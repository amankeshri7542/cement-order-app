import { randomBytes, randomUUID } from 'node:crypto';
import {
  Controller,
  Get,
  HttpException,
  Inject,
  Injectable,
  Param,
  Post,
  Req,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { Prisma } from '@prisma/client';
import { t, type Language, readLanguage } from '@shiv/i18n';
import {
  accessFor,
  canDo,
  istToday,
  khataBalance,
  money,
  orderConfirmSchema,
  orderPreviewSchema,
  orderRefuseSchema,
  orderStatusText,
  orderUndoSchema,
  pushActionSchema,
  type Access,
  type InboxCard,
  type OrderChanges,
  type Permission,
  type RefusalReason,
  siteLanguage,
} from '@shiv/shared';
import { z } from 'zod';
import { enqueueWhatsApp } from './alerts';
import { Events } from './catalog';
import { getConfig } from './config';
import { Db } from './db';
import { creditFigures } from './firms';
import {
  atOrder,
  AuthRequest,
  Can,
  Contract,
  fail,
  hash,
  Input,
  Public,
  scoped,
  shopAsked,
  Firm,
} from './http';
import { moveStock, orderTotals, validateQuantity } from './inventory';
import { clearHeldMessages } from './notify';
import { validDelivery } from './orders';
import { OwnerWorkService } from './owner-work';
import { blindShops } from './blind-count';
import { activeRules, priceFor } from './price-rules';

const holdMs = 10_000;
// An undo that starts inside the hold can take a transaction's whole life to finish (db.atomic
// allows 10 s), so nothing may send the customer's message until that time has passed too.
const messageGraceMs = 10_000;
const waiting = 'AWAITING_CONFIRMATION';

const orderInclude = {
  items: { orderBy: { id: 'asc' } },
  payment: true,
  location: { select: { name: true, active: true, managerRateCapPercent: true } },
  user: {
    select: {
      id: true,
      name: true,
      phone: true,
      language: true,
      khataBalancePaise: true,
      creditAllowed: true,
      creditLimitPaise: true,
      customerGroupId: true,
      _count: { select: { orders: true } },
    },
  },
} satisfies Prisma.OrderInclude;
type FullOrder = Prisma.OrderGetPayload<{ include: typeof orderInclude }>;
type Tx = Prisma.TransactionClient;
export type Actor = { id: string; access: Access };
type Line = {
  productId: string;
  name: string;
  unit: string;
  packSize: string;
  quantity: number;
  pricePaise: number;
  listPricePaise: number;
  priceVersion: number;
  lineTotalPaise: number;
  ruleId?: string | null;
  ruleKind?: string | null;
  rateChangedById?: string | null;
};
type Snapshot = {
  lines: Line[];
  deliveryFeePaise: number;
  deliveryDate: string;
  paymentMethod: 'COD' | 'CREDIT' | 'ONLINE';
  locationId: string;
};

const refused = () => fail('FORBIDDEN', 'You do not have access to this.', 403);
function need(actor: Actor, permission: Permission, locationId: string) {
  if (!canDo(actor.access, permission, locationId)) refused();
}
const languageOf = (value: string): Language => readLanguage(value);
const snapshotOf = (order: FullOrder): Snapshot => ({
  lines: order.items.map((item) => ({
    productId: item.productId,
    name: item.name,
    unit: item.unit,
    packSize: item.packSize,
    quantity: item.quantity,
    pricePaise: item.pricePaise,
    listPricePaise: item.listPricePaise,
    priceVersion: item.priceVersion,
    lineTotalPaise: item.lineTotalPaise,
    ruleId: item.ruleId,
    ruleKind: item.ruleKind,
    rateChangedById: item.rateChangedById,
  })),
  deliveryFeePaise: order.deliveryFeePaise,
  deliveryDate: order.deliveryDate,
  paymentMethod: order.payment?.method ?? 'COD',
  locationId: order.locationId,
});
const totalOf = (snapshot: Snapshot) =>
  orderTotals(snapshot.lines, snapshot.deliveryFeePaise, null).totalPaise;
const sameOrder = (a: Snapshot, b: Snapshot) => {
  const facts = (snapshot: Snapshot) =>
    JSON.stringify([
      [...snapshot.lines]
        .sort((x, y) => x.productId.localeCompare(y.productId))
        .map((line) => [line.productId, line.quantity, line.pricePaise]),
      snapshot.deliveryFeePaise,
      snapshot.deliveryDate,
      snapshot.paymentMethod,
      snapshot.locationId,
    ]);
  return facts(a) === facts(b);
};
/** A retry of the same tap carries the same key and asks for the same thing. */
const decisionPrint = (kind: 'CONFIRM' | 'REFUSE', key: string, asked: unknown) =>
  hash(JSON.stringify([kind, key, asked ?? null]));

/** What the customer will read. The sheet shows exactly this before anyone taps. */
export function decisionWords(
  order: { number: string },
  decision:
    | { kind: 'CONFIRM'; changed: boolean; totalPaise: number; date: string }
    | { kind: 'REFUSE'; reason: RefusalReason; note?: string | undefined },
  language: Language,
) {
  if (decision.kind === 'CONFIRM') {
    const params = {
      number: order.number,
      total: money(decision.totalPaise),
      date: decision.date,
    };
    const kind = decision.changed ? 'orderConfirmedChanged' : 'orderConfirmed';
    return {
      title: t(`push.${kind}.title`, params, language),
      body: t(`push.${kind}.body`, params, language),
    };
  }
  const note = decision.note?.trim();
  return {
    title: t('push.orderRefused.title', { number: order.number }, language),
    body:
      decision.reason === 'OTHER'
        ? note || t('push.orderRefused.OTHER', {}, language)
        : [t(`push.orderRefused.${decision.reason}`, {}, language), note].filter(Boolean).join(' '),
  };
}

/** Moves the stock an order holds from one set of lines and shop to another, or refuses. */
async function moveHolds(
  tx: Tx,
  order: { id: string; number: string },
  from: Snapshot,
  to: Snapshot,
  keyPrefix: string,
  actor: Actor,
  fixes: readonly string[] = [],
) {
  const qty = (snapshot: Snapshot, productId: string) =>
    snapshot.lines.find((line) => line.productId === productId)?.quantity ?? 0;
  const products = [...new Set([...from.lines, ...to.lines].map((line) => line.productId))].sort();
  const moved = from.locationId !== to.locationId;
  const release = async (productId: string, quantity: number, locationId: string) =>
    moveStock(tx, {
      productId,
      kind: 'ORDER_CANCELLED',
      quantity,
      actorId: actor.id,
      reference: order.id,
      note: 'Stock released by a change at confirm',
      idempotencyKey: `${keyPrefix}:out:${locationId}:${productId}`,
      locationId,
    });
  const hold = async (productId: string, quantity: number, locationId: string) => {
    const level = await tx.stockLevel.findUnique({
      where: { productId_locationId: { productId, locationId } },
      select: { quantity: true },
    });
    const have = level?.quantity ?? 0;
    if (have < quantity) {
      if (!fixes.includes(productId)) {
        const shop = await tx.location.findUnique({
          where: { id: locationId },
          select: { name: true },
        });
        const line = [...to.lines, ...from.lines].find((row) => row.productId === productId);
        const blind = (await blindShops(tx, actor.access)).has(locationId);
        fail('STOCK_SHORT', 'The count at this shop is short for this order.', 409, {
          productId,
          name: line?.name ?? '',
          ...(blind ? {} : { have }),
          need: quantity,
          shopName: shop?.name ?? '',
        });
      }
      // "Maal hai, stock theek karo": only an owner, and always on the record.
      if (!canDo(actor.access, 'stock.adjust', locationId)) refused();
      const movement = await moveStock(tx, {
        productId,
        kind: 'MANUAL_ADJUSTMENT',
        quantity: quantity - have,
        actorId: actor.id,
        reference: order.id,
        note: 'Goods are there: count corrected at confirm',
        idempotencyKey: `${keyPrefix}:fix:${locationId}:${productId}`,
        locationId,
      });
      await tx.auditLog.create({
        data: {
          actorId: actor.id,
          event: 'STOCK_CORRECTED_AT_CONFIRM',
          entityId: order.id,
          locationId,
          details: { productId, movementId: movement.id, from: have, to: quantity },
        },
      });
    }
    await moveStock(tx, {
      productId,
      kind: 'ONLINE_ORDER',
      quantity: -quantity,
      actorId: actor.id,
      reference: order.id,
      note: 'Stock held by a change at confirm',
      idempotencyKey: `${keyPrefix}:in:${locationId}:${productId}`,
      locationId,
    });
  };
  // Release first, so stock freed by one line can serve another.
  for (const productId of products) {
    const before = qty(from, productId);
    const after = qty(to, productId);
    if (moved) {
      if (before) await release(productId, before, from.locationId);
    } else if (before > after) await release(productId, before - after, from.locationId);
  }
  for (const productId of products) {
    const before = qty(from, productId);
    const after = qty(to, productId);
    if (moved) {
      if (after) await hold(productId, after, to.locationId);
    } else if (after > before) await hold(productId, after - before, to.locationId);
  }
}

/** Writes a set of lines, amounts and shop onto the order. */
async function writeOrder(tx: Tx, orderId: string, snapshot: Snapshot) {
  const amounts = orderTotals(snapshot.lines, snapshot.deliveryFeePaise, null);
  await tx.orderItem.deleteMany({ where: { orderId } });
  await tx.orderItem.createMany({ data: snapshot.lines.map((line) => ({ ...line, orderId })) });
  await tx.order.update({
    where: { id: orderId },
    data: {
      ...amounts,
      deliveryDate: snapshot.deliveryDate,
      locationId: snapshot.locationId,
    },
  });
  await tx.payment.update({
    where: { orderId },
    data: { amountPaise: amounts.totalPaise, method: snapshot.paymentMethod },
  });
}

@Injectable()
export class ConfirmService {
  constructor(
    @Inject(Db) private db: Db,
    @Inject(Events) private events: Events,
    @Inject(OwnerWorkService) private work: OwnerWorkService,
  ) {}

  private async load(tx: Tx, id: string) {
    const order = await tx.order.findUnique({ where: { id }, include: orderInclude });
    if (!order) fail('ORDER_NOT_FOUND', 'Order not found.', 404);
    return order;
  }

  /** Works out a change without doing it, and refuses anything this person may not do. */
  private async plan(tx: Tx, order: FullOrder, changes: OrderChanges, actor: Actor) {
    const shop = order.locationId;
    need(actor, 'orders.change', shop);
    if (order.payment?.status === 'CAPTURED')
      fail(
        'PAID_ORDER_LOCKED',
        'This order is already paid, so its amounts stay as they are.',
        409,
      );
    const target = changes.locationId ?? shop;
    // A person's own limit, where an owner set one, comes before the shop's.
    const { rateCapPercent: ownCap } = await tx.user.findUniqueOrThrow({
      where: { id: actor.id },
      select: { rateCapPercent: true },
    });
    let cap = ownCap ?? order.location.managerRateCapPercent;
    if (target !== shop) {
      need(actor, 'orders.change', target);
      const location = await tx.location.findUnique({ where: { id: target } });
      if (!location?.active) fail('INVALID_SHOP', 'That shop is not open on this system.', 400);
      cap = Math.min(cap, ownCap ?? location.managerRateCapPercent);
    }
    const rateScope = actor.access['orders.rate.change'];
    // A rate given here stands at the shop the order goes to, so that shop's limit counts too.
    const canRate =
      canDo(actor.access, 'orders.rate.change', shop) &&
      canDo(actor.access, 'orders.rate.change', target);
    const capped = rateScope !== 'ALL';
    const floorOf = (base: number) => Math.ceil((base * (100 - cap)) / 100);
    const checkRate = (base: number, current: number, next: number) => {
      if (next === current) return;
      if (!canRate) refused();
      if (capped && next < floorOf(base))
        fail('RATE_CAP', 'This rate is below what you may give. Ask an owner.', 403, {
          floorPaise: floorOf(base),
          capPercent: cap,
        });
    };
    const before = snapshotOf(order);
    const lines: Line[] = [];
    const rules = await activeRules(tx);
    for (const change of changes.lines) {
      const product = await tx.product.findUnique({ where: { id: change.productId } });
      if (!product) fail('NOT_FOUND', 'One of those products is unavailable.', 404);
      const current = before.lines.find((line) => line.productId === change.productId);
      if (!current && !product.active)
        fail('NOT_FOUND', 'One of those products is unavailable.', 404);
      validateQuantity(product, change.quantity);
      const list = current?.listPricePaise ?? product.pricePaise;
      // A new quantity may cross a slab. What the rules give is not a person's change.
      const worked =
        !current || current.quantity !== change.quantity
          ? priceFor(
              product,
              change.quantity,
              order.userId,
              order.user.customerGroupId,
              rules,
              list,
            )
          : {
              pricePaise: current.pricePaise,
              ruleId: current.ruleId ?? null,
              ruleKind: current.ruleKind ?? null,
            };
      const pricePaise = change.pricePaise ?? worked.pricePaise;
      const byHand = pricePaise !== worked.pricePaise;
      checkRate(list, worked.pricePaise, pricePaise);
      // Above the list is an owner's call too. Today's list may have moved past the order's own.
      const ceiling = Math.max(list, product.pricePaise);
      if (capped && byHand && pricePaise > ceiling)
        fail('RATE_CAP', 'A rate above the list needs an owner.', 403, {
          ceilingPaise: ceiling,
          capPercent: cap,
        });
      lines.push({
        productId: product.id,
        name: current?.name ?? product.name,
        unit: current?.unit ?? product.unit,
        packSize: current?.packSize ?? product.packSize,
        quantity: change.quantity,
        pricePaise,
        listPricePaise: list,
        priceVersion: current?.priceVersion ?? product.priceVersion,
        lineTotalPaise: pricePaise * change.quantity,
        ruleId: byHand ? null : worked.ruleId,
        ruleKind: byHand ? 'BY_HAND' : worked.ruleKind,
        rateChangedById: byHand ? actor.id : null,
      });
    }
    const deliveryFeePaise = changes.deliveryFeePaise ?? before.deliveryFeePaise;
    checkRate(before.deliveryFeePaise, before.deliveryFeePaise, deliveryFeePaise);
    const after: Snapshot = {
      lines,
      deliveryFeePaise,
      deliveryDate: changes.deliveryDate ?? before.deliveryDate,
      paymentMethod: changes.paymentMethod ?? before.paymentMethod,
      locationId: target,
    };
    // Taking an order off udhaar is as much an udhaar decision as putting it on.
    if (before.paymentMethod === 'CREDIT' && after.paymentMethod !== 'CREDIT')
      need(actor, 'orders.confirm.credit', shop);
    return { before, after };
  }

  /** A sheet sent back as it opened is no change, and the customer should not hear of one. */
  private async realChange(tx: Tx, order: FullOrder, changes: OrderChanges, actor: Actor) {
    const plan = await this.plan(tx, order, changes, actor);
    return sameOrder(plan.before, plan.after) ? null : plan;
  }

  /** What the customer would owe in all, counting orders on their way. */
  private async exposure(tx: Tx, order: FullOrder, totalPaise: number) {
    const figures = await creditFigures(tx, order.user, order.firmId);
    const pending = await tx.order.aggregate({
      where: {
        ...figures.pendingWhere,
        userId: order.userId,
        id: { not: order.id },
        payment: { method: 'CREDIT' },
        status: { in: ['CONFIRMED', 'PREPARING', 'OUT_FOR_DELIVERY', 'DELIVERY_EXCEPTION'] },
        // One that has left is already in the balance. Counting it here would count it twice.
        ledgerEntries: { none: {} },
      },
      _sum: { totalPaise: true },
    });
    try {
      return khataBalance(
        khataBalance(figures.balancePaise, pending._sum.totalPaise ?? 0),
        totalPaise,
      );
    } catch {
      return fail('KHATA_OVERFLOW', 'This order exceeds the supported khata balance.', 409);
    }
  }

  /** Udhaar needs the customer allowed it and within their limit, unless an owner passes it. */
  private async checkCredit(
    tx: Tx,
    order: FullOrder,
    totalPaise: number,
    actor: Actor,
    overrideLimit: boolean,
    locationId: string,
  ) {
    need(actor, 'orders.confirm.credit', locationId);
    const { creditAllowed } = order.user;
    const creditLimitPaise = (await creditFigures(tx, order.user, order.firmId)).limitPaise;
    if (!creditAllowed || creditLimitPaise === null)
      fail('CREDIT_NOT_ALLOWED', 'Udhaar is not allowed for this customer yet.', 409);
    const exposurePaise = await this.exposure(tx, order, totalPaise);
    if (exposurePaise > creditLimitPaise) {
      if (!overrideLimit || !canDo(actor.access, 'orders.credit.override', locationId))
        fail('CREDIT_LIMIT_EXCEEDED', 'This order is above the customer’s udhaar limit.', 409, {
          exposurePaise,
          creditLimitPaise,
        });
      await tx.auditLog.create({
        data: {
          actorId: actor.id,
          event: 'CREDIT_LIMIT_OVERRIDE',
          entityId: order.id,
          locationId,
          details: { customerId: order.userId, creditLimitPaise, exposurePaise },
        },
      });
    }
  }

  private async holdMessage(
    tx: Tx,
    order: FullOrder,
    status: 'CONFIRMED' | 'CANCELLED',
    version: number,
    words: { title: string; body: string },
    holdUntil: Date,
  ) {
    const sendAfter = new Date(holdUntil.getTime() + messageGraceMs);
    await tx.notification.create({
      data: {
        userId: order.userId,
        orderId: order.id,
        dedupeKey: `decision:${order.id}:${version}`,
        sendAfter,
        ...words,
      },
    });
    const phone = (order.address as { phone?: string } | null)?.phone || '';
    if (getConfig().WHATSAPP_CUSTOMER_UPDATES && phone)
      await enqueueWhatsApp(tx, {
        userId: order.userId,
        phone,
        template: 'shiv_order_status',
        params: [order.number, orderStatusText(status, siteLanguage(order.user.language))],
        dedupeKey: `wa:decision:${order.id}:${version}`,
        sendAfter,
      });
  }

  /** Someone already decided this order. It is news, not an error. */
  private decided(order: FullOrder, names: Map<string, string>) {
    return fail('ALREADY_DECIDED', 'This order has already been decided.', 409, {
      status: order.status,
      byName: names.get(order.confirmedById ?? '') ?? '',
      at: order.confirmedAt,
    });
  }
  private async decidedNames(tx: Tx, order: FullOrder) {
    const person = order.confirmedById
      ? await tx.user.findUnique({
          where: { id: order.confirmedById },
          select: { id: true, name: true },
        })
      : null;
    return new Map(person ? [[person.id, person.name]] : []);
  }
  private result(order: {
    id: string;
    decisionHoldUntil: Date | null;
    status: string;
    version: number;
  }) {
    return {
      orderId: order.id,
      status: order.status,
      version: order.version,
      holdUntil: order.decisionHoldUntil,
      serverNow: new Date(),
    };
  }

  async confirmIn(tx: Tx, id: string, input: z.infer<typeof orderConfirmSchema>, actor: Actor) {
    const order = await this.load(tx, id);
    need(actor, 'orders.confirm', order.locationId);
    const print = decisionPrint('CONFIRM', input.decisionKey, input.changes);
    if (order.status !== waiting) {
      // The same tap arriving twice repeats the answer. Anyone else's is news.
      if (order.decisionKey === print && order.confirmedById === actor.id)
        return this.result(order);
      this.decided(order, await this.decidedNames(tx, order));
    }
    if (order.version !== input.expectedVersion)
      fail('ORDER_CHANGED', 'This order changed. Look at it again.', 409, {
        version: order.version,
      });
    const version = order.version + 1;
    const plan = input.changes ? await this.realChange(tx, order, input.changes, actor) : null;
    const final = plan?.after ?? snapshotOf(order);
    validDelivery(final.deliveryDate);
    if (final.paymentMethod === 'CREDIT')
      await this.checkCredit(
        tx,
        order,
        totalOf(final),
        actor,
        input.changes?.overrideLimit ?? false,
        final.locationId,
      );
    if (plan) {
      await moveHolds(
        tx,
        order,
        plan.before,
        plan.after,
        `amend:${order.id}:${version}`,
        actor,
        input.changes?.stockFixes,
      );
      await writeOrder(tx, order.id, plan.after);
      await tx.orderAmendment.create({
        data: {
          orderId: order.id,
          version,
          actorId: actor.id,
          before: plan.before as unknown as Prisma.InputJsonValue,
          after: plan.after as unknown as Prisma.InputJsonValue,
        },
      });
      // Amounts and products only, as this log can never be changed.
      await tx.auditLog.create({
        data: {
          actorId: actor.id,
          event: 'ORDER_CHANGED_AT_CONFIRM',
          entityId: order.id,
          locationId: plan.after.locationId,
          details: {
            fromTotalPaise: totalOf(plan.before),
            toTotalPaise: totalOf(plan.after),
            ...(input.changes?.reason ? { reason: input.changes.reason } : {}),
            lines: plan.after.lines.map((line) => ({
              productId: line.productId,
              quantity: line.quantity,
              pricePaise: line.pricePaise,
              listPricePaise: line.listPricePaise,
            })),
            ...(plan.before.locationId === plan.after.locationId
              ? {}
              : { fromShop: plan.before.locationId, toShop: plan.after.locationId }),
          },
        },
      });
    }
    const now = new Date();
    const holdUntil = new Date(now.getTime() + holdMs);
    const moved = await tx.order.updateMany({
      where: { id, status: waiting, version: input.expectedVersion },
      data: {
        status: 'CONFIRMED',
        version,
        confirmedAt: now,
        confirmedById: actor.id,
        decisionHoldUntil: holdUntil,
        decisionKey: print,
        reservedUntil: null,
      },
    });
    if (!moved.count) fail('ORDER_CHANGED', 'This order changed. Look at it again.', 409);
    await tx.orderStatusHistory.create({
      data: { orderId: id, status: 'CONFIRMED', actorId: actor.id, note: 'Confirmed by the shop.' },
    });
    await tx.ownerWork.upsert({
      where: { orderId: id },
      create: { orderId: id, assignedToId: actor.id, acknowledgedAt: now },
      update: { assignedToId: actor.id, acknowledgedAt: now },
    });
    await tx.auditLog.create({
      data: {
        actorId: actor.id,
        event: 'ORDER_CONFIRMED',
        entityId: id,
        locationId: final.locationId,
        details: { version, changed: !!plan, totalPaise: totalOf(final) },
      },
    });
    await this.holdMessage(
      tx,
      order,
      'CONFIRMED',
      version,
      decisionWords(
        order,
        {
          kind: 'CONFIRM',
          changed: !!plan,
          totalPaise: totalOf(final),
          date: final.deliveryDate,
        },
        languageOf(order.user.language),
      ),
      holdUntil,
    );
    return { orderId: id, status: 'CONFIRMED', version, holdUntil, serverNow: now };
  }

  async refuseIn(tx: Tx, id: string, input: z.infer<typeof orderRefuseSchema>, actor: Actor) {
    const order = await this.load(tx, id);
    need(actor, 'orders.confirm', order.locationId);
    const print = decisionPrint('REFUSE', input.decisionKey, [input.reason, input.note ?? '']);
    if (order.status !== waiting) {
      if (order.decisionKey === print && order.confirmedById === actor.id)
        return this.result(order);
      this.decided(order, await this.decidedNames(tx, order));
    }
    if (order.version !== input.expectedVersion)
      fail('ORDER_CHANGED', 'This order changed. Look at it again.', 409, {
        version: order.version,
      });
    const version = order.version + 1;
    const paid = order.payment?.status === 'CAPTURED';
    // Saying no to a paid order owes the customer money, and to udhaar is an udhaar decision.
    if (paid) need(actor, 'money.refund', order.locationId);
    if (order.payment?.method === 'CREDIT') need(actor, 'orders.confirm.credit', order.locationId);
    const words = decisionWords(
      order,
      { kind: 'REFUSE', reason: input.reason, note: input.note },
      languageOf(order.user.language),
    );
    for (const line of order.items)
      await moveStock(tx, {
        productId: line.productId,
        kind: 'ORDER_CANCELLED',
        quantity: line.quantity,
        actorId: actor.id,
        reference: order.id,
        note: 'The shop could not do this order',
        idempotencyKey: `refuse:${order.id}:${version}:${line.productId}`,
        locationId: order.locationId,
      });
    const next = paid ? 'REFUND_PENDING' : 'CANCELLED';
    if (paid)
      await tx.payment.update({ where: { orderId: id }, data: { status: 'REFUND_PENDING' } });
    const now = new Date();
    const holdUntil = new Date(now.getTime() + holdMs);
    const moved = await tx.order.updateMany({
      where: { id, status: waiting, version: input.expectedVersion },
      data: {
        status: next,
        version,
        confirmedAt: now,
        confirmedById: actor.id,
        decisionHoldUntil: holdUntil,
        decisionKey: print,
        reservedUntil: null,
      },
    });
    if (!moved.count) fail('ORDER_CHANGED', 'This order changed. Look at it again.', 409);
    await tx.orderStatusHistory.create({
      data: { orderId: id, status: next, actorId: actor.id, note: words.body },
    });
    await tx.ownerWork.upsert({
      where: { orderId: id },
      create: { orderId: id, assignedToId: actor.id, acknowledgedAt: now },
      update: { assignedToId: actor.id, acknowledgedAt: now },
    });
    // The reason chip only: a typed note may name a person, and this log can never be changed.
    await tx.auditLog.create({
      data: {
        actorId: actor.id,
        event: 'ORDER_REFUSED',
        entityId: id,
        locationId: order.locationId,
        details: { version, reason: input.reason },
      },
    });
    await this.holdMessage(tx, order, 'CANCELLED', version, words, holdUntil);
    return { orderId: id, status: next, version, holdUntil, serverNow: now };
  }

  /** Wapas lo: puts the card back exactly as it was, while the customer has heard nothing. */
  async undoIn(tx: Tx, id: string, expectedVersion: number, actor: Actor) {
    const order = await this.load(tx, id);
    need(actor, 'orders.confirm', order.locationId);
    const now = new Date();
    const open = ['CONFIRMED', 'CANCELLED', 'REFUND_PENDING'].includes(order.status);
    if (!open || !order.decisionHoldUntil || order.decisionHoldUntil <= now)
      fail('UNDO_TOO_LATE', 'The message has already gone to the customer.', 409);
    // Only the decision this person is looking at. Someone may have redone it since.
    if (order.version !== expectedVersion)
      fail('ORDER_CHANGED', 'This order changed. Look at it again.', 409, {
        version: order.version,
      });
    // Cash taken during the hold is real, and its record can never change.
    if (
      order.status === 'CONFIRMED' &&
      order.payment?.method !== 'ONLINE' &&
      order.payment?.status !== 'PENDING'
    )
      fail('ORDER_CHANGED', 'Cash is already recorded on this order.', 409);
    // Once it is on a vehicle it is on the customer's khata. Undoing it now would strand that entry.
    if (await tx.customerLedgerEntry.findUnique({ where: { orderId: id }, select: { id: true } }))
      fail('ORDER_CHANGED', 'This order is already loaded.', 409);
    const version = order.version + 1;
    const key = `undo:${order.id}:${version}`;
    if (order.status === 'CONFIRMED') {
      const amendment = await tx.orderAmendment.findUnique({
        where: { orderId_version: { orderId: id, version: order.version } },
      });
      if (amendment) {
        const before = amendment.before as unknown as Snapshot;
        const after = amendment.after as unknown as Snapshot;
        await moveHolds(tx, order, after, before, key, actor);
        await writeOrder(tx, id, before);
        await tx.orderAmendment.create({
          data: {
            orderId: id,
            version,
            actorId: actor.id,
            before: after as unknown as Prisma.InputJsonValue,
            after: before as unknown as Prisma.InputJsonValue,
          },
        });
      }
    } else {
      // A refused order held nothing after its stock went back, so it has to take it again.
      const empty: Snapshot = { ...snapshotOf(order), lines: [] };
      await moveHolds(tx, order, empty, snapshotOf(order), key, actor);
      if (order.status === 'REFUND_PENDING')
        await tx.payment.update({ where: { orderId: id }, data: { status: 'CAPTURED' } });
    }
    await tx.order.update({
      where: { id },
      data: {
        status: waiting,
        version,
        confirmedAt: null,
        confirmedById: null,
        decisionHoldUntil: null,
        decisionKey: null,
      },
    });
    await tx.orderStatusHistory.create({
      data: { orderId: id, status: waiting, actorId: actor.id, note: 'Decision taken back.' },
    });
    await tx.ownerWork.update({
      where: { orderId: id },
      data: { assignedToId: null, acknowledgedAt: null },
    });
    await tx.auditLog.create({
      data: {
        actorId: actor.id,
        event: 'ORDER_DECISION_UNDONE',
        entityId: id,
        locationId: order.locationId,
        details: { from: order.status, version },
      },
    });
    await clearHeldMessages(tx, id, now);
    return { orderId: id, status: waiting, version };
  }

  changed() {
    this.work.stream.next({ type: 'OWNER_WORK_UPDATED' });
    this.events.publish({ type: 'CATALOG_UPDATED' });
  }
  async confirm(id: string, input: z.infer<typeof orderConfirmSchema>, actor: Actor) {
    const result = await this.db.atomic((tx) => this.confirmIn(tx, id, input, actor));
    this.changed();
    return result;
  }
  async refuse(id: string, input: z.infer<typeof orderRefuseSchema>, actor: Actor) {
    const result = await this.db.atomic((tx) => this.refuseIn(tx, id, input, actor));
    this.changed();
    return result;
  }
  async undo(id: string, expectedVersion: number, actor: Actor) {
    const result = await this.db.atomic((tx) => this.undoIn(tx, id, expectedVersion, actor));
    this.changed();
    return result;
  }

  /** The exact message and total for a decision, without doing it. */
  async preview(id: string, input: z.infer<typeof orderPreviewSchema>, actor: Actor) {
    return this.db.$transaction(async (tx) => {
      const order = await this.load(tx, id);
      need(actor, 'orders.confirm', order.locationId);
      const language = languageOf(order.user.language);
      if (input.decision === 'REFUSE')
        return decisionWords(
          order,
          { kind: 'REFUSE', reason: input.reason ?? 'OTHER', note: input.note },
          language,
        );
      try {
        const plan = input.changes ? await this.realChange(tx, order, input.changes, actor) : null;
        const final = plan?.after ?? snapshotOf(order);
        return {
          ...decisionWords(
            order,
            {
              kind: 'CONFIRM',
              changed: !!plan,
              totalPaise: totalOf(final),
              date: final.deliveryDate,
            },
            language,
          ),
          totalPaise: totalOf(final),
          short: plan ? await this.shortages(tx, plan.before, plan.after, actor) : [],
        };
      } catch (error) {
        // A rate beyond a limit belongs on the sheet, beside the field that caused it.
        if (error instanceof HttpException) {
          const response = error.getResponse() as { code?: string; details?: unknown };
          if (response.code === 'RATE_CAP')
            return { problem: { code: response.code, details: response.details } };
        }
        throw error;
      }
    });
  }

  /**
   * Everything a yes on this request would do, worked out the way the yes will work it out, so the
   * owner is never agreeing to more than the card says. Changes nothing.
   */
  async askedFacts(id: string, expectedVersion: number, changes: OrderChanges, actor: Actor) {
    return this.db.$transaction(async (tx) => {
      const order = await tx.order.findUnique({ where: { id }, include: orderInclude });
      if (!order) return { stillWaiting: false, lines: [], stock: [] };
      const before = snapshotOf(order);
      const facts = {
        orderId: order.id,
        number: order.number,
        fromTotalPaise: totalOf(before),
        stillWaiting: order.status === waiting && order.version === expectedVersion,
      };
      let plan;
      try {
        plan = await this.plan(tx, order, changes, actor);
      } catch (error) {
        if (error instanceof HttpException)
          return { ...facts, stillWaiting: false, lines: [], stock: [] };
        throw error;
      }
      const { after } = plan;
      const lines = [
        ...after.lines.map((line) => {
          const was = before.lines.find((row) => row.productId === line.productId);
          return {
            productId: line.productId,
            name: line.name,
            unit: line.unit,
            fromQuantity: was?.quantity ?? 0,
            toQuantity: line.quantity,
            fromPricePaise: was?.pricePaise ?? null,
            toPricePaise: line.pricePaise,
            listPricePaise: line.listPricePaise,
            byHand: line.ruleKind === 'BY_HAND',
          };
        }),
        ...before.lines
          .filter((line) => !after.lines.some((row) => row.productId === line.productId))
          .map((line) => ({
            productId: line.productId,
            name: line.name,
            unit: line.unit,
            fromQuantity: line.quantity,
            toQuantity: 0,
            fromPricePaise: line.pricePaise,
            toPricePaise: line.pricePaise,
            listPricePaise: line.listPricePaise,
            byHand: false,
          })),
      ];
      const short = await this.shortages(tx, before, after, actor);
      let overLimit: { exposurePaise: number; creditLimitPaise: number } | null = null;
      let creditNotAllowed = false;
      if (after.paymentMethod === 'CREDIT') {
        const { creditAllowed } = order.user;
        const creditLimitPaise = (await creditFigures(tx, order.user, order.firmId)).limitPaise;
        if (!creditAllowed || creditLimitPaise === null) creditNotAllowed = true;
        else {
          const exposurePaise = await this.exposure(tx, order, totalOf(after));
          if (exposurePaise > creditLimitPaise) overLimit = { exposurePaise, creditLimitPaise };
        }
      }
      const shopName = async (locationId: string) =>
        (await tx.location.findUnique({ where: { id: locationId }, select: { name: true } }))
          ?.name ?? '';
      return {
        ...facts,
        toTotalPaise: totalOf(after),
        lines,
        deliveryFee:
          before.deliveryFeePaise === after.deliveryFeePaise
            ? null
            : { from: before.deliveryFeePaise, to: after.deliveryFeePaise },
        deliveryDate:
          before.deliveryDate === after.deliveryDate
            ? null
            : { from: before.deliveryDate, to: after.deliveryDate },
        paymentMethod:
          before.paymentMethod === after.paymentMethod
            ? null
            : { from: before.paymentMethod, to: after.paymentMethod },
        shop:
          before.locationId === after.locationId
            ? null
            : { from: await shopName(before.locationId), to: await shopName(after.locationId) },
        stock: short.map((row) => ({
          name: row.name,
          have: row.have,
          need: row.need,
          // A yes mints this stock. Without it, the yes is refused for being short.
          fix: changes.stockFixes.includes(row.productId),
        })),
        overLimit,
        creditNotAllowed,
        reason: changes.reason ?? null,
      };
    });
  }

  /** What a change would need from a shop that the shop's count says it does not have. */
  private async shortages(tx: Tx, from: Snapshot, to: Snapshot, actor: Actor) {
    const moved = from.locationId !== to.locationId;
    const blind = (await blindShops(tx, actor.access)).has(to.locationId);
    const short: { productId: string; name: string; have: number | null; need: number }[] = [];
    for (const line of to.lines) {
      const before = moved
        ? 0
        : (from.lines.find((row) => row.productId === line.productId)?.quantity ?? 0);
      const need = line.quantity - before;
      if (need <= 0) continue;
      const level = await tx.stockLevel.findUnique({
        where: {
          productId_locationId: { productId: line.productId, locationId: to.locationId },
        },
        select: { quantity: true },
      });
      const have = level?.quantity ?? 0;
      if (have < need)
        short.push({
          productId: line.productId,
          name: line.name,
          have: blind ? null : have,
          need,
        });
    }
    return short;
  }

  /** One order as a card, with what this person can do with it. */
  async card(
    tx: Pick<Tx, 'stockLevel' | 'product' | 'user' | 'stockCount'>,
    order: FullOrder,
    access: Access,
    ownCap: number | null,
  ) {
    const shop = order.locationId;
    const blind = (await blindShops(tx, access)).has(shop);
    const products = await tx.product.findMany({
      where: { id: { in: order.items.map((item) => item.productId) } },
      select: { id: true, pricePaise: true, active: true },
    });
    const levels = await tx.stockLevel.findMany({
      where: { productId: { in: order.items.map((item) => item.productId) }, locationId: shop },
      select: { productId: true, quantity: true },
    });
    const blockers: InboxCard['blockers'] = [];
    if (order.deliveryDate < istToday()) blockers.push('DATE_PASSED');
    if (order.items.some((item) => !products.find((row) => row.id === item.productId)?.active))
      blockers.push('PRODUCT_OFF');
    const cash = order.payment?.method === 'COD';
    const credit = order.payment?.method === 'CREDIT';
    const paid = order.payment?.status === 'CAPTURED';
    const person = order.confirmedById
      ? await tx.user.findUnique({
          where: { id: order.confirmedById },
          select: { name: true },
        })
      : null;
    const decision = order.status === waiting ? null : order;
    const seesBalance = canDo(access, 'khata.read.one', shop);
    const card: InboxCard = {
      id: order.id,
      number: order.number,
      status: order.status,
      version: order.version,
      source: order.source,
      createdAt: order.createdAt.toISOString(),
      deliveryDate: order.deliveryDate,
      notes: order.notes,
      locationId: shop,
      shopName: order.location.name,
      customer: {
        id: order.user.id,
        name: order.user.name || (order.address as { name?: string } | null)?.name || '',
        phone: order.user.phone,
        orders: order.user._count.orders,
        balancePaise: seesBalance ? order.user.khataBalancePaise : null,
        creditAllowed: seesBalance ? order.user.creditAllowed : false,
        creditLimitPaise: seesBalance ? order.user.creditLimitPaise : null,
      },
      area: (order.address as { area?: string } | null)?.area ?? '',
      addressLine: (order.address as { line1?: string } | null)?.line1 ?? '',
      lines: order.items.map((item) => ({
        id: item.id,
        productId: item.productId,
        name: item.name,
        unit: item.unit,
        packSize: item.packSize,
        quantity: item.quantity,
        pricePaise: item.pricePaise,
        listPricePaise: item.listPricePaise,
        lineTotalPaise: item.lineTotalPaise,
        stockHere: blind
          ? null
          : (levels.find((row) => row.productId === item.productId)?.quantity ?? 0),
        currentListPricePaise:
          products.find((row) => row.id === item.productId)?.pricePaise ?? item.listPricePaise,
      })),
      subtotalPaise: order.subtotalPaise,
      deliveryFeePaise: order.deliveryFeePaise,
      totalPaise: order.totalPaise,
      paymentMethod: order.payment?.method ?? 'COD',
      paid,
      clean: cash && !paid && !order.notes.trim() && !blockers.length,
      blockers,
      can: {
        confirm:
          order.status === waiting &&
          canDo(access, 'orders.confirm', shop) &&
          (!credit || canDo(access, 'orders.confirm.credit', shop)),
        refuse:
          order.status === waiting &&
          canDo(access, 'orders.confirm', shop) &&
          (!credit || canDo(access, 'orders.confirm.credit', shop)) &&
          (!paid || canDo(access, 'money.refund', shop)),
        change:
          order.status === waiting &&
          !paid &&
          canDo(access, 'orders.change', shop) &&
          (!credit || canDo(access, 'orders.confirm.credit', shop)),
        rate: canDo(access, 'orders.rate.change', shop),
        credit: canDo(access, 'orders.confirm.credit', shop),
        override: canDo(access, 'orders.credit.override', shop),
      },
      rateCapPercent:
        access['orders.rate.change'] === 'ALL'
          ? null
          : (ownCap ?? order.location.managerRateCapPercent),
      decided: decision
        ? {
            status: decision.status,
            byId: decision.confirmedById,
            byName: person?.name ?? '',
            at: (decision.confirmedAt ?? decision.updatedAt).toISOString(),
            holdUntil:
              decision.decisionHoldUntil && decision.decisionHoldUntil > new Date()
                ? decision.decisionHoldUntil.toISOString()
                : null,
          }
        : null,
      serverNow: new Date().toISOString(),
    };
    return card;
  }

  private async ownCap(tx: Pick<Tx, 'user'>, actorId: string) {
    const person = await tx.user.findUnique({
      where: { id: actorId },
      select: { rateCapPercent: true },
    });
    return person?.rateCapPercent ?? null;
  }

  async inbox(access: Access, shops: { locationId?: { in: string[] } | string }, actorId: string) {
    const now = new Date();
    const ownCap = await this.ownCap(this.db, actorId);
    const [orders, count] = await Promise.all([
      this.db.order.findMany({
        where: {
          ...shops,
          OR: [{ status: waiting }, { decisionHoldUntil: { gt: now } }],
        },
        include: orderInclude,
        // The person waiting longest is the one who will call.
        orderBy: { createdAt: 'asc' },
        take: 50,
      }),
      this.db.order.count({ where: { ...shops, status: waiting } }),
    ]);
    return {
      count,
      items: await Promise.all(orders.map((order) => this.card(this.db, order, access, ownCap))),
      serverNow: now.toISOString(),
    };
  }

  async one(id: string, access: Access, actorId: string) {
    const order = await this.db.order.findUnique({ where: { id }, include: orderInclude });
    if (!order) fail('ORDER_NOT_FOUND', 'Order not found.', 404);
    return this.card(this.db, order, access, await this.ownCap(this.db, actorId));
  }

  /**
   * The buttons on a notification. The token stands in for a session, so the phone can act with
   * the desk closed; everything a session would check is checked again here.
   */
  async pushAction(token: string) {
    const result = await this.db.atomic(async (tx) => {
      const row = await tx.pushActionToken.findUnique({ where: { tokenHash: hash(token) } });
      if (
        !row ||
        !row.orderId ||
        !['confirm', 'undo'].includes(row.purpose) ||
        row.usedAt ||
        row.expiresAt <= new Date()
      )
        fail('INVALID_TOKEN', 'This alert has expired.', 410);
      const used = await tx.pushActionToken.updateMany({
        where: { id: row.id, usedAt: null },
        data: { usedAt: new Date() },
      });
      if (!used.count) fail('INVALID_TOKEN', 'This alert has expired.', 410);
      const person = await tx.user.findUnique({
        where: { id: row.userId },
        select: {
          role: true,
          deletedAt: true,
          staffPausedAt: true,
          staffMemberships: {
            where: { endedAt: null },
            select: { role: true, locationId: true },
          },
        },
      });
      if (!person || person.role !== 'ADMIN' || person.deletedAt || person.staffPausedAt)
        fail('INVALID_TOKEN', 'This alert has expired.', 410);
      const actor: Actor = { id: row.userId, access: accessFor(person.staffMemberships) };
      if (row.purpose === 'undo')
        return {
          kind: 'undo',
          ...(await this.undoIn(tx, row.orderId, row.orderVersion ?? 0, actor)),
        };
      // The card was clean when the alert went. It must still be, or the person must look.
      const order = await this.load(tx, row.orderId);
      const card = await this.card(tx, order, actor.access, await this.ownCap(tx, actor.id));
      if (!card.clean || !card.can.confirm) {
        if (order.status !== waiting) this.decided(order, await this.decidedNames(tx, order));
        fail('ORDER_CHANGED', 'This order needs a look.', 409);
      }
      const confirmed = await this.confirmIn(
        tx,
        row.orderId,
        { expectedVersion: row.orderVersion ?? 0, decisionKey: randomUUID() },
        actor,
      );
      const undoToken = randomBytes(24).toString('base64url');
      await tx.pushActionToken.create({
        data: {
          tokenHash: hash(undoToken),
          userId: row.userId,
          notificationId: row.notificationId,
          orderId: row.orderId,
          orderVersion: (row.orderVersion ?? 0) + 1,
          purpose: 'undo',
          expiresAt: confirmed.holdUntil ?? new Date(),
        },
      });
      return { kind: 'confirm', undoToken, ...confirmed };
    });
    this.changed();
    return result;
  }
}

@ApiTags('Pakka karo')
@Controller('admin')
export class InboxController {
  constructor(@Inject(ConfirmService) private confirms: ConfirmService) {}

  @Firm('shop')
  @Can('orders.confirm', scoped)
  @Get('inbox')
  inbox(@Req() req: AuthRequest) {
    return this.confirms.inbox(
      req.access,
      shopAsked(req, 'orders.confirm', req.query.locationId),
      req.user.id,
    );
  }
  @Firm('shop')
  @Can('orders.confirm', atOrder())
  @Get('inbox/:id')
  one(@Param('id') id: string, @Req() req: AuthRequest) {
    return this.confirms.one(id, req.access, req.user.id);
  }
  @Firm('shop')
  @Can('orders.confirm', atOrder())
  @Post('orders/:id/confirm')
  @Contract(orderConfirmSchema)
  confirm(
    @Param('id') id: string,
    @Input(orderConfirmSchema) body: z.infer<typeof orderConfirmSchema>,
    @Req() req: AuthRequest,
  ) {
    return this.confirms.confirm(id, body, { id: req.user.id, access: req.access });
  }
  @Firm('shop')
  @Can('orders.confirm', atOrder())
  @Post('orders/:id/refuse')
  @Contract(orderRefuseSchema)
  refuse(
    @Param('id') id: string,
    @Input(orderRefuseSchema) body: z.infer<typeof orderRefuseSchema>,
    @Req() req: AuthRequest,
  ) {
    return this.confirms.refuse(id, body, { id: req.user.id, access: req.access });
  }
  @Firm('shop')
  @Can('orders.confirm', atOrder())
  @Post('orders/:id/undo-decision')
  @Contract(orderUndoSchema)
  undo(
    @Param('id') id: string,
    @Input(orderUndoSchema) body: z.infer<typeof orderUndoSchema>,
    @Req() req: AuthRequest,
  ) {
    return this.confirms.undo(id, body.expectedVersion, { id: req.user.id, access: req.access });
  }
  @Firm('shop')
  @Can('orders.confirm', atOrder())
  @Post('orders/:id/preview')
  @Contract(orderPreviewSchema)
  preview(
    @Param('id') id: string,
    @Input(orderPreviewSchema) body: z.infer<typeof orderPreviewSchema>,
    @Req() req: AuthRequest,
  ) {
    return this.confirms.preview(id, body, { id: req.user.id, access: req.access });
  }
  @Public()
  @Post('push/action')
  @Contract(pushActionSchema)
  pushAction(@Input(pushActionSchema) body: z.infer<typeof pushActionSchema>) {
    return this.confirms.pushAction(body.token);
  }
}
