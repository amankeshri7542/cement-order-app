import 'reflect-metadata';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { loadEnvFile } from 'node:process';
import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import request from 'supertest';
import type { ArgumentsHost, INestApplication } from '@nestjs/common';
import type { Server } from 'node:http';
import { Prisma } from '@prisma/client';
import { Db } from '../src/db';
import { KhataService } from '../src/khata';
import { Errors, fail, hash } from '../src/http';
import { OrdersService } from '../src/orders';
import { OwnerWorkService } from '../src/owner-work';
import { AlertsService, knownPushService } from '../src/alerts';
import { Maintenance } from '../src/integrations';
import { resetConfigForTests } from '../src/config';

// Firebase is replaced so the worker's phone-push step can run without a real project.
const fcm = vi.hoisted(() => ({ apps: [] as unknown[], send: vi.fn() }));
vi.mock('firebase-admin/app', async (importOriginal) => ({
  ...(await importOriginal<typeof import('firebase-admin/app')>()),
  getApps: () => fcm.apps,
}));
vi.mock('firebase-admin/messaging', () => ({
  getMessaging: () => ({ sendEachForMulticast: fcm.send }),
}));

if (existsSync('.env.test')) loadEnvFile('.env.test');
process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
process.env.OTP_PROVIDER = 'mock';
process.env.OTP_HASH_SECRET = 'hardening-infra-test-only-secret-not-for-production';
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
const phone = '+919999999991';
const address = {
  label: 'Site',
  name: 'Test customer',
  phone,
  line1: 'Plot 12, test street',
  area: 'Kankarbagh',
  city: 'Patna',
  state: 'Bihar',
  pincode: '800020',
  landmark: '',
};
const auth = (who: keyof typeof tokens = 'customer') => ({
  Authorization: `Bearer ${tokens[who]}`,
});
async function order(paymentMethod = 'COD') {
  await request(server)
    .put('/api/v1/cart/items')
    .set(auth())
    .send({ productId: 'cement', quantity: 10 })
    .expect(200);
  const review = await request(server)
    .post('/api/v1/checkout/review')
    .set(auth())
    .send({ addressId: 'customer-address', deliveryDate: date, paymentMethod })
    .expect(201);
  const placed = await request(server)
    .post('/api/v1/orders')
    .set(auth())
    .send({ reviewId: review.body.id, idempotencyKey: randomUUID() })
    .expect(201);
  return placed.body as { id: string; number: string };
}
/** Captures console output of one kind while `run` executes. */
async function captured(kind: 'log' | 'error', run: () => Promise<unknown>) {
  const spy = vi.spyOn(console, kind).mockImplementation(() => {});
  try {
    await run();
    return spy.mock.calls.map(([line]) => String(line)).join('\n');
  } finally {
    spy.mockRestore();
  }
}
/** A worker whose service steps are replaced, so one step can be made to fail. */
function worker(steps: { expireReservations?: () => Promise<unknown> } = {}) {
  return new Maintenance(
    db,
    {
      expireReservations: steps.expireReservations || (async () => ({})),
    } as unknown as OrdersService,
    { dispatch: async () => {} } as unknown as OwnerWorkService,
    { deliver: async () => {} } as unknown as AlertsService,
    new KhataService(db),
  );
}

beforeAll(async () => {
  const { createApp } = await import('../src/app');
  app = await createApp();
  await app.listen(0, '127.0.0.1');
  server = app.getHttpServer();
  db = app.get(Db);
}, 30000);
beforeEach(async () => {
  fcm.apps = [];
  fcm.send.mockReset();
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
            id: `${role}-session`,
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
  await db.storeSettings.create({
    data: { id: 'store', deliveryFeePaise: 50000, onlinePaymentsEnabled: true },
  });
});
afterAll(async () => {
  await app?.close();
});

describe('server error logs', () => {
  function handle(error: unknown) {
    const req = { requestId: 'req-1', method: 'POST', route: { path: '/api/v1/orders/:id' } };
    const res = { status: () => res, json: () => res };
    const host = {
      switchToHttp: () => ({ getRequest: () => req, getResponse: () => res }),
    } as unknown as ArgumentsHost;
    return captured('error', async () => new Errors().catch(error, host));
  }

  it('names the Prisma code, model, route and code of a failure without its message', async () => {
    const logged = await handle(
      new Prisma.PrismaClientKnownRequestError(`Null constraint failed for ${phone}`, {
        code: 'P2011',
        clientVersion: Prisma.prismaVersion.client,
        meta: { modelName: 'Order', field_name: phone },
      }),
    );
    const line = JSON.parse(logged) as Record<string, unknown>;
    expect(line).toMatchObject({
      event: 'REQUEST_FAILED',
      status: 500,
      code: 'INTERNAL_ERROR',
      route: 'POST /api/v1/orders/:id',
      errorType: 'PrismaClientKnownRequestError',
      prismaCode: 'P2011',
      prismaModel: 'Order',
    });
    expect(line.stack).toEqual(expect.arrayContaining([expect.stringMatching(/:\d+$/)]));
    expect(logged).not.toContain('9999999991');
  });

  it('logs the code of a deliberate 5xx failure but never its message', async () => {
    let thrown: unknown;
    try {
      fail('X_CODE', `Provider refused ${phone}`, 503);
    } catch (error) {
      thrown = error;
    }
    const logged = await handle(thrown);
    expect(JSON.parse(logged)).toMatchObject({ status: 503, code: 'X_CODE' });
    expect(logged).toContain('hardening-infra.test.ts:');
    expect(logged).not.toContain('9999999991');
  });
});

describe('maintenance worker', () => {
  it('keeps purging sessions and expiring quotes when one step fails', async () => {
    await db.session.create({
      data: {
        userId: 'customer',
        accessHash: hash('old-access'),
        refreshHash: hash('old-refresh'),
        expiresAt: new Date(Date.now() - 2 * 86400000),
        refreshExpiresAt: new Date(Date.now() - 86400000),
      },
    });
    const quote = await db.quote.create({
      data: {
        number: 'Q-HARDENING-1',
        userId: 'customer',
        status: 'SENT',
        address,
        deliveryDate: date,
        company: '',
        gstin: '',
        notes: '',
        validUntil: new Date(Date.now() - 60000),
      },
    });
    const logged = await captured('error', () =>
      worker({
        expireReservations: () =>
          Promise.reject(
            new Prisma.PrismaClientKnownRequestError(`permission denied for ${phone}`, {
              code: 'P2010',
              clientVersion: Prisma.prismaVersion.client,
            }),
          ),
      }).run(),
    );
    expect(JSON.parse(logged)).toMatchObject({
      event: 'MAINTENANCE_FAILED',
      step: 'reservations',
      prismaCode: 'P2010',
    });
    expect(logged).not.toContain('9999999991');
    expect(await db.session.count({ where: { userId: 'customer' } })).toBe(1);
    expect((await db.quote.findUniqueOrThrow({ where: { id: quote.id } })).status).toBe('EXPIRED');
  });

  it('cancels the other expired reservations when one cannot be cancelled', async () => {
    const first = await order('ONLINE');
    const second = await order('ONLINE');
    await db.order.updateMany({ data: { reservedUntil: new Date(Date.now() - 60000) } });
    const orders = app.get(OrdersService);
    const change = vi.spyOn(orders, 'changeStatus').mockRejectedValueOnce(new Error('boom'));
    try {
      const logged = await captured('error', async () =>
        expect(await orders.expireReservations()).toEqual({ processed: 1, failed: 1 }),
      );
      expect(logged).toContain('RESERVATION_EXPIRY_FAILED');
    } finally {
      change.mockRestore();
    }
    const statuses = await db.order.findMany({
      where: { id: { in: [first.id, second.id] } },
      select: { status: true },
    });
    expect(statuses.map((o) => o.status).sort()).toEqual(['CANCELLED', 'PENDING_PAYMENT']);
  });

  it('marks a phone alert sent when any device got it and never repeats it to that device', async () => {
    fcm.apps = [{}];
    for (const token of ['phone-a', 'phone-b'])
      await db.device.create({
        data: { token, userId: 'customer', platform: 'android', sessionId: 'customer-session' },
      });
    const note = await db.notification.create({
      data: { userId: 'customer', title: 'Order updated', body: 'On the way' },
    });
    fcm.send.mockResolvedValueOnce({
      successCount: 1,
      failureCount: 1,
      responses: [
        { success: true },
        { success: false, error: { code: 'messaging/internal-error' } },
      ],
    });
    const logged = await captured('error', () => worker().run());
    expect(logged).toContain('"code":"messaging/internal-error"');
    expect((await db.notification.findUniqueOrThrow({ where: { id: note.id } })).sentAt).not.toBe(
      null,
    );
    await worker().run();
    expect(fcm.send).toHaveBeenCalledTimes(1);

    // When no device received it, it stays pending and is retried.
    const missed = await db.notification.create({
      data: { userId: 'customer', title: 'Order updated', body: 'Delivered' },
    });
    const failure = { success: false, error: { code: 'messaging/internal-error' } };
    fcm.send.mockResolvedValue({ successCount: 0, failureCount: 2, responses: [failure, failure] });
    await captured('error', () => worker().run());
    expect((await db.notification.findUniqueOrThrow({ where: { id: missed.id } })).sentAt).toBe(
      null,
    );
    await captured('error', () => worker().run());
    expect(fcm.send).toHaveBeenCalledTimes(3);
  });
});

describe('owner web push', () => {
  it('accepts only browser push services as subscription endpoints', async () => {
    expect(knownPushService('https://fcm.googleapis.com/fcm/send/abc')).toBe(true);
    expect(knownPushService('https://updates.push.services.mozilla.com/wpush/v2/abc')).toBe(true);
    expect(knownPushService('https://web.push.apple.com/abc')).toBe(true);
    expect(knownPushService('https://wns2-par02p.notify.windows.com/w/?token=abc')).toBe(true);
    expect(knownPushService('https://fcm.googleapis.com.evil.example/abc')).toBe(false);
    expect(knownPushService('https://evilpush.services.mozilla.com.example/abc')).toBe(false);
    expect(knownPushService('https://127.0.0.1/abc')).toBe(false);

    // A short public key passes config but is refused by web-push, so the worker step fails.
    process.env.WEB_PUSH_PUBLIC_KEY = 'B'.repeat(40);
    process.env.WEB_PUSH_PRIVATE_KEY = 'p'.repeat(43);
    resetConfigForTests();
    try {
      const keys = { p256dh: 'p'.repeat(40), auth: 'a'.repeat(16) };
      const refused = await request(server)
        .post('/api/v1/admin/push/subscriptions')
        .set(auth('admin'))
        .send({ endpoint: 'https://internal.example/collect', keys })
        .expect(400);
      expect(refused.body.error.code).toBe('INVALID_PUSH_ENDPOINT');
      await request(server)
        .post('/api/v1/admin/push/subscriptions')
        .set(auth('admin'))
        .send({ endpoint: 'https://fcm.googleapis.com/fcm/send/abc', keys })
        .expect(201);
      expect(await db.pushSubscription.count()).toBe(1);
      const logged = await captured('log', () => app.get(AlertsService).deliver());
      expect(JSON.parse(logged.split('\n')[0]!)).toMatchObject({
        event: 'WEB_PUSH_FAILED',
        step: 'webPush',
        errorType: 'Error',
      });
    } finally {
      delete process.env.WEB_PUSH_PUBLIC_KEY;
      delete process.env.WEB_PUSH_PRIVATE_KEY;
      resetConfigForTests();
    }
  });
});

describe('account deletion', () => {
  it('removes the customer from staff notes and owner alerts and closes open quotes', async () => {
    const name = 'Zedprobe Kumar';
    const area = 'Zedpur Mohalla';
    await db.user.update({ where: { id: 'admin' }, data: { whatsappAlerts: true } });
    await db.user.update({ where: { id: 'customer' }, data: { name } });
    await db.address.update({ where: { id: 'customer-address' }, data: { area } });
    await request(server)
      .post('/api/v1/admin/demand-overrides')
      .set(auth('admin'))
      .send({
        phone,
        kind: 'ORDER',
        maxTotalPaise: 10000000,
        reason: `Called ${name} about a wholesale order`,
      })
      .expect(201);
    const placed = await order();
    const quote = await request(server)
      .post('/api/v1/quotes')
      .set(auth())
      .send({
        items: [{ productId: 'cement', quantity: 100 }],
        addressId: 'customer-address',
        deliveryDate: date,
      })
      .expect(201);
    await app.get(OwnerWorkService).dispatch();
    const owner = await db.outboundMessage.findMany({ where: { userId: 'admin' } });
    expect(owner).toHaveLength(2);
    expect(JSON.stringify(owner)).toContain(area);
    // The fake WhatsApp provider never prints message parameters.
    const sent = await captured('log', () => app.get(AlertsService).deliver());
    expect(sent).toContain('WHATSAPP_FAKE_SENT');
    expect(sent).not.toContain(area);
    await request(server).post(`/api/v1/orders/${placed.id}/cancel`).set(auth()).expect(201);
    await request(server)
      .post('/api/v1/me/delete')
      .set(auth())
      .send({ confirmation: 'DELETE' })
      .expect(201);

    const audit = JSON.stringify(await db.auditLog.findMany());
    expect(audit).not.toContain('Zedprobe');
    expect(audit).not.toContain(area);
    const granted = await db.auditLog.findFirstOrThrow({
      where: { event: 'DEMAND_OVERRIDE_GRANTED' },
    });
    expect(granted.details).toEqual({ personalDataRemoved: true });
    const messages = await db.outboundMessage.findMany();
    // Delivery evidence stays for the owner; the customer's details do not.
    expect(messages).toHaveLength(2);
    expect(JSON.stringify(messages)).not.toContain(area);
    expect(messages.every((m) => Array.isArray(m.params) && m.params.length === 0)).toBe(true);
    expect(await db.quote.findUniqueOrThrow({ where: { id: quote.body.id } })).toMatchObject({
      status: 'REJECTED',
      decisionSource: 'CUSTOMER',
      decisionNote: 'Closed: customer account deleted.',
    });
    expect(
      await db.auditLog.findFirstOrThrow({ where: { event: 'ACCOUNT_DELETED' } }),
    ).toMatchObject({ details: { closedQuotes: 1 } });
  });
});

describe('malformed request bodies', () => {
  it('answers an unreadable body with 4xx INVALID_BODY and logs no server error', async () => {
    const logged = await captured('error', async () => {
      const charset = await request(server)
        .post('/api/v1/cart/items')
        .set(auth())
        .set('Content-Type', 'application/json; charset=latin1')
        .send('{"productId":"cement","quantity":1}');
      expect(charset.status).toBe(415);
      expect(charset.body.error.code).toBe('INVALID_BODY');
      const encoding = await request(server)
        .post('/api/v1/cart/items')
        .set(auth())
        .set('Content-Type', 'application/json')
        .set('Content-Encoding', 'zstd-unknown')
        .send('{"productId":"cement","quantity":1}');
      expect(encoding.status).toBe(415);
      expect(encoding.body.error.code).toBe('INVALID_BODY');
      // Nest already answers truncated JSON itself with 400 BAD_REQUEST.
      const broken = await request(server)
        .post('/api/v1/cart/items')
        .set(auth())
        .set('Content-Type', 'application/json')
        .send('{"productId":');
      expect(broken.status).toBe(400);
    });
    expect(logged).not.toContain('REQUEST_FAILED');
  });
  it('refuses a staff product in an unknown category with 400, not 500', async () => {
    const r = await request(server).post('/api/v1/admin/products').set(auth('admin')).send({
      name: 'Test cement in no category',
      brand: 'Test',
      categoryId: 'no-such-category',
      type: 'PPC',
      grade: 'PPC',
      unit: '50 kg bag',
      pricePaise: 41000,
      stock: 0,
      active: true,
      images: [],
      description: 'Test material',
      recommendedUse: 'Testing',
    });
    expect(r.status, JSON.stringify(r.body)).toBe(400);
    expect(r.body.error.code).toBe('INVALID_INPUT');
    expect(await db.product.count({ where: { categoryId: 'no-such-category' } })).toBe(0);
  });
});
