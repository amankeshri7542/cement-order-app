import 'reflect-metadata';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import type { Server } from 'node:http';
import { loadEnvFile } from 'node:process';
import type { INestApplication } from '@nestjs/common';
import { istToday } from '@shiv/shared';
import request from 'supertest';
import { Db } from '../src/db';
import { addPerson, tokenFor } from './staff-helper';

if (existsSync('.env.test')) loadEnvFile('.env.test');
process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
process.env.OTP_PROVIDER = 'mock';
process.env.OTP_HASH_SECRET = 'customer-app-test-only-secret-not-for-production';
process.env.CORS_ORIGINS = 'http://localhost:3000';
if (!process.env.DATABASE_URL || !new URL(process.env.DATABASE_URL).pathname.endsWith('_test'))
  throw new Error('These tests require a dedicated TEST_DATABASE_URL ending in _test.');

let app: INestApplication;
let server: Server;
let db: Db;
const as = (id: string) => ({ Authorization: `Bearer ${tokenFor(id)}` });
const tomorrow = () =>
  new Date(Date.parse(`${istToday()}T00:00:00Z`) + 86400000).toISOString().slice(0, 10);
const stockOf = async (id: string) => (await db.product.findUniqueOrThrow({ where: { id } })).stock;

type Line = { productId: string; quantity: number; seenPricePaise?: number };
function review(lines: Line[], extra: object = {}, who = 'customer', addressId = 'site') {
  return request(server)
    .post('/api/v1/checkout/review')
    .set(as(who))
    .send({
      addressId,
      deliveryDate: tomorrow(),
      paymentMethod: 'COD',
      notes: '',
      lines,
      ...extra,
    });
}
const place = (reviewId: string, idempotencyKey: string = randomUUID(), who = 'customer') =>
  request(server).post('/api/v1/orders').set(as(who)).send({ reviewId, idempotencyKey });

/** A special rate for one customer, made the way an owner makes it. */
async function specialRate() {
  const { body } = await request(server)
    .post('/api/v1/admin/pricing/rules')
    .set(as('papa'))
    .send({
      kind: 'SPECIAL',
      customerId: 'customer',
      productId: 'cement',
      valueType: 'AMOUNT_OFF',
      value: 2000,
      endsOn: tomorrow(),
    })
    .expect(201);
  return body as { id: string };
}
/** Places one order at the current rates and returns it. */
async function firstOrder(lines: Line[] = [{ productId: 'cement', quantity: 10 }]) {
  const { body } = await review(lines).expect(201);
  return (await place(body.id).expect(201)).body;
}

beforeAll(async () => {
  const { createApp } = await import('../src/app');
  app = await createApp();
  await app.listen(0, '127.0.0.1');
  server = app.getHttpServer();
  db = app.get(Db);
}, 30000);
beforeEach(async () => {
  await db.$executeRawUnsafe(
    'TRUNCATE TABLE "PriceRule", "CustomerGroup", "User", "Category", "Product", "DeliveryZone", "StoreSettings", "AuditLog", "AuthRateLimit" RESTART IDENTITY CASCADE',
  );
  await addPerson(db, { id: 'papa', role: 'OWNER', phone: '+919000000910' });
  await addPerson(db, { id: 'customer', phone: '+919000000901' });
  await addPerson(db, { id: 'other', phone: '+919000000902' });
  await db.category.create({ data: { id: 'cat', name: 'Cement', slug: 'cement' } });
  for (const [id, pricePaise, quantityStep] of [
    ['cement', 40000, 1],
    ['acc', 44500, 1],
    ['stepped', 50000, 5],
  ] as const)
    await db.product.create({
      data: {
        id,
        name: `Name of ${id}`,
        brand: 'Test',
        categoryId: 'cat',
        type: 'PPC',
        grade: 'PPC',
        unit: 'bag',
        pricePaise,
        stock: 73,
        minQuantity: quantityStep,
        quantityStep,
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
      pincodes: { create: [{ pincode: '800020', area: 'Kankarbagh' }, { pincode: '800001' }] },
    },
  });
  await db.storeSettings.create({ data: { id: 'store', phone: '+919999999000' } });
  const site = {
    label: 'Site',
    name: 'Ramesh',
    phone: '+919000000901',
    line1: 'Plot 12',
    area: 'Kankarbagh',
    city: 'Patna',
    state: 'Bihar',
    pincode: '800020',
    landmark: '',
  };
  await db.address.create({ data: { id: 'site', userId: 'customer', ...site } });
  await db.address.create({ data: { id: 'second', userId: 'customer', ...site, label: 'Two' } });
  await db.address.create({ data: { id: 'theirs', userId: 'other', ...site, name: 'Other Name' } });
});
afterAll(async () => {
  await app?.close();
});

describe('a review from the list on the phone', () => {
  it('prices what was sent and never reads or empties the server cart', async () => {
    await db.cartItem.create({
      data: {
        userId: 'customer',
        productId: 'acc',
        quantity: 3,
        seenPricePaise: 44500,
        seenPriceVersion: 1,
      },
    });
    const { body } = await review([{ productId: 'cement', quantity: 10 }]).expect(201);
    expect(body.items).toHaveLength(1);
    expect(body.items[0]).toMatchObject({ productId: 'cement', pricePaise: 40000 });
    expect(body.subtotalPaise).toBe(400000);
    expect(body.deliveryFeePaise).toBe(50000);
    expect(body.totalPaise).toBe(450000);
    expect(body.fromLines).toBe(true);
    const order = (await place(body.id).expect(201)).body;
    expect(order.items.map((item: Line) => item.productId)).toEqual(['cement']);
    expect(order.status).toBe('AWAITING_CONFIRMATION');
    expect(await db.cartItem.count({ where: { userId: 'customer' } })).toBe(1);
    expect(await stockOf('cement')).toBe(63);
  });

  it('still works the old way with no lines, and the cart still goes on placing', async () => {
    await request(server)
      .put('/api/v1/cart/items')
      .set(as('customer'))
      .send({ productId: 'cement', quantity: 2 })
      .expect(200);
    const { body } = await request(server)
      .post('/api/v1/checkout/review')
      .set(as('customer'))
      .send({ addressId: 'site', deliveryDate: tomorrow(), paymentMethod: 'COD', notes: '' })
      .expect(201);
    expect(body.fromLines).toBeUndefined();
    await place(body.id).expect(201);
    expect(await db.cartItem.count({ where: { userId: 'customer' } })).toBe(0);
  });

  it('refuses a review with nothing and no cart', async () => {
    await request(server)
      .post('/api/v1/checkout/review')
      .set(as('customer'))
      .send({ addressId: 'site', deliveryDate: tomorrow(), paymentMethod: 'COD', notes: '' })
      .expect(400);
  });

  it('needs a sign-in, and a staff number cannot order', async () => {
    await request(server)
      .post('/api/v1/checkout/review')
      .send({ addressId: 'site', deliveryDate: tomorrow(), paymentMethod: 'COD', notes: '' })
      .expect(401);
    await db.address.create({
      data: {
        id: 'papas',
        userId: 'papa',
        label: 'Site',
        name: 'Papa',
        phone: '+919000000910',
        line1: 'x',
        area: 'x',
        city: 'Patna',
        pincode: '800020',
      },
    });
    const refused = await review([{ productId: 'cement', quantity: 1 }], {}, 'papa', 'papas');
    expect(refused.status).toBe(403);
    expect(refused.body.error.code).toBe('STAFF_ACCOUNT');
  });

  it.each([
    ['too many lines', Array.from({ length: 51 }, (_, i) => ({ productId: `p${i}`, quantity: 1 }))],
    [
      'the same product twice',
      [
        { productId: 'cement', quantity: 1 },
        { productId: 'cement', quantity: 2 },
      ],
    ],
    ['no lines', []],
    ['quantity 0', [{ productId: 'cement', quantity: 0 }]],
    ['negative quantity', [{ productId: 'cement', quantity: -5 }]],
    ['part of a bag', [{ productId: 'cement', quantity: 1.5 }]],
    ['too large a quantity', [{ productId: 'cement', quantity: 10001 }]],
    ['a price from the phone', [{ productId: 'cement', quantity: 1, pricePaise: 1 }]],
    ['a list rate from the phone', [{ productId: 'cement', quantity: 1, listPricePaise: 1 }]],
    ['a negative seen rate', [{ productId: 'cement', quantity: 1, seenPricePaise: -1 }]],
    ['a text seen rate', [{ productId: 'cement', quantity: 1, seenPricePaise: '1' }]],
    ['an empty product id', [{ productId: '', quantity: 1 }]],
  ])('refuses %s', async (_name, lines) => {
    await review(lines as Line[]).expect(400);
    expect(await db.checkoutReview.count()).toBe(0);
  });

  it('refuses a repeat with no lines, and a total, price or status sent by the phone', async () => {
    const base = { addressId: 'site', deliveryDate: tomorrow(), paymentMethod: 'COD', notes: '' };
    const send = (body: object) =>
      request(server).post('/api/v1/checkout/review').set(as('customer')).send(body);
    await send({ ...base, repeatOfOrderId: 'x' }).expect(400);
    const lines = [{ productId: 'cement', quantity: 1 }];
    await send({ ...base, lines, totalPaise: 1 }).expect(400);
    await send({ ...base, lines, fromLines: false }).expect(400);
    await send({ ...base, lines, deliveryFeePaise: 0 }).expect(400);
    await send({ ...base, lines, userId: 'other' }).expect(400);
  });
});

describe('the review budget', () => {
  it('an hour of stepping is plenty, and the refusal past it places nothing', async () => {
    const line = (quantity: number) => [{ productId: 'cement', quantity }];
    for (let i = 1; i <= 60; i++) await review(line(1 + (i % 5))).expect(201);
    const refused = await review(line(1));
    expect(refused.status).toBe(429);
    expect(refused.body.error.code).toBe('RESOURCE_LIMIT');
    expect(await db.order.count()).toBe(0);
    // Someone else is not held back by it.
    const theirs = await review(line(1), {}, 'other', 'theirs');
    expect(theirs.status).toBe(201);
  }, 60000);
});

describe('tampering', () => {
  it('a false seenPricePaise changes only the words, never the price', async () => {
    const low = await review([{ productId: 'cement', quantity: 10, seenPricePaise: 1 }]).expect(
      201,
    );
    expect(low.body.items[0].pricePaise).toBe(40000);
    expect(low.body.totalPaise).toBe(450000);
    expect(low.body.changes).toEqual([
      expect.objectContaining({ productId: 'cement', oldPricePaise: 1, newPricePaise: 40000 }),
    ]);
    const order = (await place(low.body.id).expect(201)).body;
    expect(order.items[0].pricePaise).toBe(40000);
    expect(order.totalPaise).toBe(450000);
    const same = await review([{ productId: 'acc', quantity: 1, seenPricePaise: 44500 }]);
    expect(same.body.changes).toEqual([]);
  });

  it("someone else's repeatOfOrderId reads exactly like a missing one", async () => {
    const placed = await review([{ productId: 'acc', quantity: 1 }], {}, 'other', 'theirs').expect(
      201,
    );
    const theirs = (await place(placed.body.id, randomUUID(), 'other').expect(201)).body;
    const lines = [{ productId: 'cement', quantity: 10 }];
    const stolen = await review(lines, { repeatOfOrderId: theirs.id });
    const missing = await review(lines, { repeatOfOrderId: 'no_such_order' });
    expect(stolen.status).toBe(404);
    expect(missing.status).toBe(404);
    expect(stolen.body.error.code).toBe('ORDER_NOT_FOUND');
    expect(stolen.body.error.message).toBe(missing.body.error.message);
    expect(JSON.stringify(stolen.body)).not.toContain('Name of acc');
    expect(await db.order.count({ where: { userId: 'customer' } })).toBe(0);
  });

  it("someone else's address is refused and shows nothing of it", async () => {
    const { status, body } = await review(
      [{ productId: 'cement', quantity: 1 }],
      {},
      'customer',
      'theirs',
    );
    expect(status).toBe(400);
    expect(body.error.code).toBe('INVALID_ADDRESS');
    expect(JSON.stringify(body)).not.toContain('Other Name');
  });

  it("someone else's review cannot be placed, and shows nothing of it", async () => {
    const { body } = await review([{ productId: 'cement', quantity: 1 }]).expect(201);
    const refused = await place(body.id, randomUUID(), 'other');
    expect(refused.status).toBe(409);
    expect(refused.body.error.code).toBe('REVIEW_EXPIRED');
    expect(await db.order.count()).toBe(0);
  });

  it('a special rate reaches its customer alone', async () => {
    await specialRate();
    const mine = await review([{ productId: 'cement', quantity: 2 }]).expect(201);
    expect(mine.body.items[0].pricePaise).toBe(38000);
    // The rule behind the rate stays on the server.
    expect(mine.body.items[0].ruleId).toBeUndefined();
    expect(mine.body.items[0].listPricePaise).toBeUndefined();
    const theirs = await review([{ productId: 'cement', quantity: 2 }], {}, 'other', 'theirs');
    expect(theirs.status).toBe(201);
    expect(theirs.body.items[0].pricePaise).toBe(40000);
  });
});

describe('Order again', () => {
  it('records which order it repeats, and leaves that order alone', async () => {
    const earlier = await firstOrder();
    const { body } = await review([{ productId: 'cement', quantity: 10 }], {
      repeatOfOrderId: earlier.id,
    }).expect(201);
    expect(body.repeatOfOrderId).toBe(earlier.id);
    const again = (await place(body.id).expect(201)).body;
    expect(again.repeatOfOrderId).toBe(earlier.id);
    expect(again.id).not.toBe(earlier.id);
    const old = await db.order.findUniqueOrThrow({ where: { id: earlier.id } });
    expect(old.status).toBe('AWAITING_CONFIRMATION');
  });

  it('says a rate moved, list to list, and the total on the button is the new one', async () => {
    const earlier = await firstOrder();
    await db.product.update({
      where: { id: 'cement' },
      data: { pricePaise: 41000, priceVersion: { increment: 1 } },
    });
    const { body } = await review([{ productId: 'cement', quantity: 10 }], {
      repeatOfOrderId: earlier.id,
    }).expect(201);
    expect(body.changes).toEqual([
      expect.objectContaining({ oldPricePaise: 40000, newPricePaise: 41000 }),
    ]);
    expect(body.totalPaise).toBe(460000);
  });

  it('an agreed rate on the old order shows no false jump', async () => {
    const special = await specialRate();
    const earlier = await firstOrder();
    expect(earlier.items[0].pricePaise).toBe(38000);
    await db.priceRule.update({
      where: { id: special.id },
      data: { endsOn: istToday(), startsOn: istToday(), active: false },
    });
    const { body } = await review([{ productId: 'cement', quantity: 10 }], {
      repeatOfOrderId: earlier.id,
    }).expect(201);
    expect(body.changes).toEqual([]);
    expect(body.items[0].pricePaise).toBe(40000);
  });

  it('a line added to a repeat falls back to what the phone showed', async () => {
    const earlier = await firstOrder();
    const { body } = await review(
      [
        { productId: 'cement', quantity: 10 },
        { productId: 'acc', quantity: 1, seenPricePaise: 44000 },
      ],
      { repeatOfOrderId: earlier.id },
    ).expect(201);
    expect(body.changes).toEqual([
      expect.objectContaining({ productId: 'acc', oldPricePaise: 44000, newPricePaise: 44500 }),
    ]);
  });
});

describe('lines that cannot be sold', () => {
  it('leaves them out of the total with a word, and places the rest', async () => {
    await db.product.update({ where: { id: 'acc' }, data: { active: false } });
    const { body } = await review([
      { productId: 'cement', quantity: 2 },
      { productId: 'acc', quantity: 1 },
      { productId: 'gone_from_the_shop', quantity: 1 },
    ]).expect(201);
    expect(body.items.map((item: Line) => item.productId)).toEqual(['cement']);
    expect(body.subtotalPaise).toBe(80000);
    expect(body.unavailable).toEqual(
      expect.arrayContaining([
        { productId: 'acc', reason: 'NOT_SOLD' },
        { productId: 'gone_from_the_shop', reason: 'NOT_SOLD' },
      ]),
    );
    expect(JSON.stringify(body)).not.toContain('Name of acc');
    const order = (await place(body.id).expect(201)).body;
    expect(order.items).toHaveLength(1);
  });

  it('a short count never says how much the shop holds', async () => {
    const { body } = await review([
      { productId: 'cement', quantity: 74 },
      { productId: 'acc', quantity: 1 },
    ]).expect(201);
    expect(body.unavailable).toEqual([{ productId: 'cement', reason: 'ASK_SHOP' }]);
    expect(JSON.stringify(body.unavailable)).not.toContain('73');
    expect(body.items[0].stock).toBeUndefined();
  });

  it('an item with no public rate is not priced through a review', async () => {
    await db.product.update({ where: { id: 'acc' }, data: { sourcing: 'ON_REQUEST' } });
    const { body } = await review([
      { productId: 'cement', quantity: 1 },
      { productId: 'acc', quantity: 1 },
    ]).expect(201);
    expect(body.unavailable).toEqual([{ productId: 'acc', reason: 'ASK_SHOP' }]);
    expect(JSON.stringify(body)).not.toContain('44500');
  });

  it('a broken pack rule says what the rule is', async () => {
    const { body } = await review([
      { productId: 'stepped', quantity: 7 },
      { productId: 'acc', quantity: 1 },
    ]).expect(201);
    expect(body.unavailable).toEqual([
      { productId: 'stepped', reason: 'QUANTITY', minQuantity: 5, quantityStep: 5 },
    ]);
  });

  it('with every line gone it asks the customer to ask the shop, and saves no review', async () => {
    const { status, body } = await review([{ productId: 'cement', quantity: 74 }]);
    expect(status).toBe(409);
    expect(body.error.code).toBe('OUT_OF_STOCK');
    expect(body.error.details.unavailable).toEqual([{ productId: 'cement', reason: 'ASK_SHOP' }]);
    expect(await db.checkoutReview.count()).toBe(0);
  });

  it('a pincode the shop does not serve is refused plainly', async () => {
    await db.address.update({ where: { id: 'site' }, data: { pincode: '110001' } });
    const { status, body } = await review([{ productId: 'cement', quantity: 1 }]);
    expect(status).toBe(409);
    expect(body.error.code).toBe('NOT_SERVICEABLE');
  });
});

describe('exactly once', () => {
  it('sending Place again after a lost reply returns the same order', async () => {
    const { body } = await review([{ productId: 'cement', quantity: 10 }]).expect(201);
    const key = randomUUID();
    const first = await place(body.id, key).expect(201);
    const again = await place(body.id, key).expect(201);
    expect(again.body.id).toBe(first.body.id);
    expect(await db.order.count({ where: { userId: 'customer' } })).toBe(1);
    expect(await stockOf('cement')).toBe(63);
  });

  it('a second key on the same review still returns the one order', async () => {
    const { body } = await review([{ productId: 'cement', quantity: 10 }]).expect(201);
    const first = await place(body.id).expect(201);
    const second = await place(body.id).expect(201);
    expect(second.body.id).toBe(first.body.id);
    expect(await db.order.count()).toBe(1);
  });

  it('two taps racing make one order and move stock once', async () => {
    const { body } = await review([{ productId: 'cement', quantity: 10 }]).expect(201);
    const key = randomUUID();
    const results = await Promise.all([
      place(body.id, key),
      place(body.id, key),
      place(body.id, key),
    ]);
    expect(new Set(results.map((result) => result.body.id)).size).toBe(1);
    expect(await db.order.count()).toBe(1);
    expect(await stockOf('cement')).toBe(63);
  });

  it('a key used for another review is refused', async () => {
    const one = await review([{ productId: 'cement', quantity: 1 }]).expect(201);
    const two = await review([{ productId: 'acc', quantity: 1 }]).expect(201);
    const key = randomUUID();
    await place(one.body.id, key).expect(201);
    const refused = await place(two.body.id, key);
    expect(refused.status).toBe(409);
    expect(refused.body.error.code).toBe('IDEMPOTENCY_CONFLICT');
  });

  it('a rate change after the review refuses the order until it is seen', async () => {
    const { body } = await review([{ productId: 'cement', quantity: 10 }]).expect(201);
    await db.product.update({
      where: { id: 'cement' },
      data: { pricePaise: 42000, priceVersion: { increment: 1 } },
    });
    const refused = await place(body.id);
    expect(refused.status).toBe(409);
    expect(refused.body.error.code).toBe('PRICE_CHANGED');
    expect(await db.order.count()).toBe(0);
    expect(await stockOf('cement')).toBe(73);
    const fresh = await review([{ productId: 'cement', quantity: 10 }]).expect(201);
    expect(fresh.body.totalPaise).toBe(470000);
  });

  it('an old review is refused, and stock going short after the review is refused', async () => {
    const old = await review([{ productId: 'cement', quantity: 10 }]).expect(201);
    await db.checkoutReview.update({
      where: { id: old.body.id },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });
    const expired = await place(old.body.id);
    expect(expired.body.error.code).toBe('REVIEW_EXPIRED');
    const fresh = await review([{ productId: 'cement', quantity: 10 }]).expect(201);
    await db.product.update({ where: { id: 'cement' }, data: { stock: 5 } });
    const short = await place(fresh.body.id);
    // Either refusal is a plain word to the customer. What matters is that no order is made.
    expect(['OUT_OF_STOCK', 'DEMAND_REVIEW_REQUIRED']).toContain(short.body.error.code);
    expect(await db.order.count()).toBe(0);
  });
});

describe('sites', () => {
  const site = {
    label: 'Kankarbagh site',
    name: 'Ramesh',
    phone: '+919000000901',
    line1: 'Plot 5',
    area: 'Kankarbagh',
    city: 'Patna',
    state: 'Bihar',
    pincode: '800020',
    landmark: 'Near the tank',
  };
  const save = (body: object, who = 'customer') =>
    request(server).post('/api/v1/me/addresses').set(as(who)).send(body);

  it('keeps a pin, and null clears it', async () => {
    const { body } = await save({ ...site, lat: 25.5941, lng: 85.1376 }).expect(201);
    expect(body).toMatchObject({ lat: 25.5941, lng: 85.1376 });
    const cleared = await request(server)
      .patch(`/api/v1/me/addresses/${body.id}`)
      .set(as('customer'))
      .send({ ...site, lat: null, lng: null })
      .expect(200);
    expect(cleared.body.lat).toBeNull();
    const untouched = await save(site).expect(201);
    expect(untouched.body.lat).toBeNull();
  });

  it.each([
    ['one number', { lat: 25.5 }],
    ['the other number', { lng: 85.1 }],
    ['a latitude off the planet', { lat: 91, lng: 85 }],
    ['a longitude off the planet', { lat: 25, lng: 181 }],
    ['text', { lat: '25', lng: '85' }],
    ['a used time from the phone', { lastUsedAt: new Date().toISOString() }],
    ['an owner from the phone', { userId: 'other' }],
  ])('refuses %s', async (_name, extra) => {
    await save({ ...site, ...extra }).expect(400);
  });

  it("cannot read or edit someone else's site", async () => {
    await request(server)
      .patch('/api/v1/me/addresses/theirs')
      .set(as('customer'))
      .send(site)
      .expect(404);
    await request(server).delete('/api/v1/me/addresses/theirs').set(as('customer')).expect(404);
    const mine = await request(server).get('/api/v1/me/addresses').set(as('customer')).expect(200);
    expect(mine.body.map((row: { id: string }) => row.id)).not.toContain('theirs');
    await request(server).get('/api/v1/me/addresses').expect(401);
  });

  it('lists the last used first, and placing marks it', async () => {
    const { body } = await review(
      [{ productId: 'cement', quantity: 1 }],
      {},
      'customer',
      'second',
    ).expect(201);
    await place(body.id).expect(201);
    const list = await request(server).get('/api/v1/me/addresses').set(as('customer')).expect(200);
    expect(list.body[0].id).toBe('second');
    expect(list.body[0].lastUsedAt).toBeTruthy();
    expect(list.body[1].lastUsedAt).toBeNull();
  });

  it('an order survives its site being removed after the review', async () => {
    const { body } = await review([{ productId: 'cement', quantity: 1 }]).expect(201);
    await request(server).delete('/api/v1/me/addresses/site').set(as('customer')).expect(200);
    const order = await place(body.id).expect(201);
    expect(order.body.address.line1).toBe('Plot 12');
  });

  it('account deletion takes the pin from the site and from every saved copy', async () => {
    const { body } = await save({ ...site, lat: 25.5941, lng: 85.1376 }).expect(201);
    const reviewed = await review(
      [{ productId: 'cement', quantity: 1 }],
      {},
      'customer',
      body.id,
    ).expect(201);
    const order = (await place(reviewed.body.id).expect(201)).body;
    expect(order.address.lat).toBe(25.5941);
    await db.order.update({ where: { id: order.id }, data: { status: 'DELIVERED' } });
    await request(server)
      .post('/api/v1/me/delete')
      .set(as('customer'))
      .send({ confirmation: 'DELETE' })
      .expect(201);
    expect(await db.address.count({ where: { userId: 'customer' } })).toBe(0);
    const left = await db.order.findUniqueOrThrow({ where: { id: order.id } });
    expect(JSON.stringify(left.address)).not.toContain('25.59');
    const saved = await db.checkoutReview.findUniqueOrThrow({ where: { id: reviewed.body.id } });
    expect(JSON.stringify(saved.snapshot)).not.toContain('25.59');
  });
});

describe('pincode answers', () => {
  it('gives the area when the shop filled it in, and nothing it had to guess', async () => {
    const named = await request(server).get('/api/v1/delivery/800020').expect(200);
    expect(named.body).toMatchObject({ serviceable: true, area: 'Kankarbagh' });
    const blank = await request(server).get('/api/v1/delivery/800001').expect(200);
    expect(blank.body).toMatchObject({ serviceable: true, area: '' });
    const unknown = await request(server).get('/api/v1/delivery/110001').expect(200);
    expect(unknown.body).toMatchObject({ serviceable: false, area: '', zone: null });
    await request(server).get('/api/v1/delivery/abc').expect(400);
  });

  it('a closed zone says nothing about its area', async () => {
    await db.deliveryZone.update({ where: { id: 'zone' }, data: { active: false } });
    const { body } = await request(server).get('/api/v1/delivery/800020').expect(200);
    expect(body).toMatchObject({ serviceable: false, area: '' });
  });

  it('saving a zone keeps its area names, and an owner can set them', async () => {
    const zone = await db.deliveryZone.findUniqueOrThrow({ where: { id: 'zone' } });
    const patch = (extra: object) =>
      request(server)
        .patch('/api/v1/admin/delivery-zones/zone')
        .set(as('papa'))
        .send({
          name: 'Patna',
          active: true,
          deliveryFeePaise: 50000,
          minimumOrderPaise: 0,
          freeDeliveryAbovePaise: null,
          estimate: 'Today',
          pincodes: ['800020', '800001'],
          ...extra,
        });
    await patch({ expectedVersion: zone.version }).expect(200);
    const kept = await request(server).get('/api/v1/delivery/800020').expect(200);
    expect(kept.body.area).toBe('Kankarbagh');
    await patch({ expectedVersion: zone.version + 1, areas: { '800001': 'Boring Road' } }).expect(
      200,
    );
    const named = await request(server).get('/api/v1/delivery/800001').expect(200);
    expect(named.body.area).toBe('Boring Road');
    await patch({ expectedVersion: zone.version + 2, areas: { abc: 'x' } }).expect(400);
  });
});

describe('Udhaar on the phone', () => {
  const khata = (who = 'customer') => request(server).get('/api/v1/me/khata').set(as(who));
  async function signOff() {
    const shop = await db.location.findFirstOrThrow({ select: { id: true, firmId: true } });
    await db.khataSignoff.create({
      data: {
        customerId: 'customer',
        firmId: shop.firmId,
        locationId: shop.id,
        asOf: istToday(),
        chosenPaise: 0,
        enteredById: 'papa',
        approvedById: 'papa',
        requestHash: 'test',
      },
    });
    await db.user.update({ where: { id: 'customer' }, data: { khataViewOn: true } });
  }

  it('says nothing at all until an owner has signed off, and needs a sign-in', async () => {
    await request(server).get('/api/v1/me/khata').expect(401);
    expect((await khata().expect(200)).body).toEqual({ available: false });
    await db.user.update({ where: { id: 'customer' }, data: { khataViewOn: true } });
    expect((await khata().expect(200)).body).toEqual({ available: false });
  });

  it('once signed off, reads its own balance and can stop and restart reminders', async () => {
    await signOff();
    const { body } = await khata().expect(200);
    expect(body).toMatchObject({ available: true, balancePaise: 0, remindersStopped: false });
    await request(server)
      .put('/api/v1/me/reminders')
      .set(as('customer'))
      .send({ stopped: true })
      .expect(200);
    expect((await khata().expect(200)).body.remindersStopped).toBe(true);
    await request(server)
      .put('/api/v1/me/reminders')
      .set(as('customer'))
      .send({ stopped: false })
      .expect(200);
    expect((await khata().expect(200)).body.remindersStopped).toBe(false);
    // Someone else still sees nothing.
    expect((await khata('other').expect(200)).body).toEqual({ available: false });
    await request(server).put('/api/v1/me/reminders').send({ stopped: true }).expect(401);
    await request(server)
      .put('/api/v1/me/reminders')
      .set(as('customer'))
      .send({ stopped: 'yes' })
      .expect(400);
  });
});

describe('a shop reply on the phone', () => {
  const ask = async () =>
    (
      await request(server)
        .post('/api/v1/quotes')
        .set(as('customer'))
        .send({
          items: [{ productId: 'cement', quantity: 100 }],
          addressId: 'site',
          deliveryDate: tomorrow(),
          company: '',
          gstin: '',
          notes: '',
        })
        .expect(201)
    ).body as { id: string; number: string };

  it('the customer who sent the list reads it, with its lines', async () => {
    const quote = await ask();
    const { body } = await request(server)
      .get(`/api/v1/quotes/${quote.id}`)
      .set(as('customer'))
      .expect(200);
    expect(body).toMatchObject({ id: quote.id, number: quote.number, status: 'REQUESTED' });
    expect(body.items).toHaveLength(1);
    expect(body.items[0]).toMatchObject({ productId: 'cement', quantity: 100 });
  });

  it('reads the same as the list does, so a reply past its date is expired', async () => {
    const quote = await ask();
    await db.quote.update({
      where: { id: quote.id },
      data: { status: 'SENT', validUntil: new Date(Date.now() - 60000) },
    });
    const { body } = await request(server)
      .get(`/api/v1/quotes/${quote.id}`)
      .set(as('customer'))
      .expect(200);
    expect(body.status).toBe('EXPIRED');
    const list = await request(server).get('/api/v1/quotes').set(as('customer')).expect(200);
    expect(list.body.items[0].status).toBe('EXPIRED');
  });

  it('another customer gets the same answer as for a list that never existed', async () => {
    const quote = await ask();
    const theirs = await request(server)
      .get(`/api/v1/quotes/${quote.id}`)
      .set(as('other'))
      .expect(404);
    const missing = await request(server)
      .get('/api/v1/quotes/no-such-list')
      .set(as('other'))
      .expect(404);
    expect(theirs.body.error.code).toBe('NOT_FOUND');
    expect(theirs.body.error.code).toBe(missing.body.error.code);
    expect(theirs.body.error.message).toBe(missing.body.error.message);
    expect(JSON.stringify(theirs.body)).not.toContain(quote.number);
  });

  it('the shop’s own login is no way in to a customer’s list on this route', async () => {
    const quote = await ask();
    await request(server).get(`/api/v1/quotes/${quote.id}`).set(as('papa')).expect(404);
  });

  it('needs a sign-in', async () => {
    const quote = await ask();
    await request(server).get(`/api/v1/quotes/${quote.id}`).expect(401);
  });

  it('a tampered id reaches nothing', async () => {
    await ask();
    for (const id of ["' OR 1=1 --", '../orders', '%00', 'a'.repeat(300)])
      await request(server)
        .get(`/api/v1/quotes/${encodeURIComponent(id)}`)
        .set(as('customer'))
        .expect(404);
  });

  it('an answer for an older revision is refused, so a new offer is never accepted unseen', async () => {
    const quote = await ask();
    await db.quote.update({
      where: { id: quote.id },
      data: {
        status: 'SENT',
        revision: 2,
        validUntil: new Date(Date.now() + 86400000),
        totalPaise: 4050000,
      },
    });
    const stale = await request(server)
      .post(`/api/v1/quotes/${quote.id}/respond`)
      .set(as('customer'))
      .send({ revision: 1, status: 'ACCEPTED' });
    expect(stale.status).toBe(409);
    const { body } = await request(server)
      .get(`/api/v1/quotes/${quote.id}`)
      .set(as('customer'))
      .expect(200);
    expect(body).toMatchObject({ status: 'SENT', revision: 2 });
  });
});

describe('client config', () => {
  it('keeps Ask off until the server says so, and needs no sign-in', async () => {
    const { body } = await request(server).get('/api/v1/client-config').expect(200);
    expect(body.askEnabled).toBe(false);
    expect(body.awardsUrl).toBeNull();
    expect(body.android.minimumVersion).toMatch(/^\d+\.\d+\.\d+$/);
  });
});

describe('My people', () => {
  const add = (body: object, who = 'customer') =>
    request(server).post('/api/v1/me/people').set(as(who)).send(body);
  const allowCredit = (id = 'customer') =>
    db.user.update({ where: { id }, data: { creditAllowed: true, creditLimitPaise: 1000000 } });

  it('needs a sign-in', async () => {
    await request(server).get('/api/v1/me/people').expect(401);
    await request(server).post('/api/v1/me/people').send({}).expect(401);
    await request(server).delete('/api/v1/me/people/x').expect(401);
  });

  it('an account without udhaar sees nobody and can add nobody', async () => {
    const list = await request(server).get('/api/v1/me/people').set(as('customer')).expect(200);
    expect(list.body).toEqual([]);
    const refused = await add({ phone: '+919000000999', name: 'Munshi' });
    expect(refused.status).toBe(403);
    expect(refused.body.error.code).toBe('FORBIDDEN');
    expect(await db.accountDelegate.count()).toBe(0);
  });

  it('adds, lists and removes, and the log keeps no one else’s number', async () => {
    await allowCredit();
    const { body } = await add({ phone: '+919000000999', name: 'Munshi' }).expect(201);
    expect(body).toMatchObject({ phone: '+919000000999', name: 'Munshi' });
    expect(body.canUseUdhaar).toBeUndefined();
    const list = await request(server).get('/api/v1/me/people').set(as('customer')).expect(200);
    expect(list.body).toHaveLength(1);
    await request(server).delete(`/api/v1/me/people/${body.id}`).set(as('customer')).expect(200);
    const after = await request(server).get('/api/v1/me/people').set(as('customer')).expect(200);
    expect(after.body).toEqual([]);
    const logs = await db.auditLog.findMany({ where: { event: { startsWith: 'PERSON_' } } });
    expect(logs.map((log) => log.event).sort()).toEqual(['PERSON_ADDED', 'PERSON_REMOVED']);
    expect(JSON.stringify(logs)).not.toContain('999');
  });

  it('adding someone again reopens the row with no extra rights', async () => {
    await allowCredit();
    const { body } = await add({ phone: '+919000000999', name: 'Munshi' }).expect(201);
    await db.accountDelegate.update({ where: { id: body.id }, data: { canUseUdhaar: true } });
    await request(server).delete(`/api/v1/me/people/${body.id}`).set(as('customer')).expect(200);
    const back = await add({ phone: '+919000000999', name: 'New name' }).expect(201);
    expect(back.body.id).toBe(body.id);
    const row = await db.accountDelegate.findUniqueOrThrow({ where: { id: body.id } });
    expect(row).toMatchObject({ endedAt: null, canUseUdhaar: false, name: 'New name' });
  });

  it("cannot remove or see someone on another person's list", async () => {
    await allowCredit();
    const { body } = await add({ phone: '+919000000999', name: 'Munshi' }).expect(201);
    await request(server).delete(`/api/v1/me/people/${body.id}`).set(as('other')).expect(404);
    const theirs = await request(server).get('/api/v1/me/people').set(as('other')).expect(200);
    expect(theirs.body).toEqual([]);
    expect(
      (await db.accountDelegate.findUniqueOrThrow({ where: { id: body.id } })).endedAt,
    ).toBeNull();
  });

  it('removing twice is refused the second time', async () => {
    await allowCredit();
    const { body } = await add({ phone: '+919000000999', name: 'Munshi' }).expect(201);
    await request(server).delete(`/api/v1/me/people/${body.id}`).set(as('customer')).expect(200);
    await request(server).delete(`/api/v1/me/people/${body.id}`).set(as('customer')).expect(404);
  });

  it.each([
    ['a bad number', { phone: '12345', name: 'x' }],
    ['no name', { phone: '+919000000999' }],
    ['rights from the phone', { phone: '+919000000999', name: 'x', canUseUdhaar: true }],
    ['another account', { phone: '+919000000999', name: 'x', accountId: 'other' }],
  ])('refuses %s', async (_name, body) => {
    await allowCredit();
    await add(body).expect(400);
  });

  it('refuses your own number and an eleventh person', async () => {
    await allowCredit();
    const own = await add({ phone: '+919000000901', name: 'Me' });
    expect(own.body.error.code).toBe('SELF_CHANGE');
    for (let i = 0; i < 10; i++)
      await add({ phone: `+91900000${1000 + i}`, name: `Person ${i}` }).expect(201);
    const full = await add({ phone: '+919000002000', name: 'One more' });
    expect(full.body.error.code).toBe('PEOPLE_LIMIT');
    // Renaming someone already on the list is not an eleventh.
    await add({ phone: '+919000001000', name: 'Renamed' }).expect(201);
  });

  it('goes when the account goes', async () => {
    await allowCredit();
    await add({ phone: '+919000000999', name: 'Munshi' }).expect(201);
    await request(server)
      .post('/api/v1/me/delete')
      .set(as('customer'))
      .send({ confirmation: 'DELETE' })
      .expect(201);
    // People removed with the sign-ins; a deleted account can no longer list them.
    await request(server).get('/api/v1/me/people').set(as('customer')).expect(401);
  });
});
