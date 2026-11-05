import { Controller, Get, Inject, Injectable, Param, Post, Query, Req } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Prisma } from '@prisma/client';
import { approvalDecideSchema, canDo, orderAskOwnerSchema, type OrderChanges } from '@shiv/shared';
import { t } from '@shiv/i18n';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { Events } from './catalog';
import { ConfirmService } from './confirm';
import { Db } from './db';
import {
  atOrder,
  AuthRequest,
  Can,
  Contract,
  fail,
  Input,
  requireAt,
  scoped,
  shopWhere,
} from './http';
import { moveStock } from './inventory';
import { bigChange } from './price-rules';
import { applyCount } from './stock';

type Tx = Prisma.TransactionClient;
export type ApprovalKind =
  | 'COUNT_CORRECTION'
  | 'STOCK_DAMAGE'
  | 'TRANSFER_SHORTAGE'
  | 'RATE_CHANGE'
  | 'ORDER_CONFIRM'
  | 'ADVANCE';

// A big count must still reach an owner, even when its value is more than the column can hold.
const storedAmount = (paise: number | null) =>
  paise === null ? null : Math.min(paise, 2_147_483_647);

/** Puts a question to the owners, and tells them on their phones. Same key, same question. */
export async function askApproval(
  tx: Tx,
  input: {
    kind: ApprovalKind;
    locationId: string | null;
    amountPaise: number | null;
    payload: Prisma.InputJsonValue;
    requestedById: string;
    idempotencyKey: string;
    note?: string;
  },
) {
  const earlier = await tx.approvalRequest.findUnique({
    where: { idempotencyKey: input.idempotencyKey },
  });
  if (earlier) {
    if (earlier.requestedById !== input.requestedById || earlier.kind !== input.kind)
      fail('IDEMPOTENCY_CONFLICT', 'This request was used for something else.', 409);
    return earlier;
  }
  const request = await tx.approvalRequest.create({
    data: {
      kind: input.kind,
      locationId: input.locationId,
      amountPaise: storedAmount(input.amountPaise),
      payload: input.payload,
      requestedById: input.requestedById,
      idempotencyKey: input.idempotencyKey,
      note: input.note ?? '',
    },
  });
  const owners = await tx.user.findMany({
    where: {
      role: 'ADMIN',
      deletedAt: null,
      staffPausedAt: null,
      id: { not: input.requestedById },
      staffMemberships: { some: { role: 'OWNER', endedAt: null } },
    },
    select: { id: true, language: true },
  });
  for (const owner of owners) {
    const language = owner.language === 'en' ? 'en' : 'hi';
    await tx.notification.create({
      data: {
        userId: owner.id,
        dedupeKey: `approval:${request.id}:${owner.id}`,
        title: t('owner.approval.pushTitle', {}, language),
        // The kind only: what someone typed never reaches a lock screen.
        body: t(`owner.approval.kind.${input.kind}`, {}, language),
      },
    });
  }
  await tx.auditLog.create({
    data: {
      actorId: input.requestedById,
      event: 'APPROVAL_ASKED',
      entityId: request.id,
      locationId: input.locationId,
      details: { kind: input.kind, amountPaise: storedAmount(input.amountPaise) },
    },
  });
  return request;
}

type Payload = {
  countId?: string;
  transferId?: string;
  productId?: string;
  quantity?: number;
  orderId?: string;
  expectedVersion?: number;
  changes?: OrderChanges;
  rates?: { productId: string; pricePaise: number; expectedVersion: number }[];
  evidenceId?: string;
};

@Injectable()
export class ApprovalsService {
  constructor(
    @Inject(Db) private db: Db,
    @Inject(ConfirmService) private confirms: ConfirmService,
    @Inject(Events) private events: Events,
  ) {}

  /** Registered by the pricing service, which would otherwise be a circular import. */
  giveAdvance?: (
    tx: Tx,
    payload: unknown,
    actorId: string,
    approvedById: string,
  ) => Promise<unknown>;
  publishRates?: (
    tx: Tx,
    payload: unknown,
    actorId: string,
  ) => Promise<{ productId: string; priceVersion: number }[]>;

  async decide(id: string, body: z.infer<typeof approvalDecideSchema>, req: AuthRequest) {
    let rates: { productId: string; priceVersion: number }[] = [];
    const decided = await this.db.atomic(async (tx) => {
      const request = await tx.approvalRequest.findUnique({ where: { id } });
      if (!request) fail('NOT_FOUND_APPROVAL', 'That request is not here.', 404);
      requireAt(req, 'approvals.decide', request.locationId ?? undefined);
      if (request.requestedById === req.user.id)
        fail('OWN_REQUEST', 'Someone else must decide what you asked.', 403);
      if (request.status !== 'PENDING')
        fail('ALREADY_DECIDED', 'This was already decided.', 409, { status: request.status });
      const payload = request.payload as Payload;
      const actor = { id: req.user.id, access: req.access };
      const approve = body.decision === 'APPROVE';
      if (request.kind === 'COUNT_CORRECTION') {
        if (approve) await applyCount(tx, payload.countId!, req.user.id);
        else
          await tx.stockCount.update({
            where: { id: payload.countId! },
            data: { status: 'RECOUNT', decidedById: req.user.id, decidedAt: new Date() },
          });
      } else if (request.kind === 'STOCK_DAMAGE') {
        if (approve)
          await moveStock(tx, {
            productId: payload.productId!,
            kind: 'DAMAGE',
            quantity: -payload.quantity!,
            actorId: req.user.id,
            reference: request.id,
            note: 'Damage approved',
            idempotencyKey: `damage:${request.id}`,
            locationId: request.locationId!,
          });
      } else if (request.kind === 'TRANSFER_SHORTAGE') {
        if (approve) {
          const transfer = await tx.stockTransfer.update({
            where: { id: payload.transferId! },
            data: { status: 'SETTLED' },
            include: { lines: true },
          });
          // Only now does anything beyond what was sent join what can be sold.
          for (const line of transfer.lines) {
            const extra = (line.receivedQty ?? 0) - line.sentQty;
            if (extra > 0)
              await moveStock(tx, {
                productId: line.productId,
                kind: 'TRANSFER_IN',
                quantity: extra,
                actorId: req.user.id,
                reference: transfer.id,
                note: 'Extra goods agreed by an owner',
                idempotencyKey: `transfer:${transfer.id}:extra:${line.productId}`,
                locationId: transfer.toLocationId,
              });
          }
        }
      } else if (request.kind === 'ORDER_CONFIRM') {
        if (approve)
          await this.confirms.confirmIn(
            tx,
            payload.orderId!,
            {
              expectedVersion: payload.expectedVersion!,
              decisionKey: randomUUID(),
              // Passing an udhaar limit is said out loud on the card, or it does not happen.
              changes: { ...payload.changes!, overrideLimit: body.overrideLimit === true },
            },
            actor,
          );
      } else if (request.kind === 'ADVANCE') {
        if (approve) {
          if (!this.giveAdvance) fail('INVALID_INPUT', 'Advances cannot be given right now.');
          await this.giveAdvance(tx, payload, req.user.id, req.user.id);
        }
      } else if (request.kind === 'RATE_CHANGE') {
        if (approve) {
          if (!this.publishRates) fail('INVALID_INPUT', 'Rates cannot be published right now.');
          rates = await this.publishRates(tx, payload, req.user.id);
        }
      } else fail('INVALID_INPUT', 'This kind of request is not known.');
      const moved = await tx.approvalRequest.updateMany({
        where: { id, status: 'PENDING' },
        data: {
          status: approve ? 'APPROVED' : 'REJECTED',
          decidedById: req.user.id,
          decidedAt: new Date(),
          decisionNote: body.note ?? '',
        },
      });
      if (!moved.count) fail('ALREADY_DECIDED', 'This was already decided.', 409);
      await tx.auditLog.create({
        data: {
          actorId: req.user.id,
          event: approve ? 'APPROVAL_GRANTED' : 'APPROVAL_REFUSED',
          entityId: id,
          locationId: request.locationId,
          details: { kind: request.kind, amountPaise: request.amountPaise },
        },
      });
      return { id, status: approve ? 'APPROVED' : 'REJECTED' };
    });
    // Screens already open should not wait for their next read.
    for (const rate of rates) this.events.publish({ type: 'PRODUCT_PRICE_UPDATED', ...rate });
    if (decided.status === 'APPROVED') this.confirms.changed();
    return decided;
  }

  /** What is waiting for this person, and what they themselves asked. */
  async list(query: Record<string, string>, req: AuthRequest) {
    const decides = Boolean(req.access['approvals.decide']);
    const scope = shopWhere(req, 'approvals.decide');
    const rows = await this.db.approvalRequest.findMany({
      where: {
        ...(query.status === 'all' ? {} : { status: 'PENDING' }),
        ...(decides ? scope : { requestedById: req.user.id }),
      },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
    const people = await this.db.user.findMany({
      where: { id: { in: [...new Set(rows.flatMap((row) => [row.requestedById]))] } },
      select: { id: true, name: true },
    });
    const shops = await this.db.location.findMany({ select: { id: true, name: true } });
    return {
      items: await Promise.all(
        rows.map(async (row) => ({
          id: row.id,
          kind: row.kind,
          status: row.status,
          amountPaise: this.amountFor(row, req),
          note: row.note,
          decisionNote: row.decisionNote,
          createdAt: row.createdAt,
          decidedAt: row.decidedAt,
          requestedByName: people.find((person) => person.id === row.requestedById)?.name ?? '',
          shopName: shops.find((shop) => shop.id === row.locationId)?.name ?? '',
          canDecide:
            row.status === 'PENDING' &&
            row.requestedById !== req.user.id &&
            canDo(req.access, 'approvals.decide', row.locationId ?? undefined),
          // The facts are for the person deciding. A count's would give the book figure away.
          detail: canDo(req.access, 'approvals.decide', row.locationId ?? undefined)
            ? await this.detail(row, req)
            : null,
        })),
      ),
    };
  }

  /** Rupees only for those who see money, and never a count's: it divides back into a figure. */
  private amountFor(
    row: { kind: string; locationId: string | null; amountPaise: number | null },
    req: AuthRequest,
  ) {
    const shop = row.locationId ?? undefined;
    if (canDo(req.access, 'approvals.decide', shop)) return row.amountPaise;
    if (row.kind === 'COUNT_CORRECTION') return null;
    return canDo(req.access, 'orders.read.money', shop) ? row.amountPaise : null;
  }

  /** The facts an owner needs to decide, in numbers and catalogue names. */
  private async detail(row: { kind: string; payload: Prisma.JsonValue }, req: AuthRequest) {
    const payload = row.payload as Payload;
    if (row.kind === 'ADVANCE') {
      const asked = row.payload as {
        userId?: string;
        amountPaise?: number;
        recoveryPaise?: number;
        channel?: string;
        paidFrom?: string;
      };
      const person = asked.userId
        ? await this.db.user.findUnique({
            where: { id: asked.userId },
            select: { name: true },
          })
        : null;
      return {
        name: person?.name ?? '',
        amountPaise: asked.amountPaise ?? 0,
        recoveryPaise: asked.recoveryPaise ?? 0,
        // Approving records this payment, so the owner sees where the money comes from.
        channel: asked.channel ?? 'CASH',
        paidFrom: asked.paidFrom ?? 'OWNER',
      };
    }
    if (row.kind === 'RATE_CHANGE') {
      const asked = payload.rates ?? [];
      const products = await this.db.product.findMany({
        where: { id: { in: asked.map((rate) => rate.productId) } },
        select: { id: true, name: true, unit: true, pricePaise: true, version: true },
      });
      return {
        rates: asked.map((rate) => {
          const product = products.find((row) => row.id === rate.productId);
          return {
            productId: rate.productId,
            name: product?.name ?? '',
            unit: product?.unit ?? '',
            fromPaise: product?.pricePaise ?? 0,
            toPaise: rate.pricePaise,
            big: product ? bigChange(product.pricePaise, rate.pricePaise) : false,
            stale: !product || product.version !== rate.expectedVersion,
          };
        }),
      };
    }
    if (row.kind === 'COUNT_CORRECTION') {
      const lines = await this.db.stockCountLine.findMany({
        where: { countId: payload.countId! },
        include: { product: { select: { name: true, unit: true } } },
      });
      return {
        opening: (payload as { opening?: boolean }).opening ?? false,
        lines: lines
          .filter((line) => line.differenceQty)
          .map((line) => ({
            name: line.product.name,
            unit: line.product.unit,
            system: line.systemQty,
            counted: line.countedQty,
            difference: line.differenceQty,
          })),
      };
    }
    if (row.kind === 'STOCK_DAMAGE') {
      const product = await this.db.product.findUnique({
        where: { id: payload.productId! },
        select: { name: true, unit: true },
      });
      return {
        name: product?.name ?? '',
        unit: product?.unit ?? '',
        quantity: payload.quantity,
        evidenceId: payload.evidenceId ?? null,
      };
    }
    if (row.kind === 'TRANSFER_SHORTAGE') {
      const transfer = await this.db.stockTransfer.findUnique({
        where: { id: payload.transferId! },
        include: {
          from: { select: { name: true } },
          to: { select: { name: true } },
          lines: { include: { product: { select: { name: true, unit: true } } } },
        },
      });
      return {
        fromName: transfer?.from.name ?? '',
        toName: transfer?.to.name ?? '',
        lines: (transfer?.lines ?? [])
          .filter((line) => line.receivedQty !== line.sentQty)
          .map((line) => ({
            name: line.product.name,
            unit: line.product.unit,
            sent: line.sentQty,
            received: line.receivedQty,
          })),
      };
    }
    if (row.kind === 'ORDER_CONFIRM') {
      return this.confirms.askedFacts(
        payload.orderId!,
        payload.expectedVersion!,
        payload.changes!,
        {
          id: req.user.id,
          access: req.access,
        },
      );
    }
    return row.payload;
  }

  /** A manager asks an owner to confirm what is beyond their own limit. The order keeps waiting. */
  async askForOrder(id: string, body: z.infer<typeof orderAskOwnerSchema>, req: AuthRequest) {
    return this.db.atomic(async (tx) => {
      const order = await tx.order.findUnique({
        where: { id },
        select: { status: true, version: true, locationId: true, totalPaise: true },
      });
      if (!order) fail('ORDER_NOT_FOUND', 'Order not found.', 404);
      if (order.status !== 'AWAITING_CONFIRMATION' || order.version !== body.expectedVersion)
        fail('ORDER_CHANGED', 'This order changed. Look at it again.', 409);
      const asked = await askApproval(tx, {
        kind: 'ORDER_CONFIRM',
        locationId: order.locationId,
        amountPaise: order.totalPaise,
        payload: {
          orderId: id,
          expectedVersion: body.expectedVersion,
          changes: body.changes,
        } as unknown as Prisma.InputJsonValue,
        requestedById: req.user.id,
        idempotencyKey: `order:${body.idempotencyKey}`,
        ...(body.note ? { note: body.note } : {}),
      });
      return { id: asked.id, kind: asked.kind, status: asked.status };
    });
  }
}

@ApiTags('Manzoori')
@Controller('admin')
export class ApprovalsController {
  constructor(@Inject(ApprovalsService) private approvals: ApprovalsService) {}

  @Can('approvals.ask', scoped) @Get('approvals') list(
    @Query() query: Record<string, string>,
    @Req() req: AuthRequest,
  ) {
    return this.approvals.list(query, req);
  }
  @Can('approvals.decide', scoped)
  @Post('approvals/:id/decide')
  @Contract(approvalDecideSchema)
  decide(
    @Param('id') id: string,
    @Input(approvalDecideSchema) body: z.infer<typeof approvalDecideSchema>,
    @Req() req: AuthRequest,
  ) {
    return this.approvals.decide(id, body, req);
  }
  @Can('orders.change', atOrder())
  @Post('orders/:id/ask-owner')
  @Contract(orderAskOwnerSchema)
  askForOrder(
    @Param('id') id: string,
    @Input(orderAskOwnerSchema) body: z.infer<typeof orderAskOwnerSchema>,
    @Req() req: AuthRequest,
  ) {
    return this.approvals.askForOrder(id, body, req);
  }
}
