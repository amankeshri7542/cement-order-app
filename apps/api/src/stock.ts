import { Controller, Get, Inject, Injectable, Param, Post, Put, Query, Req } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { Prisma } from '@prisma/client';
import {
  canDo,
  istToday,
  stockCountLineSchema,
  stockCountStartSchema,
  stockDamageSchema,
  stockReceiveSchema,
  stockTransferSchema,
  type Access,
} from '@shiv/shared';
import { z } from 'zod';
import { askApproval } from './approvals';
import { blindShops } from './blind-count';
import { Events } from './catalog';
import { Db } from './db';
import { AuthRequest, Can, Contract, fail, Input, requireAt, scoped, shopWhere } from './http';
import { moveStock } from './inventory';
import { evidenceExists } from './staff/evidence';

type Tx = Prisma.TransactionClient;
// Sold but still in the yard: the heap a person counts includes these.
const stillHere = ['PENDING_PAYMENT', 'AWAITING_CONFIRMATION', 'CONFIRMED', 'PREPARING'] as const;

/** How much of each product at this shop is promised to orders but has not left. */
async function heldAt(tx: Tx, locationId: string, productIds: string[]) {
  const rows = await tx.orderItem.groupBy({
    by: ['productId'],
    where: {
      productId: { in: productIds },
      // A walk-in takes the goods with them, so those are not in the heap being counted.
      order: { locationId, status: { in: [...stillHere] }, source: { not: 'WALK_IN' } },
    },
    _sum: { quantity: true },
  });
  return new Map(rows.map((row) => [row.productId, row._sum.quantity ?? 0]));
}

/** Whether this person is kept from seeing the book figure while their shop is being counted. */
const blindAt = (access: Access, locationId: string) =>
  !canDo(access, 'approvals.decide', locationId);

/** An owner who asks for a recount wants a second pair of eyes, not the same person again. */
async function refuseSameCounter(
  tx: Tx,
  count: { locationId: string; createdAt: Date },
  actorId: string,
) {
  const before = await tx.stockCount.findFirst({
    where: { locationId: count.locationId, createdAt: { lt: count.createdAt } },
    orderBy: { createdAt: 'desc' },
    select: { status: true, countedById: true },
  });
  if (before?.status === 'RECOUNT' && before.countedById === actorId)
    fail('RECOUNT_SOMEONE_ELSE', 'Someone else must count this again.', 403);
}

/** Writes an approved count into the book. Called only from the owner's decision. */
export async function applyCount(tx: Tx, countId: string, actorId: string) {
  const count = await tx.stockCount.findUniqueOrThrow({
    where: { id: countId },
    include: { lines: true },
  });
  if (count.status !== 'SUBMITTED') fail('COUNT_NOT_OPEN', 'This count is not waiting.', 409);
  for (const line of count.lines) {
    if (line.differenceQty) {
      await moveStock(tx, {
        productId: line.productId,
        kind: count.opening ? 'OPENING_COUNT' : 'MANUAL_ADJUSTMENT',
        quantity: line.differenceQty,
        actorId,
        reference: count.id,
        note: count.opening ? 'Opening count' : 'Count difference approved',
        idempotencyKey: `count:${count.id}:${line.productId}`,
        locationId: count.locationId,
      });
    }
    await tx.stockLevel.updateMany({
      where: { productId: line.productId, locationId: count.locationId },
      data: { countedAt: new Date() },
    });
  }
  await tx.stockCount.update({
    where: { id: countId },
    data: { status: 'APPROVED', decidedById: actorId, decidedAt: new Date() },
  });
  if (count.opening)
    await tx.location.update({
      where: { id: count.locationId },
      data: { stockStartedAt: new Date() },
    });
}

@Injectable()
export class StockService {
  constructor(
    @Inject(Db) private db: Db,
    @Inject(Events) private events: Events,
  ) {}

  /** One row per item and one figure per shop. A shop being counted hides its book figure. */
  async table(req: AuthRequest) {
    const scope = shopWhere(req, 'stock.read');
    const shops = await this.db.location.findMany({
      where: { active: true, ...(scope.locationId ? { id: scope.locationId } : {}) },
      select: { id: true, name: true, stockStartedAt: true },
      orderBy: [{ createdAt: 'asc' }],
    });
    const ids = shops.map((shop) => shop.id);
    const blind = await blindShops(this.db, req.access);
    const [products, levels, counts, moving, corrections] = await Promise.all([
      this.db.product.findMany({
        where: { active: true },
        select: {
          id: true,
          name: true,
          unit: true,
          stockMode: true,
          sourcing: true,
          category: { select: { name: true } },
        },
        orderBy: [{ categoryId: 'asc' }, { name: 'asc' }],
        take: 500,
      }),
      this.db.stockLevel.findMany({
        where: { locationId: { in: ids } },
        select: {
          productId: true,
          locationId: true,
          quantity: true,
          lowStockAt: true,
          isOn: true,
          countedAt: true,
        },
      }),
      this.db.stockCount.findMany({
        where: { locationId: { in: ids }, status: { in: ['OPEN', 'SUBMITTED'] } },
        select: { id: true, locationId: true, status: true, opening: true },
      }),
      this.db.stockTransferLine.findMany({
        where: {
          transfer: {
            status: 'SENT',
            OR: [{ fromLocationId: { in: ids } }, { toLocationId: { in: ids } }],
          },
        },
        select: { productId: true, sentQty: true },
      }),
      // A correction since the opening count restarts the clean days.
      this.db.stockCount.findMany({
        where: {
          locationId: { in: ids },
          status: 'APPROVED',
          lines: { some: { differenceQty: { not: 0 } } },
          opening: false,
        },
        select: { locationId: true, decidedAt: true },
        orderBy: { decidedAt: 'desc' },
      }),
    ]);
    const onTheRoad = new Map<string, number>();
    for (const line of moving)
      onTheRoad.set(line.productId, (onTheRoad.get(line.productId) ?? 0) + line.sentQty);
    const today = Date.parse(`${istToday()}T00:00:00Z`);
    const dayOf = (at: Date) => Date.parse(`${istToday(at)}T00:00:00Z`);
    const shopRows = shops.map((shop) => {
      const open = counts.find((count) => count.locationId === shop.id) ?? null;
      const last = corrections.find((row) => row.locationId === shop.id)?.decidedAt ?? null;
      const since =
        last && shop.stockStartedAt && last > shop.stockStartedAt ? last : shop.stockStartedAt;
      return {
        id: shop.id,
        name: shop.name,
        stockStartedAt: shop.stockStartedAt,
        cleanDays: since ? Math.max(0, Math.round((today - dayOf(since)) / 86400000)) : null,
        openCount: open,
        hidden: blind.has(shop.id),
      };
    });
    return {
      shops: shopRows,
      items: products.map((product) => ({
        id: product.id,
        name: product.name,
        unit: product.unit,
        category: product.category.name,
        stockMode: product.stockMode,
        sourcing: product.sourcing,
        onTheRoad: onTheRoad.get(product.id) ?? 0,
        shops: shopRows.map((shop) => {
          const level = levels.find(
            (row) => row.productId === product.id && row.locationId === shop.id,
          );
          return {
            locationId: shop.id,
            quantity: shop.hidden ? null : (level?.quantity ?? 0),
            lowStockAt: level?.lowStockAt ?? 25,
            isOn: level?.isOn ?? true,
            countedAt: level?.countedAt ?? null,
          };
        }),
      })),
    };
  }

  // ---- Transfers ----------------------------------------------------------------------------
  async send(body: z.infer<typeof stockTransferSchema>, req: AuthRequest) {
    requireAt(req, 'stock.transfer', body.fromLocationId);
    if (body.fromLocationId === body.toLocationId)
      fail('SAME_SHOP', 'Choose a different shop to send to.', 400);
    const result = await this.db.atomic(async (tx) => {
      const earlier = await tx.stockTransfer.findUnique({
        where: { idempotencyKey: body.idempotencyKey },
        include: { lines: true },
      });
      if (earlier) {
        const same =
          earlier.sentById === req.user.id &&
          earlier.fromLocationId === body.fromLocationId &&
          earlier.toLocationId === body.toLocationId &&
          earlier.lines.length === body.lines.length &&
          body.lines.every((line) =>
            earlier.lines.some(
              (row) => row.productId === line.productId && row.sentQty === line.quantity,
            ),
          );
        if (!same) fail('IDEMPOTENCY_CONFLICT', 'This request was used for something else.', 409);
        return earlier;
      }
      const to = await tx.location.findUnique({ where: { id: body.toLocationId } });
      if (!to?.active) fail('INVALID_SHOP', 'That shop is not open on this system.', 400);
      // Each firm's stock is its own, even under one roof. Goods cross to the other firm only as a
      // sale bill from one and a purchase in the other ("Bill banake bhejo"), never as a transfer.
      const from = await tx.location.findUnique({
        where: { id: body.fromLocationId },
        select: { firmId: true },
      });
      if (from?.firmId !== to.firmId)
        fail('OTHER_FIRM', 'Stock goes to the other firm only with a bill.', 409);
      const transfer = await tx.stockTransfer.create({
        data: {
          fromLocationId: body.fromLocationId,
          toLocationId: body.toLocationId,
          vehicle: body.vehicle ?? '',
          carrierName: body.carrierName ?? '',
          note: body.note ?? '',
          sentById: req.user.id,
          idempotencyKey: body.idempotencyKey,
          lines: {
            create: body.lines.map((line) => ({
              productId: line.productId,
              sentQty: line.quantity,
            })),
          },
        },
        include: { lines: true },
      });
      for (const line of body.lines)
        await moveStock(tx, {
          productId: line.productId,
          kind: 'TRANSFER_OUT',
          quantity: -line.quantity,
          actorId: req.user.id,
          reference: transfer.id,
          note: 'Sent to another shop',
          idempotencyKey: `transfer:${transfer.id}:out:${line.productId}`,
          locationId: body.fromLocationId,
        });
      await tx.auditLog.create({
        data: {
          actorId: req.user.id,
          event: 'STOCK_TRANSFER_SENT',
          entityId: transfer.id,
          locationId: body.fromLocationId,
          details: { to: body.toLocationId, lines: body.lines },
        },
      });
      return transfer;
    });
    this.events.publish({ type: 'CATALOG_UPDATED' });
    return result;
  }

  /** Joins this shop's count only when someone here has counted it. Never settled by itself. */
  async receive(id: string, body: z.infer<typeof stockReceiveSchema>, req: AuthRequest) {
    const result = await this.db.atomic(async (tx) => {
      const transfer = await tx.stockTransfer.findUnique({
        where: { id },
        include: { lines: true },
      });
      if (!transfer) fail('NOT_FOUND', 'That transfer is not here.', 404);
      requireAt(req, 'stock.transfer', transfer.toLocationId);
      if (transfer.status !== 'SENT') fail('TRANSFER_DONE', 'This was already received.', 409);
      if (transfer.sentById === req.user.id)
        fail('SAME_PERSON', 'Someone else must count this in.', 403);
      if (
        body.lines.length !== transfer.lines.length ||
        !transfer.lines.every((line) => body.lines.some((row) => row.productId === line.productId))
      )
        fail('INVALID_INPUT', 'Count every item on this transfer.');
      let different = false;
      let differentPaise = 0;
      for (const line of transfer.lines) {
        const receivedQty = body.lines.find((row) => row.productId === line.productId)!.receivedQty;
        if (receivedQty !== line.sentQty) different = true;
        await tx.stockTransferLine.update({
          where: { transferId_productId: { transferId: id, productId: line.productId } },
          data: { receivedQty },
        });
        // More than was sent cannot be sold until an owner has agreed it is really here.
        const credited = Math.min(receivedQty, line.sentQty);
        if (credited > 0)
          await moveStock(tx, {
            productId: line.productId,
            kind: 'TRANSFER_IN',
            quantity: credited,
            actorId: req.user.id,
            reference: id,
            note: 'Received from another shop',
            idempotencyKey: `transfer:${id}:in:${line.productId}`,
            locationId: transfer.toLocationId,
          });
        if (receivedQty !== line.sentQty) {
          const product = await tx.product.findUniqueOrThrow({
            where: { id: line.productId },
            select: { pricePaise: true },
          });
          differentPaise += Math.abs(line.sentQty - receivedQty) * product.pricePaise;
        }
      }
      const moved = await tx.stockTransfer.updateMany({
        where: { id, status: 'SENT' },
        data: {
          status: different ? 'DIFFERENT' : 'RECEIVED',
          receivedById: req.user.id,
          receivedAt: new Date(),
        },
      });
      if (!moved.count) fail('TRANSFER_DONE', 'This was already received.', 409);
      if (different)
        await askApproval(tx, {
          kind: 'TRANSFER_SHORTAGE',
          locationId: transfer.toLocationId,
          amountPaise: differentPaise,
          payload: { transferId: id },
          requestedById: req.user.id,
          idempotencyKey: `transfer:${id}`,
        });
      await tx.auditLog.create({
        data: {
          actorId: req.user.id,
          event: different ? 'STOCK_TRANSFER_DIFFERENT' : 'STOCK_TRANSFER_RECEIVED',
          entityId: id,
          locationId: transfer.toLocationId,
          details: { lines: body.lines },
        },
      });
      return tx.stockTransfer.findUniqueOrThrow({ where: { id }, include: { lines: true } });
    });
    this.events.publish({ type: 'CATALOG_UPDATED' });
    return result;
  }

  // ---- Blind counts -------------------------------------------------------------------------
  async startCount(body: z.infer<typeof stockCountStartSchema>, req: AuthRequest) {
    requireAt(req, 'stock.count', body.locationId);
    return this.db.atomic(async (tx) => {
      const shop = await tx.location.findUnique({ where: { id: body.locationId } });
      if (!shop?.active) fail('INVALID_SHOP', 'That shop is not open on this system.', 400);
      const open = await tx.stockCount.findFirst({
        where: { locationId: body.locationId, status: { in: ['OPEN', 'SUBMITTED'] } },
        select: { id: true },
      });
      if (open) fail('COUNT_OPEN', 'A count is already going on at this shop.', 409);
      await refuseSameCounter(
        tx,
        { locationId: body.locationId, createdAt: new Date() },
        req.user.id,
      );
      const products = await tx.product.findMany({
        where: {
          active: true,
          stockMode: 'COUNTED',
          ...(body.productIds ? { id: { in: body.productIds } } : {}),
        },
        select: { id: true },
        take: 500,
      });
      if (!products.length || (body.productIds && products.length !== body.productIds.length))
        fail('INVALID_INPUT', 'Choose items that are counted and on the list.');
      const count = await tx.stockCount.create({
        data: {
          locationId: body.locationId,
          opening: body.opening,
          startedById: req.user.id,
          lines: { create: products.map((product) => ({ productId: product.id })) },
        },
      });
      await tx.auditLog.create({
        data: {
          actorId: req.user.id,
          event: 'STOCK_COUNT_STARTED',
          entityId: count.id,
          locationId: body.locationId,
          details: { opening: body.opening, items: products.length },
        },
      });
      return { id: count.id };
    });
  }

  /** What the person counting sees: names and their own boxes. Book figures only after submit. */
  async readCount(id: string, req: AuthRequest) {
    const count = await this.db.stockCount.findUnique({
      where: { id },
      include: {
        lines: {
          include: { product: { select: { name: true, unit: true } } },
          orderBy: { productId: 'asc' },
        },
      },
    });
    if (!count) fail('NOT_FOUND', 'That count is not here.', 404);
    requireAt(req, 'stock.read', count.locationId);
    const sees = !blindAt(req.access, count.locationId) && count.status !== 'OPEN';
    return {
      id: count.id,
      locationId: count.locationId,
      status: count.status,
      opening: count.opening,
      submittedAt: count.submittedAt,
      lines: count.lines.map((line) => ({
        productId: line.productId,
        name: line.product.name,
        unit: line.product.unit,
        countedQty: line.countedQty,
        ...(sees
          ? {
              systemQty: line.systemQty,
              heldQty: line.heldQty,
              differenceQty: line.differenceQty,
            }
          : {}),
      })),
    };
  }

  /** Saved one line at a time, so a dropped network loses nothing. */
  async saveLine(id: string, body: z.infer<typeof stockCountLineSchema>, req: AuthRequest) {
    return this.db.atomic(async (tx) => {
      const count = await tx.stockCount.findUnique({ where: { id } });
      if (!count) fail('NOT_FOUND', 'That count is not here.', 404);
      requireAt(req, 'stock.count', count.locationId);
      if (count.status !== 'OPEN') fail('COUNT_NOT_OPEN', 'This count is closed.', 409);
      await refuseSameCounter(tx, count, req.user.id);
      // The book as it stands now. Goods sold after this was counted must not look like a surplus.
      const [level, held] = await Promise.all([
        tx.stockLevel.findUnique({
          where: {
            productId_locationId: { productId: body.productId, locationId: count.locationId },
          },
          select: { quantity: true },
        }),
        heldAt(tx, count.locationId, [body.productId]),
      ]);
      const heldQty = held.get(body.productId) ?? 0;
      const moved = await tx.stockCountLine.updateMany({
        where: { countId: id, productId: body.productId },
        data: {
          countedQty: body.countedQty,
          heldQty,
          systemQty: (level?.quantity ?? 0) + heldQty,
        },
      });
      if (!moved.count) fail('NOT_IN_COUNT', 'That item is not in this count.', 404);
      await tx.stockCount.update({ where: { id }, data: { countedById: req.user.id } });
      return { ok: true };
    });
  }

  /** Fixes the book figure at this moment, and sends any difference to an owner. */
  async submitCount(id: string, req: AuthRequest) {
    return this.db.atomic(async (tx) => {
      const count = await tx.stockCount.findUnique({
        where: { id },
        include: { lines: { include: { product: { select: { pricePaise: true } } } } },
      });
      if (!count) fail('NOT_FOUND', 'That count is not here.', 404);
      requireAt(req, 'stock.count', count.locationId);
      if (count.status !== 'OPEN') fail('COUNT_NOT_OPEN', 'This count is closed.', 409);
      await refuseSameCounter(tx, count, req.user.id);
      if (count.lines.some((line) => line.countedQty === null))
        fail('COUNT_NOT_FINISHED', 'Count every item before sending.', 409);
      let differentPaise = 0;
      let differs = false;
      for (const line of count.lines) {
        const differenceQty = line.countedQty! - line.systemQty!;
        if (differenceQty) differs = true;
        differentPaise += Math.abs(differenceQty) * line.product.pricePaise;
        await tx.stockCountLine.update({
          where: { countId_productId: { countId: id, productId: line.productId } },
          data: { differenceQty },
        });
      }
      await tx.stockCount.update({
        where: { id },
        data: { status: 'SUBMITTED', submittedAt: new Date(), countedById: req.user.id },
      });
      await tx.auditLog.create({
        data: {
          actorId: req.user.id,
          event: 'STOCK_COUNT_SUBMITTED',
          entityId: id,
          locationId: count.locationId,
          details: { differs, opening: count.opening },
        },
      });
      // Nothing to correct, and a daily count needs no one's approval. An opening count always does.
      if (!differs && !count.opening) {
        await applyCount(tx, id, req.user.id);
        return { status: 'APPROVED' as const };
      }
      await askApproval(tx, {
        kind: 'COUNT_CORRECTION',
        locationId: count.locationId,
        amountPaise: differentPaise,
        payload: { countId: id, opening: count.opening },
        requestedById: req.user.id,
        idempotencyKey: `count:${id}`,
      });
      return { status: 'SUBMITTED' as const };
    });
  }

  /** Damage is reported here and written down only when an owner agrees. */
  async reportDamage(body: z.infer<typeof stockDamageSchema>, req: AuthRequest) {
    requireAt(req, 'stock.report', body.locationId);
    if (body.evidenceId) await evidenceExists(this.db, body.evidenceId, req.user.id);
    return this.db.atomic(async (tx) => {
      const product = await tx.product.findUnique({
        where: { id: body.productId },
        select: { pricePaise: true },
      });
      if (!product) fail('NOT_FOUND', 'That product is not on the list.', 404);
      const asked = await askApproval(tx, {
        kind: 'STOCK_DAMAGE',
        locationId: body.locationId,
        amountPaise: product.pricePaise * body.quantity,
        payload: {
          productId: body.productId,
          quantity: body.quantity,
          ...(body.evidenceId ? { evidenceId: body.evidenceId } : {}),
        },
        note: body.note,
        requestedById: req.user.id,
        idempotencyKey: `damage:${body.idempotencyKey}`,
      });
      // A stock keeper does not see rupees.
      return { id: asked.id, kind: asked.kind, status: asked.status };
    });
  }

  async transfers(query: Record<string, string>, req: AuthRequest) {
    const scope = shopWhere(req, 'stock.read');
    const shops = scope.locationId?.in;
    const rows = await this.db.stockTransfer.findMany({
      where: {
        ...(shops
          ? { OR: [{ fromLocationId: { in: shops } }, { toLocationId: { in: shops } }] }
          : {}),
        ...(query.open === 'true' ? { status: { in: ['SENT', 'DIFFERENT'] as const } } : {}),
      },
      include: {
        from: { select: { name: true } },
        to: { select: { name: true } },
        lines: { include: { product: { select: { name: true, unit: true } } } },
      },
      orderBy: { sentAt: 'desc' },
      take: 50,
    });
    const people = await this.db.user.findMany({
      where: {
        id: { in: rows.flatMap((row) => [row.sentById, row.receivedById ?? row.sentById]) },
      },
      select: { id: true, name: true },
    });
    const nameOf = (id: string | null) => people.find((person) => person.id === id)?.name ?? '';
    return {
      items: rows.map((row) => ({
        id: row.id,
        status: row.status,
        fromLocationId: row.fromLocationId,
        toLocationId: row.toLocationId,
        fromName: row.from.name,
        toName: row.to.name,
        vehicle: row.vehicle,
        carrierName: row.carrierName,
        sentAt: row.sentAt,
        sentByName: nameOf(row.sentById),
        receivedAt: row.receivedAt,
        receivedByName: nameOf(row.receivedById),
        canReceive:
          row.status === 'SENT' &&
          row.sentById !== req.user.id &&
          canDo(req.access, 'stock.transfer', row.toLocationId),
        lines: row.lines.map((line) => ({
          productId: line.productId,
          name: line.product.name,
          unit: line.product.unit,
          sentQty: line.sentQty,
          receivedQty: line.receivedQty,
        })),
      })),
    };
  }
}

@ApiTags('Stock')
@Controller('admin/stock')
export class StockController {
  constructor(@Inject(StockService) private stock: StockService) {}

  @Can('stock.read', scoped) @Get() table(@Req() req: AuthRequest) {
    return this.stock.table(req);
  }
  @Can('stock.read', scoped) @Get('transfers') transfers(
    @Query() query: Record<string, string>,
    @Req() req: AuthRequest,
  ) {
    return this.stock.transfers(query, req);
  }
  @Can('stock.transfer', scoped)
  @Post('transfers')
  @Contract(stockTransferSchema)
  send(
    @Input(stockTransferSchema) body: z.infer<typeof stockTransferSchema>,
    @Req() req: AuthRequest,
  ) {
    return this.stock.send(body, req);
  }
  @Can('stock.transfer', scoped)
  @Post('transfers/:id/receive')
  @Contract(stockReceiveSchema)
  receive(
    @Param('id') id: string,
    @Input(stockReceiveSchema) body: z.infer<typeof stockReceiveSchema>,
    @Req() req: AuthRequest,
  ) {
    return this.stock.receive(id, body, req);
  }
  @Can('stock.count', scoped)
  @Post('counts')
  @Contract(stockCountStartSchema)
  startCount(
    @Input(stockCountStartSchema) body: z.infer<typeof stockCountStartSchema>,
    @Req() req: AuthRequest,
  ) {
    return this.stock.startCount(body, req);
  }
  @Can('stock.read', scoped) @Get('counts/:id') readCount(
    @Param('id') id: string,
    @Req() req: AuthRequest,
  ) {
    return this.stock.readCount(id, req);
  }
  @Can('stock.count', scoped)
  @Put('counts/:id/lines')
  @Contract(stockCountLineSchema)
  saveLine(
    @Param('id') id: string,
    @Input(stockCountLineSchema) body: z.infer<typeof stockCountLineSchema>,
    @Req() req: AuthRequest,
  ) {
    return this.stock.saveLine(id, body, req);
  }
  @Can('stock.count', scoped) @Post('counts/:id/submit') submit(
    @Param('id') id: string,
    @Req() req: AuthRequest,
  ) {
    return this.stock.submitCount(id, req);
  }
  @Can('stock.report', scoped)
  @Post('damage')
  @Contract(stockDamageSchema)
  damage(
    @Input(stockDamageSchema) body: z.infer<typeof stockDamageSchema>,
    @Req() req: AuthRequest,
  ) {
    return this.stock.reportDamage(body, req);
  }
}
