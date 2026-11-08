import { t, type Language } from '@shiv/i18n';
import { Controller, Get, Inject, Injectable, Param, Post, Req, Sse } from '@nestjs/common';
import { Subject, concatMap, interval, map, merge, takeUntil, takeWhile } from 'rxjs';
import { assertSession } from './security';
import { pendingCod, pendingQuote } from './abuse';
import { z } from 'zod';
import { Db } from './db';
import { Lifecycle } from './lifecycle';
import {
  atOrder,
  atQuote,
  atWork,
  AuthRequest,
  Can,
  fail,
  Input,
  scoped,
  shopWhere,
  Firm,
} from './http';
import { enqueueWhatsApp } from './alerts';
import { money } from '@shiv/shared';
import { accessFor } from '@shiv/shared';

export const ownerSelect = { id: true, name: true, phone: true } as const;
/**
 * The alert for a new order. Catalogue names and amounts only, never the customer's own words, so
 * a message cannot talk anyone into tapping.
 */
const alertName = (value: string) =>
  value
    .replace(/[^\p{L}\p{M}\s.]/gu, ' ')
    .trim()
    .split(/\s+/)
    .slice(0, 3)
    .join(' ')
    .slice(0, 30);
export function orderAlertWords(
  order: {
    totalPaise: number;
    address: unknown;
    items: { name: string; quantity: number; packSize: string; unit: string }[];
    payment: { method: string } | null;
    user: { name: string };
    location: { name: string };
  },
  language: Language,
) {
  const [first, ...rest] = order.items;
  const firstLine = first ? `${first.quantity} ${first.packSize || first.unit} ${first.name}` : '';
  // A name and nothing else, as this sits beside a button that confirms the order.
  const name =
    alertName(order.user.name || (order.address as { name?: string } | null)?.name || '') ||
    order.location.name;
  return {
    title: t(
      'owner.alert.orderTitle',
      {
        name,
        items: rest.length
          ? t('owner.alert.moreItems', { first: firstLine, count: rest.length }, language)
          : firstLine,
      },
      language,
    ),
    body: t(
      'owner.alert.orderBody',
      {
        total: money(order.totalPaise),
        payment: t(
          order.payment?.method === 'CREDIT'
            ? 'owner.pakka.paymentCredit'
            : order.payment?.method === 'ONLINE'
              ? 'owner.pakka.paymentPaid'
              : 'owner.pakka.paymentCash',
          {},
          language,
        ),
        shop: order.location.name,
      },
      language,
    ),
  };
}
export const workInclude = {
  assignedTo: { select: ownerSelect },
  technicalOwner: { select: ownerSelect },
};
const assignment = z.strictObject({
  ownerId: z.string().min(1).max(100),
  technical: z.boolean().default(false),
});

@Injectable()
export class OwnerWorkService {
  readonly stream = new Subject<{ type: string }>();
  constructor(@Inject(Db) private db: Db) {}

  // The database inbox is authoritative. SSE is only an invalidation hint; polling recovers lost hints.
  async dispatch() {
    const pending = await this.db.ownerWork.findMany({
      where: {
        deliveredAt: null,
        nextAttemptAt: { lte: new Date() },
        // Nothing for the shop to do until the money is in, or once the order is gone.
        OR: [{ orderId: null }, { order: { status: { notIn: ['PENDING_PAYMENT', 'CANCELLED'] } } }],
      },
      take: 50,
      orderBy: { createdAt: 'asc' },
    });
    for (const work of pending) {
      try {
        await this.db.atomic(async (tx) => {
          const current = await tx.ownerWork.findUnique({ where: { id: work.id } });
          if (!current || current.deliveredAt || current.nextAttemptAt > new Date()) return;
          const owners = await tx.user.findMany({
            where: {
              role: 'ADMIN',
              deletedAt: null,
              staffPausedAt: null,
              staffMemberships: { some: { role: 'OWNER', endedAt: null } },
            },
            select: { id: true, phone: true, whatsappAlerts: true, language: true },
          });
          if (!owners.length) throw new Error('NO_OWNER');
          const alerted = work.orderId
            ? await tx.order.findUnique({
                where: { id: work.orderId },
                include: {
                  items: { orderBy: { id: 'asc' } },
                  payment: { select: { method: true } },
                  user: { select: { name: true } },
                  location: { select: { name: true } },
                },
              })
            : null;
          for (const owner of owners)
            await tx.notification.upsert({
              where: { dedupeKey: `owner:${work.id}:${owner.id}` },
              update: {},
              create: {
                userId: owner.id,
                dedupeKey: `owner:${work.id}:${owner.id}`,
                ...(alerted
                  ? orderAlertWords(alerted, owner.language === 'en' ? 'en' : 'hi')
                  : { title: t('owner.newWorkAlert'), body: t('owner.openQuoteAlert') }),
                orderId: work.orderId,
              },
            });
          // WhatsApp copies for owners who switched them on (sent by the outbox worker).
          const onWhatsapp = owners.filter((owner) => owner.whatsappAlerts);
          if (onWhatsapp.length) {
            const order = work.orderId
              ? await tx.order.findUnique({
                  where: { id: work.orderId },
                  select: { number: true, totalPaise: true, address: true },
                })
              : null;
            const quote = work.quoteId
              ? await tx.quote.findUnique({
                  where: { id: work.quoteId },
                  select: { number: true, _count: { select: { items: true } } },
                })
              : null;
            for (const owner of onWhatsapp) {
              if (order)
                await enqueueWhatsApp(tx, {
                  userId: owner.id,
                  phone: owner.phone,
                  template: 'shiv_new_order',
                  params: [
                    order.number,
                    money(order.totalPaise).replace('₹', '').trim(),
                    String((order.address as { area?: string } | null)?.area || 'Patna'),
                  ],
                  dedupeKey: `wa:owner:${work.id}:${owner.id}`,
                });
              else if (quote)
                await enqueueWhatsApp(tx, {
                  userId: owner.id,
                  phone: owner.phone,
                  template: 'shiv_new_quote',
                  params: [quote.number, String(quote._count.items)],
                  dedupeKey: `wa:owner:${work.id}:${owner.id}`,
                });
            }
          }
          await tx.ownerWork.update({
            where: { id: work.id },
            data: {
              deliveredAt: new Date(),
              attempts: { increment: 1 },
              lastError: null,
            },
          });
        });
        this.stream.next({ type: 'OWNER_WORK_UPDATED' });
      } catch (error) {
        await this.db.ownerWork.updateMany({
          where: { id: work.id, deliveredAt: null },
          data: {
            attempts: { increment: 1 },
            lastError:
              error instanceof Error && error.message === 'NO_OWNER'
                ? 'No active owner account. Set up a named owner and retry.'
                : 'Owner notification failed. Retrying automatically.',
            nextAttemptAt: new Date(
              Date.now() + Math.min(3600000, 30000 * 2 ** Math.min(work.attempts, 7)),
            ),
          },
        });
      }
    }
  }
}

@Controller('admin')
export class OwnerWorkController {
  constructor(
    @Inject(Db) private db: Db,
    @Inject(OwnerWorkService) private work: OwnerWorkService,
    @Inject(Lifecycle) private lifecycle: Lifecycle,
  ) {}

  @Firm('none')
  @Can('orders.confirm', scoped)
  @Get('owners')
  owners(@Req() req: AuthRequest) {
    const shops = shopWhere(req, 'orders.confirm');
    return this.db.user.findMany({
      where: {
        role: 'ADMIN',
        deletedAt: null,
        staffPausedAt: null,
        staffMemberships: {
          some: {
            endedAt: null,
            role: { in: ['OWNER', 'MANAGER', 'CASHIER'] },
            // People at this person's shops, and those who cover every shop.
            ...('locationId' in shops ? { OR: [{ locationId: null }, shops] } : {}),
          },
        },
      },
      // Enough to choose someone. Their number is on the staff page for those who may see it.
      select: { id: true, name: true },
      orderBy: { name: 'asc' },
    });
  }

  @Firm('shop')
  @Can('orders.confirm', scoped)
  @Get('work')
  queue(@Req() req: AuthRequest) {
    const shops = shopWhere(req, 'orders.confirm');
    return this.db.ownerWork.findMany({
      where: {
        ...('locationId' in shops
          ? { OR: [{ order: shops }, { quote: { ...shops, order: null } }] }
          : {}),
        AND: {
          OR: [
            { order: { status: { notIn: ['DELIVERED', 'CANCELLED', 'REFUNDED'] } } },
            { quote: { status: { in: ['REQUESTED', 'SENT', 'ACCEPTED'] }, order: null } },
            { lastError: { not: null } },
          ],
        },
      },
      include: workInclude,
      orderBy: { createdAt: 'asc' },
      take: 200,
    });
  }

  @Can('desk.use')
  @Sse('events')
  events(@Req() req: AuthRequest) {
    return merge(this.work.stream, interval(20000).pipe(map(() => ({ type: 'HEARTBEAT' })))).pipe(
      // Ends the stream on shutdown; the owner desk reconnects to another instance or polls.
      takeUntil(this.lifecycle.closing),
      concatMap(async (data) => {
        const session = await this.db.session.findUnique({
          where: { id: req.sessionId },
          include: {
            user: {
              include: {
                staffMemberships: {
                  where: { endedAt: null },
                  select: { role: true, locationId: true },
                },
              },
            },
          },
        });
        if (
          !session ||
          session.accessHash !== req.sessionAccessHash ||
          session.expiresAt <= new Date() ||
          session.surface === 'CUSTOMER' ||
          session.user.role !== 'ADMIN' ||
          session.user.staffPausedAt ||
          !accessFor(session.user.staffMemberships)['desk.use']
        )
          return null;
        try {
          await assertSession(this.db, session);
        } catch {
          return null;
        }
        return data;
      }),
      takeWhile((data) => data !== null),
      map((data) => ({ data })),
    );
  }
  @Can('system.ops')
  @Get('security-status')
  async securityStatus() {
    return {
      pendingCod: await this.db.order.count({ where: pendingCod }),
      pendingQuotes: await this.db.quote.count({ where: pendingQuote }),
      workers: await this.db.workerHeartbeat.findMany({ orderBy: { lane: 'asc' } }),
      overdueCod: await this.db.order.count({
        where: { ...pendingCod, createdAt: { lt: new Date(Date.now() - 2 * 3600000) } },
      }),
      warnings: await this.db.auditLog.findMany({
        where: {
          event: 'SECURITY_BUDGET_WARNING',
          createdAt: { gte: new Date(Date.now() - 86400000) },
        },
        orderBy: { createdAt: 'desc' },
        take: 20,
        select: { createdAt: true, entityId: true, details: true },
      }),
    };
  }
  @Can('orders.override')
  @Post('demand-overrides')
  async allowDemand(
    @Input(
      z.strictObject({
        phone: z.string().regex(/^\+91[6-9][0-9]{9}$/),
        kind: z.enum(['ORDER', 'QUOTE']),
        maxTotalPaise: z.number().int().min(0).max(100000000),
        reason: z.string().trim().min(10).max(300),
      }),
    )
    body: { phone: string; kind: 'ORDER' | 'QUOTE'; maxTotalPaise: number; reason: string },
    @Req() req: AuthRequest,
  ) {
    return this.db.atomic(async (tx) => {
      const user = await tx.user.findFirst({ where: { phone: body.phone, deletedAt: null } });
      if (!user) fail('NOT_FOUND', 'Customer not found.', 404);
      if (body.kind === 'ORDER' && !body.maxTotalPaise)
        fail('INVALID_INPUT', 'Enter the maximum approved total.');
      await tx.demandOverride.updateMany({
        where: { userId: user.id, kind: body.kind, usedAt: null },
        data: { expiresAt: new Date() },
      });
      const override = await tx.demandOverride.create({
        data: {
          userId: user.id,
          kind: body.kind,
          maxTotalPaise: body.maxTotalPaise,
          expiresAt: new Date(Date.now() + 30 * 60000),
        },
      });
      await tx.auditLog.create({
        data: {
          actorId: req.user.id,
          event: 'DEMAND_OVERRIDE_GRANTED',
          entityId: override.id,
          details: {
            userId: user.id,
            kind: body.kind,
            maxTotalPaise: body.maxTotalPaise,
          },
        },
      });
      return override;
    });
  }
  @Firm('shop')
  @Can('orders.confirm', atQuote())
  @Post('quotes/:id/acknowledge')
  async acknowledgeQuote(@Param('id') id: string, @Req() req: AuthRequest) {
    return this.acknowledgeEntity({ quoteId: id }, req);
  }

  @Firm('shop')
  @Can('orders.confirm', atOrder())
  @Post('orders/:id/acknowledge')
  async acknowledge(@Param('id') id: string, @Req() req: AuthRequest) {
    return this.acknowledgeEntity({ orderId: id }, req);
  }

  private async acknowledgeEntity(
    where: { orderId: string } | { quoteId: string },
    req: AuthRequest,
  ) {
    const id = 'orderId' in where ? where.orderId : where.quoteId;
    const result = await this.db.atomic(async (tx) => {
      const work = await tx.ownerWork.findUnique({ where });
      if (!work) fail('NOT_FOUND', 'Order work was not found.', 404);
      if (work.acknowledgedAt)
        return tx.ownerWork.findUniqueOrThrow({ where: { id: work.id }, include: workInclude });
      await tx.auditLog.create({
        data: {
          actorId: req.user.id,
          event: 'orderId' in where ? 'ORDER_ACKNOWLEDGED' : 'QUOTE_ACKNOWLEDGED',
          entityId: id,
          details: {},
        },
      });
      return tx.ownerWork.update({
        where: { id: work.id },
        data: { assignedToId: req.user.id, acknowledgedAt: new Date() },
        include: workInclude,
      });
    });
    this.work.stream.next({ type: 'OWNER_WORK_UPDATED' });
    return result;
  }

  @Firm('shop')
  @Can('orders.confirm', atWork())
  @Post('work/:id/assign')
  async assign(
    @Param('id') id: string,
    @Input(assignment) body: z.infer<typeof assignment>,
    @Req() req: AuthRequest,
  ) {
    return this.db.atomic(async (tx) => {
      const owner = await tx.user.findFirst({
        where: {
          id: body.ownerId,
          role: 'ADMIN',
          deletedAt: null,
          staffPausedAt: null,
          staffMemberships: {
            some: { endedAt: null, role: { in: ['OWNER', 'MANAGER', 'CASHIER'] } },
          },
        },
      });
      if (!owner || !owner.name.trim())
        fail('INVALID_OWNER', 'Choose a named active staff account.');
      const result = await tx.ownerWork.update({
        where: { id },
        data: body.technical
          ? { technicalOwnerId: owner.id }
          : { assignedToId: owner.id, acknowledgedAt: new Date() },
        include: workInclude,
      });
      await tx.auditLog.create({
        data: {
          actorId: req.user.id,
          event: 'WORK_ASSIGNED',
          entityId: id,
          details: { ownerId: body.ownerId, technical: body.technical },
        },
      });
      return result;
    });
  }

  @Firm('shop')
  @Can('orders.confirm', atWork())
  @Post('work/:id/retry')
  async retry(@Param('id') id: string) {
    await this.db.ownerWork.update({
      where: { id },
      data: { deliveredAt: null, nextAttemptAt: new Date() },
    });
    await this.work.dispatch();
    return { ok: true };
  }
}
