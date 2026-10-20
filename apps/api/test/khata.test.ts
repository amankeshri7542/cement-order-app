import 'reflect-metadata';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { loadEnvFile } from 'node:process';
import { existsSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import type { INestApplication } from '@nestjs/common';
import type { Server } from 'node:http';
import { Db } from '../src/db';
import { hash } from '../src/http';
import { KhataService } from '../src/khata';

if (existsSync('.env.test')) loadEnvFile('.env.test');
process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
process.env.OTP_PROVIDER = 'mock';
process.env.OTP_HASH_SECRET = 'khata-test-only-secret-not-for-production';
process.env.CORS_ORIGINS = 'http://localhost:3000,http://localhost:8081';
process.env.CREDIT_OVERRIDE_PHONE = '+919999999981';
if (!process.env.DATABASE_URL || !new URL(process.env.DATABASE_URL).pathname.endsWith('_test'))
  throw new Error('Khata tests require a dedicated TEST_DATABASE_URL ending in _test.');

let app: INestApplication;
let server: Server;
let db: Db;
const tokens = { papa: 'p'.repeat(43), uncle: 'u'.repeat(43), customer: 'c'.repeat(43) };
const auth = (who: keyof typeof tokens = 'papa') => ({ Authorization: `Bearer ${tokens[who]}` });
const address = {
  label: 'Site',
  name: 'Customer',
  phone: '+919999999983',
  line1: 'Plot 12',
  area: 'Kankarbagh',
  city: 'Patna',
  state: 'Bihar',
  pincode: '800020',
  landmark: '',
};
const phoneInput = (overrides: Record<string, unknown> = {}) => ({
  customerPhone: address.phone,
  customerName: 'Customer',
  address,
  items: [{ productId: 'cement', quantity: 1 }],
  deliveryDate: 'today',
  paymentMethod: 'CREDIT',
  idempotencyKey: randomUUID(),
  ...overrides,
});
const phone = (input: Record<string, unknown> = phoneInput(), who: keyof typeof tokens = 'papa') =>
  request(server).post('/api/v1/admin/orders/phone').set(auth(who)).send(input);
const entryInput = (amountPaise: number, extra: Record<string, unknown> = {}) => ({
  amountPaise,
  note: 'Test ledger entry',
  idempotencyKey: randomUUID(),
  ...extra,
});
const adjust = (amountPaise: number, extra: Record<string, unknown> = {}) =>
  request(server)
    .post('/api/v1/admin/customers/customer/khata/adjust')
    .set(auth())
    .send(entryInput(amountPaise, extra));
const payment = (input = entryInput(10000)) =>
  request(server).post('/api/v1/admin/customers/customer/khata/payment').set(auth()).send(input);
const reverse = (id: string, input = { note: 'Correct entry', idempotencyKey: randomUUID() }) =>
  request(server)
    .post(`/api/v1/admin/customers/customer/khata/reverse/${id}`)
    .set(auth())
    .send(input);
const status = (id: string, next: string) =>
  request(server)
    .patch(`/api/v1/admin/orders/${id}/status`)
    .set(auth())
    .send({ status: next, note: 'Test delivery' });
async function dispatch() {
  const result = await phone();
  expect(result.status, JSON.stringify(result.body)).toBe(201);
  await status(result.body.id, 'PREPARING').expect(200);
  await status(result.body.id, 'OUT_FOR_DELIVERY').expect(200);
  return result.body as { id: string; totalPaise: number };
}
async function invariant() {
  const entries = await db.customerLedgerEntry.findMany({
    where: { customerId: 'customer' },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
  });
  // createdAt may tie; the balance chain still identifies the serial order.
  expect(entries.reduce((total, row) => total + row.amountPaise, 0)).toBe(
    (await db.user.findUniqueOrThrow({ where: { id: 'customer' } })).khataBalancePaise,
  );
  expect((await app.get(KhataService).checkBalances()).drift).toBe(0);
  return entries;
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
    'TRUNCATE TABLE "PriceUpdateBatch", "RateSource", "FinancialMovement", "User", "Category", "Product", "Order", "Quote", "AuditLog", "OtpChallenge", "AuthRateLimit", "DeliveryZone", "StoreSettings" RESTART IDENTITY CASCADE',
  );
  for (const [index, id] of (Object.keys(tokens) as (keyof typeof tokens)[]).entries())
    await db.user.create({
      data: {
        id,
        phone: `+91999999998${index + 1}`,
        name: id,
        role: id === 'customer' ? 'CUSTOMER' : 'ADMIN',
        ...(id === 'customer' ? { creditAllowed: true, creditLimitPaise: 200000 } : {}),
        sessions: {
          create: {
            accessHash: hash(tokens[id]),
            refreshHash: hash(`${id}-refresh`),
            expiresAt: new Date(Date.now() + 3600000),
            refreshExpiresAt: new Date(Date.now() + 86400000),
          },
        },
      },
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
      id: 'zone',
      name: 'Patna',
      deliveryFeePaise: 10000,
      estimate: 'Today',
      pincodes: { create: { pincode: '800020' } },
    },
  });
  await db.storeSettings.create({ data: { id: 'store' } });
});
afterAll(async () => {
  if (app) await app.close();
});

describe('Phone orders and khata against PostgreSQL', () => {
  it('protects all new routes from customers and anonymous requests', async () => {
    const paths = [
      ['post', 'orders/phone'],
      ['get', 'customers/customer/khata'],
      ['post', 'customers/customer/khata/payment'],
      ['post', 'customers/customer/khata/adjust'],
      ['post', 'customers/customer/khata/reverse/entry'],
      ['get', 'khata/summary'],
      ['patch', 'customers/customer'],
      ['post', 'customers/customer/notes'],
      ['get', 'customers/customer/notes'],
      ['post', 'customers/customer/contacts'],
    ] as const;
    for (const [method, path] of paths) {
      await request(server)[method](`/api/v1/admin/${path}`).expect(401);
      await request(server)[method](`/api/v1/admin/${path}`).set(auth('customer')).expect(403);
    }
  });

  it('creates a Hindi customer without a session and snapshots server prices', async () => {
    const result = await phone(
      phoneInput({ customerPhone: '+919999999984', paymentMethod: 'COD' }),
    );
    expect(result.status, JSON.stringify(result.body)).toBe(201);
    expect(result.body).toMatchObject({
      source: 'PHONE',
      createdById: 'papa',
      reviewId: null,
      status: 'CONFIRMED',
      subtotalPaise: 40000,
      deliveryFeePaise: 10000,
      totalPaise: 50000,
      items: [{ pricePaise: 40000, priceVersion: 1 }],
      work: { assignedToId: 'papa' },
    });
    expect(result.body.work.acknowledgedAt).toBeTruthy();
    const customer = await db.user.findUniqueOrThrow({
      where: { id: result.body.userId },
      include: { sessions: true },
    });
    expect(customer).toMatchObject({
      role: 'CUSTOMER',
      language: 'hi',
      creditAllowed: false,
      creditLimitPaise: null,
      khataBalancePaise: 0,
      sessions: [],
    });
    expect(customer.lastOrderAt).toBeTruthy();
    expect(await db.product.findUniqueOrThrow({ where: { id: 'cement' } })).toMatchObject({
      stock: 99,
    });
    expect(await db.auditLog.count({ where: { event: 'PHONE_ORDER_CREATED' } })).toBe(1);
  });

  it('supports WALK_IN without an address or delivery fee, and cancellation releases stock', async () => {
    const input = phoneInput({ source: 'WALK_IN', address: undefined, paymentMethod: 'COD' });
    const result = await phone(input).expect(201);
    expect(result.body).toMatchObject({
      source: 'WALK_IN',
      totalPaise: 40000,
      deliveryFeePaise: 0,
    });
    await status(result.body.id, 'CANCELLED').expect(200);
    expect((await db.product.findUniqueOrThrow({ where: { id: 'cement' } })).stock).toBe(100);
    expect(await db.customerLedgerEntry.count()).toBe(0);
  });

  it('enforces address, date, quantity, availability, delivery zones and server pricing', async () => {
    for (const changes of [
      { address: undefined },
      { deliveryDate: '2026-02-30' },
      { deliveryDate: '2000-01-01' },
      { items: [{ productId: 'cement', quantity: 0 }] },
      { totalPaise: 1 },
      {
        items: [
          { productId: 'cement', quantity: 1 },
          { productId: 'cement', quantity: 1 },
        ],
      },
    ])
      await phone(phoneInput(changes)).expect(400);
    await phone(phoneInput({ address: { ...address, pincode: '800001' } })).expect(409);
    await phone(phoneInput({ items: [{ productId: 'missing', quantity: 1 }] })).expect(409);
    await db.product.update({ where: { id: 'cement' }, data: { minQuantity: 2, quantityStep: 2 } });
    await phone().expect(400);
    expect(await db.order.count()).toBe(0);
    expect(await db.inventoryMovement.count()).toBe(0);
  });

  it('replays identical orders, rejects a changed key, and never decrements twice', async () => {
    const input = phoneInput();
    const first = await phone(input).expect(201);
    const replay = await phone(input, 'uncle').expect(201);
    expect(replay.body.id).toBe(first.body.id);
    await phone({ ...input, notes: 'Different terms' }).expect(409);
    expect(await db.order.count()).toBe(1);
    expect(await db.inventoryMovement.count()).toBe(1);
  });

  it('serializes simultaneous same-key orders for a newly created customer', async () => {
    const input = phoneInput({ customerPhone: '+919999999984', paymentMethod: 'COD' });
    const results = await Promise.all([phone(input), phone(input, 'uncle')]);
    expect(results.map((r) => r.status)).toEqual([201, 201]);
    expect(results[0]!.body.id).toBe(results[1]!.body.id);
    expect(await db.order.count()).toBe(1);
    expect(await db.inventoryMovement.count()).toBe(1);
  });

  it('never oversells the last bag when two owners place orders', async () => {
    await db.product.update({ where: { id: 'cement' }, data: { stock: 1 } });
    const results = await Promise.all([
      phone(phoneInput()),
      phone(phoneInput({ customerPhone: '+919999999984', paymentMethod: 'COD' }), 'uncle'),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual([201, 409]);
    expect((await db.product.findUniqueOrThrow({ where: { id: 'cement' } })).stock).toBe(0);
    expect(await db.order.count()).toBe(1);
    expect(await db.inventoryMovement.count()).toBe(1);
  });

  it('requires permission and a configured limit, and reserves undelivered credit exposure', async () => {
    await db.user.update({ where: { id: 'customer' }, data: { creditAllowed: false } });
    await phone().expect(409);
    await db.user.update({
      where: { id: 'customer' },
      data: { creditAllowed: true, creditLimitPaise: 50000 },
    });
    await phone().expect(201);
    const second = await phone().expect(409);
    expect(second.body.error.code).toBe('CREDIT_LIMIT_EXCEEDED');
    expect(await db.customerLedgerEntry.count()).toBe(0);
    expect((await db.user.findUniqueOrThrow({ where: { id: 'customer' } })).khataBalancePaise).toBe(
      0,
    );
  });

  it('allows only Papa to override, with one audit per order', async () => {
    await db.user.update({ where: { id: 'customer' }, data: { creditLimitPaise: 1 } });
    const input = phoneInput({ overrideLimit: true });
    await phone(input, 'uncle').expect(403);
    const first = await phone(input).expect(201);
    await phone(input).expect(201);
    expect(await db.auditLog.findMany({ where: { event: 'CREDIT_LIMIT_OVERRIDE' } })).toMatchObject(
      [{ actorId: 'papa', entityId: first.body.id }],
    );
    expect(await db.order.count()).toBe(1);
  });

  it('serializes credit-limit reservations and releases them on cancellation', async () => {
    await db.user.update({ where: { id: 'customer' }, data: { creditLimitPaise: 50000 } });
    const results = await Promise.all([phone(), phone(phoneInput(), 'uncle')]);
    expect(results.map((result) => result.status).sort()).toEqual([201, 409]);
    const placed = results.find((result) => result.status === 201)!;
    await status(placed.body.id, 'CANCELLED').expect(200);
    await phone().expect(201);
    expect(await db.customerLedgerEntry.count()).toBe(0);
    await db.user.update({ where: { id: 'customer' }, data: { creditAllowed: false } });
    await phone(phoneInput({ overrideLimit: true })).expect(409);
  });

  it('cannot override the supported ledger balance range', async () => {
    await adjust(1_999_990_000).expect(201);
    const result = await phone(phoneInput({ overrideLimit: true })).expect(409);
    expect(result.body.error.code).toBe('KHATA_OVERFLOW');
    expect(await db.order.count()).toBe(0);
    expect(await db.inventoryMovement.count()).toBe(0);
    await invariant();
  });

  it('reverses a sale with a new entry, preserves the original and prevents double posting', async () => {
    const order = await dispatch();
    await status(order.id, 'DELIVERED').expect(200);
    const original = await db.customerLedgerEntry.findUniqueOrThrow({
      where: { orderId: order.id },
    });
    const reversed = await reverse(original.id).expect(201);
    expect(reversed.body).toMatchObject({ amountPaise: -50000, balanceAfterPaise: 0 });
    expect(await db.customerLedgerEntry.findUniqueOrThrow({ where: { id: original.id } })).toEqual(
      original,
    );
    await status(order.id, 'DELIVERED').expect(409);
    expect(await db.financialMovement.count()).toBe(0);
    await invariant();
    const dashboard = await request(server).get('/api/v1/admin/dashboard').set(auth()).expect(200);
    expect(dashboard.body).toMatchObject({ khataDuePaise: 0, todayCreditSalesPaise: 0 });
  });

  it('posts exactly one sale on delivery and rejects COD receipts for credit', async () => {
    const order = await dispatch();
    await request(server)
      .post(`/api/v1/admin/orders/${order.id}/cod-received`)
      .set(auth())
      .send({})
      .expect(409);
    await status(order.id, 'DELIVERED').expect(200);
    await status(order.id, 'DELIVERED').expect(409);
    const entries = await invariant();
    expect(entries).toMatchObject([
      {
        kind: 'SALE_ON_CREDIT',
        amountPaise: order.totalPaise,
        balanceAfterPaise: order.totalPaise,
        orderId: order.id,
      },
    ]);
    expect(await db.financialMovement.count()).toBe(0);
    const queue = await request(server)
      .get('/api/v1/admin/orders?queue=payments')
      .set(auth())
      .expect(200);
    expect(queue.body.items).toHaveLength(0);
  });

  it('keeps cash delivery gated on receipt', async () => {
    const result = await phone(phoneInput({ paymentMethod: 'COD' })).expect(201);
    await status(result.body.id, 'PREPARING').expect(200);
    await status(result.body.id, 'OUT_FOR_DELIVERY').expect(200);
    await status(result.body.id, 'DELIVERED').expect(409);
    await request(server)
      .post(`/api/v1/admin/orders/${result.body.id}/cod-received`)
      .set(auth())
      .send({})
      .expect(201);
    await status(result.body.id, 'DELIVERED').expect(200);
    expect(await db.customerLedgerEntry.count()).toBe(0);
  });

  it('records opening balance, signed adjustments and payments in one chain', async () => {
    const opening = await adjust(100000).expect(201);
    expect(opening.body).toMatchObject({ kind: 'OPENING_BALANCE', balanceAfterPaise: 100000 });
    await adjust(-20000).expect(201);
    const paid = await payment(entryInput(30000, { channel: 'UPI' })).expect(201);
    expect(paid.body).toMatchObject({
      kind: 'PAYMENT_RECEIVED',
      amountPaise: -30000,
      balanceAfterPaise: 50000,
    });
    const financial = await db.financialMovement.findUniqueOrThrow({
      where: { id: paid.body.financialMovementId },
    });
    expect(financial).toMatchObject({ kind: 'KHATA_PAYMENT', amountPaise: 30000, channel: 'UPI' });
    expect((await invariant()).map((row) => row.balanceAfterPaise)).toEqual([100000, 80000, 50000]);
  });

  it('replays payment and adjustment receipts and rejects payload or operation conflicts', async () => {
    const input = entryInput(10000);
    const results = await Promise.all([payment(input), payment(input)]);
    expect(results.map((r) => r.status)).toEqual([201, 201]);
    expect(results[0]!.body.id).toBe(results[1]!.body.id);
    await payment({ ...input, amountPaise: 20000 }).expect(409);
    await adjust(10000, { idempotencyKey: input.idempotencyKey }).expect(409);
    expect(await db.financialMovement.count()).toBe(1);
    expect(await db.customerLedgerEntry.count()).toBe(1);
    await invariant();
  });

  it('rolls back both the cash record and ledger on overflow', async () => {
    await adjust(-2_000_000_000).expect(201);
    await payment(entryInput(1)).expect(409);
    expect(await db.financialMovement.count()).toBe(0);
    expect(await db.customerLedgerEntry.count()).toBe(1);
    await invariant();
  });

  it('serializes simultaneous payment and delivery without losing either entry', async () => {
    const order = await dispatch();
    await adjust(20000).expect(201);
    const results = await Promise.all([payment(entryInput(10000)), status(order.id, 'DELIVERED')]);
    expect(results.map((r) => r.status)).toEqual([201, 200]);
    const entries = await invariant();
    expect(entries).toHaveLength(3);
    expect((await db.user.findUniqueOrThrow({ where: { id: 'customer' } })).khataBalancePaise).toBe(
      60000,
    );
    expect(entries.at(-1)!.balanceAfterPaise).toBe(60000);
  });

  it('uses immutable reversals and reverses the financial receipt too', async () => {
    const original = await payment(entryInput(20000)).expect(201);
    const input = { note: 'Mistaken cash receipt', idempotencyKey: randomUUID() };
    const reversed = await reverse(original.body.id, input).expect(201);
    expect(reversed.body).toMatchObject({
      kind: 'REVERSAL',
      amountPaise: 20000,
      balanceAfterPaise: 0,
      reversesId: original.body.id,
    });
    expect((await reverse(original.body.id, input).expect(201)).body.id).toBe(reversed.body.id);
    await reverse(original.body.id).expect(409);
    await reverse(reversed.body.id).expect(409);
    expect(
      await db.financialMovement.findMany({ where: { kind: 'KHATA_PAYMENT_REVERSAL' } }),
    ).toMatchObject([{ amountPaise: 20000, channel: 'CASH' }]);
    await expect(
      db.customerLedgerEntry.update({ where: { id: original.body.id }, data: { note: 'Edit' } }),
    ).rejects.toThrow(/immutable/);
    await expect(
      db.customerLedgerEntry.delete({ where: { id: original.body.id } }),
    ).rejects.toThrow(/immutable/);
    await invariant();
  });

  it('supports customer settings, notes, contacts, area search and due pagination', async () => {
    await request(server)
      .patch('/api/v1/admin/customers/customer')
      .set(auth())
      .send({ area: 'Danapur', tags: ['ठेकेदार'], creditAllowed: true, creditLimitPaise: 100000 })
      .expect(200);
    const note = await request(server)
      .post('/api/v1/admin/customers/customer/notes')
      .set(auth())
      .send({ body: 'Call before delivery' })
      .expect(201);
    const notes = await request(server)
      .get('/api/v1/admin/customers/customer/notes?limit=1')
      .set(auth())
      .expect(200);
    expect(notes.body.items[0].id).toBe(note.body.id);
    await request(server)
      .post('/api/v1/admin/customers/customer/contacts')
      .set(auth())
      .send({ channel: 'WHATSAPP', purpose: 'Payment reminder handed off' })
      .expect(201);
    await adjust(10000).expect(201);
    await db.user.create({ data: { id: 'advance', phone: '+919999999985' } });
    await request(server)
      .post('/api/v1/admin/customers/advance/khata/payment')
      .set(auth())
      .send(entryInput(100))
      .expect(201);
    const list = await request(server)
      .get('/api/v1/admin/customers?sort=due&limit=1')
      .set(auth())
      .expect(200);
    expect(list.body.items).toMatchObject([
      { id: 'customer', balancePaise: 10000, area: 'Danapur', notesCount: 1 },
    ]);
    const next = await request(server)
      .get(`/api/v1/admin/customers?sort=due&limit=1&cursor=${list.body.nextCursor}`)
      .set(auth())
      .expect(200);
    expect(next.body.items).toMatchObject([{ id: 'advance', balancePaise: -100 }]);
    const found = await request(server)
      .get('/api/v1/admin/customers?q=danapur')
      .set(auth())
      .expect(200);
    expect(found.body.items).toHaveLength(1);
    await request(server)
      .get(`/api/v1/admin/customers?sort=recent&cursor=${list.body.nextCursor}`)
      .set(auth())
      .expect(400);
    expect(await db.customerContact.count()).toBe(1);
  });

  it('shows account snapshots, daily dashboard metrics and collection reports', async () => {
    const order = await dispatch();
    await status(order.id, 'DELIVERED').expect(200);
    await payment(entryInput(10000)).expect(201);
    const ledger = await request(server)
      .get('/api/v1/admin/customers/customer/khata?limit=1')
      .set(auth())
      .expect(200);
    expect(ledger.body).toMatchObject({ balancePaise: 40000, creditLimitPaise: 200000 });
    expect(ledger.body.entries.items).toHaveLength(1);
    expect(ledger.body.entries.nextCursor).toBeTruthy();
    const dashboard = await request(server).get('/api/v1/admin/dashboard').set(auth()).expect(200);
    expect(dashboard.body).toMatchObject({
      khataDuePaise: 40000,
      todayCreditSalesPaise: 50000,
      todayPhoneOrders: 1,
      pendingPayments: 0,
      todaySalesPaise: 10000,
    });
    const today = new Date(Date.now() + 5.5 * 3600000).toISOString().slice(0, 10);
    const report = await request(server)
      .get(`/api/v1/admin/reports/money?from=${today}&to=${today}`)
      .set(auth())
      .expect(200);
    expect(report.body).toMatchObject({ collections: { cashPaise: 10000 }, netPaise: 10000 });
  });

  it('ages unpaid debt FIFO, excludes advance balances and deducts later payments', async () => {
    const old = new Date(Date.now() - 40 * 86400000).toISOString();
    await adjust(100000, { occurredAt: old }).expect(201);
    await adjust(50000).expect(201);
    await payment(entryInput(60000)).expect(201);
    const summary = await request(server)
      .get('/api/v1/admin/khata/summary')
      .set(auth())
      .expect(200);
    expect(summary.body).toMatchObject({
      totalDuePaise: 90000,
      customersWithDue: 1,
      overdue30d: [{ id: 'customer', balancePaise: 90000, overduePaise: 40000 }],
    });
    await payment(entryInput(40000)).expect(201);
    expect(
      (await request(server).get('/api/v1/admin/khata/summary').set(auth()).expect(200)).body
        .overdue30d,
    ).toEqual([]);
  });

  it('rejects future/invalid amounts, missing customers and cross-customer reversals', async () => {
    await payment(entryInput(0)).expect(400);
    await payment(entryInput(-100)).expect(400);
    await payment(entryInput(0.5)).expect(400);
    await payment(entryInput(100, { occurredAt: '2999-01-01' })).expect(400);
    await request(server)
      .patch('/api/v1/admin/customers/customer')
      .set(auth())
      .send({ creditLimitPaise: null })
      .expect(400);
    await request(server).get('/api/v1/admin/customers/missing/khata').set(auth()).expect(404);
    await request(server)
      .patch('/api/v1/admin/customers/papa')
      .set(auth())
      .send({ area: 'Test' })
      .expect(404);
    const original = await adjust(1000).expect(201);
    await request(server)
      .post(`/api/v1/admin/customers/papa/khata/reverse/${original.body.id}`)
      .set(auth())
      .send({ note: 'Wrong customer', idempotencyKey: randomUUID() })
      .expect(404);
  });

  it('blocks deletion while money is owed and scrubs CRM personal fields once settled', async () => {
    await request(server)
      .patch('/api/v1/admin/customers/customer')
      .set(auth())
      .send({ area: 'Private area', tags: ['Private'] })
      .expect(200);
    await request(server)
      .post('/api/v1/admin/customers/customer/notes')
      .set(auth())
      .send({ body: 'Private note' })
      .expect(201);
    await adjust(1000).expect(201);
    await request(server)
      .post('/api/v1/me/delete')
      .set(auth('customer'))
      .send({ confirmation: 'DELETE' })
      .expect(409);
    await payment(entryInput(1000)).expect(201);
    await request(server)
      .post('/api/v1/me/delete')
      .set(auth('customer'))
      .send({ confirmation: 'DELETE' })
      .expect(201);
    expect(await db.user.findUniqueOrThrow({ where: { id: 'customer' } })).toMatchObject({
      area: '',
      tags: [],
      creditAllowed: false,
    });
    expect((await db.customerNote.findFirstOrThrow()).body).toBe('');
    expect(await db.customerLedgerEntry.count()).toBe(2);
  });

  it('detects drift without changing the cache or ledger', async () => {
    await adjust(1000).expect(201);
    await db.user.update({ where: { id: 'customer' }, data: { khataBalancePaise: 2000 } });
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      expect(await app.get(KhataService).checkBalances()).toMatchObject({ drift: 1 });
      expect(log.mock.calls.some(([value]) => String(value).includes('KHATA_DRIFT'))).toBe(true);
      expect(
        (await db.user.findUniqueOrThrow({ where: { id: 'customer' } })).khataBalancePaise,
      ).toBe(2000);
      expect(await db.customerLedgerEntry.count()).toBe(1);
    } finally {
      log.mockRestore();
    }
  });

  it('exposes the new authenticated routes and request contracts in OpenAPI', async () => {
    const spec = await request(server).get('/api/docs-json').expect(200);
    expect(spec.body.paths['/api/v1/admin/orders/phone'].post.requestBody).toBeTruthy();
    expect(spec.body.paths['/api/v1/admin/customers/{id}/khata/payment'].post).toBeTruthy();
    expect(spec.body.paths['/api/v1/admin/khata/summary'].get).toBeTruthy();
  });
});
