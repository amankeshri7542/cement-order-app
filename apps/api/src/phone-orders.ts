import { activeRules, priceFor } from './price-rules';
import { Controller, Inject, Injectable, Post, Req } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { Prisma } from '@prisma/client';
import { z } from 'zod';
import { istToday, khataBalance, phoneOrderSchema } from '@shiv/shared';
import { Db } from './db';
import {
  AuthRequest,
  Can,
  Contract,
  fail,
  hash,
  Input,
  MAIN_LOCATION,
  requireAt,
  scoped,
  shopForAction,
} from './http';
import { Events } from './catalog';
import { getConfig } from './config';
import { deliveryFor, moveStock, orderTotals, validateQuantity } from './inventory';
import { khataCustomer } from './khata';
import { orderInclude, reference, validDelivery } from './orders';

@Injectable()
export class PhoneOrdersService {
  constructor(
    @Inject(Db) private db: Db,
    @Inject(Events) private events: Events,
  ) {}

  async create(
    { locationId: asked, ...input }: z.infer<typeof phoneOrderSchema>,
    actorId: string,
    locationId = asked ?? MAIN_LOCATION,
  ) {
    const order = await this.db.atomic((tx) => this.createIn(tx, input, actorId, locationId));
    this.events.publish({ type: 'CATALOG_UPDATED' });
    return order;
  }

  /** The same order, inside a caller's transaction: a person's tap on a WhatsApp card uses this. */
  async createIn(
    tx: Prisma.TransactionClient,
    input: Omit<z.infer<typeof phoneOrderSchema>, 'locationId' | 'source'> & {
      source: 'PHONE' | 'WALK_IN' | 'WHATSAPP';
    },
    actorId: string,
    locationId: string,
  ) {
    const customerPhone = input.customerPhone ?? 'walk-in:store';
    const items = [...input.items].sort((a, b) => a.productId.localeCompare(b.productId));
    const requestHash = hash(JSON.stringify({ ...input, items }));
    const actor = await tx.user.findFirst({
      where: { id: actorId, role: 'ADMIN', deletedAt: null },
    });
    if (!actor) fail('FORBIDDEN', 'Store owner access required.', 403);
    if (
      input.overrideLimit &&
      (!getConfig().CREDIT_OVERRIDE_PHONE || actor.phone !== getConfig().CREDIT_OVERRIDE_PHONE)
    )
      fail(
        'CREDIT_OVERRIDE_FORBIDDEN',
        'Only the designated owner may override a credit limit.',
        403,
      );
    if (input.overrideLimit && input.paymentMethod !== 'CREDIT')
      fail('INVALID_CREDIT_OVERRIDE', 'A limit override applies only to a credit order.');
    const user = await tx.user.upsert({
      where: { phone: customerPhone },
      create: {
        phone: customerPhone,
        name: input.customerName ?? (input.customerPhone ? '' : 'काउंटर ग्राहक'),
        role: 'CUSTOMER',
        language: 'hi',
      },
      update: { updatedAt: new Date() },
    });
    const customer = await khataCustomer(tx, user.id);
    const previous = await tx.order.findUnique({
      where: {
        userId_idempotencyKey: { userId: user.id, idempotencyKey: input.idempotencyKey },
      },
      include: orderInclude,
    });
    if (previous) {
      if (previous.requestHash !== requestHash)
        fail('IDEMPOTENCY_CONFLICT', 'This key was already used for a different order.', 409);
      return previous;
    }
    const deliveryDate = input.deliveryDate === 'today' ? istToday() : input.deliveryDate;
    validDelivery(deliveryDate);
    const lines = [];
    const rules = await activeRules(tx);
    const { customerGroupId } = await tx.user.findUniqueOrThrow({
      where: { id: user.id },
      select: { customerGroupId: true },
    });
    for (const item of items) {
      const product = await tx.product.findUnique({ where: { id: item.productId } });
      // What this shop holds counts here, not what the whole firm holds.
      const level = await tx.stockLevel.findUnique({
        where: { productId_locationId: { productId: item.productId, locationId } },
        select: { quantity: true },
      });
      if (!product?.active || (level?.quantity ?? 0) < item.quantity)
        fail('OUT_OF_STOCK', 'That product or quantity is not available.', 409);
      validateQuantity(product, item.quantity);
      const priced = priceFor(product, item.quantity, user.id, customerGroupId, rules);
      lines.push({
        productId: product.id,
        name: product.name,
        unit: product.unit,
        packSize: product.packSize,
        quantity: item.quantity,
        pricePaise: priced.pricePaise,
        listPricePaise: product.pricePaise,
        ruleId: priced.ruleId,
        ruleKind: priced.ruleKind,
        priceVersion: product.priceVersion,
        lineTotalPaise: priced.pricePaise * item.quantity,
      });
    }
    const subtotal = orderTotals(lines, 0, null).subtotalPaise;
    const zone =
      input.source === 'PHONE' || (input.source === 'WHATSAPP' && input.address)
        ? await deliveryFor(tx, input.address!.pincode, subtotal)
        : null;
    const amounts = orderTotals(
      lines,
      zone?.deliveryFeePaise ?? 0,
      zone?.freeDeliveryAbovePaise ?? null,
    );
    let exposurePaise = customer.khataBalancePaise;
    if (input.paymentMethod === 'CREDIT') {
      if (!customer.creditAllowed || customer.creditLimitPaise === null)
        fail('CREDIT_NOT_ALLOWED', 'Enable credit and set a limit for this customer first.', 409);
      const pending = await tx.order.aggregate({
        where: {
          userId: user.id,
          payment: { method: 'CREDIT' },
          status: { in: ['CONFIRMED', 'PREPARING', 'OUT_FOR_DELIVERY', 'DELIVERY_EXCEPTION'] },
          // One that has left is already in the balance. Counting it here would count it twice.
          ledgerEntries: { none: {} },
        },
        _sum: { totalPaise: true },
      });
      try {
        exposurePaise = khataBalance(
          khataBalance(customer.khataBalancePaise, pending._sum.totalPaise ?? 0),
          amounts.totalPaise,
        );
      } catch {
        fail('KHATA_OVERFLOW', 'This order exceeds the supported khata balance.', 409);
      }
      if (exposurePaise > customer.creditLimitPaise && !input.overrideLimit)
        fail('CREDIT_LIMIT_EXCEEDED', 'This order exceeds the customer credit limit.', 409, {
          exposurePaise,
          creditLimitPaise: customer.creditLimitPaise,
        });
    }
    const number = reference('SC');
    for (const line of lines)
      await moveStock(tx, {
        productId: line.productId,
        kind: input.source === 'WALK_IN' ? 'WALK_IN_SALE' : 'ONLINE_ORDER',
        quantity: -line.quantity,
        actorId,
        reference: number,
        note: 'Owner-created order reservation',
        idempotencyKey: `phone:${number}:${line.productId}`,
        locationId,
      });
    // Preserve the address snapshot shape for existing consumers, including store pickup.
    const address = input.address ?? {
      label: 'Store pickup',
      name: customer.name || input.customerPhone || 'काउंटर ग्राहक',
      phone: input.customerPhone ?? '',
      line1: 'Store pickup',
      area: '',
      city: 'Patna',
      state: 'Bihar',
      pincode: '',
      landmark: '',
    };
    const order = await tx.order.create({
      data: {
        number,
        locationId,
        userId: user.id,
        source: input.source,
        createdById: actorId,
        requestHash,
        idempotencyKey: input.idempotencyKey,
        // A person at the shop made it, so it is confirmed from the start.
        status: 'CONFIRMED',
        confirmedAt: new Date(),
        confirmedById: actorId,
        address,
        deliveryDate,
        notes: input.notes,
        ...amounts,
        items: { create: lines },
        payment: { create: { method: input.paymentMethod, amountPaise: amounts.totalPaise } },
        work: { create: { assignedToId: actorId, acknowledgedAt: new Date() } },
        history: { create: { status: 'CONFIRMED', actorId, note: 'Order recorded by owner.' } },
      },
      include: orderInclude,
    });
    await tx.user.update({
      where: { id: user.id },
      data: {
        lastOrderAt: order.createdAt,
        ...(!customer.name && input.customerName ? { name: input.customerName } : {}),
      },
    });
    await tx.auditLog.create({
      data: {
        actorId,
        event: 'PHONE_ORDER_CREATED',
        entityId: order.id,
        details: {
          source: input.source,
          customerId: user.id,
          totalPaise: amounts.totalPaise,
          paymentMethod: input.paymentMethod,
        },
      },
    });
    if (input.overrideLimit)
      await tx.auditLog.create({
        data: {
          actorId,
          event: 'CREDIT_LIMIT_OVERRIDE',
          entityId: order.id,
          details: {
            customerId: user.id,
            creditLimitPaise: customer.creditLimitPaise,
            exposurePaise,
          },
        },
      });
    return order;
  }
}

@ApiTags('Owner phone orders')
@Controller('admin/orders/phone')
export class PhoneOrdersController {
  constructor(@Inject(PhoneOrdersService) private orders: PhoneOrdersService) {}
  @Can('orders.create', scoped)
  @Post()
  @Contract(phoneOrderSchema)
  create(
    @Input(phoneOrderSchema) input: z.infer<typeof phoneOrderSchema>,
    @Req() req: AuthRequest,
  ) {
    const locationId = shopForAction(req, 'orders.create', input.locationId);
    // A phone order is confirmed from the start, so udhaar here is an udhaar decision.
    if (input.paymentMethod === 'CREDIT') requireAt(req, 'orders.confirm.credit', locationId);
    return this.orders.create(input, req.user.id, locationId);
  }
}
