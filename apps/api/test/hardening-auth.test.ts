import 'reflect-metadata';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { loadEnvFile } from 'node:process';
import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import request from 'supertest';
import type { INestApplication } from '@nestjs/common';
import { Db } from '../src/db';
import { hash } from '../src/http';
import { hashPassword } from '../src/security';

// Regression tests for the 15 October 2026 audit: authentication, privacy and request hardening
// (F01, F02, F07, F09, F20, F31, F33). Fixtures follow integration.test.ts.
if (existsSync('.env.test')) loadEnvFile('.env.test');
process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
process.env.OTP_PROVIDER = 'mock';
process.env.OTP_HASH_SECRET = 'hardening-test-only-secret-not-for-production';
process.env.CORS_ORIGINS = 'http://localhost:3000,http://localhost:8081';
if (!process.env.DATABASE_URL || !new URL(process.env.DATABASE_URL).pathname.endsWith('_test'))
  throw new Error(
    'Hardening tests require a dedicated TEST_DATABASE_URL database ending in _test.',
  );

let app: INestApplication;
let server: Server;
let db: Db;
const tokens = { customer: 'c'.repeat(43), admin: 'a'.repeat(43) };
const phones = { customer: '+919999999991', admin: '+919999999993' };
const password = 'correct-staff-passphrase';
const date = new Date(Date.now() + 86400000).toISOString().slice(0, 10);
const auth = (who: keyof typeof tokens = 'customer') => ({
  Authorization: `Bearer ${tokens[who]}`,
});
const otpRequest = (phone: string) =>
  request(server).post('/api/v1/auth/otp/request').send({ phone });
const otpVerify = (body: { phone: string; code: string; adminPassword?: string }) =>
  request(server).post('/api/v1/auth/otp/verify').send(body);
const globalBudget = async (action: 'send' | 'verify') =>
  (
    await db.authRateLimit.findFirst({
      where: { key: { startsWith: `budget:otp:${action}:global:` } },
    })
  )?.count ?? 0;
const port = () => (server.address() as AddressInfo).port;

beforeAll(async () => {
  const { createApp } = await import('../src/app');
  app = await createApp();
  // Listen on 127.0.0.1 once (see integration.test.ts for the macOS port-reuse reason).
  await app.listen(0, '127.0.0.1');
  server = app.getHttpServer();
  db = app.get(Db);
}, 30000);
beforeEach(async () => {
  await db.$executeRawUnsafe(
    'TRUNCATE TABLE "User", "Category", "Product", "Order", "Quote", "AuditLog", "OtpChallenge", "AuthRateLimit", "DeliveryZone", "StoreSettings" RESTART IDENTITY CASCADE',
  );
  for (const role of ['customer', 'admin'] as const)
    await db.user.create({
      data: {
        id: role,
        phone: phones[role],
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
        addresses: {
          create: {
            id: `${role}-address`,
            label: 'Site',
            name: 'Test customer',
            phone: phones.customer,
            line1: 'Plot 12, test street',
            area: 'Kankarbagh',
            city: 'Patna',
            state: 'Bihar',
            pincode: '800020',
            landmark: '',
          },
        },
      },
    });
  await db.category.create({ data: { id: 'cement-category', name: 'Cement', slug: 'cement' } });
  await db.product.create({
    data: {
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
    },
  });
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
  await db.storeSettings.create({ data: { id: 'store', deliveryFeePaise: 50000 } });
});
afterAll(async () => {
  await app?.close();
});

describe('F01: store-wide OTP budgets', () => {
  it('per-IP rejections do not use up the store-wide send budget', async () => {
    for (let i = 0; i < 205; i++) await otpRequest(`+9177${String(i).padStart(8, '0')}`);
    // Only the 10 requests the per-IP limit allowed were charged (previously all 200).
    expect(await globalBudget('send')).toBeLessThanOrEqual(10);
    // Another client (no per-IP rows yet) can still request a code.
    await db.authRateLimit.deleteMany({ where: { key: { startsWith: 'send:' } } });
    await otpRequest('+917799999999').expect(201);
  }, 60000);
  it('per-phone cooldown rejections do not use up the send budget', async () => {
    for (let i = 0; i < 5; i++) {
      await db.authRateLimit.deleteMany({ where: { key: { startsWith: 'send:' } } });
      await otpRequest('+917711111111').expect(i ? 429 : 201);
    }
    expect(await globalBudget('send')).toBe(1);
  });
  it('per-IP rejections and junk checks do not use up the store-wide verify budget', async () => {
    const phone = '+917722222222';
    const sent = await otpRequest(phone).expect(201);
    for (let i = 0; i < 205; i++)
      await otpVerify({ phone: `+9178${String(i).padStart(8, '0')}`, code: '000000' });
    expect(await globalBudget('verify')).toBeLessThanOrEqual(30);
    await db.authRateLimit.deleteMany({ where: { key: { startsWith: 'verify:' } } });
    await otpVerify({ phone, code: sent.body.devCode }).expect(201);
    expect(await globalBudget('verify')).toBe(1);
  }, 60000);
});

describe('F07: staff sign-in does not reveal the passphrase', () => {
  beforeEach(async () => {
    await db.adminCredential.create({
      data: { userId: 'admin', passwordHash: await hashPassword(password) },
    });
  });
  it('answers a wrong code the same way whether the passphrase was right or wrong', async () => {
    await otpRequest(phones.admin).expect(201);
    const both = await otpVerify({
      phone: phones.admin,
      code: '000000',
      adminPassword: 'wrong-staff-passphrase',
    });
    const codeOnly = await otpVerify({
      phone: phones.admin,
      code: '000000',
      adminPassword: password,
    });
    expect(both.status).toBe(401);
    expect(codeOnly.status).toBe(401);
    expect(codeOnly.body.error.code).toBe('INVALID_CREDENTIALS');
    expect({ ...codeOnly.body.error, requestId: null }).toEqual({
      ...both.body.error,
      requestId: null,
    });
  });
  it('locks staff sign-in from one address after ten wrong passphrases, even with the right one', async () => {
    for (let i = 0; i < 10; i++) {
      // Five attempts per code: request a fresh one (skipping the 60-second resend wait).
      if (i % 5 === 0) {
        await db.otpChallenge.deleteMany({ where: { phone: phones.admin } });
        await otpRequest(phones.admin).expect(201);
      }
      const wrong = await otpVerify({
        phone: phones.admin,
        code: '000000',
        adminPassword: 'wrong-staff-passphrase',
      });
      expect(wrong.status).toBe(401);
    }
    expect(await db.auditLog.count({ where: { event: 'STAFF_PASSPHRASE_LOCKED' } })).toBe(1);
    await db.otpChallenge.deleteMany({ where: { phone: phones.admin } });
    await db.authRateLimit.deleteMany({ where: { key: { startsWith: 'send:' } } });
    const fresh = await otpRequest(phones.admin).expect(201);
    const locked = await otpVerify({
      phone: phones.admin,
      code: fresh.body.devCode,
      adminPassword: password,
    });
    expect(locked.status).toBe(429);
    expect(
      await db.session.count({ where: { userId: 'admin', adminVerifiedAt: { not: null } } }),
    ).toBe(0);
    // The lockout is per address: the owner signing in from elsewhere is not locked out by
    // someone who only knows the number.
    const { assertStaffAttempts } = await import('../src/security');
    await expect(assertStaffAttempts(db, 'admin', '203.0.113.9')).resolves.toBeUndefined();
  }, 60000);
});

describe('F02: customers never receive staff phone numbers', () => {
  it('shows the acknowledging staff member by name only on orders and quotes', async () => {
    await request(server)
      .put('/api/v1/cart/items')
      .set(auth())
      .send({ productId: 'cement', quantity: 10 })
      .expect(200);
    const review = await request(server)
      .post('/api/v1/checkout/review')
      .set(auth())
      .send({ addressId: 'customer-address', deliveryDate: date, paymentMethod: 'COD' })
      .expect(201);
    const placed = await request(server)
      .post('/api/v1/orders')
      .set(auth())
      .send({ reviewId: review.body.id, idempotencyKey: randomUUID() })
      .expect(201);
    const id = placed.body.id;
    await request(server)
      .post(`/api/v1/admin/orders/${id}/acknowledge`)
      .set(auth('admin'))
      .send({})
      .expect(201);
    const quote = await request(server)
      .post('/api/v1/quotes')
      .set(auth())
      .send({
        items: [{ productId: 'cement', quantity: 100 }],
        addressId: 'customer-address',
        deliveryDate: date,
      })
      .expect(201);
    await request(server)
      .post(`/api/v1/admin/quotes/${quote.body.id}/acknowledge`)
      .set(auth('admin'))
      .send({})
      .expect(201);
    const get = (path: string) => request(server).get(path).set(auth()).expect(200);
    const detail = await get(`/api/v1/orders/${id}`);
    const responses = [
      placed,
      quote,
      detail,
      await get('/api/v1/orders'),
      await get(`/api/v1/orders/${id}/invoice`),
      await get('/api/v1/quotes'),
      await request(server).post(`/api/v1/orders/${id}/cancel`).set(auth()).expect(201),
    ];
    for (const response of responses) {
      const text = JSON.stringify(response.body);
      expect(text).not.toContain(phones.admin);
      expect(text).not.toMatch(/technicalOwner|lastError|nextAttemptAt|"attempts"/);
    }
    const work = { acknowledgedAt: expect.any(String), assignedTo: { name: 'admin' } };
    expect(detail.body.work).toEqual(work);
    expect((await get('/api/v1/quotes')).body.items[0].work).toEqual(work);
    // The owner desk keeps the full record.
    const desk = await request(server)
      .get(`/api/v1/admin/orders/${id}`)
      .set(auth('admin'))
      .expect(200);
    expect(desk.body.work.assignedTo.phone).toBe(phones.admin);
  });
});

/** Sends the headers and only 64 KiB of a larger body; a server that waits for it never answers. */
function partialPost(path: string, headers: Record<string, string>, length: number) {
  type Reply = { status: number; body: { error: { code: string; requestId: string } } };
  return new Promise<Reply>((resolve, reject) => {
    const req = http.request(
      {
        host: '127.0.0.1',
        port: port(),
        path,
        method: 'POST',
        headers: { ...headers, 'Content-Type': 'image/png', 'Content-Length': String(length) },
      },
      (res) => {
        let text = '';
        res.setEncoding('utf8');
        res.on('data', (chunk) => (text += chunk));
        res.on('end', () => {
          req.destroy();
          resolve({ status: res.statusCode!, body: JSON.parse(text) });
        });
      },
    );
    req.on('error', reject);
    req.write(Buffer.alloc(64 * 1024));
  });
}

describe('F09: upload routes refuse anonymous bodies before reading them', () => {
  it('answers anonymous uploads without waiting for the body', async () => {
    // No credential, a made-up token of the right shape or a made-up cookie: none reaches the body
    // parser.
    const callers: Record<string, string>[] = [
      {},
      { Authorization: `Bearer ${'z'.repeat(43)}` },
      { Cookie: 'shiv_access=made-up' },
    ];
    for (const path of ['/api/v1/admin/uploads', '/api/v1/admin/rate-studio/batches'])
      for (const headers of callers) {
        const started = Date.now();
        const anonymous = await partialPost(path, headers, 5 * 1024 * 1024);
        expect(anonymous.status).toBe(401);
        expect(anonymous.body.error.code).toBe('UNAUTHORIZED');
        expect(anonymous.body.error.requestId).toMatch(/^[0-9a-f-]{36}$/);
        expect(Date.now() - started).toBeLessThan(1000);
      }
    // A customer's real session is refused as before (403), also without reading the body.
    for (const path of ['/api/v1/admin/uploads', '/api/v1/admin/rate-studio/batches']) {
      const started = Date.now();
      const customer = await partialPost(path, auth('customer'), 5 * 1024 * 1024);
      expect(customer.status).toBe(403);
      expect(Date.now() - started).toBeLessThan(1000);
    }
    // Preflight requests carry no credentials and must still reach CORS.
    await request(server)
      .options('/api/v1/admin/uploads')
      .set('Origin', 'http://localhost:3000')
      .set('Access-Control-Request-Method', 'POST')
      .expect(204);
  });
});

describe('F20: refresh-token grace and reuse detection', () => {
  it('repeats a lost refresh reply within the grace window, then treats reuse as theft', async () => {
    const phone = '+917733333333';
    const sent = await otpRequest(phone).expect(201);
    const signed = await otpVerify({ phone, code: sent.body.devCode }).expect(201);
    const userId = signed.body.user.id;
    const refresh = (refreshToken: string) =>
      request(server).post('/api/v1/auth/refresh').send({ refreshToken });
    const lost = await refresh(signed.body.refreshToken).expect(201);
    // The reply above never arrived: the app retries with the token it still has.
    const retried = await refresh(signed.body.refreshToken).expect(201);
    expect(retried.body.user.id).toBe(userId);
    expect(await db.session.count({ where: { userId } })).toBe(1);
    const me = (token: string) =>
      request(server).get('/api/v1/me').set('Authorization', `Bearer ${token}`);
    // Same pair both times: whichever reply arrives (or both tabs that raced) stays signed in.
    expect(retried.body.refreshToken).toBe(lost.body.refreshToken);
    expect(retried.body.accessToken).toBe(lost.body.accessToken);
    await me(retried.body.accessToken).expect(200);
    // Signing out with the rotated-out token (a sign-out racing a refresh) still ends it.
    const other = await otpVerify({
      phone,
      code: await (async () => {
        await db.otpChallenge.deleteMany({ where: { phone } });
        return (await otpRequest(phone).expect(201)).body.devCode;
      })(),
    }).expect(201);
    await refresh(other.body.refreshToken).expect(201);
    await request(server)
      .post('/api/v1/auth/logout')
      .send({ refreshToken: other.body.refreshToken })
      .expect(201);
    expect(await db.session.count({ where: { userId } })).toBe(1);
    // After the window, the rotated-out token means someone else holds a copy: end the session.
    await db.session.updateMany({
      where: { userId },
      data: { previousRefreshUntil: new Date(Date.now() - 1000) },
    });
    await refresh(signed.body.refreshToken).expect(401);
    expect(await db.session.count({ where: { userId } })).toBe(0);
    expect(await db.auditLog.count({ where: { event: 'REFRESH_TOKEN_REUSED' } })).toBe(1);
    await me(retried.body.accessToken).expect(401);
    await refresh(retried.body.refreshToken).expect(401);
  });
});

describe('F31: public live-update stream cap', () => {
  it('refuses streams beyond the per-client cap and frees a slot on disconnect', async () => {
    const { getConfig } = await import('../src/config');
    const c = getConfig();
    const old = c.EVENT_STREAMS_PER_IP;
    c.EVENT_STREAMS_PER_IP = 2;
    const opened: http.ClientRequest[] = [];
    const open = () =>
      new Promise<number>((resolve, reject) => {
        const req = http.get({ host: '127.0.0.1', port: port(), path: '/api/v1/events' }, (res) =>
          resolve(res.statusCode!),
        );
        req.on('error', reject);
        opened.push(req);
      });
    try {
      expect(await open()).toBe(200);
      expect(await open()).toBe(200);
      expect(await open()).toBe(429);
      opened[0]!.destroy();
      let status = 429;
      for (let i = 0; i < 50 && status === 429; i++) {
        await new Promise((resolve) => setTimeout(resolve, 20));
        status = await open();
      }
      expect(status).toBe(200);
    } finally {
      for (const req of opened) req.destroy();
      c.EVENT_STREAMS_PER_IP = old;
    }
  });
});

describe('F33: bad list filters', () => {
  it('answers an unknown quote status with 400 instead of 500', async () => {
    const bad = await request(server)
      .get('/api/v1/admin/quotes?status=NOPE')
      .set(auth('admin'))
      .expect(400);
    expect(bad.body.error.code).toBe('INVALID_INPUT');
    await request(server).get('/api/v1/admin/quotes?status=SENT').set(auth('admin')).expect(200);
  });
});
