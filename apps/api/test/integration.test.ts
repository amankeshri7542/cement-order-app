import { afterEach } from 'vitest';
import 'reflect-metadata';
import { beforeAll, beforeEach, afterAll, describe, expect, it, vi } from 'vitest';
import { loadEnvFile } from 'node:process';
import { createHmac, randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import request from 'supertest';
import type { INestApplication } from '@nestjs/common';
import type { Server } from 'node:http';
import { Db } from '../src/db';
import { hash } from '../src/http';
import { PaymentsService } from '../src/payments';
import { hashPassword } from '../src/security';
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
    'TRUNCATE TABLE "ProductAsset", "PriceUpdateBatch", "RateSource", "User", "Category", "Product", "Order", "Quote", "AuditLog", "OtpChallenge", "AuthRateLimit", "DeliveryZone", "StoreSettings" RESTART IDENTITY CASCADE',
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
  await db.inventoryMovement.create({
    data: {
      productId: 'cement',
      kind: 'PURCHASE_IN',
      quantity: 100,
      balanceAfter: 100,
      actorId: 'fixture',
      reference: 'Fixture',
      note: 'Opening test stock',
      idempotencyKey: 'opening:cement',
    },
  });
  await db.deliveryZone.create({
    data: {
      id: 'test-zone',
      name: 'Patna test',
      deliveryFeePaise: 50000,
      minimumOrderPaise: 0,
      estimate: 'Test delivery',
      pincodes: { create: [{ pincode: '800020' }, { pincode: '800001' }] },
    },
  });
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
    // Both wholesale requests were reviewed by the owner; inventory must still arbitrate the last stock.
    for (const phone of ['+919999999991', '+919999999992'])
      await request(server)
        .post('/api/v1/admin/demand-overrides')
        .set(auth('admin'))
        .send({
          phone,
          kind: 'ORDER',
          maxTotalPaise: 10000000,
          reason: 'Reviewed last-stock wholesale demand',
        })
        .expect(201);

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
      .expect(201);
    const revised = await db.quote.findUniqueOrThrow({ where: { id: q.body.id } });
    expect(revised.status).toBe('SENT');
    expect(revised.decisionAt).toBeNull();
    expect(revised.decisionSource).toBeNull();
    expect(await db.quoteRevision.count()).toBe(3);
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
      .send({ revision: 1, status: 'ACCEPTED', note: 'Customer confirmed by phone' })
      .expect(201);
    expect(
      (await db.auditLog.findFirstOrThrow({ where: { event: 'QUOTE_ACCEPTED' } })).actorId,
    ).toBe('admin');
  });
});

afterEach(() => vi.restoreAllMocks());
describe('Pilot operations and privacy', () => {
  it('pages tied catalogue values without duplicates and rejects mismatched cursors', async () => {
    await db.product.createMany({
      data: Array.from({ length: 55 }, (_, i) => ({
        ...product,
        id: `material-${String(i).padStart(3, '0')}`,
        name: 'Same material',
        brand: i % 2 ? 'A' : 'B',
        pricePaise: 50000,
        stock: i % 3 ? 10 : 0,
      })),
    });
    const ids: string[] = [];
    let cursor: string | null = null;
    do {
      const r: { body: { items: { id: string }[]; nextCursor: string | null } } = await request(
        server,
      )
        .get('/api/v1/products')
        .query({ limit: 7, sort: 'price_desc', ...(cursor ? { cursor } : {}) })
        .expect(200);
      expect(r.body.items.length).toBeLessThanOrEqual(7);
      ids.push(...r.body.items.map((p: { id: string }) => p.id));
      cursor = r.body.nextCursor;
    } while (cursor);
    expect(ids.length).toBe(56);
    expect(new Set(ids).size).toBe(56);
    const a = await request(server)
      .get('/api/v1/products?limit=3&brand=A&availability=in')
      .expect(200);
    expect(
      a.body.items.every((p: { brand: string; stock: number }) => p.brand === 'A' && p.stock > 0),
    ).toBe(true);
    await request(server)
      .get('/api/v1/products')
      .query({ cursor: a.body.nextCursor, brand: 'B', availability: 'in' })
      .expect(400);
    await request(server).get('/api/v1/products?cursor=garbage').expect(400);
    await request(server).get('/api/v1/products?limit=5000').expect(400);
  });
  it('writes idempotent inventory movements and prevents concurrent negative balances', async () => {
    const move = {
      kind: 'WALK_IN_SALE',
      quantity: 70,
      note: 'Counter receipt',
      reference: 'R-1',
      idempotencyKey: randomUUID(),
    };
    const results = await Promise.all([
      request(server).post('/api/v1/admin/products/cement/movements').set(auth('admin')).send(move),
      request(server).post('/api/v1/admin/products/cement/movements').set(auth('admin')).send(move),
    ]);
    expect(results.map((r) => r.status)).toEqual([201, 201]);
    expect(results[0]!.body.id).toBe(results[1]!.body.id);
    const sales = await Promise.all(
      [1, 2].map((i) =>
        request(server)
          .post('/api/v1/admin/products/cement/movements')
          .set(auth('admin'))
          .send({ ...move, quantity: 20, reference: `R-${i + 1}`, idempotencyKey: randomUUID() }),
      ),
    );
    expect(sales.map((r) => r.status).sort()).toEqual([201, 409]);
    const balance = await db.product.findUniqueOrThrow({ where: { id: 'cement' } });
    expect(balance.stock).toBe(10);
    expect(
      (
        await db.inventoryMovement.aggregate({
          where: { productId: 'cement' },
          _sum: { quantity: true },
        })
      )._sum.quantity,
    ).toBe(balance.stock);
    await request(server)
      .post('/api/v1/admin/products/cement/movements')
      .set(auth('admin'))
      .send({ ...move, quantity: 1 })
      .expect(409);
    await request(server)
      .post('/api/v1/admin/products/cement/movements')
      .set(auth())
      .send({ ...move, idempotencyKey: randomUUID() })
      .expect(403);
    await expect(
      db.inventoryMovement.update({
        where: { id: results[0]!.body.id },
        data: { note: 'Changed' },
      }),
    ).rejects.toThrow();
  });
  it('requires stock ledger entry and enforces material quantity increments', async () => {
    await request(server)
      .patch('/api/v1/admin/products/cement')
      .set(auth('admin'))
      .send({ ...product, expectedVersion: 1, stock: 200, id: undefined })
      .expect(409);
    await db.product.update({
      where: { id: 'cement' },
      data: { minQuantity: 10, quantityStep: 5 },
    });
    await request(server)
      .put('/api/v1/cart/items')
      .set(auth())
      .send({ productId: 'cement', quantity: 11 })
      .expect(400);
    await cart('customer', 10);
    const r = await review();
    await db.product.update({ where: { id: 'cement' }, data: { minQuantity: 20 } });
    await place(r.body.id).then((r) => expect(r.status).toBe(400));
  });
  it('records online reservation and cancellation once in stock ledger', async () => {
    const o = await order();
    await request(server).post(`/api/v1/orders/${o.id}/cancel`).set(auth()).expect(201);
    await request(server).post(`/api/v1/orders/${o.id}/cancel`).set(auth()).expect(409);
    expect(await db.inventoryMovement.count({ where: { kind: 'ONLINE_ORDER' } })).toBe(1);
    expect(await db.inventoryMovement.count({ where: { kind: 'ORDER_CANCELLED' } })).toBe(1);
    expect((await db.inventoryMovement.aggregate({ _sum: { quantity: true } }))._sum.quantity).toBe(
      100,
    );
  });
  it('validates pincode, minimum and delivery version before reserving stock', async () => {
    await request(server)
      .get('/api/v1/delivery/999999')
      .expect(200)
      .then((r) => expect(r.body.serviceable).toBe(false));
    await cart();
    await db.deliveryZone.update({
      where: { id: 'test-zone' },
      data: { minimumOrderPaise: 500000 },
    });
    await request(server)
      .post('/api/v1/checkout/review')
      .set(auth())
      .send({ addressId: 'customer-address', deliveryDate: date, paymentMethod: 'COD' })
      .expect(409)
      .then((r) => expect(r.body.error.code).toBe('DELIVERY_MINIMUM'));
    await db.deliveryZone.update({ where: { id: 'test-zone' }, data: { minimumOrderPaise: 0 } });
    const r = await review();
    await request(server)
      .patch('/api/v1/admin/delivery-zones/test-zone')
      .set(auth('admin'))
      .send({
        name: 'Updated',
        active: true,
        deliveryFeePaise: 90000,
        minimumOrderPaise: 0,
        freeDeliveryAbovePaise: null,
        estimate: 'Tomorrow',
        pincodes: ['800020'],
        expectedVersion: 1,
      })
      .expect(200);
    expect((await place(r.body.id)).body.error.code).toBe('PRICE_CHANGED');
    expect((await db.product.findUniqueOrThrow({ where: { id: 'cement' } })).stock).toBe(100);
    await db.deliveryZone.update({ where: { id: 'test-zone' }, data: { active: false } });
    await request(server)
      .post('/api/v1/checkout/review')
      .set(auth())
      .send({ addressId: 'customer-address', deliveryDate: date, paymentMethod: 'COD' })
      .expect(409);
  });
  it('rejects overlapping pincodes without partially changing a zone', async () => {
    const zone = {
      name: 'Overlap',
      active: true,
      deliveryFeePaise: 0,
      minimumOrderPaise: 0,
      freeDeliveryAbovePaise: null,
      estimate: 'Tomorrow',
      pincodes: ['800020'],
    };
    await request(server)
      .post('/api/v1/admin/delivery-zones')
      .set(auth('admin'))
      .send(zone)
      .expect(409);
    expect(await db.deliveryZone.count()).toBe(1);
  });
  it('requires configured staff passphrase and invalidates sessions after credential change', async () => {
    const password = 'correct-staff-passphrase';
    await db.adminCredential.create({
      data: { userId: 'admin', passwordHash: await hashPassword(password) },
    });
    await request(server).get('/api/v1/admin/dashboard').set(auth('admin')).expect(401);
    const r = await request(server)
      .post('/api/v1/auth/otp/request')
      .send({ phone: '+919999999993' })
      .expect(201);
    await request(server)
      .post('/api/v1/auth/otp/verify')
      .send({
        phone: '+919999999993',
        code: r.body.devCode,
        adminPassword: 'wrong-staff-passphrase',
      })
      .expect(401);
    const logged = await request(server)
      .post('/api/v1/auth/otp/verify')
      .send({ phone: '+919999999993', code: r.body.devCode, adminPassword: password })
      .expect(201);
    expect(JSON.stringify(logged.body)).not.toContain('scrypt-v1');
    const header = { Authorization: `Bearer ${logged.body.accessToken}` };
    await request(server).get('/api/v1/admin/dashboard').set(header).expect(200);
    await db.adminCredential.update({
      where: { userId: 'admin' },
      data: { passwordHash: await hashPassword('new-correct-staff-passphrase') },
    });
    await request(server).get('/api/v1/admin/dashboard').set(header).expect(401);
  });
  it('limits OTP requests across phone numbers with persistent hashed IP counters', async () => {
    for (let i = 0; i < 10; i++)
      await request(server)
        .post('/api/v1/auth/otp/request')
        .send({ phone: `+9188888888${String(i).padStart(2, '0')}` })
        .expect(201);
    await request(server)
      .post('/api/v1/auth/otp/request')
      .send({ phone: '+918888888899' })
      .expect(429);
    const buckets = await db.authRateLimit.findMany();
    expect(buckets.filter((b) => b.key.startsWith('send:')).length).toBe(2);
    expect(buckets.filter((b) => b.key.startsWith('budget:otp:send:global:')).length).toBe(1);
    expect(JSON.stringify(buckets)).not.toContain('127.0.0.1');
  });
  it('lists safe session metadata and restricts session revocation to its owner', async () => {
    const sessions = await request(server).get('/api/v1/auth/sessions').set(auth()).expect(200);
    expect(sessions.body[0].current).toBe(true);
    expect(JSON.stringify(sessions.body)).not.toContain('Hash');
    const other = await db.session.findFirstOrThrow({ where: { userId: 'other' } });
    await request(server).delete(`/api/v1/auth/sessions/${other.id}`).set(auth()).expect(404);
    await request(server)
      .delete(`/api/v1/auth/sessions/${sessions.body[0].id}`)
      .set(auth())
      .expect(200);
    await request(server).get('/api/v1/orders').set(auth()).expect(401);
  });
  it('requires audited contractor verification rather than self-promotion', async () => {
    const r = await request(server)
      .patch('/api/v1/me')
      .set(auth())
      .send({ name: 'Builder', language: 'en', contractor: true })
      .expect(200);
    expect(r.body.role).toBe('CUSTOMER');
    expect(r.body.contractorStatus).toBe('PENDING');
    await request(server)
      .patch('/api/v1/admin/customers/customer/contractor')
      .set(auth())
      .send({ status: 'VERIFIED', note: 'Self claim' })
      .expect(403);
    await request(server)
      .patch('/api/v1/admin/customers/customer/contractor')
      .set(auth('admin'))
      .send({ status: 'VERIFIED', note: 'Store owner checked business details in person' })
      .expect(200);
    expect((await db.user.findUniqueOrThrow({ where: { id: 'customer' } })).role).toBe(
      'CONTRACTOR',
    );
    expect(await db.auditLog.count({ where: { event: 'CONTRACTOR_REVIEWED' } })).toBe(1);
  });
  it('deletes personal account data and revokes access while retaining de-identified financial records', async () => {
    const o = await order();
    await request(server)
      .post('/api/v1/me/delete')
      .set(auth())
      .send({ confirmation: 'DELETE' })
      .expect(409);
    await request(server).post(`/api/v1/orders/${o.id}/cancel`).set(auth()).expect(201);
    await db.orderStatusHistory.create({
      data: {
        orderId: o.id,
        status: 'CANCELLED',
        actorId: 'admin',
        note: address.phone + ' ' + address.line1,
      },
    });
    await db.auditLog.create({
      data: {
        actorId: 'admin',
        event: 'STAFF_NOTE',
        entityId: o.id,
        details: { note: address.phone },
      },
    });
    await request(server)
      .post('/api/v1/me/delete')
      .set(auth())
      .send({ confirmation: 'wrong' })
      .expect(400);
    await request(server)
      .post('/api/v1/me/delete')
      .set(auth())
      .send({ confirmation: 'DELETE' })
      .expect(201);
    await request(server).get('/api/v1/orders').set(auth()).expect(401);
    expect(
      JSON.stringify(await db.orderStatusHistory.findMany({ where: { orderId: o.id } })),
    ).not.toContain(address.phone);
    expect(JSON.stringify(await db.auditLog.findMany({ where: { entityId: o.id } }))).not.toContain(
      address.phone,
    );
    expect(await db.address.count({ where: { userId: 'customer' } })).toBe(0);
    expect(await db.session.count({ where: { userId: 'customer' } })).toBe(0);
    const retained = await db.order.findUniqueOrThrow({ where: { id: o.id } });
    expect(retained.totalPaise).toBe(o.totalPaise);
    expect(JSON.stringify(retained)).not.toContain(address.phone);
    expect(JSON.stringify(retained)).not.toContain(address.line1);
    expect(
      (await db.user.findUniqueOrThrow({ where: { id: 'customer' } })).deletedAt,
    ).not.toBeNull();
    await request(server)
      .post('/api/v1/me/delete')
      .set(auth('admin'))
      .send({ confirmation: 'DELETE' })
      .expect(403);
  });
  it('never creates a second gateway order after an uncertain initialization', async () => {
    const o = await order('ONLINE');
    const gateway = vi
      .spyOn(app.get(PaymentsService), 'gateway')
      .mockRejectedValue(new Error('Network result unknown'));
    await request(server).post(`/api/v1/payments/orders/${o.id}`).set(auth()).expect(500);
    await request(server).post(`/api/v1/payments/orders/${o.id}`).set(auth()).expect(409);
    expect(gateway).toHaveBeenCalledTimes(1);
  });
  it('allows only one provider association during concurrent payment recovery', async () => {
    const o = await order('ONLINE');
    vi.spyOn(app.get(PaymentsService), 'gateway').mockImplementation(async (path: string) =>
      path.endsWith('/payments')
        ? { items: [] }
        : { id: path.split('/')[1], receipt: o.id, amount: o.totalPaise, currency: 'INR' },
    );
    const results = await Promise.all(
      ['order_first123', 'order_second123'].map((razorpayOrderId) =>
        request(server)
          .post(`/api/v1/admin/orders/${o.id}/reconcile-payment`)
          .set(auth('admin'))
          .send({ razorpayOrderId }),
      ),
    );
    expect(results.map((r) => r.status).sort()).toEqual([201, 400]);
    expect(await db.auditLog.count({ where: { event: 'PAYMENT_RECONCILED' } })).toBe(1);
  });
});

describe('Quote decision provenance', () => {
  it('clears old decision metadata on revised offers and requires staff evidence', async () => {
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
      deliveryFeePaise: 0,
      validUntil: new Date(Date.now() + 86400000).toISOString(),
    };
    await request(server)
      .post(`/api/v1/admin/quotes/${q.body.id}/offer`)
      .set(auth('admin'))
      .send(offer)
      .expect(201);
    const rejected = await request(server)
      .post(`/api/v1/quotes/${q.body.id}/respond`)
      .set(auth())
      .send({ revision: 1, status: 'REJECTED' })
      .expect(201);
    expect(rejected.body.decisionSource).toBe('CUSTOMER');
    const revised = await request(server)
      .post(`/api/v1/admin/quotes/${q.body.id}/offer`)
      .set(auth('admin'))
      .send({ ...offer, expectedRevision: 1 })
      .expect(201);
    expect(revised.body.decisionSource).toBeNull();
    expect(revised.body.decisionAt).toBeNull();
    await request(server)
      .post(`/api/v1/admin/quotes/${q.body.id}/respond`)
      .set(auth('admin'))
      .send({ revision: 2, status: 'ACCEPTED' })
      .expect(400);
    const accepted = await request(server)
      .post(`/api/v1/admin/quotes/${q.body.id}/respond`)
      .set(auth('admin'))
      .send({ revision: 2, status: 'ACCEPTED', note: 'Customer confirmed by phone' })
      .expect(201);
    expect(accepted.body.decisionSource).toBe('STORE_RECORDED');
    expect(accepted.body.decisionActorId).toBe('admin');
  });
});

// Rate Studio uses the real database; paid extraction providers are mocked.
const rateBase = '/api/v1/admin/rate-studio';
async function newRate(sourceType = 'MANUAL', idempotencyKey = randomUUID()) {
  return (
    await request(server)
      .post(`${rateBase}/batches`)
      .set(auth('admin'))
      .send({ title: 'Supplier price sheet', sourceType, idempotencyKey })
      .expect(201)
  ).body;
}
function rateRow(productId = 'cement', price = 43000) {
  return {
    productId,
    label: 'Test cement',
    brand: 'Test',
    specification: 'PPC',
    unit: '50 kg bag',
    weight: '',
    proposedPricePaise: price,
    included: true,
    reviewed: true,
    acknowledged: true,
    note: 'Confirmed at counter',
    rememberAlias: false,
    refreshBaseline: false,
    expectedProductVersion: 1,
  };
}
async function saveRate(batch: { id: string; version: number; title: string }, items: unknown[]) {
  return (
    await request(server)
      .patch(`${rateBase}/batches/${batch.id}`)
      .set(auth('admin'))
      .send({ expectedVersion: batch.version, title: batch.title, items })
      .expect(200)
  ).body;
}
function publishRate(batch: { id: string; version: number }) {
  return request(server)
    .post(`${rateBase}/batches/${batch.id}/publish`)
    .set(auth('admin'))
    .send({ expectedVersion: batch.version, confirmation: 'PUBLISH' });
}
async function uploadRate(batch: { id: string; version: number }) {
  const sharp = (await import('sharp')).default;
  const bytes = await sharp({ create: { width: 1, height: 1, channels: 3, background: '#ddab30' } })
    .png()
    .toBuffer();
  const result = await request(server)
    .post(`${rateBase}/batches/${batch.id}/source`)
    .set(auth('admin'))
    .set('Content-Type', 'image/png')
    .set('X-Batch-Version', String(batch.version))
    .set('X-File-Name', 'supplier.png')
    .send(bytes)
    .expect(201);
  return { batch: result.body, bytes };
}
async function finishRate(id: string) {
  await vi.waitFor(
    async () =>
      expect((await db.priceUpdateBatch.findUniqueOrThrow({ where: { id } })).status).not.toBe(
        'PROCESSING',
      ),
    { timeout: 5000, interval: 20 },
  );
  return (await request(server).get(`${rateBase}/batches/${id}`).set(auth('admin')).expect(200))
    .body;
}
const extractedRate = {
  brand: 'Test',
  product: 'Test cement',
  category: 'Cement',
  size: null,
  specification: 'PPC',
  price: '430',
  unit: '50 kg bag',
  weight: null,
  effectiveDate: null,
  deliveryNotes: null,
  confidence: 0.5,
  sourceText: 'Test cement PPC 430',
  sourceReference: 'row 1',
};
describe('Rate Studio financial and extraction operations', () => {
  it('denies customer access to every source, draft, publication and card operation', async () => {
    const paths = [
      'providers',
      'batches',
      'batches/missing',
      'batches/missing/source',
      'cards/missing',
      'cards/missing/pages/1/png',
    ];
    for (const path of paths)
      await request(server).get(`${rateBase}/${path}`).set(auth()).expect(403);
    for (const path of [
      'batches',
      'batches/missing/source',
      'batches/missing/extract',
      'batches/missing/adjust',
      'batches/missing/publish',
      'batches/missing/cancel',
      'batches/missing/cards',
    ])
      await request(server).post(`${rateBase}/${path}`).set(auth()).send({}).expect(403);
    await request(server).patch(`${rateBase}/batches/missing`).set(auth()).send({}).expect(403);
  });
  it('creates one draft when creation is retried concurrently', async () => {
    const key = randomUUID();
    const [a, b] = await Promise.all([newRate('MANUAL', key), newRate('MANUAL', key)]);
    expect(a.id).toBe(b.id);
    expect(await db.priceUpdateBatch.count()).toBe(1);
  });
  it('publishes multiple products atomically with one history per actual change and one post-commit SSE', async () => {
    const { Events } = await import('../src/catalog');
    const event = vi.spyOn(app.get(Events), 'publish');
    await db.product.create({
      data: { ...product, id: 'second', name: 'Second material', pricePaise: 60000 },
    });
    const b = await saveRate(await newRate(), [rateRow(), rateRow('second', 62000)]);
    const reads: Promise<unknown>[] = [];
    event.mockImplementation(() => {
      reads.push(
        db.priceUpdateBatch
          .findUniqueOrThrow({ where: { id: b.id } })
          .then((v) => expect(v.status).toBe('PUBLISHED')),
      );
    });
    const responses = await Promise.all([publishRate(b), publishRate(b)]);
    expect(responses.map((r) => r.status)).toEqual([201, 201]);
    expect(await db.productPriceHistory.count({ where: { batchId: b.id } })).toBe(2);
    expect((await db.product.findUniqueOrThrow({ where: { id: 'cement' } })).priceVersion).toBe(2);
    expect((await db.product.findUniqueOrThrow({ where: { id: 'second' } })).pricePaise).toBe(
      62000,
    );
    expect(event).toHaveBeenCalledTimes(1);
    await Promise.all(reads);
    expect(
      responses[0]!.body.items
        .flatMap((row: { issues: { code: string }[] }) => row.issues)
        .some((issue: { code: string }) => issue.code === 'PRODUCT_CHANGED'),
    ).toBe(false);
    await db.product.update({
      where: { id: 'cement' },
      data: { active: false, name: 'Renamed later', version: { increment: 1 } },
    });
    const historical = (
      await request(server).get(`${rateBase}/batches/${b.id}`).set(auth('admin')).expect(200)
    ).body;
    expect(historical.items[0].product.name).toBe(product.name);
    expect(historical.items[0].issues.some((issue: { blocking: boolean }) => issue.blocking)).toBe(
      false,
    );

    await request(server)
      .patch(`${rateBase}/batches/${b.id}`)
      .set(auth('admin'))
      .send({ expectedVersion: responses[0]!.body.version, title: b.title, items: [] })
      .expect(409);
    await expect(
      db.priceUpdateBatchItem.updateMany({
        where: { batchId: b.id },
        data: { note: 'rewrite evidence' },
      }),
    ).rejects.toThrow();
    await expect(
      db.priceUpdateBatch.update({ where: { id: b.id }, data: { title: 'rewrite' } }),
    ).rejects.toThrow();
  });
  it('rejects stale product versions without changing any other product or history', async () => {
    const { Events } = await import('../src/catalog');
    const event = vi.spyOn(app.get(Events), 'publish');
    await db.product.create({ data: { ...product, id: 'second', name: 'Second material' } });
    const b = await saveRate(await newRate(), [rateRow(), rateRow('second', 44000)]);
    await db.product.update({
      where: { id: 'second' },
      data: { pricePaise: 50000, version: { increment: 1 } },
    });
    await publishRate(b).expect(409);
    expect((await db.product.findUniqueOrThrow({ where: { id: 'cement' } })).pricePaise).toBe(
      41000,
    );
    expect(await db.productPriceHistory.count()).toBe(0);
    expect(event).not.toHaveBeenCalled();
    expect((await db.priceUpdateBatch.findUniqueOrThrow({ where: { id: b.id } })).status).not.toBe(
      'PUBLISHED',
    );
  });
  it('rejects a product changed after selection and before a new row is saved', async () => {
    const b = await newRate();
    await db.product.update({
      where: { id: 'cement' },
      data: { version: { increment: 1 }, pricePaise: 45000 },
    });
    await request(server)
      .patch(`${rateBase}/batches/${b.id}`)
      .set(auth('admin'))
      .send({ expectedVersion: b.version, title: b.title, items: [rateRow()] })
      .expect(409);
    expect(await db.priceUpdateBatchItem.count()).toBe(0);
  });
  it('rejects concurrent draft editors and preserves the winning review', async () => {
    const b = await newRate();
    const responses = await Promise.all(
      [43000, 45000].map((price) =>
        request(server)
          .patch(`${rateBase}/batches/${b.id}`)
          .set(auth('admin'))
          .send({ expectedVersion: b.version, title: b.title, items: [rateRow('cement', price)] }),
      ),
    );
    expect(responses.map((r) => r.status).sort()).toEqual([200, 409]);
    expect(await db.priceUpdateBatchItem.count()).toBe(1);
  });
  it('shows duplicate and abnormal-change warnings and requires human acknowledgement', async () => {
    let b = await saveRate(await newRate(), [rateRow(), rateRow()]);
    expect(b.issues.some((i: { code: string }) => i.code === 'DUPLICATE')).toBe(true);
    await publishRate(b).expect(409);
    b = await saveRate(b, [{ ...rateRow('cement', 410000), acknowledged: false }]);
    expect(b.issues.some((i: { code: string }) => i.code === 'LARGE_CHANGE')).toBe(true);
    await publishRate(b).expect(409);
  });
  it('creates adjustment previews with integer rounding and no live change', async () => {
    const b = await newRate('ADJUSTMENT');
    const r = await request(server)
      .post(`${rateBase}/batches/${b.id}/adjust`)
      .set(auth('admin'))
      .send({
        expectedVersion: b.version,
        productIds: ['cement'],
        kind: 'PERCENT',
        direction: 'INCREASE',
        amount: 250,
      })
      .expect(201);
    expect(r.body.items[0].proposedPricePaise).toBe(42025);
    expect(r.body.status).toBe('REVIEW_REQUIRED');
    expect((await db.product.findUniqueOrThrow({ where: { id: 'cement' } })).pricePaise).toBe(
      41000,
    );
    await publishRate(r.body).expect(409);
  });
  it('records unchanged sheets without fabricating monetary history', async () => {
    const b = await saveRate(await newRate(), [rateRow('cement', 41000)]);
    await publishRate(b).expect(201);
    expect(await db.productPriceHistory.count()).toBe(0);
    expect((await db.product.findUniqueOrThrow({ where: { id: 'cement' } })).priceVersion).toBe(1);
  });
  it('invalidates checkout for pack changes without equal-price monetary history', async () => {
    const { productSchema } = await import('@shiv/shared');
    const p = await db.product.findUniqueOrThrow({ where: { id: 'cement' } });
    const data = Object.fromEntries(
      Object.keys(productSchema.shape).map((k) => [k, p[k as keyof typeof p]]),
    );
    await request(server)
      .patch('/api/v1/admin/products/cement')
      .set(auth('admin'))
      .send({ ...data, packSize: 'Revised pack description', expectedVersion: p.version })
      .expect(200);
    expect(await db.productPriceHistory.count()).toBe(0);
    expect((await db.product.findUniqueOrThrow({ where: { id: 'cement' } })).priceVersion).toBe(2);
    expect(await db.auditLog.count({ where: { event: 'PRODUCT_TERMS_CHANGED' } })).toBe(1);
  });
  it('preserves checkout re-review after a batch publishes', async () => {
    await cart();
    const r = await review();
    const b = await saveRate(await newRate(), [rateRow()]);
    await publishRate(b).expect(201);
    const placed = await place(r.body.id);
    expect(placed.status).toBe(409);
    expect(placed.body.error.code).toBe('PRICE_CHANGED');
  });
  it('creates remembered aliases only after publication and rejects conflicting alias mappings atomically', async () => {
    const { normalizeAlias } = await import('../src/rate-studio/rules');
    const b = await saveRate(await newRate(), [
      { ...rateRow(), label: 'Counter PPC', rememberAlias: true },
    ]);
    expect(await db.productAlias.count()).toBe(0);
    await publishRate(b).expect(201);
    expect((await db.productAlias.findFirstOrThrow()).normalizedAlias).toBe(
      normalizeAlias('Test Counter PPC PPC'),
    );
    await db.product.create({ data: { ...product, id: 'second', name: 'Second material' } });
    const next = await saveRate(await newRate(), [
      { ...rateRow('second'), label: 'Counter PPC', rememberAlias: true },
    ]);
    await publishRate(next).expect(409);
    expect((await db.product.findUniqueOrThrow({ where: { id: 'second' } })).pricePaise).toBe(
      41000,
    );
  });
  it('validates private source bytes, retains digest evidence and blocks replacement', async () => {
    const initial = await newRate('IMAGE');
    await request(server)
      .post(`${rateBase}/batches/${initial.id}/source`)
      .set(auth('admin'))
      .set('Content-Type', 'image/png')
      .set('X-Batch-Version', '1')
      .send(Buffer.from('<script>bad</script>'))
      .expect(400);
    const { batch: b, bytes } = await uploadRate(initial);
    expect(b.source.sha256).toHaveLength(64);
    expect(b.source.storageKey).toBeUndefined();
    const image = await request(server)
      .get(`${rateBase}/batches/${b.id}/source`)
      .set(auth('admin'))
      .expect(200);
    expect(image.body).toEqual(bytes);
    expect(image.headers['cross-origin-resource-policy']).toBe('same-site');
    await request(server)
      .post(`${rateBase}/batches/${b.id}/source`)
      .set(auth('admin'))
      .set('Content-Type', 'image/png')
      .set('X-Batch-Version', String(b.version))
      .send(bytes)
      .expect(409);
  });
  it('retains OCR after interpretation fails and retries only interpretation', async () => {
    const { RateProviders, RateProviderError } = await import('../src/rate-studio/providers');
    const p = app.get(RateProviders);
    const ocr = vi
      .spyOn(p, 'ocr')
      .mockResolvedValue({ text: extractedRate.sourceText, layout: [], usage: { images: 1 } });
    const interpret = vi
      .spyOn(p, 'interpret')
      .mockRejectedValueOnce(new RateProviderError('INTERPRETATION_UNAVAILABLE'))
      .mockResolvedValue({ extraction: { rows: [extractedRate] }, usage: { model: 'mock' } });
    const { batch: b } = await uploadRate(await newRate('IMAGE'));
    await request(server)
      .post(`${rateBase}/batches/${b.id}/extract`)
      .set(auth('admin'))
      .send({ expectedVersion: b.version })
      .expect(201);
    const failed = await finishRate(b.id);
    expect(failed.source.ocrText).toBe(extractedRate.sourceText);
    expect(failed.errorCode).toBe('INTERPRETATION_UNAVAILABLE');
    await request(server)
      .post(`${rateBase}/batches/${b.id}/extract`)
      .set(auth('admin'))
      .send({ expectedVersion: failed.version })
      .expect(201);
    const done = await finishRate(b.id);
    expect(done.items).toHaveLength(1);
    expect(done.items[0].productId).toBe('cement');
    expect(done.items[0].reviewed).toBe(false);
    expect(done.items[0].issues.some((i: { code: string }) => i.code === 'LOW_CONFIDENCE')).toBe(
      true,
    );
    expect(ocr).toHaveBeenCalledTimes(1);
    expect(interpret).toHaveBeenCalledTimes(2);
    expect(await db.productPriceHistory.count()).toBe(0);
  });
  it('recovers interrupted leases and allows manual entry with the uploaded source intact', async () => {
    const { batch: b } = await uploadRate(await newRate('IMAGE'));
    await db.priceUpdateBatch.update({
      where: { id: b.id },
      data: {
        status: 'PROCESSING',
        stage: 'INTERPRETING',
        attemptToken: randomUUID(),
        leaseUntil: new Date(Date.now() - 1),
      },
    });
    const recovered = (
      await request(server).get(`${rateBase}/batches/${b.id}`).set(auth('admin')).expect(200)
    ).body;
    expect(recovered.errorCode).toBe('PROCESS_INTERRUPTED');
    const manual = await saveRate(recovered, [rateRow()]);
    expect(manual.source.id).toBe(b.source.id);
    await publishRate(manual).expect(201);
  });
  it('does not let an expired OCR attempt overwrite evidence or call interpretation', async () => {
    const { RateProviders } = await import('../src/rate-studio/providers');
    const { RateStudioService } = await import('../src/rate-studio/studio');
    const p = app.get(RateProviders);
    let resolveOcr!: (value: {
      text: string;
      layout: unknown[];
      usage: Record<string, number>;
    }) => void;
    const ocr = vi.spyOn(p, 'ocr').mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveOcr = resolve;
        }),
    );
    const interpret = vi.spyOn(p, 'interpret');
    const { batch: b } = await uploadRate(await newRate('IMAGE'));
    const token = randomUUID();
    await db.priceUpdateBatch.update({
      where: { id: b.id },
      data: { status: 'PROCESSING', attemptToken: token, leaseUntil: new Date(Date.now() + 60000) },
    });
    const pending = app.get(RateStudioService).process(b.id, token);
    await vi.waitFor(() => expect(ocr).toHaveBeenCalled());
    await db.priceUpdateBatch.update({
      where: { id: b.id },
      data: { leaseUntil: new Date(Date.now() - 1) },
    });
    await app.get(RateStudioService).get(b.id);
    resolveOcr({ text: 'stale result', layout: [], usage: { images: 1 } });
    await pending;
    expect(
      (await db.rateSource.findUniqueOrThrow({ where: { id: b.source.id } })).ocrText,
    ).toBeNull();
    expect(interpret).not.toHaveBeenCalled();
  });
  it('uses a confirmed alias before normalized product matching', async () => {
    const { matchRate, normalizeAlias, extractionAlias } = await import('../src/rate-studio/rules');
    const row = { ...extractedRate, product: 'Vendor shorthand' };
    await db.productAlias.create({
      data: {
        productId: 'cement',
        alias: extractionAlias(row),
        normalizedAlias: normalizeAlias(extractionAlias(row)),
        source: 'test',
        confirmedBy: 'admin',
      },
    });
    const match = await db.atomic((tx) => matchRate(tx, row));
    expect(match.product?.id).toBe('cement');
    expect(match.method).toBe('CONFIRMED_ALIAS');
  });
  it('keeps published prices intact when rendering fails and creates exact immutable card values', async () => {
    const b = await saveRate(await newRate(), [rateRow('cement', 43025)]);
    await publishRate(b).expect(201);
    const input = {
      format: 'SQUARE',
      template: 'COUNTER',
      heading: 'Current material rates',
      deliveryMessage: 'Confirm delivery with the store.',
      contactLabel: 'Call / WhatsApp',
      promotionalCopy: '',
      confirmed: true,
    };
    const card = (
      await request(server)
        .post(`${rateBase}/batches/${b.id}/cards`)
        .set(auth('admin'))
        .send(input)
        .expect(201)
    ).body;
    expect(card.snapshot.items[0].pricePaise).toBe(43025);
    expect(card.snapshot.items[0].unit).toBe('50 kg bag');
    const svg = await request(server)
      .get(`${rateBase}/cards/${card.id}/pages/1/svg`)
      .set(auth('admin'))
      .expect(200);
    expect(svg.text || svg.body.toString()).toContain('430.25');
    const renderer = await import('../src/rate-studio/cards');
    vi.spyOn(renderer, 'rateCardPng').mockRejectedValue(new Error('renderer unavailable'));
    await request(server)
      .get(`${rateBase}/cards/${card.id}/pages/1/png`)
      .set(auth('admin'))
      .expect(503);
    expect((await db.product.findUniqueOrThrow({ where: { id: 'cement' } })).pricePaise).toBe(
      43025,
    );
    expect((await db.priceUpdateBatch.findUniqueOrThrow({ where: { id: b.id } })).status).toBe(
      'PUBLISHED',
    );
    await expect(
      db.rateCard.update({ where: { id: card.id }, data: { snapshot: { wrong: true } } }),
    ).rejects.toThrow();
    await db.product.update({
      where: { id: 'cement' },
      data: { pricePaise: 44000, priceVersion: { increment: 1 } },
    });
    await request(server)
      .post(`${rateBase}/batches/${b.id}/cards`)
      .set(auth('admin'))
      .send(input)
      .expect(409);
  });
});

describe('security hardening', () => {
  it('bounds pending COD demand and leaves rejected stock unchanged', async () => {
    for (let i = 0; i < 3; i++) await order();
    await cart();
    const r = await review();
    const rejected = await place(r.body.id);
    expect(rejected.status).toBe(429);
    expect(rejected.body.error.code).toBe('DEMAND_REVIEW_REQUIRED');
    expect(await db.order.count()).toBe(3);
    expect((await db.product.findUniqueOrThrow({ where: { id: 'cement' } })).stock).toBe(70);
  });
  it('rejects unverified public product image URLs', async () => {
    const { id: _id, ...body } = product;
    const r = await request(server)
      .post('/api/v1/admin/products')
      .set(auth('admin'))
      .send({ ...body, images: ['https://attacker.invalid/tracker.svg'] });
    expect(r.status).toBe(400);
    expect(r.body.error.code).toBe('UNAPPROVED_ASSET');
  });
  it('stops an already-open owner event stream after session revocation', async () => {
    const { OwnerWorkController, OwnerWorkService } = await import('../src/owner-work');
    const session = await db.session.findFirstOrThrow({ where: { userId: 'admin' } });
    const controller = app.get(OwnerWorkController);
    const stream = Reflect.apply(controller.events, controller, [
      { sessionId: session.id, sessionAccessHash: session.accessHash },
    ]);
    const received: unknown[] = [];
    let completed = false;
    const subscription = stream.subscribe({
      next: (v: unknown) => received.push(v),
      complete: () => {
        completed = true;
      },
    });
    await db.session.delete({ where: { id: session.id } });
    app.get(OwnerWorkService).stream.next({ type: 'OWNER_WORK_UPDATED' });
    await new Promise((resolve) => setTimeout(resolve, 100));
    subscription.unsubscribe();
    expect(received).toEqual([]);
    expect(completed).toBe(true);
  });
});

describe('security hardening concurrency and recovery', () => {
  const exception = (who = 'admin', amount = 10000000) =>
    request(server)
      .post('/api/v1/admin/demand-overrides')
      .set(auth(who as keyof typeof tokens))
      .send({
        phone: '+919999999991',
        kind: 'ORDER',
        maxTotalPaise: amount,
        reason: 'Verified wholesale customer by phone',
      });
  it('serializes pending demand and consumes an audited exception once', async () => {
    for (let i = 0; i < 2; i++) await order();
    await cart();
    const a = await review(),
      b = await review();
    const results = await Promise.all([place(a.body.id), place(b.body.id)]);
    expect(results.map((r) => r.status).sort()).toEqual([201, 429]);
    expect(await db.order.count()).toBe(3);
    await exception('customer').expect(403);
    await exception().expect(201);
    const extra = await order();
    expect(await db.auditLog.count({ where: { event: 'DEMAND_OVERRIDE_USED' } })).toBe(1);
    expect(await db.auditLog.count({ where: { event: 'DEMAND_OVERRIDE_GRANTED' } })).toBe(1);
    await cart();
    const next = await review();
    await place(next.body.id).then((r) => expect(r.status).toBe(429));
    const retry = await place(extra.reviewId, 'customer', extra.idempotencyKey);
    expect(retry.status).toBe(201);
    expect(retry.body.id).toBe(extra.id);
    expect((await db.product.findUniqueOrThrow({ where: { id: 'cement' } })).stock).toBe(60);
  });
  it('blocks single-customer stock monopolization, allowing bounded owner-approved wholesale', async () => {
    await cart('customer', 80);
    const r = await review();
    await place(r.body.id).then((v) => expect(v.body.error.code).toBe('DEMAND_REVIEW_REQUIRED'));
    await exception('admin', 100).expect(201);
    await place(r.body.id).then((v) => expect(v.status).toBe(429));
    const approval = await exception().expect(201);
    await db.demandOverride.update({
      where: { id: approval.body.id },
      data: { expiresAt: new Date(0) },
    });
    await place(r.body.id).then((v) => expect(v.status).toBe(429));
    await exception().expect(201);
    await place(r.body.id).then((v) => expect(v.status).toBe(201));
    expect((await db.product.findUniqueOrThrow({ where: { id: 'cement' } })).stock).toBe(20);
  });
  it('limits concurrent quotations and retains keyed retry recovery', async () => {
    const body = {
      items: [{ productId: 'cement', quantity: 100 }],
      addressId: 'customer-address',
      deliveryDate: date,
      idempotencyKey: randomUUID(),
    };
    const send = (key: string) =>
      request(server)
        .post('/api/v1/quotes')
        .set(auth())
        .send({ ...body, idempotencyKey: key });
    const first = await send(body.idempotencyKey).expect(201);
    await send(randomUUID()).expect(201);
    const results = await Promise.all([send(randomUUID()), send(randomUUID())]);
    expect(results.map((r) => r.status).sort()).toEqual([201, 429]);
    expect((await send(body.idempotencyKey).expect(201)).body.id).toBe(first.body.id);
    await request(server)
      .post(`/api/v1/admin/quotes/${first.body.id}/acknowledge`)
      .set(auth('admin'))
      .send({})
      .expect(201);
    await send(randomUUID()).expect(201);
    expect((await db.product.findUniqueOrThrow({ where: { id: 'cement' } })).stock).toBe(100);
  });
  it('enforces store-wide caps across customers and does not release old pending stock', async () => {
    const { getConfig } = await import('../src/config');
    const c = getConfig();
    const old = c.PENDING_COD_STORE;
    c.PENDING_COD_STORE = 1;
    try {
      await cart();
      await cart('other');
      const a = await review(),
        b = await review('other');
      const results = await Promise.all([place(a.body.id), place(b.body.id, 'other')]);
      expect(results.map((r) => r.status).sort()).toEqual([201, 429]);
      await db.order.updateMany({ data: { createdAt: new Date(0) } });
      await app.get(OrdersService).expireReservations();
      expect(await db.order.count({ where: { status: 'CONFIRMED' } })).toBe(1);
      expect((await db.product.findUniqueOrThrow({ where: { id: 'cement' } })).stock).toBe(90);
    } finally {
      c.PENDING_COD_STORE = old;
    }
  });
  it('persists global OTP budgets, emits a threshold warning, and ignores spoofed forwarded IPs', async () => {
    const { getConfig } = await import('../src/config');
    const c = getConfig();
    const old = c.OTP_SENDS_PER_DAY;
    c.OTP_SENDS_PER_DAY = 2;
    try {
      for (let i = 0; i < 2; i++)
        await request(server)
          .post('/api/v1/auth/otp/request')
          .send({ phone: `+91988888888${i}` })
          .expect(201);
      const denied = await request(server)
        .post('/api/v1/auth/otp/request')
        .set('X-Forwarded-For', '203.0.113.9')
        .send({ phone: '+919888888889' });
      expect(denied.status).toBe(429);
      expect(
        await db.auditLog.count({
          where: { event: 'SECURITY_BUDGET_WARNING', entityId: 'otp:send:global' },
        }),
      ).toBe(1);
      expect(await db.authRateLimit.count({ where: { key: { startsWith: 'send:600000:' } } })).toBe(
        1,
      );
    } finally {
      c.OTP_SENDS_PER_DAY = old;
    }
  });
  it('holds resource concurrency across DB clients and honours emergency switches', async () => {
    const { leased } = await import('../src/abuse');
    const { getConfig } = await import('../src/config');
    const c = getConfig();
    let release!: () => void;
    const held = leased(
      db,
      'security-test',
      1,
      10000,
      () =>
        new Promise<void>((resolve) => {
          release = resolve;
        }),
    );
    while (!release) await new Promise((r) => setTimeout(r, 5));
    try {
      await expect(leased(db, 'security-test', 1, 10000, async () => true)).rejects.toMatchObject({
        status: 429,
      });
    } finally {
      release();
      await held;
    }
    expect(await leased(db, 'security-test', 1, 10000, async () => true)).toBe(true);
    c.DEMAND_PAUSED = true;
    c.OTP_PAUSED = true;
    try {
      await cart();
      await request(server)
        .post('/api/v1/checkout/review')
        .set(auth())
        .send({ addressId: 'customer-address', deliveryDate: date, paymentMethod: 'COD' })
        .expect(503);
      await request(server)
        .post('/api/v1/auth/otp/request')
        .send({ phone: '+919888888881' })
        .expect(503);
    } finally {
      c.DEMAND_PAUSED = false;
      c.OTP_PAUSED = false;
    }
  });
  it.each(['rotation', 'demotion', 'expiry', 'credential change'])(
    'closes owner streams on %s',
    async (change) => {
      const { OwnerWorkController, OwnerWorkService } = await import('../src/owner-work');
      const session = await db.session.findFirstOrThrow({ where: { userId: 'admin' } });
      const controller = app.get(OwnerWorkController);
      const stream = Reflect.apply(controller.events, controller, [
        { sessionId: session.id, sessionAccessHash: session.accessHash },
      ]);
      const received: unknown[] = [];
      let completed = false;
      const subscription = stream.subscribe({
        next: (v: unknown) => received.push(v),
        complete: () => {
          completed = true;
        },
      });
      if (change === 'rotation')
        await db.session.update({
          where: { id: session.id },
          data: { accessHash: hash('rotated') },
        });
      if (change === 'demotion')
        await db.user.update({ where: { id: 'admin' }, data: { role: 'CUSTOMER' } });
      if (change === 'expiry')
        await db.session.update({ where: { id: session.id }, data: { expiresAt: new Date(0) } });
      if (change === 'credential change')
        await db.adminCredential.create({
          data: {
            userId: 'admin',
            passwordHash: await hashPassword('changed-passphrase-for-test'),
          },
        });
      app.get(OwnerWorkService).stream.next({ type: 'OWNER_WORK_UPDATED' });
      await new Promise((r) => setTimeout(r, 100));
      subscription.unsubscribe();
      expect(received).toEqual([]);
      expect(completed).toBe(true);
    },
  );
});

describe('security hardening public photo boundary (simulated object storage)', () => {
  it('validates bytes before storage, only publishes recorded assets, and bounds the HTTP body', async () => {
    const { S3Client } = await import('@aws-sdk/client-s3');
    const sharp = (await import('sharp')).default;
    const { getConfig } = await import('../src/config');
    const c = getConfig();
    const before = {
      R2_ENDPOINT: c.R2_ENDPOINT,
      R2_BUCKET: c.R2_BUCKET,
      R2_ACCESS_KEY_ID: c.R2_ACCESS_KEY_ID,
      R2_SECRET_ACCESS_KEY: c.R2_SECRET_ACCESS_KEY,
      R2_PUBLIC_URL: c.R2_PUBLIC_URL,
    };
    Object.assign(c, {
      R2_ENDPOINT: 'https://storage.example.invalid',
      R2_BUCKET: 'simulated-public',
      R2_ACCESS_KEY_ID: 'simulation',
      R2_SECRET_ACCESS_KEY: 'simulation',
      R2_PUBLIC_URL: 'https://assets.example.invalid',
    });
    const send = vi.spyOn(S3Client.prototype, 'send').mockResolvedValue({} as never);
    const upload = (bytes: Buffer, type = 'image/png', who: keyof typeof tokens = 'admin') =>
      request(server)
        .post('/api/v1/admin/uploads')
        .set(auth(who))
        .set('Content-Type', type)
        .send(bytes);
    try {
      const bytes = await sharp({
        create: { width: 16, height: 16, channels: 3, background: '#fff' },
      })
        .png()
        .toBuffer();
      await upload(bytes, 'image/png', 'customer').expect(403);
      await upload(Buffer.from('<svg onload="alert(1)"/>')).expect(400);
      await upload(bytes, 'image/jpeg').expect(400);
      await upload(bytes.subarray(0, 30)).expect(400);
      await upload(Buffer.alloc(5 * 1024 * 1024 + 1)).expect(413);
      expect(send).not.toHaveBeenCalled();
      const photo = await upload(bytes).expect(201);
      expect(send).toHaveBeenCalledTimes(1);
      expect(
        await db.productAsset.findUnique({ where: { url: photo.body.publicUrl } }),
      ).not.toBeNull();
      const { id: _id, ...body } = product;
      await request(server)
        .post('/api/v1/admin/products')
        .set(auth('admin'))
        .send({ ...body, images: [photo.body.publicUrl] })
        .expect(201);
      await request(server)
        .post('/api/v1/admin/products')
        .set(auth('admin'))
        .send({
          ...body,
          images: [
            'https://assets.example.invalid/products/00000000-0000-4000-8000-000000000000.webp',
          ],
        })
        .expect(400);
      c.UPLOADS_PAUSED = true;
      await upload(bytes).expect(503);
      c.UPLOADS_PAUSED = false;
    } finally {
      Object.assign(c, before);
      c.UPLOADS_PAUSED = false;
      send.mockRestore();
    }
  });
});

describe('security hardening extraction provider budget (simulated OCR/AI)', () => {
  it('stops extraction while paused or over the persistent global budget, leaving prices untouched', async () => {
    const { getConfig } = await import('../src/config');
    const c = getConfig();
    const old = c.EXTRACTIONS_PER_DAY;
    c.EXTRACTIONS_PER_DAY = 1;
    const { RateProviders } = await import('../src/rate-studio/providers');
    const providers = app.get(RateProviders);
    const ocr = vi
      .spyOn(providers, 'ocr')
      .mockResolvedValue({ text: extractedRate.sourceText, layout: [], usage: { images: 1 } });
    const interpret = vi
      .spyOn(providers, 'interpret')
      .mockResolvedValue({ extraction: { rows: [extractedRate] }, usage: { model: 'simulation' } });
    try {
      const { batch: first } = await uploadRate(await newRate('IMAGE'));
      c.EXTRACTION_PAUSED = true;
      await request(server)
        .post(`${rateBase}/batches/${first.id}/extract`)
        .set(auth('admin'))
        .send({ expectedVersion: first.version })
        .expect(503);
      expect(ocr).not.toHaveBeenCalled();
      c.EXTRACTION_PAUSED = false;
      await request(server)
        .post(`${rateBase}/batches/${first.id}/extract`)
        .set(auth('admin'))
        .send({ expectedVersion: first.version })
        .expect(201);
      await finishRate(first.id);
      const { batch: second } = await uploadRate(await newRate('IMAGE'));
      await request(server)
        .post(`${rateBase}/batches/${second.id}/extract`)
        .set(auth('admin'))
        .send({ expectedVersion: second.version })
        .expect(429);
      expect(ocr).toHaveBeenCalledTimes(1);
      expect(interpret).toHaveBeenCalledTimes(1);
      expect(await db.productPriceHistory.count()).toBe(0);
      expect(
        await db.auditLog.count({
          where: { event: 'SECURITY_BUDGET_WARNING', entityId: 'extraction:global' },
        }),
      ).toBe(1);
    } finally {
      c.EXTRACTIONS_PER_DAY = old;
      c.EXTRACTION_PAUSED = false;
    }
  });
});
