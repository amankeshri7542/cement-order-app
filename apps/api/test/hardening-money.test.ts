import 'reflect-metadata';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { loadEnvFile } from 'node:process';
import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import request from 'supertest';
import type { INestApplication } from '@nestjs/common';
import type { Server } from 'node:http';
import { Db } from '../src/db';
import { hash } from '../src/http';

// Money and stock records: owner edits after orders, replayed money actions, stale delivery
// keys, refunds by the collection channel, late quote conversion and oversized totals.
if (existsSync('.env.test')) loadEnvFile('.env.test');
process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
process.env.OTP_PROVIDER = 'mock';
process.env.OTP_HASH_SECRET = 'money-test-only-secret-not-for-production';
process.env.RAZORPAY_KEY_ID = 'rzp_test_local';
process.env.RAZORPAY_KEY_SECRET = 'test-key-secret';
process.env.RAZORPAY_WEBHOOK_SECRET = 'test-webhook-secret';
process.env.CORS_ORIGINS = 'http://localhost:3000,http://localhost:8081';
if (!process.env.DATABASE_URL || !new URL(process.env.DATABASE_URL).pathname.endsWith('_test'))
  throw new Error('Money tests require a dedicated TEST_DATABASE_URL database ending in _test.');

let app: INestApplication;
let server: Server;
let db: Db;
const tokens = { customer: 'c'.repeat(43), admin: 'a'.repeat(43) };
const day = (offset: number) => new Date(Date.now() + offset * 86400000).toISOString().slice(0, 10);
const date = day(1);
const address = {
  label: 'Site',
  name: 'Test customer',
  phone: '+919999999971',
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
async function review(quantity = 10) {
  await request(server)
    .put('/api/v1/cart/items')
    .set(auth())
    .send({ productId: 'cement', quantity })
    .expect(200);
  return request(server)
    .post('/api/v1/checkout/review')
    .set(auth())
    .send({ addressId: 'customer-address', deliveryDate: date, paymentMethod: 'COD' });
}
async function order(quantity = 10) {
  const checked = await review(quantity);
  expect(checked.status, JSON.stringify(checked.body)).toBe(201);
  const placed = await request(server)
    .post('/api/v1/orders')
    .set(auth())
    .send({ reviewId: checked.body.id, idempotencyKey: randomUUID() });
  expect(placed.status, JSON.stringify(placed.body)).toBe(201);
  return placed.body as { id: string; totalPaise: number };
}
function status(id: string, next: string) {
  return request(server)
    .patch(`/api/v1/admin/orders/${id}/status`)
    .set(auth('admin'))
    .send({ status: next, note: 'Money test action' });
}
const editable = () => {
  const { id: _id, ...data } = product;
  return data;
};

beforeAll(async () => {
  const { createApp } = await import('../src/app');
  app = await createApp();
  // Listen once on 127.0.0.1; see integration.test.ts for the per-request port collision.
  await app.listen(0, '127.0.0.1');
  server = app.getHttpServer();
  db = app.get(Db);
}, 30000);
beforeEach(async () => {
  await db.$executeRawUnsafe(
    'TRUNCATE TABLE "PriceUpdateBatch", "RateSource", "FinancialMovement", "User", "Category", "Product", "Order", "Quote", "AuditLog", "OtpChallenge", "AuthRateLimit", "DeliveryZone", "StoreSettings" RESTART IDENTITY CASCADE',
  );
  for (const [i, role] of (['customer', 'admin'] as const).entries())
    await db.user.create({
      data: {
        id: role,
        phone: `+91999999997${i + 1}`,
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
      pincodes: { create: [{ pincode: '800020' }] },
    },
  });
  await db.storeSettings.create({
    data: { id: 'store', deliveryFeePaise: 50000, onlinePaymentsEnabled: true },
  });
});
afterAll(async () => {
  await app?.close();
});

describe('F10 product edits after stock movements', () => {
  it('saves a price loaded before an order without touching the stock balance', async () => {
    const loaded = await db.product.findUniqueOrThrow({ where: { id: 'cement' } });
    await order();
    await request(server)
      .post('/api/v1/admin/products/cement/movements')
      .set(auth('admin'))
      .send({ kind: 'DAMAGE', quantity: 2, note: 'Torn bags', idempotencyKey: randomUUID() })
      .expect(201);
    expect((await db.product.findUniqueOrThrow({ where: { id: 'cement' } })).version).toBe(
      loaded.version,
    );
    // The editor sends the balance it loaded (100) with the version it loaded.
    const saved = await request(server)
      .patch('/api/v1/admin/products/cement')
      .set(auth('admin'))
      .send({ ...editable(), stock: loaded.stock, pricePaise: 42500, expectedVersion: 1 });
    expect(saved.status, JSON.stringify(saved.body)).toBe(200);
    expect(saved.body).toMatchObject({ pricePaise: 42500, stock: 88, version: 2 });
    const after = await db.product.findUniqueOrThrow({ where: { id: 'cement' } });
    expect(after).toMatchObject({ stock: 88, pricePaise: 42500, priceVersion: 2 });
    // The stale editor copy is now refused by version, as before.
    await request(server)
      .patch('/api/v1/admin/products/cement')
      .set(auth('admin'))
      .send({ ...editable(), stock: 88, expectedVersion: 1 })
      .expect(409);
  });
  it('still refuses a stock balance the product never had', async () => {
    await order();
    const refused = await request(server)
      .patch('/api/v1/admin/products/cement')
      .set(auth('admin'))
      .send({ ...editable(), stock: 500, expectedVersion: 1 })
      .expect(409);
    expect(refused.body.error.code).toBe('USE_INVENTORY_MOVEMENT');
    expect((await db.product.findUniqueOrThrow({ where: { id: 'cement' } })).stock).toBe(90);
  });
  it('publishes a Rate Studio batch reviewed before an order landed', async () => {
    const base = '/api/v1/admin/rate-studio';
    const created = await request(server)
      .post(`${base}/batches`)
      .set(auth('admin'))
      .send({ title: 'Supplier price sheet', sourceType: 'MANUAL', idempotencyKey: randomUUID() })
      .expect(201);
    const batch = await request(server)
      .patch(`${base}/batches/${created.body.id}`)
      .set(auth('admin'))
      .send({
        expectedVersion: created.body.version,
        title: created.body.title,
        items: [
          {
            productId: 'cement',
            label: 'Test cement',
            brand: 'Test',
            specification: 'PPC',
            unit: '50 kg bag',
            weight: '',
            proposedPricePaise: 43000,
            included: true,
            reviewed: true,
            acknowledged: true,
            note: 'Confirmed at counter',
            rememberAlias: false,
            refreshBaseline: false,
            expectedProductVersion: 1,
          },
        ],
      })
      .expect(200);
    await order();
    const published = await request(server)
      .post(`${base}/batches/${batch.body.id}/publish`)
      .set(auth('admin'))
      .send({ expectedVersion: batch.body.version, confirmation: 'PUBLISH' });
    expect(published.status, JSON.stringify(published.body)).toBe(201);
    expect(await db.product.findUniqueOrThrow({ where: { id: 'cement' } })).toMatchObject({
      pricePaise: 43000,
      stock: 90,
    });
  });
});

describe('F12 replayed money actions', () => {
  it('refuses a counter sale replay with another price, channel or buyer', async () => {
    const sale = {
      kind: 'WALK_IN_SALE',
      quantity: 2,
      reference: '',
      note: 'Counter sale',
      idempotencyKey: randomUUID(),
      unitPricePaise: 40000,
      channel: 'CASH',
      counterParty: 'Ram Mistri',
    };
    const send = (body: object) =>
      request(server).post('/api/v1/admin/products/cement/movements').set(auth('admin')).send(body);
    await send(sale).expect(201);
    for (const changed of [
      { unitPricePaise: 35000 },
      { channel: 'UPI' },
      { counterParty: 'Shyam Mistri' },
    ]) {
      const replay = await send({ ...sale, ...changed });
      expect(replay.status, JSON.stringify(changed)).toBe(409);
      expect(replay.body.error.code).toBe('IDEMPOTENCY_CONFLICT');
    }
    await send(sale).expect(201);
    // A replay without a price keeps the recorded amount even after a list-price change.
    await db.product.update({ where: { id: 'cement' }, data: { pricePaise: 45000 } });
    const { unitPricePaise: _price, ...withoutPrice } = sale;
    await send(withoutPrice).expect(201);
    const money = await db.financialMovement.findMany({ where: { kind: 'COUNTER_SALE' } });
    expect(money).toHaveLength(1);
    expect(money[0]).toMatchObject({
      amountPaise: 80000,
      channel: 'CASH',
      counterParty: 'Ram Mistri',
    });
    expect((await db.product.findUniqueOrThrow({ where: { id: 'cement' } })).stock).toBe(98);
  });
  it('refuses a COD collection replay that names another channel', async () => {
    const o = await order();
    const collect = (body?: object) => {
      const sent = request(server)
        .post(`/api/v1/admin/orders/${o.id}/cod-received`)
        .set(auth('admin'));
      return body ? sent.send(body) : sent;
    };
    await collect({ channel: 'CASH' }).expect(201);
    const changed = await collect({ channel: 'UPI' }).expect(409);
    expect(changed.body.error.code).toBe('IDEMPOTENCY_CONFLICT');
    await collect({ channel: 'CASH' }).expect(201);
    await collect().expect(201);
    const money = await db.financialMovement.findMany({ where: { kind: 'COLLECTION' } });
    expect(money).toHaveLength(1);
    expect(money[0]!.channel).toBe('CASH');
  });
});

describe('F13 stale delivery keys', () => {
  it('refuses an old report key after a newer retry instead of doing nothing', async () => {
    const o = await order();
    expect((await status(o.id, 'PREPARING')).status).toBe(200);
    expect((await status(o.id, 'OUT_FOR_DELIVERY')).status).toBe(200);
    const deliver = (body: object) =>
      request(server).post(`/api/v1/admin/orders/${o.id}/delivery`).set(auth('admin')).send(body);
    const report = {
      action: 'REPORT',
      reason: 'UNAVAILABLE',
      note: 'Nobody at site',
      idempotencyKey: randomUUID(),
    };
    await deliver(report).expect(201);
    await deliver(report).expect(201);
    await deliver({
      action: 'RETRY',
      retryDate: day(2),
      note: 'Try again',
      idempotencyKey: randomUUID(),
    }).expect(201);
    const stale = await deliver(report).expect(409);
    expect(stale.body.error.code).toBe('IDEMPOTENCY_CONFLICT');
    expect((await db.order.findUniqueOrThrow({ where: { id: o.id } })).status).toBe(
      'OUT_FOR_DELIVERY',
    );
    expect(await db.deliveryAttempt.count({ where: { orderId: o.id } })).toBe(2);
    // A new key records the new report.
    await deliver({ ...report, idempotencyKey: randomUUID() }).expect(201);
    expect((await db.order.findUniqueOrThrow({ where: { id: o.id } })).status).toBe(
      'DELIVERY_EXCEPTION',
    );
  });
});

describe('F37 COD refund channel', () => {
  async function cancelledAfter(channel?: 'CASH' | 'UPI') {
    const o = await order();
    const collected = request(server)
      .post(`/api/v1/admin/orders/${o.id}/cod-received`)
      .set(auth('admin'));
    await (channel ? collected.send({ channel }) : collected).expect(201);
    expect((await status(o.id, 'CANCELLED')).status).toBe(200);
    return o;
  }
  // The desk sends no body; a stated channel is optional.
  const refund = (id: string, body?: object) => {
    const sent = request(server)
      .post(`/api/v1/admin/orders/${id}/cash-refunded`)
      .set(auth('admin'));
    return body ? sent.send(body) : sent;
  };
  const refundOf = (id: string) =>
    db.financialMovement.findFirstOrThrow({ where: { kind: 'REFUND', payment: { orderId: id } } });

  it('records a refund by the channel the money was collected in', async () => {
    const o = await cancelledAfter('UPI');
    await refund(o.id).expect(201);
    expect((await refundOf(o.id)).channel).toBe('UPI');
    const final = await db.order.findUniqueOrThrow({
      where: { id: o.id },
      include: { history: { where: { status: 'REFUNDED' } } },
    });
    expect(final.status).toBe('REFUNDED');
    expect(final.history[0]!.note).toBe('UPI refund recorded by store staff.');
    await refund(o.id).expect(201);
    expect((await refund(o.id, { channel: 'CASH' }).expect(409)).body.error.code).toBe(
      'IDEMPOTENCY_CONFLICT',
    );
    expect(await db.financialMovement.count({ where: { kind: 'REFUND' } })).toBe(1);
  });
  it('accepts a stated refund channel and treats an unlabelled collection as cash', async () => {
    const stated = await cancelledAfter('UPI');
    await refund(stated.id, { channel: 'CASH' }).expect(201);
    expect((await refundOf(stated.id)).channel).toBe('CASH');
    const legacy = await cancelledAfter();
    await refund(legacy.id).expect(201);
    expect((await refundOf(legacy.id)).channel).toBe('CASH');
  });
});

describe('F11 late conversion of an accepted quote', () => {
  async function acceptedQuote() {
    const q = await request(server)
      .post('/api/v1/quotes')
      .set(auth())
      .send({
        items: [{ productId: 'cement', quantity: 50 }],
        addressId: 'customer-address',
        deliveryDate: date,
      })
      .expect(201);
    await request(server)
      .post(`/api/v1/admin/quotes/${q.body.id}/offer`)
      .set(auth('admin'))
      .send({
        expectedRevision: 0,
        items: [{ productId: 'cement', unitPricePaise: 38000 }],
        deliveryFeePaise: 100000,
        deliveryConfirmed: true,
        validUntil: new Date(Date.now() + 86400000).toISOString(),
      })
      .expect(201);
    await request(server)
      .post(`/api/v1/quotes/${q.body.id}/respond`)
      .set(auth())
      .send({ revision: 1, status: 'ACCEPTED' })
      .expect(201);
    return q.body.id as string;
  }
  const convert = (id: string, body: object) =>
    request(server).post(`/api/v1/admin/quotes/${id}/convert`).set(auth('admin')).send(body);

  it('converts an acceptance given before the offer expired, with a new date if needed', async () => {
    const id = await acceptedQuote();
    // Accepted a minute before validUntil, converted after it, and the quoted date has passed.
    await db.quote.update({
      where: { id },
      data: {
        decisionAt: new Date(Date.now() - 120000),
        validUntil: new Date(Date.now() - 60000),
        deliveryDate: day(-1),
      },
    });
    const late = await convert(id, { revision: 1 }).expect(400);
    expect(late.body.error.code).toBe('INVALID_DELIVERY_DATE');
    await convert(id, { revision: 1, deliveryDate: day(-1) }).expect(400);
    const converted = await convert(id, { revision: 1, deliveryDate: day(3) });
    expect(converted.status, JSON.stringify(converted.body)).toBe(201);
    expect(converted.body).toMatchObject({
      quoteId: id,
      deliveryDate: day(3),
      totalPaise: 2000000,
      items: [{ pricePaise: 38000, quantity: 50 }],
    });
    expect((await db.product.findUniqueOrThrow({ where: { id: 'cement' } })).stock).toBe(50);
  });
  it('still refuses an acceptance recorded after the offer expired', async () => {
    const id = await acceptedQuote();
    await db.quote.update({
      where: { id },
      data: { validUntil: new Date(Date.now() - 120000), decisionAt: new Date(Date.now() - 60000) },
    });
    const refused = await convert(id, { revision: 1 }).expect(409);
    expect(refused.body.error.code).toBe('QUOTE_CHANGED');
    expect(await db.order.count()).toBe(0);
  });
});

describe('F33 totals beyond the supported amount', () => {
  it('answers an oversized checkout review with 409 ORDER_TOO_LARGE', async () => {
    await db.product.update({ where: { id: 'cement' }, data: { pricePaise: 100_000_000 } });
    const checked = await review(21);
    expect(checked.status, JSON.stringify(checked.body)).toBe(409);
    expect(checked.body.error.code).toBe('ORDER_TOO_LARGE');
  });
});
