import { Controller, Get, Inject, Injectable, Param, Post, Req, Sse } from '@nestjs/common';
import { Subject, interval, map, merge, concatMap, takeWhile } from 'rxjs';
import { assertSession } from './security';
import { pendingCod, pendingQuote } from './abuse';
import { z } from 'zod';
import { Db } from './db';
import { Admin, AuthRequest, Input, fail } from './http';

export const ownerSelect = { id: true, name: true, phone: true } as const;
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
      where: { deliveredAt: null, nextAttemptAt: { lte: new Date() } },
      take: 50,
      orderBy: { createdAt: 'asc' },
    });
    for (const work of pending) {
      try {
        await this.db.atomic(async (tx) => {
          const current = await tx.ownerWork.findUnique({ where: { id: work.id } });
          if (!current || current.deliveredAt || current.nextAttemptAt > new Date()) return;
          const owners = await tx.user.findMany({
            where: { role: 'ADMIN', deletedAt: null },
            select: { id: true },
          });
          if (!owners.length) throw new Error('NO_OWNER');
          for (const owner of owners)
            await tx.notification.upsert({
              where: { dedupeKey: `owner:${work.id}:${owner.id}` },
              update: {},
              create: {
                userId: owner.id,
                dedupeKey: `owner:${work.id}:${owner.id}`,
                title: 'New store work / नया काम',
                body: work.orderId
                  ? 'Open Orders to acknowledge the new order.'
                  : 'Open Bulk quotes to review the request.',
                orderId: work.orderId,
              },
            });
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

@Admin()
@Controller('admin')
export class OwnerWorkController {
  constructor(
    @Inject(Db) private db: Db,
    @Inject(OwnerWorkService) private work: OwnerWorkService,
  ) {}

  @Get('owners') owners() {
    return this.db.user.findMany({
      where: { role: 'ADMIN', deletedAt: null },
      select: ownerSelect,
      orderBy: { name: 'asc' },
    });
  }

  @Get('work') queue() {
    return this.db.ownerWork.findMany({
      where: {
        OR: [
          { order: { status: { notIn: ['DELIVERED', 'CANCELLED', 'REFUNDED'] } } },
          { quote: { status: { in: ['REQUESTED', 'SENT', 'ACCEPTED'] }, order: null } },
          { lastError: { not: null } },
        ],
      },
      include: workInclude,
      orderBy: { createdAt: 'asc' },
      take: 200,
    });
  }

  @Sse('events')
  events(@Req() req: AuthRequest) {
    return merge(this.work.stream, interval(20000).pipe(map(() => ({ type: 'HEARTBEAT' })))).pipe(
      concatMap(async (data) => {
        const session = await this.db.session.findUnique({
          where: { id: req.sessionId },
          include: { user: true },
        });
        if (
          !session ||
          session.accessHash !== req.sessionAccessHash ||
          session.expiresAt <= new Date() ||
          session.user.role !== 'ADMIN'
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
  @Get('security-status')
  async securityStatus() {
    return {
      pendingCod: await this.db.order.count({ where: pendingCod }),
      pendingQuotes: await this.db.quote.count({ where: pendingQuote }),
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
            reason: body.reason,
          },
        },
      });
      return override;
    });
  }
  @Post('quotes/:id/acknowledge') async acknowledgeQuote(
    @Param('id') id: string,
    @Req() req: AuthRequest,
  ) {
    return this.acknowledgeEntity({ quoteId: id }, req);
  }

  @Post('orders/:id/acknowledge') async acknowledge(
    @Param('id') id: string,
    @Req() req: AuthRequest,
  ) {
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

  @Post('work/:id/assign') async assign(
    @Param('id') id: string,
    @Input(assignment) body: z.infer<typeof assignment>,
    @Req() req: AuthRequest,
  ) {
    return this.db.atomic(async (tx) => {
      const owner = await tx.user.findFirst({
        where: { id: body.ownerId, role: 'ADMIN', deletedAt: null },
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
        data: { actorId: req.user.id, event: 'WORK_ASSIGNED', entityId: id, details: body },
      });
      return result;
    });
  }

  @Post('work/:id/retry') async retry(@Param('id') id: string) {
    await this.db.ownerWork.update({
      where: { id },
      data: { deliveredAt: null, nextAttemptAt: new Date() },
    });
    await this.work.dispatch();
    return { ok: true };
  }
}
