import 'reflect-metadata';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { existsSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import type { Server } from 'node:http';
import { loadEnvFile } from 'node:process';
import type { INestApplication } from '@nestjs/common';
import { RequestMethod } from '@nestjs/common';
import request from 'supertest';
import { rolePermissions, type Permission, type StaffRole } from '@shiv/shared';
import { AppModule } from '../src/app';
import { Db } from '../src/db';
import type { CanRule } from '../src/http';
import { addPerson, tokenFor } from './staff-helper';

if (existsSync('.env.test')) loadEnvFile('.env.test');
process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
process.env.OTP_PROVIDER = 'mock';
process.env.OTP_HASH_SECRET = 'matrix-test-only-secret-not-for-production';
process.env.CORS_ORIGINS = 'http://localhost:3000';
if (!process.env.DATABASE_URL || !new URL(process.env.DATABASE_URL).pathname.endsWith('_test'))
  throw new Error('Matrix tests require a dedicated TEST_DATABASE_URL ending in _test.');

const SHOP_A = 'loc_main';
const SHOP_B = 'loc_matrix_b';
let app: INestApplication;
let server: Server;
let db: Db;

const staff: { id: string; role: StaffRole; shops?: string[] }[] = [
  { id: 'owner', role: 'OWNER' },
  { id: 'manager', role: 'MANAGER', shops: [SHOP_A] },
  { id: 'cashier', role: 'CASHIER', shops: [SHOP_A] },
  { id: 'accountant', role: 'ACCOUNTANT' },
  { id: 'keeper', role: 'STOCK_KEEPER', shops: [SHOP_A] },
  { id: 'driver', role: 'DRIVER', shops: [SHOP_A] },
  { id: 'helper', role: 'HELPER', shops: [SHOP_A] },
  { id: 'tech', role: 'TECH_OPERATOR' },
];
const as = (id: string) => ({ Authorization: `Bearer ${tokenFor(id)}` });

type Route = {
  name: string;
  method: string;
  path: string;
  can?: CanRule;
  self: boolean;
  sse: boolean;
};
function routes(): Route[] {
  const verbs: Partial<Record<RequestMethod, string>> = {
    [RequestMethod.GET]: 'get',
    [RequestMethod.POST]: 'post',
    [RequestMethod.PUT]: 'put',
    [RequestMethod.PATCH]: 'patch',
    [RequestMethod.DELETE]: 'delete',
  };
  const controllers: (new (...args: never[]) => object)[] =
    Reflect.getMetadata('controllers', AppModule) ?? [];
  return controllers.flatMap((controller) => {
    const base = String(Reflect.getMetadata('path', controller) ?? '');
    return Object.getOwnPropertyNames(controller.prototype).flatMap((key) => {
      const handler = (controller.prototype as Record<string, unknown>)[key] as object;
      if (typeof handler !== 'function' || key === 'constructor') return [];
      const declared = Reflect.getMetadata('path', handler) as string | string[] | undefined;
      if (declared === undefined) return [];
      const read = <T>(rule: string) =>
        (Reflect.getMetadata(rule, handler) ?? Reflect.getMetadata(rule, controller)) as T;
      const path = (Array.isArray(declared) ? declared[0]! : declared)
        .split('/')
        .map((part) => (part.startsWith(':') ? 'no-such-row' : part))
        .join('/');
      const method = verbs[Reflect.getMetadata('method', handler) as RequestMethod] ?? 'get';
      const full = ['/api/v1', base, path].filter((part) => part && part !== '/').join('/');
      return [
        {
          name: `${method.toUpperCase()} ${full}`,
          method,
          path: full.replace(/\/+/g, '/'),
          can: read<CanRule | undefined>('can'),
          self: !!read('self'),
          sse: !!Reflect.getMetadata('__sse__', handler),
        },
      ];
    });
  });
}
const call = (route: Route, id?: string) => {
  const sent = (request(server) as unknown as Record<string, (path: string) => request.Test>)[
    route.method
  ]!(route.path);
  if (id) void sent.set(as(id));
  return route.method === 'get' ? sent : sent.send({});
};

beforeAll(async () => {
  const { createApp } = await import('../src/app');
  app = await createApp();
  await app.listen(0, '127.0.0.1');
  server = app.getHttpServer();
  db = app.get(Db);
  await db.$executeRawUnsafe(
    'TRUNCATE TABLE "PriceUpdateBatch", "RateSource", "FinancialMovement", "User", "Category", "Product", "Order", "Quote", "AuditLog", "OtpChallenge", "AuthRateLimit", "DeliveryZone", "StoreSettings" RESTART IDENTITY CASCADE',
  );
  await db.location.upsert({
    where: { id: SHOP_B },
    update: { active: true, stockStartedAt: new Date() },
    create: {
      id: SHOP_B,
      firmId: 'firm_main',
      slug: 'matrix-b',
      name: 'Second shop',
      stockStartedAt: new Date(),
    },
  });
  let phone = 9000000100;
  const next = () => `+91${++phone}`;
  for (const person of staff) await addPerson(db, { ...person, phone: next() });
  await addPerson(db, { id: 'customer', phone: next() });
  // Someone who works here, and is using the customer app on their own phone.
  await addPerson(db, {
    id: 'staffcustomerapp',
    role: 'OWNER',
    phone: next(),
    surface: 'CUSTOMER',
  });
  await addPerson(db, { id: 'pausedowner', role: 'OWNER', phone: next() });
  await db.user.update({ where: { id: 'pausedowner' }, data: { staffPausedAt: new Date() } });
  await addPerson(db, { id: 'managerb', role: 'MANAGER', shops: [SHOP_B], phone: next() });
  await addPerson(db, { id: 'keeperb', role: 'STOCK_KEEPER', shops: [SHOP_B], phone: next() });
  await addPerson(db, {
    id: 'cashierboth',
    role: 'CASHIER',
    shops: [SHOP_A, SHOP_B],
    phone: next(),
  });
  await db.category.create({ data: { id: 'category', name: 'Cement', slug: 'cement' } });
  await db.product.create({
    data: {
      id: 'cement',
      name: 'Test cement',
      brand: 'Test',
      categoryId: 'category',
      type: 'PPC',
      grade: 'PPC',
      unit: 'bag',
      pricePaise: 40000,
      stock: 100,
      description: 'Test product',
      recommendedUse: 'Test',
      images: [],
    },
  });
  await db.deliveryZone.create({
    data: {
      id: 'zone-a',
      name: 'Patna A',
      deliveryFeePaise: 0,
      estimate: 'Today',
      pincodes: { create: { pincode: '800020' } },
    },
  });
  await db.deliveryZone.create({
    data: {
      id: 'zone-b',
      name: 'Patna B',
      deliveryFeePaise: 0,
      estimate: 'Today',
      locationId: SHOP_B,
      pincodes: { create: { pincode: '800021' } },
    },
  });
  await db.storeSettings.create({ data: { id: 'store', phone: '+919999999000' } });
  await request(server)
    .post('/api/v1/admin/products/cement/movements')
    .set(as('owner'))
    .send({
      kind: 'PURCHASE_IN',
      quantity: 50,
      locationId: SHOP_B,
      note: 'Opening stock',
      idempotencyKey: randomUUID(),
    })
    .expect(201);
}, 30000);
afterAll(async () => {
  await app?.close();
});

describe('every role against every route', () => {
  const guarded = routes().filter((route) => route.can);

  it('checks more than a handful of routes', () => {
    expect(guarded.length).toBeGreaterThan(80);
  });

  for (const { id, role } of staff)
    it(`${role} reaches only what the table gives them`, async () => {
      const wrong: string[] = [];
      for (const route of guarded) {
        const permission = route.can!.permission as Permission;
        // These are desk sessions. Driving is the linked phone's alone, and someone with no desk
        // holds nothing at one: a text message must not stand in for the phone's key.
        const allowed =
          !!rolePermissions[role][permission] &&
          !!rolePermissions[role]['desk.use'] &&
          permission !== 'trip.drive';
        // An open event stream never answers; refused streams are still checked.
        if (allowed && route.sse) continue;
        const { status } = await call(route, id);
        if (allowed ? status === 403 || status === 401 : status !== 403)
          wrong.push(`${route.name}: ${status} for ${route.can!.permission}`);
      }
      expect(wrong).toEqual([]);
    }, 60000);

  it.each(['customer', 'staffcustomerapp', 'pausedowner'])(
    '%s reaches nothing on the desk',
    async (id) => {
      const wrong: string[] = [];
      for (const route of guarded) {
        const { status } = await call(route, id);
        if (status !== 403) wrong.push(`${route.name}: ${status}`);
      }
      expect(wrong).toEqual([]);
    },
    60000,
  );

  it('nobody reaches a guarded or personal route without signing in', async () => {
    const wrong: string[] = [];
    for (const route of routes().filter((item) => item.can || item.self)) {
      const { status } = await call(route);
      if (status !== 401) wrong.push(`${route.name}: ${status}`);
    }
    expect(wrong).toEqual([]);
  }, 60000);

  it('a made-up or expired token is treated the same as none', async () => {
    await request(server)
      .get('/api/v1/admin/orders')
      .set('Authorization', `Bearer ${'z'.repeat(43)}`)
      .expect(401);
    await addPerson(db, { id: 'expiredowner', role: 'OWNER', phone: '+919000000099' });
    await db.session.updateMany({
      where: { userId: 'expiredowner' },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });
    await request(server).get('/api/v1/admin/orders').set(as('expiredowner')).expect(401);
  });
});

describe('what the session tells the desk', () => {
  it('an owner gets their access and the open shops', async () => {
    const { body } = await request(server).get('/api/v1/auth/session').set(as('owner')).expect(200);
    expect(body.access['staff.manage']).toBe('ALL');
    expect(body.permissionsVersion).toBeGreaterThan(0);
    const ids = body.locations.map((shop: { id: string }) => shop.id);
    expect(ids).toEqual(expect.arrayContaining([SHOP_A, SHOP_B]));
    // A chooser starts on the first one, so it must never be some other shop by accident.
    expect(ids[0]).toBe(SHOP_A);
  });
  it('a cashier gets only their shop', async () => {
    const { body } = await request(server)
      .get('/api/v1/auth/session')
      .set(as('cashier'))
      .expect(200);
    expect(body.access['orders.read']).toEqual([SHOP_A]);
    expect(body.access['staff.manage']).toBeUndefined();
  });
  it('a customer gets no access and no list of shops', async () => {
    const { body } = await request(server)
      .get('/api/v1/auth/session')
      .set(as('customer'))
      .expect(200);
    expect(body.access).toEqual({});
    expect(body.locations).toEqual([]);
  });
  it('someone using the customer app still has their customer account', async () => {
    await request(server).get('/api/v1/me').set(as('staffcustomerapp')).expect(200);
    await request(server).get('/api/v1/orders').set(as('staffcustomerapp')).expect(200);
  });
});

describe('another shop’s data', () => {
  const address = (pincode: string) => ({
    label: 'Site',
    name: 'Customer',
    phone: '+919999999983',
    line1: 'Plot 12',
    area: 'Kankarbagh',
    city: 'Patna',
    state: 'Bihar',
    pincode,
    landmark: '',
  });
  const phoneOrder = (who: string, overrides: Record<string, unknown> = {}) =>
    request(server)
      .post('/api/v1/admin/orders/phone')
      .set(as(who))
      .send({
        customerPhone: '+919999999983',
        customerName: 'Customer',
        address: address('800020'),
        items: [{ productId: 'cement', quantity: 1 }],
        deliveryDate: 'today',
        paymentMethod: 'COD',
        idempotencyKey: randomUUID(),
        ...overrides,
      });
  let inA: string;
  let inB: string;
  beforeAll(async () => {
    inA = (await phoneOrder('owner', { locationId: SHOP_A }).expect(201)).body.id;
    inB = (await phoneOrder('owner', { locationId: SHOP_B }).expect(201)).body.id;
  });

  it('a phone order is placed at the shop it was made for', async () => {
    const orders = await db.order.findMany({ where: { id: { in: [inA, inB] } } });
    expect(orders.find((order) => order.id === inA)?.locationId).toBe(SHOP_A);
    expect(orders.find((order) => order.id === inB)?.locationId).toBe(SHOP_B);
  });
  it('lists show only your shop', async () => {
    const list = async (who: string) =>
      (await request(server).get('/api/v1/admin/orders').set(as(who)).expect(200)).body.items.map(
        (order: { id: string }) => order.id,
      );
    expect(await list('manager')).toContain(inA);
    expect(await list('manager')).not.toContain(inB);
    expect(await list('managerb')).toContain(inB);
    expect(await list('managerb')).not.toContain(inA);
    expect(await list('cashierboth')).toEqual(expect.arrayContaining([inA, inB]));
    expect(await list('owner')).toEqual(expect.arrayContaining([inA, inB]));
    expect(await list('accountant')).toEqual(expect.arrayContaining([inA, inB]));
  });
  it('opening another shop’s order by its id is refused', async () => {
    await request(server).get(`/api/v1/admin/orders/${inA}`).set(as('manager')).expect(200);
    await request(server).get(`/api/v1/admin/orders/${inA}`).set(as('managerb')).expect(403);
    await request(server).get(`/api/v1/admin/orders/${inA}`).set(as('keeperb')).expect(403);
  });
  it('an order that does not exist is a plain 404, for every shop', async () => {
    await request(server).get('/api/v1/admin/orders/nope').set(as('managerb')).expect(404);
  });
  it.each([
    ['patch', (id: string) => `/api/v1/admin/orders/${id}/status`, { status: 'PREPARING' }],
    ['post', (id: string) => `/api/v1/admin/orders/${id}/delivery`, {}],
    ['post', (id: string) => `/api/v1/admin/orders/${id}/cod-received`, {}],
    ['post', (id: string) => `/api/v1/admin/orders/${id}/cash-refunded`, {}],
    ['post', (id: string) => `/api/v1/admin/orders/${id}/acknowledge`, {}],
  ])('changing another shop’s order with %s %s is refused', async (method, path, body) => {
    const before = await db.order.findUniqueOrThrow({ where: { id: inA } });
    const sent = (request(server) as unknown as Record<string, (path: string) => request.Test>)[
      method
    ]!(path(inA)).set(as('managerb'));
    await sent.send(body).expect(403);
    const after = await db.order.findUniqueOrThrow({ where: { id: inA } });
    expect(after.status).toBe(before.status);
  });
  it('the shop on a phone order cannot be swapped for one you do not hold', async () => {
    const { body } = await phoneOrder('managerb', { locationId: SHOP_A }).expect(403);
    expect(body.error.code).toBe('FORBIDDEN');
  });
  it('someone at one shop need not say which', async () => {
    const { body } = await phoneOrder('managerb').expect(201);
    expect((await db.order.findUniqueOrThrow({ where: { id: body.id } })).locationId).toBe(SHOP_B);
  });
  it('someone at two shops must say which', async () => {
    const { body } = await phoneOrder('cashierboth').expect(400);
    expect(body.error.code).toBe('SHOP_REQUIRED');
    await phoneOrder('cashierboth', { locationId: SHOP_B }).expect(201);
  });
  it('a stock keeper sees what to load, with no rupee value anywhere', async () => {
    const detail = await request(server)
      .get(`/api/v1/admin/orders/${inA}`)
      .set(as('keeper'))
      .expect(200);
    const list = await request(server).get('/api/v1/admin/orders').set(as('keeper')).expect(200);
    for (const body of [detail.body, list.body]) {
      const text = JSON.stringify(body);
      expect(text).not.toMatch(/paise/i);
      expect(text).not.toContain('"payment"');
      expect(text).not.toContain('+919999999983');
    }
    expect(detail.body.items[0].quantity).toBe(1);
    expect(detail.body.area).toBe('Kankarbagh');
    // Only what is on the list: nothing typed by staff or about the customer.
    expect(Object.keys(detail.body).sort()).toEqual(
      [
        'area',
        'createdAt',
        'deliveryDate',
        'id',
        'items',
        'locationId',
        'number',
        'source',
        'status',
      ].sort(),
    );
  });
  it('the dashboard counts only your shop', async () => {
    const orders = async (who: string) =>
      (await request(server).get('/api/v1/admin/dashboard').set(as(who)).expect(200)).body;
    const owner = await orders('owner');
    const manager = await orders('manager');
    const managerB = await orders('managerb');
    expect(owner.recentOrders.map((o: { id: string }) => o.id)).toEqual(
      expect.arrayContaining([inA, inB]),
    );
    expect(manager.recentOrders.map((o: { id: string }) => o.id)).not.toContain(inB);
    expect(managerB.recentOrders.map((o: { id: string }) => o.id)).not.toContain(inA);
    expect(manager.todayOrders).toBeLessThan(owner.todayOrders);
  });
  it('the whole firm’s udhaar total is not on a shop manager’s dashboard', async () => {
    await db.user.update({ where: { id: 'customer' }, data: { khataBalancePaise: 5000000 } });
    // What is owed is kept per firm too; the dashboard reads each firm's figure.
    const firmRow = { customerId_firmId: { customerId: 'customer', firmId: 'firm_main' } };
    await db.customerFirmBalance.upsert({
      where: firmRow,
      create: { customerId: 'customer', firmId: 'firm_main', balancePaise: 5000000 },
      update: { balancePaise: 5000000 },
    });
    try {
      const of = async (who: string) =>
        JSON.stringify(
          (await request(server).get('/api/v1/admin/dashboard').set(as(who)).expect(200)).body,
        );
      expect(await of('accountant')).toContain('5000000');
      expect(await of('manager')).not.toContain('5000000');
    } finally {
      await db.user.update({ where: { id: 'customer' }, data: { khataBalancePaise: 0 } });
      await db.customerFirmBalance.update({ where: firmRow, data: { balancePaise: 0 } });
    }
  });
  it('the money report counts only your shop', async () => {
    const day = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date());
    const report = async (who: string) =>
      (
        await request(server)
          .get(`/api/v1/admin/reports/money?from=${day}&to=${day}`)
          .set(as(who))
          .expect(200)
      ).body;
    const owner = await report('owner');
    const manager = await report('manager');
    expect(JSON.stringify(manager)).not.toEqual(JSON.stringify(owner));
  });
  it('stock lists show only your shop’s levels', async () => {
    const levels = async (who: string) =>
      (
        await request(server).get('/api/v1/admin/products').set(as(who)).expect(200)
      ).body.items[0].stockLevels.map((level: { locationId: string }) => level.locationId);
    expect(await levels('owner')).toEqual(expect.arrayContaining([SHOP_A, SHOP_B]));
    expect(await levels('manager')).toEqual([SHOP_A]);
    expect(await levels('keeperb')).toEqual([SHOP_B]);
  });
  it('a shop’s people see their shop’s count, not the firm’s', async () => {
    const count = async (who: string) =>
      (await request(server).get('/api/v1/admin/products').set(as(who)).expect(200)).body.items[0];
    const owner = await count('owner');
    const manager = await count('manager');
    const levelA = owner.stockLevels.find(
      (level: { locationId: string }) => level.locationId === SHOP_A,
    );
    expect(manager.stock).toBe(levelA.quantity);
    expect(owner.stock).toBeGreaterThan(manager.stock);
  });
  it('someone who loads goods gets no price in the stock list', async () => {
    const { body } = await request(server)
      .get('/api/v1/admin/products')
      .set(as('keeper'))
      .expect(200);
    expect(JSON.stringify(body)).not.toMatch(/paise/i);
    expect(body.items[0].name).toBe('Test cement');
    const manager = await request(server)
      .get('/api/v1/admin/products')
      .set(as('manager'))
      .expect(200);
    expect(manager.body.items[0].pricePaise).toBe(40000);
  });
  it('stock movements show only your shop', async () => {
    const shops = async (who: string) =>
      (
        await request(server)
          .get('/api/v1/admin/products/cement/movements')
          .set(as(who))
          .expect(200)
      ).body.items.map((movement: { locationId: string }) => movement.locationId);
    expect(new Set(await shops('manager'))).toEqual(new Set([SHOP_A]));
    expect(new Set(await shops('keeperb'))).toEqual(new Set([SHOP_B]));
  });
  it('a manager’s staff list holds only people at their shop', async () => {
    const { body } = await request(server)
      .get('/api/v1/admin/staff')
      .set(as('managerb'))
      .expect(200);
    const ids = (Array.isArray(body) ? body : body.items).map(
      (person: { id: string }) => person.id,
    );
    expect(ids).toContain('keeperb');
    expect(ids).not.toContain('keeper');
    expect(ids).not.toContain('owner');
  });
  it('the work queue holds only your shop’s work', async () => {
    const ids = async (who: string) =>
      (await request(server).get('/api/v1/admin/work').set(as(who)).expect(200)).body.map(
        (work: { orderId: string | null }) => work.orderId,
      );
    await db.ownerWork.updateMany({ data: { deliveredAt: null, acknowledgedAt: null } });
    expect(await ids('managerb')).not.toContain(inA);
    expect(await ids('manager')).not.toContain(inB);
  });
});

describe('customers across shops', () => {
  const list = (who: string, query = '') =>
    request(server).get(`/api/v1/admin/customers?limit=50${query}`).set(as(who));
  beforeAll(async () => {
    await db.user.update({
      where: { id: 'customer' },
      data: { khataBalancePaise: 12345, creditAllowed: true, creditLimitPaise: 500000 },
    });
    await db.customerFirmBalance.upsert({
      where: { customerId_firmId: { customerId: 'customer', firmId: 'firm_main' } },
      create: { customerId: 'customer', firmId: 'firm_main', balancePaise: 12345 },
      update: { balancePaise: 12345 },
    });
  });
  it('those with the udhaar list see who owes what', async () => {
    const { body } = await list('accountant', '&sort=due').expect(200);
    const row = body.items.find((item: { id: string }) => item.id === 'customer');
    expect(row.balancePaise).toBe(12345);
  });
  it.each(['manager', 'cashier'])(
    '%s cannot sort or read the list by who owes what',
    async (who) => {
      await list(who, '&sort=due').expect(403);
      const { body } = await list(who).expect(200);
      const text = JSON.stringify(body);
      expect(text).not.toMatch(/balancePaise|creditLimitPaise/i);
      expect(text).not.toContain('12345');
    },
  );
  it('a customer found by their full number shows their balance, as at the counter', async () => {
    const phone = (await db.user.findUniqueOrThrow({ where: { id: 'customer' } })).phone;
    const { body } = await list('cashier', `&q=${encodeURIComponent(phone)}`).expect(200);
    expect(body.items[0].balancePaise).toBe(12345);
  });
  it('part of a number does not', async () => {
    const phone = (await db.user.findUniqueOrThrow({ where: { id: 'customer' } })).phone;
    const { body } = await list('cashier', `&q=${encodeURIComponent(phone.slice(-5))}`).expect(200);
    expect(JSON.stringify(body)).not.toContain('12345');
  });
  it('staff cannot be opened as customers', async () => {
    await request(server).get('/api/v1/admin/customers/owner').set(as('cashier')).expect(404);
    await request(server).get('/api/v1/admin/customers/owner').set(as('owner')).expect(404);
  });
  it('a customer’s recent orders show only your shop’s', async () => {
    const buyer = await db.user.findUniqueOrThrow({ where: { phone: '+919999999983' } });
    const orders = async (who: string) =>
      (await request(server).get(`/api/v1/admin/customers/${buyer.id}`).set(as(who)).expect(200))
        .body.orders as { locationId: string }[];
    expect(new Set((await orders('managerb')).map((order) => order.locationId))).toEqual(
      new Set([SHOP_B]),
    );
    expect(new Set((await orders('manager')).map((order) => order.locationId))).toEqual(
      new Set([SHOP_A]),
    );
  });
});

describe('the people to assign work to', () => {
  const people = async (who: string) =>
    (await request(server).get('/api/v1/admin/owners').set(as(who)).expect(200)).body as {
      id: string;
      phone?: string;
    }[];
  it('someone at one shop sees that shop’s people and the owners, with no numbers', async () => {
    const list = await people('managerb');
    const ids = list.map((person) => person.id);
    expect(ids).toEqual(expect.arrayContaining(['managerb', 'owner', 'cashierboth']));
    expect(ids).not.toContain('manager');
    expect(ids).not.toContain('cashier');
    expect(JSON.stringify(list)).not.toContain('+91');
  });
  it('an owner sees everyone who can take work', async () => {
    const ids = (await people('owner')).map((person) => person.id);
    expect(ids).toEqual(expect.arrayContaining(['manager', 'managerb', 'cashier']));
  });
});

describe('what a stock keeper’s searches can reveal', () => {
  const search = (query: string) =>
    request(server).get(`/api/v1/admin/orders?${query}`).set(as('keeper'));
  it('searching by a customer’s number or name finds nothing', async () => {
    for (const q of ['%2B919999', 'Customer']) {
      const { body } = await search(`q=${q}`).expect(200);
      expect(body.items).toEqual([]);
    }
  });
  it('searching by order number still works, as that is how they find a load', async () => {
    const order = await db.order.findFirstOrThrow({ where: { locationId: SHOP_A } });
    const { body } = await search(`q=${order.number}`).expect(200);
    expect(body.items.map((item: { id: string }) => item.id)).toContain(order.id);
  });
  it('filtering by customer or by unpaid orders is refused', async () => {
    const buyer = await db.user.findUniqueOrThrow({ where: { phone: '+919999999983' } });
    await search(`customerId=${buyer.id}`).expect(403);
    await search('queue=payments').expect(403);
  });
});

describe('agreed prices at the counter', () => {
  const sale = (who: string, extra: Record<string, unknown> = {}) =>
    request(server)
      .post('/api/v1/admin/products/cement/movements')
      .set(as(who))
      .send({
        kind: 'WALK_IN_SALE',
        quantity: 1,
        note: 'Counter',
        channel: 'CASH',
        idempotencyKey: randomUUID(),
        ...extra,
      });
  it('a cashier sells at the list price and cannot set their own', async () => {
    const { body } = await sale('cashier', { unitPricePaise: 1 }).expect(403);
    expect(body.error.code).toBe('FORBIDDEN');
    await sale('cashier').expect(201);
  });
  it('a manager may agree a price, and it is logged next to the list price', async () => {
    await db.location.update({ where: { id: SHOP_A }, data: { managerRateCapPercent: 5 } });
    const made = await sale('manager', { unitPricePaise: 39000 }).expect(201);
    const log = await db.auditLog.findFirstOrThrow({
      where: { event: 'COUNTER_SALE_RECORDED', entityId: made.body.id },
    });
    expect(log).toMatchObject({ actorId: 'manager', locationId: SHOP_A });
    expect(log.details).toMatchObject({ agreedPricePaise: 39000, listPricePaise: 40000 });
  });
});

describe('udhaar money counts at the shop that took it', () => {
  const pay = (who: string) =>
    request(server)
      .post('/api/v1/admin/customers/customer/khata/payment')
      .set(as(who))
      .send({ amountPaise: 100, note: 'Payment', idempotencyKey: randomUUID() });
  it('a manager’s receipt lands at their shop, and its reversal with it', async () => {
    const { body } = await pay('managerb').expect(201);
    const entry = await db.customerLedgerEntry.findUniqueOrThrow({ where: { id: body.id } });
    expect(entry.locationId).toBe(SHOP_B);
    const money = await db.financialMovement.findUniqueOrThrow({
      where: { id: entry.financialMovementId! },
    });
    expect(money.locationId).toBe(SHOP_B);
    const reversed = await request(server)
      .post(`/api/v1/admin/customers/customer/khata/reverse/${body.id}`)
      .set(as('owner'))
      .send({ note: 'Entered by mistake', idempotencyKey: randomUUID() })
      .expect(201);
    const undo = await db.customerLedgerEntry.findUniqueOrThrow({
      where: { id: reversed.body.id },
    });
    expect(undo.locationId).toBe(SHOP_B);
  });
  it('an all-shop role’s receipt lands at the main shop', async () => {
    const { body } = await pay('owner').expect(201);
    const entry = await db.customerLedgerEntry.findUniqueOrThrow({ where: { id: body.id } });
    expect(entry.locationId).toBe(SHOP_A);
  });
});

describe('the store settings log', () => {
  it('names what changed and holds no phone number', async () => {
    const store = await request(server).get('/api/v1/store').expect(200);
    await request(server)
      .patch('/api/v1/admin/store')
      .set(as('owner'))
      .send({
        phone: '+919999999000',
        deliveryMessage: 'Delivery within the day',
        deliveryFeePaise: 0,
        freeDeliveryAbovePaise: null,
        onlinePaymentsEnabled: false,
        expectedVersion: store.body.version,
      })
      .expect(200);
    const log = await db.auditLog.findFirstOrThrow({ where: { event: 'STORE_SETTINGS_UPDATED' } });
    expect(JSON.stringify(log)).not.toContain('+91');
    expect((log.details as { fields: string[] }).fields).toContain('phone');
  });
});

describe('who may send a test alert', () => {
  it('only those who look after alerts, as each one spends the day’s WhatsApp budget', async () => {
    await request(server).post('/api/v1/admin/alerts/test').set(as('cashier')).send({}).expect(403);
    await request(server).post('/api/v1/admin/alerts/test').set(as('tech')).send({}).expect(201);
  });
});

describe('a customer’s bulk request', () => {
  it('goes to the shop serving their delivery area, and its order stays there', async () => {
    await db.address.create({
      data: {
        id: 'danapur-site',
        userId: 'customer',
        label: 'Site',
        name: 'Customer',
        phone: '+919999999983',
        line1: 'Plot 3',
        area: 'Danapur',
        city: 'Patna',
        state: 'Bihar',
        pincode: '800021',
        landmark: '',
      },
    });
    const day = new Date(Date.now() + 2 * 86400000).toISOString().slice(0, 10);
    const { body } = await request(server)
      .post('/api/v1/quotes')
      .set(as('customer'))
      .send({
        items: [{ productId: 'cement', quantity: 2 }],
        addressId: 'danapur-site',
        deliveryDate: day,
        idempotencyKey: randomUUID(),
      })
      .expect(201);
    expect((await db.quote.findUniqueOrThrow({ where: { id: body.id } })).locationId).toBe(SHOP_B);
    const list = async (who: string) =>
      (await request(server).get('/api/v1/admin/quotes').set(as(who)).expect(200)).body.items.map(
        (quote: { id: string }) => quote.id,
      );
    expect(await list('managerb')).toContain(body.id);
    expect(await list('manager')).not.toContain(body.id);
  });
});

describe('who may move stock', () => {
  const move = (who: string, kind: string, extra: Record<string, unknown> = {}) =>
    request(server)
      .post('/api/v1/admin/products/cement/movements')
      .set(as(who))
      .send({
        kind,
        quantity: 1,
        note: 'Matrix test',
        idempotencyKey: randomUUID(),
        ...extra,
      });
  it('a stock keeper receives goods at their shop only', async () => {
    await move('keeper', 'PURCHASE_IN').expect(201);
    await move('keeper', 'PURCHASE_IN', { locationId: SHOP_B }).expect(403);
  });
  it('a stock keeper cannot sell, correct or write off', async () => {
    await move('keeper', 'WALK_IN_SALE').expect(403);
    await move('keeper', 'MANUAL_ADJUSTMENT').expect(403);
    await move('keeper', 'DAMAGE').expect(403);
  });
  it('a cashier sells at the counter and receives nothing', async () => {
    await move('cashier', 'WALK_IN_SALE').expect(201);
    await move('cashier', 'PURCHASE_IN').expect(403);
    await move('cashier', 'MANUAL_ADJUSTMENT').expect(403);
  });
  it('a manager cannot change the count, only an owner can', async () => {
    await move('manager', 'MANUAL_ADJUSTMENT').expect(403);
    await move('owner', 'MANUAL_ADJUSTMENT').expect(201);
  });
  it('the accountant only reads', async () => {
    await move('accountant', 'PURCHASE_IN').expect(403);
    await request(server)
      .get('/api/v1/admin/products/cement/movements')
      .set(as('accountant'))
      .expect(200);
  });
  it('a closed or made-up shop is refused', async () => {
    const { body } = await move('owner', 'PURCHASE_IN', { locationId: 'no-such-shop' }).expect(400);
    expect(body.error.code).toBe('INVALID_SHOP');
  });
});

describe('changes take effect on the next request', () => {
  it('pausing someone stops the same token at once', async () => {
    await addPerson(db, {
      id: 'pauseme',
      role: 'CASHIER',
      shops: [SHOP_A],
      phone: '+919000000090',
    });
    await request(server).get('/api/v1/admin/orders').set(as('pauseme')).expect(200);
    await db.user.update({ where: { id: 'pauseme' }, data: { staffPausedAt: new Date() } });
    await request(server).get('/api/v1/admin/orders').set(as('pauseme')).expect(403);
  });
  it('ending a membership stops the same token at once', async () => {
    await addPerson(db, { id: 'endme', role: 'CASHIER', shops: [SHOP_A], phone: '+919000000091' });
    await request(server).get('/api/v1/admin/orders').set(as('endme')).expect(200);
    await db.staffMembership.updateMany({
      where: { userId: 'endme', endedAt: null },
      data: { endedAt: new Date(), endedById: 'owner' },
    });
    await request(server).get('/api/v1/admin/orders').set(as('endme')).expect(403);
  });
});

describe('Tally numbers', () => {
  it('reach owners and the accountant, and no other role, by any route', async () => {
    const routesWithNumbers = routes().filter(
      (route) => route.can?.permission === 'tally.numbers.view',
    );
    expect(routesWithNumbers.length).toBeGreaterThanOrEqual(3);
    const allowed = new Set(['owner', 'accountant']);
    const wrong: string[] = [];
    for (const route of routesWithNumbers)
      for (const { id } of staff) {
        const { status } = await call(route, id);
        if (allowed.has(id) ? status === 403 || status === 401 : status !== 403)
          wrong.push(`${route.name}: ${status} for ${id}`);
      }
    expect(wrong).toEqual([]);
  });
});
