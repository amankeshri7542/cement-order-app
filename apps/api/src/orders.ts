import { Controller, Get, Inject, Injectable, Param, Patch, Post, Put, Req } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Prisma } from '@prisma/client';
import { randomBytes } from 'node:crypto';
import { z } from 'zod';
import {
  cartItemSchema,
  checkoutSchema,
  CheckoutReview,
  orderStatusSchema,
  placeOrderSchema,
  totals,
  transitions,
} from '@shiv/shared';
import { Db } from './db';
import { Admin, AuthRequest, Contract, Input, fail } from './http';
import { onlineReady } from './config';

export const orderInclude = {
  items: true,
  payment: true,
  history: { orderBy: { createdAt: 'asc' as const } },
};
export const reference = (prefix: string) =>
  `${prefix}-${new Date().getFullYear()}-${randomBytes(4).toString('hex').toUpperCase()}`;
export function validDelivery(date: string) {
  const today = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
  const parsed = new Date(`${date}T12:00:00+05:30`);
  if (
    !Number.isFinite(parsed.getTime()) ||
    parsed.toISOString().slice(0, 10) !== date ||
    date < today ||
    parsed.getTime() > Date.now() + 90 * 86400000
  )
    fail('INVALID_DELIVERY_DATE', 'Choose a delivery date within the next 90 days.');
}
@Injectable()
export class OrdersService {
  constructor(@Inject(Db) private db: Db) {}
  cart(userId: string) {
    return this.db.cartItem.findMany({
      where: { userId },
      include: { product: { include: { category: true } } },
      orderBy: { productId: 'asc' },
    });
  }
  async setCart(userId: string, input: z.infer<typeof cartItemSchema>) {
    await this.db.atomic(async (tx) => {
      if (!input.quantity) {
        await tx.cartItem.deleteMany({ where: { userId, productId: input.productId } });
        return;
      }
      const product = await tx.product.findUnique({ where: { id: input.productId } });
      if (!product?.active || product.stock < input.quantity)
        fail('OUT_OF_STOCK', 'That quantity is not available.', 409);
      if (
        (await tx.cartItem.count({ where: { userId } })) >= 50 &&
        !(await tx.cartItem.findUnique({
          where: { userId_productId: { userId, productId: input.productId } },
        }))
      )
        fail('CART_LIMIT', 'A cart can contain up to 50 products.');
      await tx.cartItem.upsert({
        where: { userId_productId: { userId, productId: input.productId } },
        create: {
          userId,
          ...input,
          seenPricePaise: product.pricePaise,
          seenPriceVersion: product.priceVersion,
        },
        update: { quantity: input.quantity },
      });
    });
    return this.cart(userId);
  }
  async review(userId: string, input: z.infer<typeof checkoutSchema>) {
    validDelivery(input.deliveryDate);
    return this.db.atomic(async (tx) => {
      const address = await tx.address.findFirst({ where: { id: input.addressId, userId } });
      if (!address) fail('INVALID_ADDRESS', 'Choose one of your saved addresses.');
      const cart = await tx.cartItem.findMany({
        where: { userId },
        include: { product: true },
        orderBy: { productId: 'asc' },
      });
      if (!cart.length) fail('EMPTY_CART', 'Add a product before checkout.');
      const settings = await tx.storeSettings.findUniqueOrThrow({ where: { id: 'store' } });
      if (input.paymentMethod === 'ONLINE' && !(settings.onlinePaymentsEnabled && onlineReady()))
        fail('PAYMENTS_UNAVAILABLE', 'Online payment is unavailable. Choose cash on delivery.');
      const items = cart.map(({ product, quantity }) => {
        if (!product.active || product.stock < quantity)
          fail('OUT_OF_STOCK', `${product.name} is not available in that quantity.`, 409);
        return {
          productId: product.id,
          name: product.name,
          unit: product.unit,
          quantity,
          pricePaise: product.pricePaise,
          priceVersion: product.priceVersion,
          lineTotalPaise: product.pricePaise * quantity,
        };
      });
      const snapshot = {
        ...input,
        address,
        items,
        ...totals(items, settings.deliveryFeePaise, settings.freeDeliveryAbovePaise),
        settingsVersion: settings.version,
        changes: cart
          .filter((c) => c.seenPriceVersion !== c.product.priceVersion)
          .map((c) => ({
            name: c.product.name,
            oldPricePaise: c.seenPricePaise,
            newPricePaise: c.product.pricePaise,
          })),
      };
      const review = await tx.checkoutReview.create({
        data: {
          userId,
          snapshot: JSON.parse(JSON.stringify(snapshot)) as Prisma.InputJsonValue,
          expiresAt: new Date(Date.now() + 300000),
        },
      });
      return { ...snapshot, id: review.id, expiresAt: review.expiresAt };
    });
  }
  async place(userId: string, input: z.infer<typeof placeOrderSchema>) {
    return this.db.atomic(async (tx) => {
      const existing = await tx.order.findUnique({
        where: { userId_idempotencyKey: { userId, idempotencyKey: input.idempotencyKey } },
        include: orderInclude,
      });
      if (existing) {
        if (existing.reviewId !== input.reviewId)
          fail('IDEMPOTENCY_CONFLICT', 'This request key belongs to another checkout.', 409);
        return existing;
      }
      const review = await tx.checkoutReview.findFirst({
        where: { id: input.reviewId, userId },
        include: { order: true },
      });
      if (!review || review.expiresAt < new Date())
        fail('REVIEW_EXPIRED', 'Review your total again before placing the order.', 409);
      if (review.order)
        return tx.order.findUniqueOrThrow({
          where: { id: review.order.id },
          include: orderInclude,
        });
      const snapshot = review.snapshot as unknown as CheckoutReview;
      validDelivery(snapshot.deliveryDate);
      const settings = await tx.storeSettings.findUniqueOrThrow({ where: { id: 'store' } });
      if (settings.version !== snapshot.settingsVersion)
        fail('PRICE_CHANGED', 'Delivery charges changed. Review the updated total.', 409);
      if (snapshot.paymentMethod === 'ONLINE' && !(settings.onlinePaymentsEnabled && onlineReady()))
        fail('PAYMENTS_UNAVAILABLE', 'Online payment is unavailable.');
      const cart = await tx.cartItem.findMany({ where: { userId }, orderBy: { productId: 'asc' } });
      if (
        JSON.stringify(cart.map((c) => [c.productId, c.quantity])) !==
        JSON.stringify(snapshot.items.map((c) => [c.productId, c.quantity]))
      )
        fail('CART_CHANGED', 'Your cart changed. Review it again.', 409);
      for (const line of snapshot.items) {
        const product = await tx.product.findUniqueOrThrow({ where: { id: line.productId } });
        if (product.priceVersion !== line.priceVersion || product.pricePaise !== line.pricePaise)
          fail(
            'PRICE_CHANGED',
            `${product.name} now costs a different amount. Review the updated total.`,
            409,
            {
              productId: product.id,
              oldPricePaise: line.pricePaise,
              currentPricePaise: product.pricePaise,
            },
          );
        const reserved = await tx.product.updateMany({
          where: {
            id: product.id,
            active: true,
            stock: { gte: line.quantity },
            priceVersion: line.priceVersion,
          },
          data: { stock: { decrement: line.quantity }, version: { increment: 1 } },
        });
        if (!reserved.count)
          fail('OUT_OF_STOCK', `${product.name} is no longer available in that quantity.`, 409);
      }
      const amounts = totals(
        snapshot.items,
        settings.deliveryFeePaise,
        settings.freeDeliveryAbovePaise,
      );
      const online = snapshot.paymentMethod === 'ONLINE';
      const order = await tx.order.create({
        data: {
          number: reference('SC'),
          userId,
          reviewId: review.id,
          idempotencyKey: input.idempotencyKey,
          status: online ? 'PENDING_PAYMENT' : 'CONFIRMED',
          address: snapshot.address as unknown as Prisma.InputJsonValue,
          deliveryDate: snapshot.deliveryDate,
          notes: snapshot.notes,
          ...amounts,
          reservedUntil: online ? new Date(Date.now() + 30 * 60000) : null,
          items: { create: snapshot.items },
          payment: { create: { method: snapshot.paymentMethod, amountPaise: amounts.totalPaise } },
          history: {
            create: {
              status: online ? 'PENDING_PAYMENT' : 'CONFIRMED',
              note: online
                ? 'Stock reserved for 30 minutes while awaiting payment.'
                : 'Cash on delivery order placed.',
              actorId: userId,
            },
          },
        },
        include: orderInclude,
      });
      await tx.cartItem.deleteMany({ where: { userId } });
      await tx.auditLog.create({
        data: {
          actorId: userId,
          event: 'ORDER_CREATED',
          entityId: order.id,
          details: { totalPaise: amounts.totalPaise, status: order.status },
        },
      });
      await tx.notification.create({
        data: {
          userId,
          title: 'Order received',
          body: `${order.number} has been placed.`,
          orderId: order.id,
        },
      });
      return order;
    });
  }
  async changeStatus(
    id: string,
    status: z.infer<typeof orderStatusSchema>['status'],
    actorId: string,
    note: string,
    ownerId?: string,
  ) {
    return this.db.atomic(async (tx) => {
      const order = await tx.order.findFirst({
        where: { id, ...(ownerId ? { userId: ownerId } : {}) },
        include: orderInclude,
      });
      if (!order) fail('ORDER_NOT_FOUND', 'Order not found.', 404);
      if (
        ownerId &&
        (!['PENDING_PAYMENT', 'CONFIRMED'].includes(order.status) || status !== 'CANCELLED')
      )
        fail('INVALID_TRANSITION', 'Contact the store to cancel this order.', 409);
      if (
        !transitions[order.status].includes(status) ||
        ['CONFIRMED', 'REFUND_PENDING', 'REFUNDED'].includes(status)
      )
        fail('INVALID_TRANSITION', 'That order status change is not allowed.', 409);
      if (status === 'DELIVERED' && order.payment?.status !== 'CAPTURED')
        fail('PAYMENT_PENDING', 'Record payment received before completing delivery.', 409);
      const next =
        status === 'CANCELLED' && order.payment?.status === 'CAPTURED' ? 'REFUND_PENDING' : status;
      if (status === 'CANCELLED') {
        for (const line of order.items)
          await tx.product.update({
            where: { id: line.productId },
            data: { stock: { increment: line.quantity }, version: { increment: 1 } },
          });
        if (next === 'REFUND_PENDING')
          await tx.payment.update({ where: { orderId: id }, data: { status: 'REFUND_PENDING' } });
      }
      await tx.order.update({
        where: { id },
        data: {
          status: next,
          reservedUntil: null,
          history: {
            create: {
              status: next,
              actorId,
              note:
                note ||
                (next === 'REFUND_PENDING'
                  ? 'Cancelled; refund requires store action.'
                  : `Order ${status.toLowerCase()}.`),
            },
          },
        },
      });
      await tx.auditLog.create({
        data: {
          actorId,
          event: `ORDER_${next}`,
          entityId: id,
          details: { from: order.status, to: next },
        },
      });
      await tx.notification.create({
        data: {
          userId: order.userId,
          title: 'Order updated',
          body: `${order.number}: ${next.toLowerCase().replaceAll('_', ' ')}`,
          orderId: id,
        },
      });
      return tx.order.findUniqueOrThrow({ where: { id }, include: orderInclude });
    });
  }
  async expireReservations() {
    const expired = await this.db.order.findMany({
      where: { status: 'PENDING_PAYMENT', reservedUntil: { lt: new Date() } },
      take: 100,
    });
    for (const order of expired) {
      try {
        await this.changeStatus(order.id, 'CANCELLED', 'system', 'Payment reservation expired.');
      } catch (error) {
        if (!(error instanceof Error && error.message.includes('status change'))) throw error;
      }
    }
    return { processed: expired.length };
  }
  async reorder(id: string, userId: string) {
    return this.db.atomic(async (tx) => {
      const order = await tx.order.findFirst({
        where: { id, userId },
        include: { items: { include: { product: true } } },
      });
      if (!order) fail('ORDER_NOT_FOUND', 'Order not found.', 404);
      const notices: string[] = [];
      for (const item of order.items) {
        const old = await tx.cartItem.findUnique({
          where: { userId_productId: { userId, productId: item.productId } },
        });
        const quantity = item.quantity + (old?.quantity || 0);
        if (!item.product.active || item.product.stock < quantity || quantity > 10000) {
          notices.push(`${item.name}: unavailable in the requested quantity.`);
          continue;
        }
        if (item.product.pricePaise !== item.pricePaise)
          notices.push(`${item.name}: price has changed; current price added.`);
        await tx.cartItem.upsert({
          where: { userId_productId: { userId, productId: item.productId } },
          create: {
            userId,
            productId: item.productId,
            quantity,
            seenPricePaise: item.product.pricePaise,
            seenPriceVersion: item.product.priceVersion,
          },
          update: {
            quantity,
            seenPricePaise: item.product.pricePaise,
            seenPriceVersion: item.product.priceVersion,
          },
        });
      }
      return { notices };
    });
  }
}
@ApiTags('Cart and orders')
@Controller()
export class OrdersController {
  constructor(
    @Inject(OrdersService) private orders: OrdersService,
    @Inject(Db) private db: Db,
  ) {}
  @Get('cart') cart(@Req() req: AuthRequest) {
    return this.orders.cart(req.user.id);
  }
  @Put('cart/items') @Contract(cartItemSchema) cartItem(
    @Input(cartItemSchema) body: z.infer<typeof cartItemSchema>,
    @Req() req: AuthRequest,
  ) {
    return this.orders.setCart(req.user.id, body);
  }
  @Post('checkout/review') @Contract(checkoutSchema) review(
    @Input(checkoutSchema) body: z.infer<typeof checkoutSchema>,
    @Req() req: AuthRequest,
  ) {
    return this.orders.review(req.user.id, body);
  }
  @Post('orders') @Contract(placeOrderSchema) place(
    @Input(placeOrderSchema) body: z.infer<typeof placeOrderSchema>,
    @Req() req: AuthRequest,
  ) {
    return this.orders.place(req.user.id, body);
  }
  @Get('orders') list(@Req() req: AuthRequest) {
    return this.db.order.findMany({
      where: { userId: req.user.id },
      include: orderInclude,
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
  }
  @Get('orders/:id') async detail(@Param('id') id: string, @Req() req: AuthRequest) {
    const order = await this.db.order.findFirst({
      where: { id, userId: req.user.id },
      include: orderInclude,
    });
    if (!order) fail('ORDER_NOT_FOUND', 'Order not found.', 404);
    return order;
  }
  @Get('orders/:id/invoice') async invoice(@Param('id') id: string, @Req() req: AuthRequest) {
    return {
      documentType: 'ORDER_SUMMARY',
      taxInvoice: false,
      store: 'Shiv Cement Store',
      order: await this.detail(id, req),
    };
  }
  @Post('orders/:id/reorder') reorder(@Param('id') id: string, @Req() req: AuthRequest) {
    return this.orders.reorder(id, req.user.id);
  }
  @Post('orders/:id/cancel') cancel(@Param('id') id: string, @Req() req: AuthRequest) {
    return this.orders.changeStatus(
      id,
      'CANCELLED',
      req.user.id,
      'Cancelled by customer.',
      req.user.id,
    );
  }
  @Admin() @Get('admin/orders') all() {
    return this.db.order.findMany({
      include: { ...orderInclude, user: true },
      orderBy: { createdAt: 'desc' },
      take: 300,
    });
  }
  @Admin() @Patch('admin/orders/:id/status') @Contract(orderStatusSchema) change(
    @Param('id') id: string,
    @Input(orderStatusSchema) body: z.infer<typeof orderStatusSchema>,
    @Req() req: AuthRequest,
  ) {
    return this.orders.changeStatus(id, body.status, req.user.id, body.note);
  }
  @Admin() @Post('admin/orders/expire-reservations') expire() {
    return this.orders.expireReservations();
  }
}
