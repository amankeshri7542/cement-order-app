import 'reflect-metadata';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { existsSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import type { Server } from 'node:http';
import { loadEnvFile } from 'node:process';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import {
  customerPageSchema,
  orderPageSchema,
  rolePermissions,
  searchResponseSchema,
  type StaffRole,
} from '@shiv/shared';
import { searchCatalogue, searchQueries } from '../../../packages/shared/src/search-cases';
import { Db } from '../src/db';
import { addPerson, tokenFor } from './staff-helper';

// Plan v4 B4b: the desk's search. Grouped answers, each group on its own permission, numbers and
// money only for those who may see them, and the 60-query table answered by the server.
if (existsSync('.env.test')) loadEnvFile('.env.test');
process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
process.env.OTP_PROVIDER = 'mock';
process.env.OTP_HASH_SECRET = 'search-test-only-secret-not-for-production-use';
process.env.CORS_ORIGINS = 'http://localhost:3000';
if (!process.env.DATABASE_URL || !new URL(process.env.DATABASE_URL).pathname.endsWith('_test'))
  throw new Error('Search tests require a dedicated TEST_DATABASE_URL ending in _test.');

const FIRM_A = 'firm_main';
const FIRM_B = 'firm_search_b';
const SHOP_A = 'loc_main';
const SHOP_A2 = 'loc_search_a2';
const SHOP_B = 'loc_search_b';
let app: INestApplication;
let server: Server;
let db: Db;
const as = (id: string) => ({ Authorization: `Bearer ${tokenFor(id)}` });
const search = (who: string, query: Record<string, string | number>) =>
  request(server).get('/api/v1/admin/search').query(query).set(as(who));

// One person per desk role, at shop A where the role works shop by shop.
const roles: [string, StaffRole, string[] | undefined][] = [
  ['owner', 'OWNER', undefined],
  ['manager', 'MANAGER', [SHOP_A]],
  ['cashier', 'CASHIER', [SHOP_A]],
  ['accountant', 'ACCOUNTANT', undefined],
  ['stock', 'STOCK_KEEPER', [SHOP_A]],
  ['tech', 'TECH_OPERATOR', undefined],
];
const PHONE_RAMESH = '+919812345670';
const PHONE_BONLY = '+919812345699';

let orderCount = 0;
async function order(input: { user: string; shop: string; firm: string; number?: string }) {
  return db.order.create({
    data: {
      firmId: input.firm,
      number: input.number ?? `SC-S${String(++orderCount).padStart(4, '0')}`,
      userId: input.user,
      idempotencyKey: randomUUID(),
      status: 'CONFIRMED',
      source: 'WEB',
      address: {},
      deliveryDate: '2026-11-08',
      notes: '',
      subtotalPaise: 4250000,
      deliveryFeePaise: 0,
      totalPaise: 4250000,
      locationId: input.shop,
    },
  });
}

beforeAll(async () => {
  const { createApp } = await import('../src/app');
  app = await createApp();
  await app.listen(0, '127.0.0.1');
  server = app.getHttpServer();
  db = app.get(Db);
  await db.$executeRawUnsafe(
    'TRUNCATE TABLE "User", "Category", "Product", "Order", "AuditLog", "AuthRateLimit", "StoreSettings" RESTART IDENTITY CASCADE',
  );
  await db.firm.upsert({
    where: { id: FIRM_B },
    update: { active: true },
    create: { id: FIRM_B, legalName: 'Search Firm B (test)', tradeName: 'Firm B' },
  });
  for (const [id, firmId, slug] of [
    [SHOP_A2, FIRM_A, 'search-a2'],
    [SHOP_B, FIRM_B, 'search-b'],
  ] as const)
    await db.location.upsert({
      where: { id },
      update: { active: true, firmId },
      create: { id, firmId, slug, name: id, kind: 'SHOP', stockStartedAt: new Date() },
    });
  let phone = 9100000500;
  const next = () => `+91${++phone}`;
  for (const [id, role, shops] of roles) await addPerson(db, { id, role, shops, phone: next() });
  await addPerson(db, { id: 'managera2', role: 'MANAGER', shops: [SHOP_A2], phone: next() });
  await addPerson(db, { id: 'driver', role: 'DRIVER', shops: [SHOP_A], phone: next() });
  // Runs shop A, and only loads goods at shop A2: order money at A only.
  await addPerson(db, { id: 'mixed', role: 'MANAGER', shops: [SHOP_A], phone: next() });
  await db.staffMembership.create({
    data: { userId: 'mixed', locationId: SHOP_A2, role: 'STOCK_KEEPER', grantedById: 'fixture' },
  });
  // An accountant for firm A only.
  await addPerson(db, { id: 'accounta', phone: next() });
  await db.user.update({ where: { id: 'accounta' }, data: { role: 'ADMIN' } });
  await db.session.updateMany({ where: { userId: 'accounta' }, data: { surface: 'DESK' } });
  await db.staffMembership.create({
    data: {
      userId: 'accounta',
      locationId: null,
      role: 'ACCOUNTANT',
      firmId: FIRM_A,
      grantedById: 'fixture',
    },
  });
  // Customers. Ramesh buys from firm A, the other from firm B only; a new one from nobody yet.
  await addPerson(db, { id: 'ramesh', phone: PHONE_RAMESH });
  await addPerson(db, { id: 'rameshwar', phone: '+919812345671' });
  await addPerson(db, { id: 'bonly', phone: PHONE_BONLY });
  await addPerson(db, { id: 'newbie', phone: '+919812345672' });
  for (const [id, name, area] of [
    ['ramesh', 'Ramesh Yadav', 'Danapur'],
    ['rameshwar', 'Rameshwar Prasad', 'Bihta'],
    ['bonly', 'Zorawar Bonly', 'Phulwari'],
    ['newbie', 'Naya Grahak', ''],
  ])
    await db.user.update({ where: { id }, data: { name, area } });
  await db.user.update({ where: { id: 'ramesh' }, data: { khataBalancePaise: 1500000 } });
  await db.customerFirmBalance.create({
    data: { customerId: 'ramesh', firmId: FIRM_A, balancePaise: 1500000 },
  });
  await db.customerFirmBalance.create({
    data: { customerId: 'bonly', firmId: FIRM_B, balancePaise: 900000 },
  });
  await order({ user: 'ramesh', shop: SHOP_A, firm: FIRM_A, number: 'SC-A10427' });
  await order({ user: 'ramesh', shop: SHOP_A2, firm: FIRM_A, number: 'SC-A20427' });
  await order({ user: 'bonly', shop: SHOP_B, firm: FIRM_B, number: 'SC-B30427' });
  // The query table's catalogue, with stock at two shops.
  for (const slug of new Set(searchCatalogue.map((item) => item.category)))
    await db.category.create({ data: { id: `cat-${slug}`, slug, name: slug } });
  for (const item of searchCatalogue) {
    const loose = item.category === 'sand' || item.category === 'aggregates';
    await db.product.create({
      data: {
        id: item.id,
        name: item.name,
        nameHi: item.nameHi ?? null,
        brand: item.brand ?? '',
        categoryId: `cat-${item.category}`,
        type: item.type ?? '',
        grade: item.grade ?? '',
        unit: 'unit',
        pricePaise: 10000,
        description: 'Search test',
        recommendedUse: 'Search test',
        images: [],
        stockMode: loose ? 'AVAILABILITY' : 'COUNTED',
      },
    });
    for (const [shop, quantity] of [
      [SHOP_A, 30],
      [SHOP_A2, 5],
    ] as const)
      await db.stockLevel.upsert({
        where: { productId_locationId: { productId: item.id, locationId: shop } },
        update: { quantity, lowStockAt: 10, isOn: shop === SHOP_A },
        create: {
          productId: item.id,
          locationId: shop,
          quantity,
          lowStockAt: 10,
          isOn: shop === SHOP_A,
        },
      });
    for (const word of item.words ?? [])
      await db.productAlias.create({
        data: {
          productId: item.id,
          alias: word,
          normalizedAlias: `${item.id}-${word}`,
          source: 'test',
          confirmedBy: 'owner',
        },
      });
  }
}, 120000);

afterAll(async () => {
  // Leave the shared test database with one open firm, as other suites expect.
  await db.location.updateMany({ where: { firmId: { not: FIRM_A } }, data: { active: false } });
  await db.firm.updateMany({ where: { id: { not: FIRM_A } }, data: { active: false } });
  await db.location.updateMany({ where: { id: SHOP_A2 }, data: { active: false } });
  await app.close();
});

describe('each group on its own permission', () => {
  it('every desk role gets exactly the groups it may read, in the shared shape', async () => {
    for (const [id, role] of roles) {
      const res = await search(id, { q: 'rame' }).expect(200);
      expect(() => searchResponseSchema.parse(res.body), id).not.toThrow();
      const rights = rolePermissions[role];
      expect(!!res.body.customers, `${id} customers`).toBe(!!rights['customers.read']);
      expect(!!res.body.orders, `${id} orders`).toBe(!!rights['orders.read']);
      expect(!!res.body.products, `${id} goods`).toBe(
        !!rights['stock.read'] || !!rights['rates.read'],
      );
    }
  });

  it('a stock keeper finds goods and orders to load, never a customer', async () => {
    const res = await search('stock', { q: 'Ramesh' }).expect(200);
    expect(res.body.customers).toBeUndefined();
    // Orders by number, to load them; never by the customer's name.
    expect(res.body.orders).toEqual([]);
    expect(JSON.stringify({ ...res.body, query: '' })).not.toContain('Ramesh');
    const byNumber = await search('stock', { q: 'SC-A10427' }).expect(200);
    expect(byNumber.body.orders[0]).toMatchObject({ customerName: null, totalPaise: null });
    expect((await search('stock', { q: 'tata 12' }).expect(200)).body.products[0].id).toBe(
      'sq-tata-12',
    );
  });

  it('refuses people outside the desk', async () => {
    await search('driver', { q: 'rame' }).expect(403);
    await search('ramesh', { q: 'rame' }).expect(403);
    await request(server).get('/api/v1/admin/search?q=rame').expect(401);
  });

  it('one group only, for a picker', async () => {
    const res = await search('owner', { q: 'rame', only: 'customers' }).expect(200);
    expect(Object.keys(res.body).sort()).toEqual(['customers', 'query']);
  });
});

describe('customers', () => {
  it('are found by four letters of their name, the closest first', async () => {
    const res = await search('owner', { q: 'rame' }).expect(200);
    expect(res.body.customers.map((row: { id: string }) => row.id)).toEqual([
      'ramesh',
      'rameshwar',
    ]);
    const exact = await search('owner', { q: 'Rameshwar Prasad' }).expect(200);
    expect(exact.body.customers[0].id).toBe('rameshwar');
    // A word inside the name counts too.
    expect((await search('owner', { q: 'yada' }).expect(200)).body.customers[0].id).toBe('ramesh');
  });

  it('a letter or two wrong still finds the person, after real matches', async () => {
    const res = await search('owner', { q: 'Rmesh Yadav' }).expect(200);
    expect(res.body.customers[0]?.id).toBe('ramesh');
  });

  it('numbers are masked, and a piece of a number finds nobody, for those who may not hold them', async () => {
    const owner = await search('owner', { q: '345670' }).expect(200);
    expect(owner.body.customers[0]).toMatchObject({ id: 'ramesh', phone: PHONE_RAMESH });
    const roleWithoutPhones = roles.find(
      ([, role]) =>
        rolePermissions[role]['customers.read'] && !rolePermissions[role]['customers.phone.read'],
    );
    if (!roleWithoutPhones) return;
    const [who] = roleWithoutPhones;
    expect((await search(who, { q: '345670' }).expect(200)).body.customers).toEqual([]);
    // The whole number finds them, as on the customer list, and still shows only the mask.
    const whole = await search(who, { q: '98123 45670' }).expect(200);
    expect(whole.body.customers[0].id).toBe('ramesh');
    expect(whole.body.customers[0].phone).not.toBe(PHONE_RAMESH);
    expect(JSON.stringify((await search(who, { q: 'rame' })).body)).not.toContain('345670');
  });

  it('balances only for those who see who owes what', async () => {
    for (const [id, role] of roles) {
      const res = await search(id, { q: 'Ramesh Yadav' }).expect(200);
      if (!res.body.customers) continue;
      expect(res.body.customers[0].balancePaise, id).toBe(
        rolePermissions[role]['khata.read.list'] ? 1500000 : null,
      );
    }
  });

  it('someone limited to one firm never finds the other firm’s customer', async () => {
    const owner = await search('owner', { q: 'Zorawar' }).expect(200);
    expect(owner.body.customers.map((row: { id: string }) => row.id)).toEqual(['bonly']);
    const limited = await search('accounta', { q: 'Zorawar' }).expect(200);
    expect(limited.body.customers).toEqual([]);
    expect(JSON.stringify({ ...limited.body, query: '' })).not.toContain('Bonly');
    // New customers, known to no firm yet, are everyone's.
    expect((await search('accounta', { q: 'Naya' }).expect(200)).body.customers[0].id).toBe(
      'newbie',
    );
    // The owner choosing firm A in the top bar sees what firm A sees.
    const chosen = await search('owner', { q: 'Zorawar', firmId: FIRM_A }).expect(200);
    expect(chosen.body.customers).toEqual([]);
    // A firm that is not theirs is refused, not widened.
    await search('accounta', { q: 'Zorawar', firmId: FIRM_B }).expect(403);
  });
});

describe('orders', () => {
  it('are found by a piece of their number, the typed one first', async () => {
    const res = await search('owner', { q: '0427' }).expect(200);
    expect(res.body.orders.map((row: { number: string }) => row.number).sort()).toEqual([
      'SC-A10427',
      'SC-A20427',
      'SC-B30427',
    ]);
    const exact = await search('owner', { q: 'sc-a20427' }).expect(200);
    expect(exact.body.orders[0].number).toBe('SC-A20427');
    expect(exact.body.orders[0]).toMatchObject({
      customerName: 'Ramesh Yadav',
      totalPaise: 4250000,
    });
  });

  it('a manager finds only their own shop’s orders', async () => {
    const res = await search('manager', { q: '0427' }).expect(200);
    expect(res.body.orders.map((row: { number: string }) => row.number)).toEqual(['SC-A10427']);
    const other = await search('managera2', { q: '0427' }).expect(200);
    expect(other.body.orders.map((row: { number: string }) => row.number)).toEqual(['SC-A20427']);
  });

  it('the shop or firm chosen in the top bar narrows them, and another shop is refused', async () => {
    const shop = await search('owner', { q: '0427', locationId: SHOP_A2 }).expect(200);
    expect(shop.body.orders.map((row: { number: string }) => row.number)).toEqual(['SC-A20427']);
    const firm = await search('owner', { q: '0427', firmId: FIRM_B }).expect(200);
    expect(firm.body.orders.map((row: { number: string }) => row.number)).toEqual(['SC-B30427']);
    await search('manager', { q: '0427', locationId: SHOP_A2 }).expect(403);
    await search('manager', { q: '0427', locationId: 'loc_nowhere' }).expect(403);
  });

  it('no customer and no money for someone who only loads goods', async () => {
    for (const [id, role] of roles) {
      const res = await search(id, { q: 'SC-A10427' }).expect(200);
      if (!res.body.orders) continue;
      const money = !!rolePermissions[role]['orders.read.money'];
      expect(res.body.orders[0].customerName, id).toBe(money ? 'Ramesh Yadav' : null);
      expect(res.body.orders[0].totalPaise, id).toBe(money ? 4250000 : null);
      // Nor can they find an order by its customer's name.
      const byName = await search(id, { q: 'Ramesh Yadav' }).expect(200);
      expect(byName.body.orders.length > 0, id).toBe(money);
    }
  });
});

describe('orders found by a customer name, only where the money is theirs', () => {
  it('money at one shop and loading at another: the name finds only the first shop’s order', async () => {
    const byName = await search('mixed', { q: 'Ramesh Yadav' }).expect(200);
    expect(byName.body.orders.map((row: { number: string }) => row.number)).toEqual(['SC-A10427']);
    // The other shop's order is still found by its number, without its customer or money.
    const byNumber = await search('mixed', { q: 'SC-A20427' }).expect(200);
    expect(byNumber.body.orders[0]).toMatchObject({ customerName: null, totalPaise: null });
  });
});

describe('goods', () => {
  it('the query table on the server: what must come first', async () => {
    expect(searchQueries.length).toBeGreaterThanOrEqual(60);
    for (const [q, expected] of searchQueries) {
      const res = await search('owner', { q, only: 'products' }).expect(200);
      const first = res.body.products[0]?.id ?? null;
      if (expected === null) expect(first, q).toBeNull();
      else if (typeof expected === 'string') expect(first, q).toBe(expected);
      else expect(expected, `${q}: ${first}`).toContain(first);
    }
  });

  it('stock per shop this person may see, and a heap has no count', async () => {
    const owner = await search('owner', { q: 'tata 12', only: 'products' }).expect(200);
    expect(owner.body.products[0].stock).toEqual([
      { locationId: SHOP_A, quantity: 30, low: false },
      { locationId: SHOP_A2, quantity: 5, low: true },
    ]);
    const manager = await search('manager', { q: 'tata 12', only: 'products' }).expect(200);
    expect(manager.body.products[0].stock).toEqual([
      { locationId: SHOP_A, quantity: 30, low: false },
    ]);
    const chosen = await search('owner', { q: 'tata 12', locationId: SHOP_A2 }).expect(200);
    expect(chosen.body.products[0].stock).toEqual([
      { locationId: SHOP_A2, quantity: 5, low: true },
    ]);
    const balu = await search('owner', { q: 'sone balu fine', only: 'products' }).expect(200);
    expect(balu.body.products[0]).toMatchObject({ stockMode: 'AVAILABILITY' });
    expect(balu.body.products[0].stock).toEqual([
      { locationId: SHOP_A, quantity: null, low: false },
      { locationId: SHOP_A2, quantity: null, low: true },
    ]);
  });

  it('a renamed product and a new alias are found at once', async () => {
    await db.product.update({
      where: { id: 'sq-konark-ppc' },
      data: { name: 'Konark Cement Gold PPC' },
    });
    expect(
      (await search('owner', { q: 'konark gold', only: 'products' })).body.products[0].id,
    ).toBe('sq-konark-ppc');
    await db.productAlias.create({
      data: {
        productId: 'sq-dust',
        alias: 'dhool',
        normalizedAlias: 'sq-dust-dhool',
        source: 'test',
        confirmedBy: 'owner',
      },
    });
    expect((await search('owner', { q: 'dhool', only: 'products' })).body.products[0].id).toBe(
      'sq-dust',
    );
    await db.product.update({ where: { id: 'sq-konark-ppc' }, data: { active: false } });
    expect((await search('owner', { q: 'konark', only: 'products' })).body.products).toEqual([]);
  });
});

describe('bad and tampered input', () => {
  it('refuses a missing, empty, long or repeated query and a bad limit', async () => {
    await search('owner', {}).expect(400);
    await search('owner', { q: '   ' }).expect(400);
    await search('owner', { q: 'x'.repeat(101) }).expect(400);
    await search('owner', { q: 'rame', limit: 21 }).expect(400);
    await search('owner', { q: 'rame', only: 'salary' }).expect(400);
    await search('owner', { q: 'rame', extra: 'x' }).expect(400);
    await request(server).get('/api/v1/admin/search?q=a&q=b').set(as('owner')).expect(400);
  });

  it('LIKE wildcards and quotes are only text', async () => {
    for (const q of ['%', '_', '%%%%', '____', '\\', "' OR 1=1 --", '"; DROP TABLE "User"; --']) {
      const res = await search('owner', { q }).expect(200);
      expect(res.body.customers, q).toEqual([]);
      expect(res.body.orders, q).toEqual([]);
    }
    expect(await db.user.count()).toBeGreaterThan(0);
  });

  it('an answer never grows past the limit', async () => {
    const res = await search('owner', { q: 'cement', limit: 3 }).expect(200);
    expect(res.body.products).toHaveLength(3);
  });
});

describe('the shape is published', () => {
  it('the OpenAPI document carries the shared response schema', async () => {
    const res = await request(server).get('/api/docs-json').expect(200);
    const answer = res.body.paths['/api/v1/admin/search']?.get?.responses?.['200'];
    const schema = answer?.content?.['application/json']?.schema;
    expect(Object.keys(schema?.properties ?? {}).sort()).toEqual([
      'customers',
      'orders',
      'products',
      'query',
    ]);
  });
});

describe('the customer and order lists take the top bar’s choice', () => {
  const list = (who: string, path: string, query: Record<string, string> = {}) =>
    request(server).get(`/api/v1/admin/${path}`).query(query).set(as(who));

  it('orders by shop and by firm, and a firm that is not theirs is refused', async () => {
    const numbers = (body: { items: { number: string }[] }) =>
      body.items.map((row) => row.number).sort();
    const all = await list('owner', 'orders').expect(200);
    expect(numbers(all.body)).toEqual(['SC-A10427', 'SC-A20427', 'SC-B30427']);
    expect(numbers((await list('owner', 'orders', { firmId: FIRM_B }).expect(200)).body)).toEqual([
      'SC-B30427',
    ]);
    expect(
      numbers((await list('owner', 'orders', { locationId: SHOP_A2 }).expect(200)).body),
    ).toEqual(['SC-A20427']);
    await list('accounta', 'orders', { firmId: FIRM_B }).expect(403);
    await list('manager', 'orders', { locationId: SHOP_A2 }).expect(403);
  });

  it('customers by firm, with that firm’s balance', async () => {
    const ids = (body: { items: { id: string }[] }) => body.items.map((row) => row.id).sort();
    const firmB = await list('owner', 'customers', { firmId: FIRM_B }).expect(200);
    // Firm B's customer, and those nobody has sold to yet; not firm A's.
    expect(ids(firmB.body)).toEqual(['bonly', 'newbie', 'rameshwar']);
    expect(firmB.body.items.find((row: { id: string }) => row.id === 'bonly').balancePaise).toBe(
      900000,
    );
    const firmA = await list('owner', 'customers', { firmId: FIRM_A }).expect(200);
    expect(ids(firmA.body)).not.toContain('bonly');
    await list('accounta', 'customers', { firmId: FIRM_B }).expect(403);
  });

  it('every role’s answer matches the shared list schemas', async () => {
    for (const [id, role] of roles) {
      const rights = rolePermissions[role];
      if (rights['customers.read']) {
        const res = await list(id, 'customers').expect(200);
        expect(() => customerPageSchema.parse(res.body), id).not.toThrow();
      }
      if (rights['orders.read']) {
        const res = await list(id, 'orders').expect(200);
        expect(() => orderPageSchema.parse(res.body), id).not.toThrow();
      }
    }
  });
});
