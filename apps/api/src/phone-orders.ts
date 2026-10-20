import { Controller, Inject, Injectable, Post, Req } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { istToday, khataBalance, phoneOrderSchema } from '@shiv/shared';
import { Db } from './db';
import { Admin, AuthRequest, Contract, Input, fail, hash } from './http';
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

  async create(input: z.infer<typeof phoneOrderSchema>, actorId: string) {
    const customerPhone = input.customerPhone ?? 'walk-in:store';
    const items = [...input.items].sort((a, b) => a.productId.localeCompare(b.productId));
    const requestHash = hash(JSON.stringify({ ...input, items }));
    const order = await this.db.atomic(async (tx) => {
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
      for (const item of items) {
        const product = await tx.product.findUnique({ where: { id: item.productId } });
        if (!product?.active || product.stock < item.quantity)
          fail('OUT_OF_STOCK', 'That product or quantity is not available.', 409);
        validateQuantity(product, item.quantity);
        lines.push({
          productId: product.id,
          name: product.name,
          unit: product.unit,
          packSize: product.packSize,
          quantity: item.quantity,
          pricePaise: product.pricePaise,
          priceVersion: product.priceVersion,
          lineTotalPaise: product.pricePaise * item.quantity,
        });
      }
      const subtotal = orderTotals(lines, 0, null).subtotalPaise;
      const zone =
        input.source === 'PHONE' ? await deliveryFor(tx, input.address!.pincode, subtotal) : null;
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
          userId: user.id,
          source: input.source,
          createdById: actorId,
          requestHash,
          idempotencyKey: input.idempotencyKey,
          status: 'CONFIRMED',
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
    });
    this.events.publish({ type: 'CATALOG_UPDATED' });
    return order;
  }
}

@ApiTags('Owner phone orders')
@Admin()
@Controller('admin/orders/phone')
export class PhoneOrdersController {
  constructor(@Inject(PhoneOrdersService) private orders: PhoneOrdersService) {}
  @Post()
  @Contract(phoneOrderSchema)
  create(
    @Input(phoneOrderSchema) input: z.infer<typeof phoneOrderSchema>,
    @Req() req: AuthRequest,
  ) {
    return this.orders.create(input, req.user.id);
  }
}
