import 'reflect-metadata';
import { beforeAll, beforeEach, afterAll, describe, expect, it } from 'vitest';
import { loadEnvFile } from 'node:process';
import { createHmac, randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import request from 'supertest';
import type { INestApplication } from '@nestjs/common';
import type { Server } from 'node:http';
import { Db } from '../src/db';
import { hash } from '../src/http';
import { OrdersService } from '../src/orders';

if (existsSync('.env.test')) loadEnvFile('.env.test');
process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
process.env.OTP_PROVIDER = 'mock';
process.env.OTP_HASH_SECRET = 'integration-test-only-secret-not-for-production';
process.env.RAZORPAY_KEY_ID = 'rzp_test_local';
process.env.RAZORPAY_KEY_SECRET = 'test-key-secret';
process.env.RAZORPAY_WEBHOOK_SECRET = 'test-webhook-secret';
process.env.CORS_ORIGINS = 'http://localhost:3000,http://localhost:8081';
if (!process.env.DATABASE_URL || !new URL(process.env.DATABASE_URL).pathname.endsWith('_test'))
  throw new Error(
    'Integration tests require a dedicated TEST_DATABASE_URL database ending in _test.',
  );

let app: INestApplication;
let server: Server;
let db: Db;
const tokens = { customer: 'c'.repeat(43), other: 'o'.repeat(43), admin: 'a'.repeat(43) };
const date = new Date(Date.now() + 86400000).toISOString().slice(0, 10);
const address = {
  label: 'Site',
  name: 'Test customer',
  phone: '+919999999991',
  line1: 'Plot 12, test street',
  area: 'Kankarbagh',
  city: 'Patna',
  state: 'Bihar',
  pincode: '800020',
  landmark: '',
};
const product = {
  id: 'cement',
  name: 'Test cement',
  brand: 'Test',
  categoryId: 'cement-category',
  type: 'PPC',
  grade: 'PPC',
  unit: '50 kg bag',
  pricePaise: 41000,
  stock: 100,
  active: true,
  images: [],
  description: 'Test material',
  recommendedUse: 'Testing',
};
const auth = (who: keyof typeof tokens = 'customer') => ({
  Authorization: `Bearer ${tokens[who]}`,
});
async function cart(who: keyof typeof tokens = 'customer', quantity = 10) {
  return request(server)
    .put('/api/v1/cart/items')
    .set(auth(who))
    .send({ productId: 'cement', quantity })
    .expect(200);
}
async function review(who: keyof typeof tokens = 'customer', paymentMethod = 'COD') {
  return request(server)
    .post('/api/v1/checkout/review')
    .set(auth(who))
    .send({ addressId: `${who}-address`, deliveryDate: date, paymentMethod })
    .expect(201);
}
async function place(reviewId: string, who: keyof typeof tokens = 'customer', key = randomUUID()) {
  return request(server)
    .post('/api/v1/orders')
    .set(auth(who))
    .send({ reviewId, idempotencyKey: key });
}
async function order(paymentMethod = 'COD') {
  await cart();
  const r = await review('customer', paymentMethod);
  return place(r.body.id).then((r) => {
    expect(r.status).toBe(201);
    return r.body;
  });
}
async function onlineOrder() {
  const o = await order('ONLINE');
  await db.payment.update({ where: { orderId: o.id }, data: { razorpayOrderId: 'order_gateway' } });
  return o;
}
function webhook(
  entity: Record<string, unknown>,
  eventId = randomUUID(),
  event = 'payment.captured',
) {
  const body = JSON.stringify({
    event,
    payload: { [event === 'refund.processed' ? 'refund' : 'payment']: { entity } },
  });
  const signature = createHmac('sha256', 'test-webhook-secret').update(body).digest('hex');
  return request(server)
    .post('/api/v1/payments/webhook')
    .set('Content-Type', 'application/json')
    .set('x-razorpay-signature', signature)
    .set('x-razorpay-event-id', eventId)
    .send(body);
}
const capture = {
  id: 'pay_test',
  order_id: 'order_gateway',
  amount: 460000,
  currency: 'INR',
  status: 'captured',
};

beforeAll(async () => {
  const { createApp } = await import('../src/app');
  app = await createApp();
  await app.init();
  server = app.getHttpServer();
  db = app.get(Db);
}, 30000);
beforeEach(async () => {
  await db.$executeRawUnsafe(
    'TRUNCATE TABLE "User", "Category", "Product", "Order", "Quote", "AuditLog", "OtpChallenge", "StoreSettings" RESTART IDENTITY CASCADE',
  );
  for (const [i, role] of (['customer', 'other', 'admin'] as const).entries()) {
    await db.user.create({
      data: {
        id: role,
        phone: `+91999999999${i + 1}`,
        role: role === 'admin' ? 'ADMIN' : 'CUSTOMER',
        name: role,
        sessions: {
          create: {
            accessHash: hash(tokens[role]),
            refreshHash: hash(`${role}-refresh`),
            expiresAt: new Date(Date.now() + 3600000),
            refreshExpiresAt: new Date(Date.now() + 86400000),
          },
        },
        addresses: { create: { id: `${role}-address`, ...address } },
      },
    });
  }
  await db.category.create({ data: { id: 'cement-category', name: 'Cement', slug: 'cement' } });
  await db.product.create({ data: product });
  await db.storeSettings.create({
    data: { id: 'store', deliveryFeePaise: 50000, onlinePaymentsEnabled: true },
  });
});
afterAll(async () => {
  await app?.close();
});

describe('Authentication and authorization over HTTP', () => {
  it('blocks unauthenticated access, customer admin access and role injection', async () => {
    await request(server).get('/api/v1/orders').expect(401);
    await request(server).get('/api/v1/admin/products').set(auth()).expect(403);
    await request(server)
      .patch('/api/v1/me')
      .set(auth())
      .send({ name: 'Hacker', language: 'en', role: 'ADMIN' })
      .expect(400);
    expect((await db.user.findUniqueOrThrow({ where: { id: 'customer' } })).role).toBe('CUSTOMER');
  });
  it('binds address and review access to customer identity', async () => {
    await cart();
    await request(server)
      .post('/api/v1/checkout/review')
      .set(auth())
      .send({ addressId: 'other-address', deliveryDate: date, paymentMethod: 'COD' })
      .expect(400);
    const r = await review();
    const other = await place(r.body.id, 'other');
    expect(other.status).toBe(409);
    await request(server).delete('/api/v1/me/addresses/other-address').set(auth()).expect(404);
  });
  it('checks browser origins and uses HttpOnly cookies without returning browser tokens', async () => {
    await request(server)
      .post('/api/v1/auth/otp/request')
      .set('Origin', 'https://evil.example')
      .send({ phone: '+918888888881' })
      .expect(403);
    const r = await request(server)
      .post('/api/v1/auth/otp/request')
      .set('Origin', 'http://localhost:3000')
      .send({ phone: '+918888888881' })
      .expect(201);
    const v = await request(server)
      .post('/api/v1/auth/otp/verify')
      .set('Origin', 'http://localhost:3000')
      .send({ phone: '+918888888881', code: r.body.devCode })
      .expect(201);
    expect(v.body.accessToken).toBeUndefined();
    expect(String(v.headers['set-cookie'])).toContain('HttpOnly');
  });
  it('limits OTP requests and failed attempts, consumes OTP once, rotates refresh tokens', async () => {
    const phone = '+918888888882';
    const r = await request(server).post('/api/v1/auth/otp/request').send({ phone }).expect(201);
    await request(server).post('/api/v1/auth/otp/request').send({ phone }).expect(429);
    const v = await request(server)
      .post('/api/v1/auth/otp/verify')
      .send({ phone, code: r.body.devCode })
      .expect(201);
    await request(server)
      .post('/api/v1/auth/otp/verify')
      .send({ phone, code: r.body.devCode })
      .expect(401);
    const refreshed = await request(server)
      .post('/api/v1/auth/refresh')
      .send({ refreshToken: v.body.refreshToken })
      .expect(201);
    await request(server)
      .get('/api/v1/me')
      .set('Authorization', `Bearer ${v.body.accessToken}`)
      .expect(401);
    await request(server)
      .post('/api/v1/auth/refresh')
      .send({ refreshToken: v.body.refreshToken })
      .expect(401);
    await request(server)
      .get('/api/v1/me')
      .set('Authorization', `Bearer ${refreshed.body.accessToken}`)
      .expect(200);
    const p = '+918888888883';
    const c = await request(server).post('/api/v1/auth/otp/request').send({ phone: p });
    for (let i = 0; i < 5; i++)
      await request(server)
        .post('/api/v1/auth/otp/verify')
        .send({ phone: p, code: '000000' })
        .expect(401);
    await request(server)
      .post('/api/v1/auth/otp/verify')
      .send({ phone: p, code: c.body.devCode })
      .expect(401);
  });
  it('revokes device notifications when their authenticated session logs out', async () => {
    await request(server)
      .post('/api/v1/me/devices')
      .set(auth())
      .send({ token: 'test-device-token-long-enough', platform: 'android' })
      .expect(201);
    expect(await db.device.count()).toBe(1);
    await request(server).post('/api/v1/auth/logout').set(auth()).send({}).expect(201);
    expect(await db.device.count()).toBe(0);
    await request(server).get('/api/v1/me').set(auth()).expect(401);
  });
});
describe('Checkout and stock transaction integrity', () => {
  it('calculates server totals and rejects money injection', async () => {
    await request(server)
      .put('/api/v1/cart/items')
      .set(auth())
      .send({ productId: 'cement', quantity: 10, pricePaise: 1 })
      .expect(400);
    const o = await order();
    expect(o.totalPaise).toBe(460000);
    expect(o.items[0].pricePaise).toBe(41000);
    expect((await db.product.findUniqueOrThrow({ where: { id: 'cement' } })).stock).toBe(90);
  });
  it('requires another review after an admin price update and records price history', async () => {
    await cart();
    const r = await review();
    const { id: _id, ...data } = product;
    await request(server)
      .patch('/api/v1/admin/products/cement')
      .set(auth('admin'))
      .send({ ...data, pricePaise: 42500, expectedVersion: 1 })
      .expect(200);
    const failed = await place(r.body.id);
    expect(failed.status).toBe(409);
    expect(failed.body.error.code).toBe('PRICE_CHANGED');
    expect(await db.order.count()).toBe(0);
    expect((await db.product.findUniqueOrThrow({ where: { id: 'cement' } })).stock).toBe(100);
    const fresh = await review();
    expect(fresh.body.changes[0]).toMatchObject({ oldPricePaise: 41000, newPricePaise: 42500 });
    expect((await place(fresh.body.id)).body.totalPaise).toBe(475000);
    expect(await db.productPriceHistory.count()).toBe(1);
  });
  it('invalidates reviews after delivery policy changes', async () => {
    await cart();
    const r = await review();
    await request(server)
      .patch('/api/v1/admin/store')
      .set(auth('admin'))
      .send({
        phone: '+919297513707',
        deliveryFeePaise: 60000,
        freeDeliveryAbovePaise: null,
        onlinePaymentsEnabled: true,
        deliveryMessage: 'Across Bihar',
        expectedVersion: 1,
      })
      .expect(200);
    expect((await place(r.body.id)).body.error.code).toBe('PRICE_CHANGED');
  });
  it('makes simultaneous repeated order submissions idempotent', async () => {
    await cart();
    const r = await review();
    const key = randomUUID();
    const results = await Promise.all([
      place(r.body.id, 'customer', key),
      place(r.body.id, 'customer', key),
    ]);
    expect(results.map((r) => r.status)).toEqual([201, 201]);
    expect(results[0]!.body.id).toBe(results[1]!.body.id);
    expect(await db.order.count()).toBe(1);
    expect((await db.product.findUniqueOrThrow({ where: { id: 'cement' } })).stock).toBe(90);
  });
  it('does not oversell the last stock to concurrent customers', async () => {
    await db.product.update({ where: { id: 'cement' }, data: { stock: 10 } });
    await cart('customer');
    await cart('other');
    const a = await review();
    const b = await review('other');
    const results = await Promise.all([place(a.body.id), place(b.body.id, 'other')]);
    expect(results.map((r) => r.status).sort()).toEqual([201, 409]);
    expect(await db.order.count()).toBe(1);
    expect((await db.product.findUniqueOrThrow({ where: { id: 'cement' } })).stock).toBe(0);
  });
  it('rejects changed carts, expired reviews, unavailable stock and invalid dates', async () => {
    await cart();
    const r = await review();
    await cart('customer', 5);
    expect((await place(r.body.id)).body.error.code).toBe('CART_CHANGED');
    const fresh = await review();
    await db.checkoutReview.update({
      where: { id: fresh.body.id },
      data: { expiresAt: new Date(0) },
    });
    expect((await place(fresh.body.id)).body.error.code).toBe('REVIEW_EXPIRED');
    await db.product.update({ where: { id: 'cement' }, data: { stock: 0 } });
    await request(server)
      .post('/api/v1/checkout/review')
      .set(auth())
      .send({ addressId: 'customer-address', deliveryDate: date, paymentMethod: 'COD' })
      .expect(409);
    await request(server)
      .post('/api/v1/checkout/review')
      .set(auth())
      .send({ addressId: 'customer-address', deliveryDate: '2020-02-31', paymentMethod: 'COD' })
      .expect(400);
  });
});
describe('Orders, payments and replay protection', () => {
  it('prevents IDOR, invalid fulfilment, and delivery before payment; records COD', async () => {
    const o = await order();
    await request(server).get(`/api/v1/orders/${o.id}`).set(auth('other')).expect(404);
    await request(server).get(`/api/v1/orders/${o.id}/invoice`).set(auth('other')).expect(404);
    await request(server)
      .patch(`/api/v1/admin/orders/${o.id}/status`)
      .set(auth('admin'))
      .send({ status: 'DELIVERED' })
      .expect(409);
    for (const status of ['PREPARING', 'OUT_FOR_DELIVERY'])
      await request(server)
        .patch(`/api/v1/admin/orders/${o.id}/status`)
        .set(auth('admin'))
        .send({ status })
        .expect(200);
    await request(server)
      .patch(`/api/v1/admin/orders/${o.id}/status`)
      .set(auth('admin'))
      .send({ status: 'DELIVERED' })
      .expect(409);
    await request(server)
      .post(`/api/v1/admin/orders/${o.id}/cod-received`)
      .set(auth('admin'))
      .expect(201);
    await request(server)
      .patch(`/api/v1/admin/orders/${o.id}/status`)
      .set(auth('admin'))
      .send({ status: 'DELIVERED' })
      .expect(200);
  });
  it('restores cancelled stock exactly once', async () => {
    const o = await order();
    const result = await Promise.all([
      request(server).post(`/api/v1/orders/${o.id}/cancel`).set(auth()),
      request(server).post(`/api/v1/orders/${o.id}/cancel`).set(auth()),
    ]);
    expect(result.map((r) => r.status).sort()).toEqual([201, 409]);
    expect((await db.product.findUniqueOrThrow({ where: { id: 'cement' } })).stock).toBe(100);
  });
  it('reorders using current prices and reports unavailable products', async () => {
    const o = await order();
    await db.product.update({
      where: { id: 'cement' },
      data: { pricePaise: 45000, priceVersion: 2 },
    });
    const r = await request(server).post(`/api/v1/orders/${o.id}/reorder`).set(auth()).expect(201);
    expect(r.body.notices).toHaveLength(1);
    expect((await db.cartItem.findFirstOrThrow()).seenPricePaise).toBe(45000);
    await db.product.update({ where: { id: 'cement' }, data: { active: false } });
    const unavailable = await request(server)
      .post(`/api/v1/orders/${o.id}/reorder`)
      .set(auth())
      .expect(201);
    expect(unavailable.body.notices[0]).toContain('unavailable');
  });
  it('rejects forged signatures, mismatched amounts and callback-only fake success', async () => {
    const o = await onlineOrder();
    await request(server)
      .post('/api/v1/payments/webhook')
      .set('x-razorpay-signature', '0'.repeat(64))
      .send({ event: 'payment.captured' })
      .expect(401);
    expect((await webhook({ ...capture, amount: 1 })).status).toBe(400);
    await request(server)
      .post('/api/v1/payments/verify')
      .set(auth())
      .send({
        orderId: o.id,
        razorpayOrderId: 'order_gateway',
        razorpayPaymentId: 'pay_fake',
        signature: '0'.repeat(64),
      })
      .expect(400);
    expect((await db.payment.findUniqueOrThrow({ where: { orderId: o.id } })).status).toBe(
      'PENDING',
    );
  });
  it('handles duplicate and concurrent captured webhooks once and rejects event ID reuse', async () => {
    const o = await onlineOrder();
    const id = randomUUID();
    const result = await Promise.all([webhook(capture, id), webhook(capture, id)]);
    expect(result.map((r) => r.status)).toEqual([201, 201]);
    expect(await db.paymentEvent.count()).toBe(1);
    expect((await db.order.findUniqueOrThrow({ where: { id: o.id } })).status).toBe('CONFIRMED');
    expect((await webhook({ ...capture, amount: 123 }, id)).status).toBe(409);
    expect((await webhook(capture)).status).toBe(201);
    expect(
      await db.orderStatusHistory.count({ where: { orderId: o.id, status: 'CONFIRMED' } }),
    ).toBe(1);
  });
  it('expires unpaid reservations and flags late captured payments for refund without reserving stock again', async () => {
    const o = await onlineOrder();
    await db.order.update({ where: { id: o.id }, data: { reservedUntil: new Date(0) } });
    await app.get(OrdersService).expireReservations();
    expect((await db.product.findUniqueOrThrow({ where: { id: 'cement' } })).stock).toBe(100);
    await webhook(capture);
    expect((await db.order.findUniqueOrThrow({ where: { id: o.id } })).status).toBe(
      'REFUND_PENDING',
    );
    expect((await db.product.findUniqueOrThrow({ where: { id: 'cement' } })).stock).toBe(100);
    await webhook(
      { id: 'rfnd_test', payment_id: 'pay_test', amount: 460000, status: 'processed' },
      randomUUID(),
      'refund.processed',
    );
    expect((await db.payment.findUniqueOrThrow({ where: { orderId: o.id } })).status).toBe(
      'REFUNDED',
    );
    expect(
      (
        await webhook(
          { id: 'rfnd_test', payment_id: 'pay_test', amount: 460000, status: 'processed' },
          randomUUID(),
          'refund.processed',
        )
      ).body.duplicate,
    ).toBe(true);
  });
});
describe('Quotations and admin conflicts', () => {
  it('checks quote revisions, ownership and expiry', async () => {
    const q = await request(server)
      .post('/api/v1/quotes')
      .set(auth())
      .send({
        items: [{ productId: 'cement', quantity: 100 }],
        addressId: 'customer-address',
        deliveryDate: date,
      })
      .expect(201);
    const offer = {
      expectedRevision: 0,
      items: [{ productId: 'cement', unitPricePaise: 40000 }],
      deliveryFeePaise: 75000,
      validUntil: new Date(Date.now() + 86400000).toISOString(),
    };
    await request(server)
      .post(`/api/v1/admin/quotes/${q.body.id}/offer`)
      .set(auth())
      .send(offer)
      .expect(403);
    const first = await request(server)
      .post(`/api/v1/admin/quotes/${q.body.id}/offer`)
      .set(auth('admin'))
      .send(offer)
      .expect(201);
    expect(first.body.totalPaise).toBe(4075000);
    await request(server)
      .post(`/api/v1/admin/quotes/${q.body.id}/offer`)
      .set(auth('admin'))
      .send({ ...offer, expectedRevision: 1 })
      .expect(201);
    await request(server)
      .post(`/api/v1/quotes/${q.body.id}/respond`)
      .set(auth())
      .send({ revision: 1, status: 'ACCEPTED' })
      .expect(409);
    await request(server)
      .post(`/api/v1/quotes/${q.body.id}/respond`)
      .set(auth('other'))
      .send({ revision: 2, status: 'ACCEPTED' })
      .expect(404);
    await request(server)
      .post(`/api/v1/quotes/${q.body.id}/respond`)
      .set(auth())
      .send({ revision: 2, status: 'ACCEPTED' })
      .expect(201);
    await request(server)
      .post(`/api/v1/admin/quotes/${q.body.id}/offer`)
      .set(auth('admin'))
      .send({ ...offer, expectedRevision: 2 })
      .expect(409);
    expect(await db.quoteRevision.count()).toBe(2);
  });
  it('rejects stale product edits and negative stock at the database boundary', async () => {
    const { id: _id, ...data } = product;
    await request(server)
      .patch('/api/v1/admin/products/cement')
      .set(auth('admin'))
      .send({ ...data, expectedVersion: 2 })
      .expect(409);
    await expect(
      db.product.update({ where: { id: 'cement' }, data: { stock: -1 } }),
    ).rejects.toThrow();
  });
  it('expires quotes and allows only staff to record acceptance of a current quote', async () => {
    const q = await request(server)
      .post('/api/v1/quotes')
      .set(auth())
      .send({
        items: [{ productId: 'cement', quantity: 100 }],
        addressId: 'customer-address',
        deliveryDate: date,
      });
    await request(server)
      .post(`/api/v1/admin/quotes/${q.body.id}/offer`)
      .set(auth('admin'))
      .send({
        expectedRevision: 0,
        items: [{ productId: 'cement', unitPricePaise: 40000 }],
        deliveryFeePaise: 0,
        validUntil: new Date(Date.now() + 86400000).toISOString(),
      })
      .expect(201);
    await request(server)
      .post(`/api/v1/admin/quotes/${q.body.id}/respond`)
      .set(auth())
      .send({ revision: 1, status: 'ACCEPTED' })
      .expect(403);
    await db.quote.update({ where: { id: q.body.id }, data: { validUntil: new Date(0) } });
    await request(server)
      .post(`/api/v1/quotes/${q.body.id}/respond`)
      .set(auth())
      .send({ revision: 1, status: 'ACCEPTED' })
      .expect(409);
    await db.quote.update({
      where: { id: q.body.id },
      data: { validUntil: new Date(Date.now() + 86400000) },
    });
    await request(server)
      .post(`/api/v1/admin/quotes/${q.body.id}/respond`)
      .set(auth('admin'))
      .send({ revision: 1, status: 'ACCEPTED' })
      .expect(201);
    expect(
      (await db.auditLog.findFirstOrThrow({ where: { event: 'QUOTE_ACCEPTED' } })).actorId,
    ).toBe('admin');
  });
});
