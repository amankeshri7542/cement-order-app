import 'reflect-metadata';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import type { Server } from 'node:http';
import { loadEnvFile } from 'node:process';
import type { INestApplication } from '@nestjs/common';
import { istToday } from '@shiv/shared';
import request from 'supertest';
import { Events } from '../src/catalog';
import { Db } from '../src/db';
import { addPerson, tokenFor } from './staff-helper';

if (existsSync('.env.test')) loadEnvFile('.env.test');
process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
process.env.OTP_PROVIDER = 'mock';
process.env.OTP_HASH_SECRET = 'pricing-test-only-secret-not-for-production';
process.env.CORS_ORIGINS = 'http://localhost:3000';
if (!process.env.DATABASE_URL || !new URL(process.env.DATABASE_URL).pathname.endsWith('_test'))
  throw new Error('These tests require a dedicated TEST_DATABASE_URL ending in _test.');

const MAIN = 'loc_main';
let app: INestApplication;
let server: Server;
let db: Db;
const as = (id: string) => ({ Authorization: `Bearer ${tokenFor(id)}` });
const admin = (
  who: string,
  method: 'get' | 'post' | 'patch' | 'put',
  path: string,
  body?: object,
) => {
  const call = request(server)[method](`/api/v1/admin/${path}`).set(as(who));
  return body ? call.send(body) : call;
};
const addDays = (count: number) =>
  new Date(Date.parse(`${istToday()}T00:00:00Z`) + count * 86400000).toISOString().slice(0, 10);
const rule = (body: object, who = 'papa') => admin(who, 'post', 'pricing/rules', body);
const version = async (id = 'cement') =>
  (await db.product.findUniqueOrThrow({ where: { id } })).version;

beforeAll(async () => {
  const { createApp } = await import('../src/app');
  app = await createApp();
  await app.listen(0, '127.0.0.1');
  server = app.getHttpServer();
  db = app.get(Db);
}, 30000);
beforeEach(async () => {
  await db.$executeRawUnsafe(
    'TRUNCATE TABLE "PriceRule", "CustomerGroup", "DeliveryRate", "ApprovalRequest", "FinancialMovement", "User", "Category", "Product", "DeliveryZone", "StoreSettings", "AuditLog", "AuthRateLimit" RESTART IDENTITY CASCADE',
  );
  await db.location.update({ where: { id: MAIN }, data: { managerRateCapPercent: 5 } });
  await addPerson(db, { id: 'papa', role: 'OWNER', phone: '+919000000810' });
  await addPerson(db, { id: 'chacha', role: 'OWNER', phone: '+919000000811' });
  await addPerson(db, { id: 'manager', role: 'MANAGER', shops: [MAIN], phone: '+919000000812' });
  await addPerson(db, { id: 'cashier', role: 'CASHIER', shops: [MAIN], phone: '+919000000814' });
  await addPerson(db, {
    id: 'keeper',
    role: 'STOCK_KEEPER',
    shops: [MAIN],
    phone: '+919000000815',
  });
  await addPerson(db, { id: 'accountant', role: 'ACCOUNTANT', phone: '+919000000816' });
  await addPerson(db, { id: 'tech', role: 'TECH_OPERATOR', phone: '+919000000817' });
  await addPerson(db, { id: 'customer', phone: '+919000000801' });
  await addPerson(db, { id: 'other', phone: '+919000000802' });
  await db.category.createMany({
    data: [
      { id: 'cat', name: 'Cement', slug: 'cement' },
      { id: 'sandcat', name: 'Sand', slug: 'sand' },
    ],
  });
  for (const [id, categoryId] of [
    ['cement', 'cat'],
    ['acc', 'cat'],
    ['sand', 'sandcat'],
  ] as const)
    await db.product.create({
      data: {
        id,
        name: id,
        brand: 'Test',
        categoryId,
        type: 'PPC',
        grade: 'PPC',
        unit: 'bag',
        pricePaise: 40000,
        stock: 1000,
        minQuantity: 1,
        description: 'Test',
        recommendedUse: 'Test',
        images: [],
      },
    });
  await db.deliveryZone.create({
    data: {
      id: 'zone',
      name: 'Patna',
      deliveryFeePaise: 50000,
      minimumOrderPaise: 0,
      estimate: 'Today',
      pincodes: { create: { pincode: '800020' } },
    },
  });
  await db.storeSettings.create({ data: { id: 'store', phone: '+919999999000' } });
  await db.address.create({
    data: {
      id: 'site',
      userId: 'customer',
      label: 'Site',
      name: 'Ramesh',
      phone: '+919000000801',
      line1: 'Plot 12',
      area: 'Kankarbagh',
      city: 'Patna',
      state: 'Bihar',
      pincode: '800020',
      landmark: '',
    },
  });
});
afterAll(async () => {
  await app?.close();
});

async function reviewOf(quantity = 10, productId = 'cement') {
  const headers = as('customer');
  await request(server)
    .put('/api/v1/cart/items')
    .set(headers)
    .send({ productId, quantity })
    .expect(200);
  return request(server)
    .post('/api/v1/checkout/review')
    .set(headers)
    .send({ addressId: 'site', deliveryDate: addDays(2), paymentMethod: 'COD', notes: '' })
    .expect(201);
}
const place = (reviewId: string) =>
  request(server)
    .post('/api/v1/orders')
    .set(as('customer'))
    .send({ reviewId, idempotencyKey: randomUUID() });
const lineOf = (orderId: string) => db.orderItem.findFirstOrThrow({ where: { orderId } });

describe('Aaj ke rate', () => {
  it('publishes many rates together, with one log entry and a history for each', async () => {
    const { body } = await admin('papa', 'post', 'rates/publish', {
      rates: [
        { productId: 'cement', expectedVersion: await version(), pricePaise: 41000 },
        { productId: 'acc', expectedVersion: await version('acc'), pricePaise: 39000 },
      ],
    }).expect(201);
    expect(body.changed).toBe(2);
    expect((await db.product.findUniqueOrThrow({ where: { id: 'cement' } })).pricePaise).toBe(
      41000,
    );
    expect(await db.auditLog.count({ where: { event: 'RATES_PUBLISHED' } })).toBe(1);
    const { body: history } = await admin('papa', 'get', 'rates/cement/history').expect(200);
    expect(history[0]).toMatchObject({
      oldPricePaise: 40000,
      newPricePaise: 41000,
      actorId: 'papa',
    });
  });
  it('one stale rate stops the whole publish', async () => {
    const { status } = await admin('papa', 'post', 'rates/publish', {
      rates: [
        { productId: 'cement', expectedVersion: await version(), pricePaise: 41000 },
        { productId: 'acc', expectedVersion: 999, pricePaise: 39000 },
      ],
    });
    expect(status).toBe(409);
    expect((await db.product.findUniqueOrThrow({ where: { id: 'cement' } })).pricePaise).toBe(
      40000,
    );
  });
  it('a big jump must be meant, as it is usually a slipped digit', async () => {
    const rates = [{ productId: 'cement', expectedVersion: await version(), pricePaise: 400000 }];
    const { status, body } = await admin('papa', 'post', 'rates/publish', { rates });
    expect(status).toBe(409);
    expect(body.error.code).toBe('BIG_RATE_CHANGE');
    expect(body.error.details.productIds).toEqual(['cement']);
    expect((await db.product.findUniqueOrThrow({ where: { id: 'cement' } })).pricePaise).toBe(
      40000,
    );
    await admin('papa', 'post', 'rates/publish', { rates, bigChangesChecked: true }).expect(201);
  });
  it('an unchanged rate is left alone', async () => {
    const before = await version();
    const { body } = await admin('papa', 'post', 'rates/publish', {
      rates: [{ productId: 'cement', expectedVersion: before, pricePaise: 40000 }],
    }).expect(201);
    expect(body.changed).toBe(0);
    expect(await version()).toBe(before);
  });
  it('refuses nonsense rates', async () => {
    for (const pricePaise of [0, -1, 1.5, 100000001])
      await admin('papa', 'post', 'rates/publish', {
        rates: [{ productId: 'cement', expectedVersion: 1, pricePaise }],
      }).expect(400);
    await admin('papa', 'post', 'rates/publish', {
      rates: [{ productId: 'nope', expectedVersion: 1, pricePaise: 100 }],
    }).expect(404);
  });
  it('"rate wahi hain" says someone looked, and changes no rate', async () => {
    const before = await version();
    await admin('papa', 'post', 'rates/reaffirm').expect(201);
    const row = await db.product.findUniqueOrThrow({ where: { id: 'cement' } });
    expect(row.priceCheckedAt).not.toBeNull();
    expect(row.pricePaise).toBe(40000);
    expect(row.version).toBe(before);
    expect(await db.auditLog.count({ where: { event: 'RATES_REAFFIRMED' } })).toBe(1);
  });
  it('a manager can only ask, and it goes live only on an owner’s yes', async () => {
    const rates = [{ productId: 'cement', expectedVersion: await version(), pricePaise: 41000 }];
    await admin('manager', 'post', 'rates/publish', { rates }).expect(403);
    const { body } = await admin('manager', 'post', 'rates/ask', {
      rates,
      idempotencyKey: randomUUID(),
    }).expect(201);
    expect((await db.product.findUniqueOrThrow({ where: { id: 'cement' } })).pricePaise).toBe(
      40000,
    );
    await admin('papa', 'post', `approvals/${body.id}/decide`, { decision: 'APPROVE' }).expect(201);
    expect((await db.product.findUniqueOrThrow({ where: { id: 'cement' } })).pricePaise).toBe(
      41000,
    );
  });
  it('an old request cannot overwrite a newer rate', async () => {
    const rates = [{ productId: 'cement', expectedVersion: await version(), pricePaise: 41000 }];
    const { body } = await admin('manager', 'post', 'rates/ask', {
      rates,
      idempotencyKey: randomUUID(),
    }).expect(201);
    await admin('papa', 'post', 'rates/publish', {
      rates: [{ productId: 'cement', expectedVersion: await version(), pricePaise: 42000 }],
    }).expect(201);
    await admin('chacha', 'post', `approvals/${body.id}/decide`, { decision: 'APPROVE' }).expect(
      409,
    );
    expect((await db.product.findUniqueOrThrow({ where: { id: 'cement' } })).pricePaise).toBe(
      42000,
    );
  });
  it('who may do what', async () => {
    for (const who of ['manager', 'cashier', 'accountant'])
      await admin(who, 'get', 'rates').expect(200);
    for (const who of ['keeper', 'tech', 'customer']) await admin(who, 'get', 'rates').expect(403);
    for (const who of ['manager', 'cashier', 'accountant', 'keeper', 'tech', 'customer']) {
      await admin(who, 'post', 'rates/reaffirm').expect(403);
      await admin(who, 'post', 'rates/publish', {
        rates: [{ productId: 'cement', expectedVersion: 1, pricePaise: 100 }],
      }).expect(403);
    }
    for (const who of ['cashier', 'accountant', 'keeper', 'tech', 'customer'])
      await admin(who, 'post', 'rates/ask', {
        rates: [{ productId: 'cement', expectedVersion: 1, pricePaise: 100 }],
        idempotencyKey: randomUUID(),
      }).expect(403);
  });
});

describe('rules', () => {
  const good = {
    kind: 'SLAB',
    productId: 'cement',
    minQuantity: 100,
    valueType: 'RATE',
    value: 39000,
  };
  it('only owners make or see them', async () => {
    for (const who of ['manager', 'cashier', 'accountant', 'keeper', 'tech', 'customer']) {
      await admin(who, 'get', 'pricing/rules').expect(403);
      await rule(good, who).expect(403);
      await admin(who, 'get', 'pricing/groups').expect(403);
      await admin(who, 'post', 'pricing/groups', { name: 'X' }).expect(403);
      await admin(who, 'put', 'pricing/customers/customer/group', { groupId: null }).expect(403);
      await admin(who, 'get', 'pricing/limits').expect(403);
      await admin(who, 'put', 'pricing/people/manager/rate-cap', { rateCapPercent: 50 }).expect(
        403,
      );
      await admin(who, 'get', 'pricing/suggestions').expect(403);
    }
    await rule(good).expect(201);
  });
  for (const [name, body] of [
    ['a slab of one', { ...good, minQuantity: 1 }],
    ['a slab with no goods named', { ...good, productId: null }],
    ['both a product and a category', { ...good, categoryId: 'cat' }],
    ['a fixed rate for a whole category', { ...good, productId: null, categoryId: 'cat' }],
    ['more than 90% off', { ...good, valueType: 'PERCENT_OFF', value: 9001 }],
    ['nothing off', { ...good, value: 0 }],
    ['a negative value', { ...good, value: -5 }],
    ['a fraction', { ...good, value: 1.5 }],
    ['a group rate with no group', { kind: 'GROUP', valueType: 'AMOUNT_OFF', value: 100 }],
    [
      'a special rate with no customer',
      { kind: 'SPECIAL', valueType: 'AMOUNT_OFF', value: 100, endsOn: addDays(1) },
    ],
    [
      'a special rate with no end date',
      { kind: 'SPECIAL', customerId: 'customer', valueType: 'AMOUNT_OFF', value: 100 },
    ],
    ['an offer with no dates', { kind: 'OFFER', valueType: 'AMOUNT_OFF', value: 100 }],
    [
      'an end before the start',
      {
        kind: 'OFFER',
        valueType: 'AMOUNT_OFF',
        value: 100,
        startsOn: addDays(2),
        endsOn: addDays(1),
      },
    ],
    ['a public slab', { ...good, isPublic: true }],
    ['a slab that stacks', { ...good, stacks: true }],
    ['a customer named on a slab', { ...good, customerId: 'customer' }],
    ['an unknown field', { ...good, createdById: 'someone' }],
  ] as const)
    it(`refuses ${name}`, async () => {
      await rule(body).expect(400);
      expect(await db.priceRule.count()).toBe(0);
    });
  it('refuses goods, groups and customers that do not exist', async () => {
    await rule({ ...good, productId: 'nope' }).expect(404);
    await rule({ kind: 'GROUP', groupId: 'nope', valueType: 'AMOUNT_OFF', value: 1 }).expect(404);
    await rule({
      kind: 'SPECIAL',
      customerId: 'nope',
      valueType: 'AMOUNT_OFF',
      value: 1,
      endsOn: addDays(1),
    }).expect(404);
    // A special rate is for a customer, never for a member of staff.
    await rule({
      kind: 'SPECIAL',
      customerId: 'manager',
      valueType: 'AMOUNT_OFF',
      value: 1,
      endsOn: addDays(1),
    }).expect(404);
  });
  it('a change needs the version it was looking at', async () => {
    const { body } = await rule(good).expect(201);
    await admin('papa', 'patch', `pricing/rules/${body.id}`, { ...good, value: 38000 }).expect(409);
    await admin('papa', 'patch', `pricing/rules/${body.id}`, {
      ...good,
      value: 38000,
      expectedVersion: body.version,
    }).expect(200);
    await admin('chacha', 'patch', `pricing/rules/${body.id}`, {
      ...good,
      value: 1,
      expectedVersion: body.version,
    }).expect(409);
    await admin('papa', 'patch', 'pricing/rules/nope', { ...good, expectedVersion: 1 }).expect(404);
    expect(await db.auditLog.count({ where: { event: { startsWith: 'PRICE_RULE' } } })).toBe(2);
  });
});

describe('at checkout', () => {
  it('a slab lowers the rate from its quantity, and the line says why', async () => {
    const { body: slab } = await rule({
      kind: 'SLAB',
      productId: 'cement',
      minQuantity: 100,
      valueType: 'RATE',
      value: 39000,
    }).expect(201);
    const small = await reviewOf(99);
    expect(small.body.items[0].pricePaise).toBe(40000);
    const big = await reviewOf(100);
    expect(big.body.items[0]).toMatchObject({ pricePaise: 39000, lineTotalPaise: 3900000 });
    // How a rate was reached stays on the server: the customer sees what they pay.
    for (const hidden of ['listPricePaise', 'ruleId', 'ruleKind'])
      expect(big.body.items[0]).not.toHaveProperty(hidden);
    expect(big.body.subtotalPaise).toBe(3900000);
    const placed = await place(big.body.id).expect(201);
    expect(placed.body.totalPaise).toBe(big.body.totalPaise);
    expect(await lineOf(placed.body.id)).toMatchObject({
      pricePaise: 39000,
      listPricePaise: 40000,
      ruleId: slab.id,
      ruleKind: 'SLAB',
    });
  });
  it('a customer never sees how their rate was set', async () => {
    await rule({
      kind: 'SLAB',
      productId: 'cement',
      minQuantity: 5,
      valueType: 'RATE',
      value: 39000,
    }).expect(201);
    const review = await reviewOf(10);
    const placed = await place(review.body.id).expect(201);
    for (const field of ['listPricePaise', 'ruleId', 'ruleKind', 'rateChangedById'])
      expect(placed.body.items[0]).not.toHaveProperty(field);
    const { body } = await request(server)
      .get(`/api/v1/orders/${placed.body.id}`)
      .set(as('customer'))
      .expect(200);
    expect(body.items[0]).not.toHaveProperty('ruleKind');
    expect(body.items[0].pricePaise).toBe(39000);
  });
  it('a group rate reaches that group’s customers only', async () => {
    const { body: group } = await admin('papa', 'post', 'pricing/groups', {
      name: 'Regular',
    }).expect(201);
    await rule({
      kind: 'GROUP',
      groupId: group.id,
      categoryId: 'cat',
      valueType: 'PERCENT_OFF',
      value: 500,
    }).expect(201);
    expect((await reviewOf(10)).body.items[0].pricePaise).toBe(40000);
    await admin('papa', 'put', 'pricing/customers/customer/group', { groupId: group.id }).expect(
      200,
    );
    expect((await reviewOf(1)).body.items[0]).toMatchObject({
      pricePaise: 38000,
    });
  });
  it('a special rate reaches that one customer only, and ends on its day', async () => {
    const { body: special } = await rule({
      kind: 'SPECIAL',
      customerId: 'customer',
      productId: 'cement',
      valueType: 'RATE',
      value: 37000,
      endsOn: addDays(0),
    }).expect(201);
    expect((await reviewOf(10)).body.items[0].pricePaise).toBe(37000);
    await db.priceRule.update({ where: { id: special.id }, data: { endsOn: addDays(-1) } });
    expect((await reviewOf(1)).body.items[0].pricePaise).toBe(40000);
    const rates = await request(server).get('/api/v1/me/rates').set(as('other')).expect(200);
    expect(
      rates.body.find((row: { productId: string }) => row.productId === 'cement').yourPaise,
    ).toBe(40000);
  });
  it('an offer that has ended or not begun does not apply', async () => {
    await rule({
      kind: 'OFFER',
      productId: 'cement',
      valueType: 'RATE',
      value: 30000,
      startsOn: addDays(1),
      endsOn: addDays(5),
    }).expect(201);
    expect((await reviewOf(10)).body.items[0].pricePaise).toBe(40000);
  });
  it('a rate cannot be sent from the browser', async () => {
    const headers = as('customer');
    await request(server)
      .put('/api/v1/cart/items')
      .set(headers)
      .send({ productId: 'cement', quantity: 10 })
      .expect(200);
    const tampered = await request(server)
      .post('/api/v1/checkout/review')
      .set(headers)
      .send({
        addressId: 'site',
        deliveryDate: addDays(2),
        paymentMethod: 'COD',
        notes: '',
        pricePaise: 1,
      });
    expect(tampered.status).toBe(400);
    await request(server)
      .put('/api/v1/cart/items')
      .set(headers)
      .send({ productId: 'cement', quantity: 10, pricePaise: 1 })
      .expect(400);
  });
  it('a rule that ends between review and placing asks them to look again', async () => {
    const { body: offer } = await rule({
      kind: 'OFFER',
      productId: 'cement',
      valueType: 'RATE',
      value: 30000,
      startsOn: addDays(0),
      endsOn: addDays(5),
    }).expect(201);
    const review = await reviewOf(10);
    expect(review.body.items[0].pricePaise).toBe(30000);
    await db.priceRule.update({ where: { id: offer.id }, data: { active: false } });
    const { status, body } = await place(review.body.id);
    expect(status).toBe(409);
    expect(body.error.code).toBe('PRICE_CHANGED');
    expect(await db.order.count()).toBe(0);
  });
  it('a better rule arriving between review and placing also asks again', async () => {
    const review = await reviewOf(10);
    await rule({
      kind: 'SLAB',
      productId: 'cement',
      minQuantity: 5,
      valueType: 'RATE',
      value: 39000,
    }).expect(201);
    expect((await place(review.body.id)).body.error.code).toBe('PRICE_CHANGED');
  });
  it('an old order never changes when a rule or rate changes', async () => {
    const { body: slab } = await rule({
      kind: 'SLAB',
      productId: 'cement',
      minQuantity: 5,
      valueType: 'RATE',
      value: 39000,
    }).expect(201);
    const review = await reviewOf(10);
    const placed = await place(review.body.id).expect(201);
    await admin('papa', 'patch', `pricing/rules/${slab.id}`, {
      kind: 'SLAB',
      productId: 'cement',
      minQuantity: 5,
      valueType: 'RATE',
      value: 20000,
      expectedVersion: slab.version,
    }).expect(200);
    await admin('papa', 'post', 'rates/publish', {
      rates: [{ productId: 'cement', expectedVersion: await version(), pricePaise: 45000 }],
    }).expect(201);
    expect((await lineOf(placed.body.id)).pricePaise).toBe(39000);
  });
  it('very large quantities stay within what an order can hold', async () => {
    await db.product.update({
      where: { id: 'cement' },
      data: { pricePaise: 100_000_000, stock: 1000 },
    });
    const headers = as('customer');
    await request(server)
      .put('/api/v1/cart/items')
      .set(headers)
      .send({ productId: 'cement', quantity: 1000 })
      .expect(200);
    const { status, body } = await request(server)
      .post('/api/v1/checkout/review')
      .set(headers)
      .send({ addressId: 'site', deliveryDate: addDays(2), paymentMethod: 'COD', notes: '' });
    expect(status).toBe(409);
    expect(body.error.code).toBe('ORDER_TOO_LARGE');
  });
});

describe('a staff order', () => {
  it('uses the customer’s rate, and keeps which rule set it', async () => {
    await rule({
      kind: 'SPECIAL',
      customerId: 'customer',
      productId: 'cement',
      valueType: 'RATE',
      value: 37000,
      endsOn: addDays(9),
    }).expect(201);
    const { body, status } = await admin('papa', 'post', 'orders/phone', {
      customerPhone: '+919000000801',
      customerName: 'Ramesh',
      source: 'PHONE',
      paymentMethod: 'COD',
      deliveryDate: addDays(2),
      address: {
        label: 'Site',
        name: 'Ramesh',
        phone: '+919000000801',
        line1: 'Plot 12',
        area: 'Kankarbagh',
        city: 'Patna',
        state: 'Bihar',
        pincode: '800020',
        landmark: '',
      },
      items: [{ productId: 'cement', quantity: 10 }],
      idempotencyKey: randomUUID(),
    });
    expect(status, JSON.stringify(body)).toBe(201);
    expect(body.items[0]).toMatchObject({
      pricePaise: 37000,
      listPricePaise: 40000,
      ruleKind: 'SPECIAL',
    });
  });
});

describe('at confirm', () => {
  async function waiting(quantity = 10) {
    const review = await reviewOf(quantity);
    const placed = await place(review.body.id).expect(201);
    return db.order.findUniqueOrThrow({ where: { id: placed.body.id } });
  }
  const confirm = (who: string, id: string, version_: number, changes: object) =>
    admin(who, 'post', `orders/${id}/confirm`, {
      expectedVersion: version_,
      decisionKey: randomUUID(),
      changes,
    });
  it('a person’s own limit comes before the shop’s', async () => {
    const order = await waiting();
    const lines = [{ productId: 'cement', quantity: 10, pricePaise: 36000 }];
    expect((await confirm('manager', order.id, order.version, { lines })).body.error.code).toBe(
      'RATE_CAP',
    );
    await admin('papa', 'put', 'pricing/people/manager/rate-cap', { rateCapPercent: 15 }).expect(
      200,
    );
    await confirm('manager', order.id, order.version, { lines }).expect(201);
  });
  it('a lower limit for a person also holds', async () => {
    await db.location.update({ where: { id: MAIN }, data: { managerRateCapPercent: 20 } });
    await admin('papa', 'put', 'pricing/people/manager/rate-cap', { rateCapPercent: 0 }).expect(
      200,
    );
    const order = await waiting();
    const lines = [{ productId: 'cement', quantity: 10, pricePaise: 39900 }];
    expect((await confirm('manager', order.id, order.version, { lines })).body.error.code).toBe(
      'RATE_CAP',
    );
  });
  it('nobody sets their own limit, and a limit stays in range', async () => {
    await admin('papa', 'put', 'pricing/people/papa/rate-cap', { rateCapPercent: 50 }).expect(403);
    await admin('papa', 'put', 'pricing/people/manager/rate-cap', { rateCapPercent: 51 }).expect(
      400,
    );
    await admin('papa', 'put', 'pricing/people/manager/rate-cap', { rateCapPercent: -1 }).expect(
      400,
    );
    await admin('papa', 'put', 'pricing/people/customer/rate-cap', { rateCapPercent: 5 }).expect(
      404,
    );
  });
  it('a line changed by hand says who changed it and why', async () => {
    const order = await waiting();
    await confirm('manager', order.id, order.version, {
      lines: [{ productId: 'cement', quantity: 10, pricePaise: 39000 }],
      reason: 'REGULAR_CUSTOMER',
    }).expect(201);
    expect(await lineOf(order.id)).toMatchObject({
      pricePaise: 39000,
      listPricePaise: 40000,
      ruleKind: 'BY_HAND',
      rateChangedById: 'manager',
    });
    const log = await db.auditLog.findFirstOrThrow({
      where: { event: 'ORDER_CHANGED_AT_CONFIRM' },
    });
    expect(log.details).toMatchObject({ reason: 'REGULAR_CUSTOMER' });
  });
  it('a reason comes from the list, so no one’s words enter the permanent log', async () => {
    const order = await waiting();
    await confirm('papa', order.id, order.version, {
      lines: [{ productId: 'cement', quantity: 10, pricePaise: 39000 }],
      reason: 'Ramesh is my cousin',
    }).expect(400);
  });
  it('a new quantity crossing a slab gets the slab, even for someone with no right to change rates', async () => {
    await rule({
      kind: 'SLAB',
      productId: 'cement',
      minQuantity: 100,
      valueType: 'RATE',
      value: 30000,
    }).expect(201);
    const order = await waiting(10);
    await confirm('cashier', order.id, order.version, {
      lines: [{ productId: 'cement', quantity: 100 }],
    }).expect(201);
    expect(await lineOf(order.id)).toMatchObject({
      pricePaise: 30000,
      ruleKind: 'SLAB',
      rateChangedById: null,
    });
  });
  it('falling below a slab takes the rate back up', async () => {
    await rule({
      kind: 'SLAB',
      productId: 'cement',
      minQuantity: 10,
      valueType: 'RATE',
      value: 30000,
    }).expect(201);
    const order = await waiting(10);
    expect((await lineOf(order.id)).pricePaise).toBe(30000);
    await confirm('cashier', order.id, order.version, {
      lines: [{ productId: 'cement', quantity: 9 }],
    }).expect(201);
    expect((await lineOf(order.id)).pricePaise).toBe(40000);
  });
  it('a cashier cannot set a rate by hand', async () => {
    const order = await waiting();
    await confirm('cashier', order.id, order.version, {
      lines: [{ productId: 'cement', quantity: 10, pricePaise: 39000 }],
    }).expect(403);
  });
  it('undo puts back the exact rate and rule', async () => {
    const { body: slab } = await rule({
      kind: 'SLAB',
      productId: 'cement',
      minQuantity: 5,
      valueType: 'RATE',
      value: 39000,
    }).expect(201);
    const order = await waiting(10);
    const done = await confirm('manager', order.id, order.version, {
      lines: [{ productId: 'cement', quantity: 10, pricePaise: 38000 }],
    }).expect(201);
    expect((await lineOf(order.id)).ruleKind).toBe('BY_HAND');
    await admin('manager', 'post', `orders/${order.id}/undo-decision`, {
      expectedVersion: done.body.version,
    }).expect(201);
    expect(await lineOf(order.id)).toMatchObject({
      pricePaise: 39000,
      ruleKind: 'SLAB',
      ruleId: slab.id,
      rateChangedById: null,
    });
  });
});

describe('groups', () => {
  it('a name is taken once, and a person moves a customer, never the system', async () => {
    const { body: group } = await admin('papa', 'post', 'pricing/groups', {
      name: 'Regular',
    }).expect(201);
    const twin = await admin('papa', 'post', 'pricing/groups', { name: 'Regular' });
    expect(twin.status).toBe(409);
    expect(twin.body.error.code).toBe('GROUP_TAKEN');
    await admin('papa', 'put', 'pricing/customers/nope/group', { groupId: group.id }).expect(404);
    await admin('papa', 'put', 'pricing/customers/manager/group', { groupId: group.id }).expect(
      404,
    );
    await admin('papa', 'put', 'pricing/customers/customer/group', { groupId: 'nope' }).expect(404);
    await admin('papa', 'patch', `pricing/groups/${group.id}`, {
      name: 'Regular',
      active: false,
    }).expect(200);
    await admin('papa', 'put', 'pricing/customers/customer/group', { groupId: group.id }).expect(
      404,
    );
  });
  it('suggests regulars and moves nobody', async () => {
    for (let i = 0; i < 3; i++) {
      const review = await reviewOf(1);
      await place(review.body.id).expect(201);
    }
    const { body } = await admin('papa', 'get', 'pricing/suggestions').expect(200);
    expect(body[0]).toMatchObject({ customerId: 'customer', orders: 3 });
    expect(
      (await db.user.findUniqueOrThrow({ where: { id: 'customer' } })).customerGroupId,
    ).toBeNull();
  });
});

describe('bhada', () => {
  it('rates by area and vehicle, and a card suggests them from its own area', async () => {
    const save = (feePaise: number, vehicle = 'Tractor') =>
      admin('papa', 'put', 'pricing/delivery-rates', { zoneId: 'zone', vehicle, feePaise });
    await save(50000).expect(200);
    await save(80000).expect(200);
    await save(120000, 'Truck').expect(200);
    expect(await db.deliveryRate.count()).toBe(2);
    await admin('papa', 'put', 'pricing/delivery-rates', {
      zoneId: 'nope',
      vehicle: 'X',
      feePaise: 1,
    }).expect(404);
    await save(-1).expect(400);
    for (const who of ['manager', 'cashier', 'keeper'])
      await admin(who, 'put', 'pricing/delivery-rates', {
        zoneId: 'zone',
        vehicle: 'X',
        feePaise: 1,
      }).expect(403);
    const review = await reviewOf(1);
    const placed = await place(review.body.id).expect(201);
    const { body } = await admin('cashier', 'get', `inbox/${placed.body.id}/bhada`).expect(200);
    expect(body.items).toEqual([
      { vehicle: 'Tractor', feePaise: 80000 },
      { vehicle: 'Truck', feePaise: 120000 },
    ]);
    await admin('keeper', 'get', `inbox/${placed.body.id}/bhada`).expect(403);
  });
});

describe('what customers and the public see', () => {
  it('a customer’s own rates, and nobody else’s', async () => {
    await rule({
      kind: 'SPECIAL',
      customerId: 'customer',
      productId: 'cement',
      valueType: 'RATE',
      value: 37000,
      endsOn: addDays(9),
    }).expect(201);
    const mine = await request(server).get('/api/v1/me/rates').set(as('customer')).expect(200);
    expect(mine.body.find((row: { productId: string }) => row.productId === 'cement')).toEqual({
      productId: 'cement',
      listPaise: 40000,
      yourPaise: 37000,
    });
    const theirs = await request(server).get('/api/v1/me/rates').set(as('other')).expect(200);
    expect(
      theirs.body.find((row: { productId: string }) => row.productId === 'cement').yourPaise,
    ).toBe(40000);
    await request(server).get('/api/v1/me/rates').expect(401);
  });
  it('only offers an owner chose to show, in date, and nothing about anyone', async () => {
    await rule({
      kind: 'OFFER',
      title: 'Diwali',
      productId: 'cement',
      valueType: 'RATE',
      value: 39000,
      startsOn: addDays(0),
      endsOn: addDays(5),
      isPublic: true,
    }).expect(201);
    await rule({
      kind: 'OFFER',
      title: 'Hidden',
      productId: 'acc',
      valueType: 'RATE',
      value: 39000,
      startsOn: addDays(0),
      endsOn: addDays(5),
    }).expect(201);
    await rule({
      kind: 'OFFER',
      title: 'Later',
      productId: 'acc',
      valueType: 'RATE',
      value: 39000,
      startsOn: addDays(1),
      endsOn: addDays(5),
      isPublic: true,
    }).expect(201);
    await rule({
      kind: 'SPECIAL',
      title: 'Secret',
      customerId: 'customer',
      productId: 'cement',
      valueType: 'RATE',
      value: 1000,
      endsOn: addDays(5),
    }).expect(201);
    const { body } = await request(server).get('/api/v1/public/offers').expect(200);
    expect(body.items.map((row: { title: string }) => row.title)).toEqual(['Diwali']);
    expect(JSON.stringify(body)).not.toMatch(/customer|Secret|createdBy/i);
  });
});

describe('no way around the rate limit', () => {
  const sell = (who: string, unitPricePaise: number, rest: object = {}) =>
    admin(who, 'post', 'products/cement/movements', {
      kind: 'WALK_IN_SALE',
      quantity: 1,
      note: 'Counter',
      reference: '',
      locationId: MAIN,
      unitPricePaise,
      channel: 'CASH',
      idempotencyKey: randomUUID(),
      ...rest,
    });
  it('a counter sale cannot go below what the manager may give', async () => {
    const low = await sell('manager', 1).expect(403);
    expect(low.body.error).toMatchObject({
      code: 'RATE_CAP',
      details: { floorPaise: 38000, capPercent: 5 },
    });
    expect(await db.financialMovement.count()).toBe(0);
    expect((await db.product.findUniqueOrThrow({ where: { id: 'cement' } })).stock).toBe(1000);
  });
  it('a counter sale at the limit goes through', async () => {
    await sell('manager', 38000).expect(201);
    const [row] = await db.financialMovement.findMany({ where: { kind: 'COUNTER_SALE' } });
    expect(row!.amountPaise).toBe(38000);
  });
  it('a counter sale above the list needs an owner', async () => {
    expect((await sell('manager', 40001).expect(403)).body.error.code).toBe('RATE_ABOVE_LIST');
    await sell('papa', 40001).expect(201);
  });
  it('a person’s own limit counts there too', async () => {
    await admin('papa', 'put', 'pricing/people/manager/rate-cap', { rateCapPercent: 1 }).expect(
      200,
    );
    await sell('manager', 38000).expect(403);
    await sell('manager', 39600).expect(201);
  });
  it('owners have no limit', async () => {
    await sell('papa', 100).expect(201);
  });
  it('someone with no right to agree a price is refused before any of this', async () => {
    await sell('cashier', 39000).expect(403);
  });
  it('the replay of a sale is still answered as that sale', async () => {
    const key = randomUUID();
    await sell('manager', 38000, { idempotencyKey: key }).expect(201);
    await sell('manager', 38000, { idempotencyKey: key }).expect(201);
    expect(await db.financialMovement.count()).toBe(1);
  });

  async function askedQuote() {
    const quote = await request(server)
      .post('/api/v1/quotes')
      .set(as('customer'))
      .send({
        items: [{ productId: 'cement', quantity: 50 }],
        addressId: 'site',
        deliveryDate: addDays(2),
      })
      .expect(201);
    return quote.body.id as string;
  }
  const offer = (who: string, id: string, unitPricePaise: number) =>
    admin(who, 'post', `quotes/${id}/offer`, {
      expectedRevision: 0,
      items: [{ productId: 'cement', unitPricePaise }],
      deliveryFeePaise: 0,
      deliveryConfirmed: true,
      validUntil: new Date(Date.now() + 86400000).toISOString(),
    });
  it('a quote cannot go below the limit, or above the list', async () => {
    const id = await askedQuote();
    expect((await offer('manager', id, 100).expect(403)).body.error.code).toBe('RATE_CAP');
    expect((await offer('manager', id, 50000).expect(403)).body.error.code).toBe('RATE_ABOVE_LIST');
    await offer('manager', id, 38000).expect(201);
  });
  it('an order made from a quote remembers who gave the rate', async () => {
    const id = await askedQuote();
    await offer('manager', id, 38000).expect(201);
    await request(server)
      .post(`/api/v1/quotes/${id}/respond`)
      .set(as('customer'))
      .send({ revision: 1, status: 'ACCEPTED' })
      .expect(201);
    const { body } = await admin('papa', 'post', `quotes/${id}/convert`, {
      revision: 1,
      deliveryDate: addDays(2),
    });
    expect(body.id).toBeTruthy();
    expect(await lineOf(body.id)).toMatchObject({
      pricePaise: 38000,
      listPricePaise: 40000,
      ruleKind: 'BY_HAND',
      rateChangedById: 'manager',
    });
  });
  it('at confirm, a rate above the list needs an owner too', async () => {
    const review = await reviewOf(10);
    const placed = await place(review.body.id).expect(201);
    const order = await db.order.findUniqueOrThrow({ where: { id: placed.body.id } });
    const confirm = (who: string, pricePaise: number) =>
      admin(who, 'post', `orders/${order.id}/confirm`, {
        expectedVersion: order.version,
        decisionKey: randomUUID(),
        changes: { lines: [{ productId: 'cement', quantity: 10, pricePaise }] },
      });
    expect((await confirm('manager', 400000).expect(403)).body.error.code).toBe('RATE_CAP');
    await confirm('papa', 400000).expect(201);
  });
  it('a rate may still follow the list up, when today’s list passed the order’s own', async () => {
    const review = await reviewOf(10);
    const placed = await place(review.body.id).expect(201);
    const order = await db.order.findUniqueOrThrow({ where: { id: placed.body.id } });
    await db.product.update({ where: { id: 'cement' }, data: { pricePaise: 42000 } });
    await admin('manager', 'post', `orders/${order.id}/confirm`, {
      expectedVersion: order.version,
      decisionKey: randomUUID(),
      changes: { lines: [{ productId: 'cement', quantity: 10, pricePaise: 42000 }] },
    }).expect(201);
  });
  it('the card shows a person’s own limit, not the shop’s', async () => {
    await admin('papa', 'put', 'pricing/people/manager/rate-cap', { rateCapPercent: 2 }).expect(
      200,
    );
    const review = await reviewOf(10);
    await place(review.body.id).expect(201);
    const cap = async (who: string) =>
      (await admin(who, 'get', 'inbox').expect(200)).body.items[0].rateCapPercent;
    expect(await cap('manager')).toBe(2);
    expect(await cap('papa')).toBeNull();
  });
});

describe('an owner reads a rate request before a yes', () => {
  it('sees each item with from and to, and a slipped digit is called out', async () => {
    const { body } = await admin('manager', 'post', 'rates/ask', {
      rates: [
        { productId: 'cement', pricePaise: 400, expectedVersion: await version('cement') },
        { productId: 'acc', pricePaise: 36000, expectedVersion: await version('acc') },
      ],
      idempotencyKey: randomUUID(),
    }).expect(201);
    const list = await admin('papa', 'get', 'approvals').expect(200);
    const row = list.body.items.find((item: { id: string }) => item.id === body.id);
    expect(row.detail.rates).toEqual([
      expect.objectContaining({
        name: expect.any(String),
        fromPaise: 40000,
        toPaise: 400,
        big: true,
        stale: false,
      }),
      expect.objectContaining({ toPaise: 36000, big: false }),
    ]);
  });
  it('sees when a rate moved after it was asked', async () => {
    const { body } = await admin('manager', 'post', 'rates/ask', {
      rates: [{ productId: 'cement', pricePaise: 39000, expectedVersion: await version('cement') }],
      idempotencyKey: randomUUID(),
    }).expect(201);
    await admin('papa', 'post', 'rates/publish', {
      rates: [{ productId: 'cement', pricePaise: 39500, expectedVersion: await version('cement') }],
    }).expect(201);
    const list = await admin('papa', 'get', 'approvals').expect(200);
    const row = list.body.items.find((item: { id: string }) => item.id === body.id);
    expect(row.detail.rates[0].stale).toBe(true);
    await admin('chacha', 'post', `approvals/${body.id}/decide`, { decision: 'APPROVE' }).expect(
      409,
    );
  });
  it('open screens hear at once when a yes changes a rate', async () => {
    const seen = vi.spyOn(app.get(Events), 'publish');
    const { body } = await admin('manager', 'post', 'rates/ask', {
      rates: [{ productId: 'cement', pricePaise: 39000, expectedVersion: await version('cement') }],
      idempotencyKey: randomUUID(),
    }).expect(201);
    seen.mockClear();
    await admin('papa', 'post', `approvals/${body.id}/decide`, { decision: 'APPROVE' }).expect(201);
    expect(seen).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'PRODUCT_PRICE_UPDATED', productId: 'cement' }),
    );
    seen.mockRestore();
  });
  it('the person who asked sees that it waits, and not the rates', async () => {
    const { body } = await admin('manager', 'post', 'rates/ask', {
      rates: [{ productId: 'cement', pricePaise: 39000, expectedVersion: await version('cement') }],
      idempotencyKey: randomUUID(),
    }).expect(201);
    const list = await admin('manager', 'get', 'approvals').expect(200);
    expect(list.body.items.find((item: { id: string }) => item.id === body.id).detail).toBeNull();
  });
});

describe('rules that would make goods nearly free', () => {
  it('more off than an item costs is refused on saving, naming the item', async () => {
    const big = await rule({
      kind: 'OFFER',
      categoryId: 'cat',
      valueType: 'AMOUNT_OFF',
      value: 40000,
      startsOn: addDays(0),
      endsOn: addDays(5),
    }).expect(400);
    expect(big.body.error).toMatchObject({ code: 'RULE_TOO_BIG' });
    await rule({
      kind: 'OFFER',
      categoryId: 'cat',
      valueType: 'AMOUNT_OFF',
      value: 100,
      startsOn: addDays(0),
      endsOn: addDays(5),
    }).expect(201);
  });
  it('one that slipped in, or an item later made cheaper, leaves the rate alone', async () => {
    await rule({
      kind: 'OFFER',
      productId: 'cement',
      valueType: 'AMOUNT_OFF',
      value: 30000,
      startsOn: addDays(0),
      endsOn: addDays(5),
    }).expect(201);
    await db.product.update({ where: { id: 'cement' }, data: { pricePaise: 25000 } });
    expect((await reviewOf(1)).body.items[0].pricePaise).toBe(25000);
  });
});

describe('a group switched off', () => {
  it('takes its rates with it', async () => {
    const { body: group } = await admin('papa', 'post', 'pricing/groups', {
      name: 'Thekedar',
    }).expect(201);
    await rule({
      kind: 'GROUP',
      groupId: group.id,
      categoryId: 'cat',
      valueType: 'PERCENT_OFF',
      value: 500,
    }).expect(201);
    await admin('papa', 'put', 'pricing/customers/customer/group', { groupId: group.id }).expect(
      200,
    );
    expect((await reviewOf(1)).body.items[0].pricePaise).toBe(38000);
    await db.customerGroup.update({ where: { id: group.id }, data: { active: false } });
    expect((await reviewOf(1)).body.items[0].pricePaise).toBe(40000);
  });
});

describe('ordering the same again', () => {
  it('does not say a price changed because the customer had a special rate', async () => {
    await rule({
      kind: 'SPECIAL',
      customerId: 'customer',
      productId: 'cement',
      valueType: 'RATE',
      value: 36000,
      endsOn: addDays(30),
    }).expect(201);
    const review = await reviewOf(10);
    const placed = await place(review.body.id).expect(201);
    const again = await request(server)
      .post(`/api/v1/orders/${placed.body.id}/reorder`)
      .set(as('customer'))
      .send({ idempotencyKey: randomUUID() })
      .expect(201);
    expect(JSON.stringify(again.body.notices ?? [])).not.toContain('price');
  });
  it('does say so when the list really moved', async () => {
    const review = await reviewOf(10);
    const placed = await place(review.body.id).expect(201);
    await db.product.update({ where: { id: 'cement' }, data: { pricePaise: 41000 } });
    const again = await request(server)
      .post(`/api/v1/orders/${placed.body.id}/reorder`)
      .set(as('customer'))
      .send({ idempotencyKey: randomUUID() })
      .expect(201);
    expect(JSON.stringify(again.body.notices)).toContain('price');
  });
});
