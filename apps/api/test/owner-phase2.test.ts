import 'reflect-metadata';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { loadEnvFile } from 'node:process';
import { existsSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import type { Server } from 'node:http';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import sharp from 'sharp';
import { istToday } from '@shiv/shared';
import { Db } from '../src/db';
import { hash } from '../src/http';
import * as config from '../src/config';

if (existsSync('.env.test')) loadEnvFile('.env.test');
process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
process.env.OTP_PROVIDER = 'mock';
process.env.OTP_HASH_SECRET = 'owner-phase2-test-only-secret-not-for-production';
process.env.CORS_ORIGINS = 'http://localhost:3000,http://localhost:8081';
process.env.STAFF_PASSPHRASE_REQUIRED = 'false';
process.env.OWNER_SESSION_DAYS = '30';
if (!process.env.DATABASE_URL || !new URL(process.env.DATABASE_URL).pathname.endsWith('_test'))
  throw new Error('Owner Phase 2 tests require a dedicated TEST_DATABASE_URL ending in _test.');

let app: INestApplication;
let server: Server;
let db: Db;
const tokens = { owner: 'o'.repeat(43), customer: 'c'.repeat(43) };
const refreshTokens = { owner: 'r'.repeat(43), customer: 's'.repeat(43) };
const phones = { owner: '+919999999981', customer: '+919999999982' };
const auth = (who: keyof typeof tokens = 'owner') => ({ Authorization: `Bearer ${tokens[who]}` });
const address = {
  label: 'Site',
  name: 'Customer',
  phone: phones.customer,
  line1: 'Plot 12',
  area: 'Kankarbagh',
  city: 'Patna',
  state: 'Bihar',
  pincode: '800020',
  landmark: '',
};
const phoneInput = (changes: Record<string, unknown> = {}) => ({
  customerPhone: phones.customer,
  customerName: 'Customer',
  items: [{ productId: 'cement', quantity: 1 }],
  address,
  deliveryDate: 'today',
  paymentMethod: 'COD',
  idempotencyKey: randomUUID(),
  ...changes,
});
const phoneOrder = (changes: Record<string, unknown> = {}) =>
  request(server).post('/api/v1/admin/orders/phone').set(auth()).send(phoneInput(changes));
const listOrders = (query: Record<string, string | number> = {}) =>
  request(server).get('/api/v1/admin/orders').set(auth()).query(query);
const changeStatus = (id: string, status: string) =>
  request(server)
    .patch(`/api/v1/admin/orders/${id}/status`)
    .set(auth())
    .send({ status, note: 'Test delivery' });
const receipt = (amountPaise: number, channel = 'CASH') =>
  request(server)
    .post('/api/v1/admin/customers/customer/khata/payment')
    .set(auth())
    .send({ amountPaise, channel, note: 'Customer payment', idempotencyKey: randomUUID() });
const reverse = (id: string) =>
  request(server)
    .post(`/api/v1/admin/customers/customer/khata/reverse/${id}`)
    .set(auth())
    .send({ note: 'Correct duplicate entry', idempotencyKey: randomUUID() });
const report = () =>
  request(server)
    .get('/api/v1/admin/reports/money')
    .set(auth())
    .query({ from: istToday(), to: istToday() });

beforeAll(async () => {
  config.resetConfigForTests();
  const { createApp } = await import('../src/app');
  app = await createApp();
  await app.listen(0, '127.0.0.1');
  server = app.getHttpServer();
  db = app.get(Db);
}, 30000);
beforeEach(async () => {
  config.resetConfigForTests();
  await db.$executeRawUnsafe(
    'TRUNCATE TABLE "PriceUpdateBatch", "RateSource", "FinancialMovement", "User", "Category", "Product", "Order", "Quote", "AuditLog", "OtpChallenge", "AuthRateLimit", "DeliveryZone", "StoreSettings" RESTART IDENTITY CASCADE',
  );
  for (const id of Object.keys(tokens) as (keyof typeof tokens)[])
    await db.user.create({
      data: {
        id,
        phone: phones[id],
        name: id === 'owner' ? 'Papa' : 'Customer',
        role: id === 'owner' ? 'ADMIN' : 'CUSTOMER',
        ...(id === 'customer' ? { creditAllowed: true, creditLimitPaise: 1000000 } : {}),
        sessions: {
          create: {
            id: `${id}-session`,
            label: `${id} phone`,
            accessHash: hash(tokens[id]),
            refreshHash: hash(refreshTokens[id]),
            createdAt: new Date(Date.now() - 40 * 86400000),
            lastSeenAt: new Date(Date.now() - 600000),
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
      nameHi: 'परीक्षण सीमेंट',
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
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  config.resetConfigForTests();
});
afterAll(async () => {
  if (app) await app.close();
});

describe('Owner Phase 2 APIs against PostgreSQL', () => {
  it('allows production owners to sign in with OTP without a staff credential by default', async () => {
    const policy = config.getConfig();
    expect(policy.STAFF_PASSPHRASE_REQUIRED).toBe(false);
    vi.spyOn(config, 'getConfig').mockReturnValue({
      ...policy,
      NODE_ENV: 'production',
      OTP_PROVIDER: 'twilio',
    });
    const provider = vi.fn(async (url: string | URL | Request) =>
      Response.json({
        status: String(url).endsWith('/VerificationCheck') ? 'approved' : 'pending',
      }),
    );
    vi.stubGlobal('fetch', provider);
    expect(await db.adminCredential.count()).toBe(0);
    await request(server)
      .post('/api/v1/auth/otp/request')
      .send({ phone: phones.owner })
      .expect(201);
    const result = await request(server)
      .post('/api/v1/auth/otp/verify')
      .send({ phone: phones.owner, code: '123456' })
      .expect(201);
    expect(result.body.user).toMatchObject({ id: 'owner', role: 'ADMIN' });
    expect(provider).toHaveBeenCalledTimes(2);
    const session = await db.session.findUniqueOrThrow({
      where: { accessHash: hash(result.body.accessToken) },
    });
    expect(session.refreshExpiresAt.getTime() - Date.now()).toBeGreaterThan(29 * 86400000);
    expect(await db.adminCredential.count()).toBe(0);
  });

  it('slides old owner sessions on activity and refresh for the configured number of days', async () => {
    const policy = config.getConfig();
    vi.spyOn(config, 'getConfig').mockReturnValue({ ...policy, OWNER_SESSION_DAYS: 14 });
    const before = Date.now();
    await request(server).get('/api/v1/auth/session').set(auth()).expect(200);
    const active = await db.session.findUniqueOrThrow({ where: { id: 'owner-session' } });
    expect(active.refreshExpiresAt.getTime()).toBeGreaterThanOrEqual(before + 14 * 86400000);
    expect(active.refreshExpiresAt.getTime()).toBeLessThanOrEqual(Date.now() + 14 * 86400000);
    await db.session.update({
      where: { id: 'owner-session' },
      data: { refreshExpiresAt: new Date(Date.now() + 3600000) },
    });
    const refreshStart = Date.now();
    await request(server)
      .post('/api/v1/auth/refresh')
      .send({ refreshToken: refreshTokens.owner })
      .expect(201);
    const refreshed = await db.session.findUniqueOrThrow({ where: { id: 'owner-session' } });
    expect(refreshed.refreshExpiresAt.getTime()).toBeGreaterThanOrEqual(
      refreshStart + 14 * 86400000,
    );
    expect(refreshed.refreshExpiresAt.getTime()).toBeLessThanOrEqual(Date.now() + 14 * 86400000);
  });

  it('keeps customer expiry fixed across activity and refresh', async () => {
    const before = await db.session.findUniqueOrThrow({ where: { id: 'customer-session' } });
    await request(server).get('/api/v1/auth/session').set(auth('customer')).expect(200);
    await request(server)
      .post('/api/v1/auth/refresh')
      .send({ refreshToken: refreshTokens.customer })
      .expect(201);
    const after = await db.session.findUniqueOrThrow({ where: { id: 'customer-session' } });
    expect(after.refreshExpiresAt).toEqual(before.refreshExpiresAt);
  });

  it('lets an account rename its own devices without editing another account', async () => {
    await request(server)
      .patch('/api/v1/auth/sessions/owner-session')
      .set(auth())
      .send({ label: 'पापा का फोन' })
      .expect(200);
    expect((await db.session.findUniqueOrThrow({ where: { id: 'owner-session' } })).label).toBe(
      'पापा का फोन',
    );
    await request(server)
      .patch('/api/v1/auth/sessions/customer-session')
      .set(auth())
      .send({ label: 'Changed by another user' })
      .expect(404);
    expect((await db.session.findUniqueOrThrow({ where: { id: 'customer-session' } })).label).toBe(
      'customer phone',
    );
  });

  it('filters order groups, phones and customers and rejects cross-filter cursors', async () => {
    const today = new Date(`${istToday()}T00:00:00+05:30`);
    const pending = await phoneOrder().expect(201);
    const yesterday = await phoneOrder().expect(201);
    const delivered = await phoneOrder({
      customerPhone: '+919999999983',
      customerName: 'Second',
    }).expect(201);
    const cancelled = await phoneOrder().expect(201);
    await db.order.update({ where: { id: pending.body.id }, data: { createdAt: today } });
    await db.order.update({
      where: { id: yesterday.body.id },
      data: { createdAt: new Date(today.getTime() - 1) },
    });
    await db.order.update({
      where: { id: delivered.body.id },
      data: { createdAt: today, status: 'DELIVERED' },
    });
    await db.order.update({
      where: { id: cancelled.body.id },
      data: { createdAt: today, status: 'CANCELLED' },
    });
    const phone = await listOrders({ q: '9999999983' }).expect(200);
    expect(phone.body.items.map((order: { id: string }) => order.id)).toEqual([delivered.body.id]);
    const customer = await listOrders({ customerId: 'customer' }).expect(200);
    expect(customer.body.items).toHaveLength(3);
    const recent = await listOrders({ group: 'today' }).expect(200);
    expect(new Set(recent.body.items.map((order: { id: string }) => order.id))).toEqual(
      new Set([pending.body.id, delivered.body.id, cancelled.body.id]),
    );
    const incomplete = await listOrders({ group: 'pending' }).expect(200);
    expect(new Set(incomplete.body.items.map((order: { id: string }) => order.id))).toEqual(
      new Set([pending.body.id, yesterday.body.id]),
    );
    const complete = await listOrders({ group: 'completed' }).expect(200);
    expect(new Set(complete.body.items.map((order: { id: string }) => order.id))).toEqual(
      new Set([delivered.body.id, cancelled.body.id]),
    );
    const page = await listOrders({ limit: 1 }).expect(200);
    expect(page.body.nextCursor).toBeTruthy();
    const mismatched = await listOrders({
      limit: 1,
      group: 'today',
      cursor: page.body.nextCursor,
    }).expect(400);
    expect(mismatched.body.error.code).toBe('INVALID_CURSOR');
  });

  it('nets credit reversals and repayments and exports the same top customers', async () => {
    const first = await phoneOrder({
      paymentMethod: 'CREDIT',
      items: [{ productId: 'cement', quantity: 2 }],
    }).expect(201);
    const second = await phoneOrder({ paymentMethod: 'CREDIT' }).expect(201);
    for (const order of [first.body, second.body])
      for (const status of ['PREPARING', 'OUT_FOR_DELIVERY', 'DELIVERED'])
        await changeStatus(order.id, status).expect(200);
    const sale = await db.customerLedgerEntry.findUniqueOrThrow({
      where: { orderId: first.body.id },
    });
    await reverse(sale.id).expect(201);
    const paid = await receipt(20000).expect(201);
    await reverse(paid.body.id).expect(201);
    await receipt(10000, 'UPI').expect(201);
    const other = await phoneOrder({
      customerPhone: '+919999999983',
      customerName: 'Second',
      items: [{ productId: 'cement', quantity: 3 }],
    }).expect(201);
    const cancelled = await phoneOrder({ items: [{ productId: 'cement', quantity: 4 }] }).expect(
      201,
    );
    await db.order.update({ where: { id: cancelled.body.id }, data: { status: 'CANCELLED' } });
    for (let index = 0; index < 10; index++)
      await phoneOrder({
        customerPhone: `+9198888888${String(index).padStart(2, '0')}`,
        customerName: `Buyer ${index}`,
      }).expect(201);
    const result = await report().expect(200);
    expect(result.body).toMatchObject({ creditSalesPaise: 50000, creditPaymentsPaise: 10000 });
    expect(result.body.topCustomers).toHaveLength(10);
    expect(result.body.topCustomers[0]).toMatchObject({
      id: 'customer',
      totalPaise: 140000,
      orders: 2,
    });
    expect(result.body.topCustomers[1]).toMatchObject({
      id: other.body.userId,
      totalPaise: 130000,
      orders: 1,
    });
    const csv = await request(server)
      .get('/api/v1/admin/reports/export')
      .set(auth())
      .query({ from: istToday(), to: istToday() })
      .expect(200);
    expect(csv.headers['content-type']).toContain('text/csv');
    expect(csv.text).toContain('500.00');
    expect(csv.text).toContain('100.00');
    expect(csv.text).toContain('Customer');
    expect(csv.text).toContain('1400.00');
  }, 30000);

  it('records anonymous cash walk-ins once without inventing a mobile number', async () => {
    const input = phoneInput({
      customerPhone: undefined,
      customerName: undefined,
      source: 'WALK_IN',
      address: undefined,
      items: [{ productId: 'cement', quantity: 3 }],
    });
    const first = await request(server)
      .post('/api/v1/admin/orders/phone')
      .set(auth())
      .send(input)
      .expect(201);
    expect(first.body).toMatchObject({ source: 'WALK_IN', totalPaise: 120000 });
    const anonymous = await db.user.findUniqueOrThrow({ where: { id: first.body.userId } });
    expect(anonymous.phone).not.toMatch(/^\+91[6-9][0-9]{9}$/);
    expect(first.body.address.phone).not.toMatch(/^\+91[6-9][0-9]{9}$/);
    const replay = await request(server)
      .post('/api/v1/admin/orders/phone')
      .set(auth())
      .send(input)
      .expect(201);
    expect(replay.body.id).toBe(first.body.id);
    expect((await db.product.findUniqueOrThrow({ where: { id: 'cement' } })).stock).toBe(97);
    await request(server)
      .post(`/api/v1/admin/orders/${first.body.id}/cod-received`)
      .set(auth())
      .send({ channel: 'CASH' })
      .expect(201);
    expect(
      await db.financialMovement.aggregate({
        where: { kind: 'COLLECTION' },
        _sum: { amountPaise: true },
      }),
    ).toMatchObject({ _sum: { amountPaise: 120000 } });
    await request(server)
      .post('/api/v1/admin/orders/phone')
      .set(auth())
      .send({ ...input, paymentMethod: 'CREDIT', idempotencyKey: randomUUID() })
      .expect(400);
    expect(await db.order.count()).toBe(1);
  });

  it('renders current Hindi rates as PNG pages only for an authenticated owner', async () => {
    await request(server)
      .post('/api/v1/admin/rate-cards/current')
      .send({ language: 'hi' })
      .expect(401);
    await request(server)
      .post('/api/v1/admin/rate-cards/current')
      .set(auth('customer'))
      .send({ language: 'hi' })
      .expect(403);
    await request(server)
      .post('/api/v1/admin/rate-cards/current')
      .set(auth())
      .send({ language: 'xx' })
      .expect(400);
    const card = await request(server)
      .post('/api/v1/admin/rate-cards/current')
      .set(auth())
      .send({ language: 'hi' })
      .expect(201);
    expect(Number.isFinite(Date.parse(card.body.publishedAt))).toBe(true);
    expect(card.body.pages.length).toBeGreaterThan(0);
    const png = Buffer.from(card.body.pages[0].pngBase64, 'base64');
    expect(png.subarray(0, 8)).toEqual(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
    expect((await sharp(png).metadata()).format).toBe('png');
  }, 30000);
});
