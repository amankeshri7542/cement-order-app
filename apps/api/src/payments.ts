import { Controller, Inject, Injectable, Param, Post, Req } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { createHmac } from 'node:crypto';
import { z } from 'zod';
import { paymentVerifySchema } from '@shiv/shared';
import { Db } from './db';
import { getConfig, onlineReady } from './config';
import { Admin, AuthRequest, Contract, Input, Public, fail, hash, safeEqual } from './http';

const capturedSchema = z.object({
  id: z.string(),
  order_id: z.string(),
  amount: z.number().int(),
  currency: z.string(),
  status: z.string(),
});
const reconcileSchema = z.strictObject({
  razorpayOrderId: z.string().regex(/^order_[A-Za-z0-9]+$/),
});
export function verifySignature(body: string | Buffer, signature: string, secret: string) {
  return (
    /^[a-f0-9]{64}$/.test(signature) &&
    safeEqual(createHmac('sha256', secret).update(body).digest('hex'), signature)
  );
}
@Injectable()
export class PaymentsService {
  constructor(@Inject(Db) private db: Db) {}
  async gateway(path: string, body?: unknown) {
    const c = getConfig();
    if (!onlineReady())
      fail('PAYMENTS_NOT_CONFIGURED', 'Online payments have not been configured.', 503);
    const response = await fetch(`https://api.razorpay.com/v1/${path}`, {
      method: body === undefined ? 'GET' : 'POST',
      headers: {
        Authorization: `Basic ${Buffer.from(`${c.RAZORPAY_KEY_ID}:${c.RAZORPAY_KEY_SECRET}`).toString('base64')}`,
        'Content-Type': 'application/json',
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal: AbortSignal.timeout(15000),
    });
    if (!response.ok)
      fail(
        'PAYMENT_GATEWAY_ERROR',
        'Payment service could not complete the request. Contact the store before trying again.',
        502,
      );
    return (await response.json()) as unknown;
  }
  async initialize(orderId: string, userId: string) {
    if (!onlineReady())
      fail('PAYMENTS_NOT_CONFIGURED', 'Online payments have not been configured.', 503);
    const payment = await this.db.atomic(async (tx) => {
      const p = await tx.payment.findFirst({
        where: { orderId, order: { userId } },
        include: { order: true },
      });
      if (!p) fail('ORDER_NOT_FOUND', 'Order not found.', 404);
      if (
        p.method !== 'ONLINE' ||
        p.order.status !== 'PENDING_PAYMENT' ||
        !p.order.reservedUntil ||
        p.order.reservedUntil < new Date()
      )
        fail('INVALID_PAYMENT_STATE', 'This order is not awaiting payment.', 409);
      if (p.razorpayOrderId) return p;
      if (p.initializationStartedAt)
        fail(
          'PAYMENT_PENDING',
          'Payment setup is pending verification. Contact the store; do not pay again.',
          409,
        );
      await tx.payment.update({
        where: { id: p.id },
        data: { initializationStartedAt: new Date() },
      });
      return p;
    });
    let razorpayOrderId = payment.razorpayOrderId;
    if (!razorpayOrderId) {
      // An uncertain network result deliberately stays locked; staff reconcile the provider receipt.
      const created = z
        .object({
          id: z.string().regex(/^order_/),
          amount: z.number().int(),
          currency: z.literal('INR'),
        })
        .parse(
          await this.gateway('orders', {
            amount: payment.amountPaise,
            currency: 'INR',
            receipt: orderId,
          }),
        );
      if (created.amount !== payment.amountPaise)
        fail('PAYMENT_MISMATCH', 'Payment amount could not be verified.', 502);
      razorpayOrderId = created.id;
      await this.db.payment.update({ where: { id: payment.id }, data: { razorpayOrderId } });
      await this.db.auditLog.create({
        data: {
          actorId: userId,
          event: 'PAYMENT_INITIATED',
          entityId: orderId,
          details: { razorpayOrderId },
        },
      });
    }
    return {
      key: getConfig().RAZORPAY_KEY_ID,
      razorpayOrderId,
      amount: payment.amountPaise,
      currency: 'INR',
      name: 'Shiv Cement Store',
    };
  }
  async callback(userId: string, input: z.infer<typeof paymentVerifySchema>) {
    const payment = await this.db.payment.findFirst({
      where: { orderId: input.orderId, order: { userId } },
    });
    if (!payment || payment.razorpayOrderId !== input.razorpayOrderId)
      fail('PAYMENT_MISMATCH', 'Payment does not belong to this order.', 400);
    const secret = getConfig().RAZORPAY_KEY_SECRET;
    if (
      !secret ||
      !verifySignature(
        `${payment.razorpayOrderId}|${input.razorpayPaymentId}`,
        input.signature,
        secret,
      )
    )
      fail('INVALID_SIGNATURE', 'Payment signature is invalid.', 400);
    const captured = capturedSchema.parse(
      await this.gateway(`payments/${encodeURIComponent(input.razorpayPaymentId)}`),
    );
    if (
      captured.order_id !== payment.razorpayOrderId ||
      captured.amount !== payment.amountPaise ||
      captured.currency !== 'INR'
    )
      fail('PAYMENT_MISMATCH', 'Payment details do not match.', 400);
    return {
      verified: true,
      status: payment.status,
      message:
        payment.status === 'CAPTURED'
          ? 'Payment confirmed.'
          : 'Payment received by gateway. Awaiting server confirmation.',
    };
  }
  async capture(eventId: string, payloadHash: string, entity: z.infer<typeof capturedSchema>) {
    return this.db.atomic(async (tx) => {
      const duplicate = await tx.paymentEvent.findUnique({ where: { id: eventId } });
      if (duplicate) {
        if (duplicate.payloadHash !== payloadHash)
          fail('EVENT_CONFLICT', 'Event identifier reused with different content.', 409);
        return { duplicate: true };
      }
      const payment = await tx.payment.findUnique({
        where: { razorpayOrderId: entity.order_id },
        include: { order: true },
      });
      if (!payment)
        fail('PAYMENT_NOT_FOUND', 'Payment order is not registered yet. Retry delivery.', 409);
      if (
        payment.method !== 'ONLINE' ||
        entity.amount !== payment.amountPaise ||
        entity.currency !== 'INR' ||
        entity.status !== 'captured'
      )
        fail('PAYMENT_MISMATCH', 'Payment details do not match the order.');
      if (payment.razorpayPaymentId && payment.razorpayPaymentId !== entity.id)
        fail('PAYMENT_CONFLICT', 'A different payment was already recorded.', 409);
      await tx.paymentEvent.create({
        data: { id: eventId, paymentId: payment.id, type: 'payment.captured', payloadHash },
      });
      if (payment.status !== 'PENDING') return { duplicate: true };
      const late = payment.order.status === 'CANCELLED';
      if (!late && payment.order.status !== 'PENDING_PAYMENT')
        fail('PAYMENT_CONFLICT', 'Order is not awaiting payment.', 409);
      await tx.payment.update({
        where: { id: payment.id },
        data: { status: late ? 'REFUND_PENDING' : 'CAPTURED', razorpayPaymentId: entity.id },
      });
      await tx.order.update({
        where: { id: payment.orderId },
        data: {
          status: late ? 'REFUND_PENDING' : 'CONFIRMED',
          reservedUntil: null,
          history: {
            create: {
              status: late ? 'REFUND_PENDING' : 'CONFIRMED',
              actorId: 'razorpay',
              note: late
                ? 'Payment arrived after cancellation. Refund required; stock was not re-reserved.'
                : 'Payment verified by Razorpay.',
            },
          },
        },
      });
      await tx.auditLog.create({
        data: {
          actorId: 'razorpay',
          event: late ? 'LATE_PAYMENT_REFUND_REQUIRED' : 'PAYMENT_CONFIRMED',
          entityId: payment.orderId,
          details: { paymentId: entity.id, amountPaise: entity.amount },
        },
      });
      await tx.notification.create({
        data: {
          userId: payment.order.userId,
          title: late ? 'Refund required' : 'Payment confirmed',
          body: late
            ? 'Your payment arrived after the reservation expired. Contact the store for your refund.'
            : `Payment for ${payment.order.number} is confirmed.`,
          orderId: payment.orderId,
        },
      });
      return { ok: true };
    });
  }
  async webhook(raw: Buffer, signature: string, eventId: string) {
    const secret = getConfig().RAZORPAY_WEBHOOK_SECRET;
    if (!secret || !verifySignature(raw, signature, secret))
      fail('INVALID_SIGNATURE', 'Webhook signature is invalid.', 401);
    if (!eventId || eventId.length > 200)
      fail('INVALID_EVENT', 'A gateway event identifier is required.');
    const body = z
      .object({ event: z.string(), payload: z.record(z.string(), z.unknown()) })
      .parse(JSON.parse(raw.toString('utf8')));
    if (body.event === 'payment.captured') {
      const payment = z.object({ entity: capturedSchema }).parse(body.payload.payment);
      return this.capture(eventId, hash(raw), payment.entity);
    }
    if (body.event === 'refund.processed') {
      const refund = z
        .object({
          entity: z.object({
            id: z.string(),
            payment_id: z.string(),
            amount: z.number().int(),
            status: z.literal('processed'),
          }),
        })
        .parse(body.payload.refund).entity;
      return this.db.atomic(async (tx) => {
        const duplicate = await tx.paymentEvent.findUnique({ where: { id: eventId } });
        if (duplicate) {
          if (duplicate.payloadHash !== hash(raw))
            fail('EVENT_CONFLICT', 'Event content changed.', 409);
          return { duplicate: true };
        }
        const p = await tx.payment.findUnique({
          where: { razorpayPaymentId: refund.payment_id },
          include: { order: true },
        });
        if (!p) fail('PAYMENT_NOT_FOUND', 'Payment not found.', 409);
        if (p.status === 'REFUNDED' && refund.amount === p.amountPaise) {
          await tx.paymentEvent.create({
            data: { id: eventId, paymentId: p.id, type: body.event, payloadHash: hash(raw) },
          });
          return { duplicate: true };
        }
        if (p.status !== 'REFUND_PENDING' || refund.amount !== p.amountPaise)
          fail(
            'REFUND_REVIEW_REQUIRED',
            'Only full refunds of cancelled orders are supported.',
            409,
          );
        await tx.paymentEvent.create({
          data: { id: eventId, paymentId: p.id, type: body.event, payloadHash: hash(raw) },
        });
        await tx.payment.update({ where: { id: p.id }, data: { status: 'REFUNDED' } });
        await tx.order.update({
          where: { id: p.orderId },
          data: {
            status: 'REFUNDED',
            history: {
              create: {
                status: 'REFUNDED',
                actorId: 'razorpay',
                note: 'Full refund verified by Razorpay.',
              },
            },
          },
        });
        await tx.auditLog.create({
          data: {
            actorId: 'razorpay',
            event: 'PAYMENT_REFUNDED',
            entityId: p.orderId,
            details: { refundId: refund.id, amountPaise: refund.amount },
          },
        });
        return { ok: true };
      });
    }
    return { ignored: true };
  }
  async cod(orderId: string, actorId: string, refund = false) {
    return this.db.atomic(async (tx) => {
      const p = await tx.payment.findUnique({ where: { orderId }, include: { order: true } });
      if (!p || p.method !== 'COD')
        fail('INVALID_PAYMENT_STATE', 'This is not a cash-on-delivery order.');
      if (
        refund
          ? p.status !== 'REFUND_PENDING'
          : p.status !== 'PENDING' ||
            !['CONFIRMED', 'PREPARING', 'OUT_FOR_DELIVERY'].includes(p.order.status)
      )
        fail('INVALID_PAYMENT_STATE', 'Payment cannot be updated in this state.', 409);
      await tx.payment.update({
        where: { id: p.id },
        data: { status: refund ? 'REFUNDED' : 'CAPTURED' },
      });
      if (refund)
        await tx.order.update({
          where: { id: orderId },
          data: {
            status: 'REFUNDED',
            history: {
              create: { status: 'REFUNDED', actorId, note: 'Cash refund recorded by store staff.' },
            },
          },
        });
      await tx.auditLog.create({
        data: {
          actorId,
          event: refund ? 'CASH_REFUNDED' : 'COD_RECEIVED',
          entityId: orderId,
          details: { amountPaise: p.amountPaise },
        },
      });
      return { ok: true };
    });
  }
  async reconcile(orderId: string, providerId: string, actorId: string) {
    const remote = z
      .object({
        id: z.string(),
        receipt: z.string(),
        amount: z.number().int(),
        currency: z.string(),
      })
      .parse(await this.gateway(`orders/${encodeURIComponent(providerId)}`));
    const payment = await this.db.payment.findUniqueOrThrow({ where: { orderId } });
    if (
      payment.method !== 'ONLINE' ||
      remote.receipt !== orderId ||
      remote.amount !== payment.amountPaise ||
      remote.currency !== 'INR' ||
      (payment.razorpayOrderId && payment.razorpayOrderId !== providerId)
    )
      fail('PAYMENT_MISMATCH', 'Provider order does not match this order.');
    await this.db.payment.update({ where: { orderId }, data: { razorpayOrderId: providerId } });
    await this.db.auditLog.create({
      data: { actorId, event: 'PAYMENT_RECONCILED', entityId: orderId, details: { providerId } },
    });
    const payments = z
      .object({ items: z.array(capturedSchema) })
      .parse(await this.gateway(`orders/${encodeURIComponent(providerId)}/payments`));
    for (const p of payments.items.filter((p) => p.status === 'captured'))
      await this.capture(`reconcile:${p.id}`, hash(JSON.stringify(p)), p);
    return { ok: true };
  }
}
@ApiTags('Payments')
@Controller()
export class PaymentsController {
  constructor(@Inject(PaymentsService) private payments: PaymentsService) {}
  @Post('payments/orders/:id') initialize(@Param('id') id: string, @Req() req: AuthRequest) {
    return this.payments.initialize(id, req.user.id);
  }
  @Post('payments/verify') @Contract(paymentVerifySchema) verify(
    @Input(paymentVerifySchema) body: z.infer<typeof paymentVerifySchema>,
    @Req() req: AuthRequest,
  ) {
    return this.payments.callback(req.user.id, body);
  }
  @Public() @Post('payments/webhook') webhook(@Req() req: AuthRequest) {
    if (!req.rawBody) fail('INVALID_BODY', 'Raw request body required.');
    return this.payments.webhook(
      req.rawBody,
      String(req.headers['x-razorpay-signature'] || ''),
      String(req.headers['x-razorpay-event-id'] || ''),
    );
  }
  @Admin() @Post('admin/orders/:id/cod-received') cod(
    @Param('id') id: string,
    @Req() req: AuthRequest,
  ) {
    return this.payments.cod(id, req.user.id);
  }
  @Admin() @Post('admin/orders/:id/cash-refunded') refund(
    @Param('id') id: string,
    @Req() req: AuthRequest,
  ) {
    return this.payments.cod(id, req.user.id, true);
  }
  @Admin() @Post('admin/orders/:id/reconcile-payment') @Contract(reconcileSchema) reconcile(
    @Param('id') id: string,
    @Input(reconcileSchema) body: z.infer<typeof reconcileSchema>,
    @Req() req: AuthRequest,
  ) {
    return this.payments.reconcile(id, body.razorpayOrderId, req.user.id);
  }
}
