import 'reflect-metadata';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { loadEnvFile } from 'node:process';
import type { Server } from 'node:http';
import type { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { quoteRequestSchema } from '@shiv/shared';
import request from 'supertest';
import { Db } from '../src/db';
import { hash } from '../src/http';
import { Events } from '../src/catalog';
import { OwnerWorkService } from '../src/owner-work';
import { OrdersService } from '../src/orders';
import { PaymentsService } from '../src/payments';

if (existsSync('.env.test')) loadEnvFile('.env.test');
if (!process.env.TEST_DATABASE_URL)
  throw new Error('Set a local TEST_DATABASE_URL ending in _test.');
const source = new URL(process.env.TEST_DATABASE_URL);
if (
  !source.pathname.endsWith('_test') ||
  !['localhost', '127.0.0.1', '::1'].includes(source.hostname)
)
  throw new Error('Workflow tests are restricted to local disposable PostgreSQL databases.');
const databaseName = 'shiv_workflows_test';
const testUrl = new URL(source);
testUrl.pathname = `/${databaseName}`;
const adminUrl = new URL(source);
adminUrl.pathname = '/postgres';
process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = testUrl.href;
process.env.OTP_PROVIDER = 'mock';
process.env.OTP_HASH_SECRET = 'local-workflow-test-secret-not-production';
process.env.RAZORPAY_KEY_ID = 'rzp_test_workflows';
process.env.RAZORPAY_KEY_SECRET = 'local-workflow-key-secret';
process.env.RAZORPAY_WEBHOOK_SECRET = 'local-workflow-webhook-secret';
process.env.CORS_ORIGINS = 'http://localhost:3000,http://localhost:8081';

const adminDb = new PrismaClient({ datasourceUrl: adminUrl.href });
let ownsDatabase = false;
let app: INestApplication | undefined;
let server: Server;
let db: Db;
let orders: OrdersService;
let payments: PaymentsService;
let work: OwnerWorkService;
const tokens = {
  customer: 'c'.repeat(43),
  other: 'o'.repeat(43),
  father: 'f'.repeat(43),
  uncle: 'u'.repeat(43),
};
type Person = keyof typeof tokens;
const auth = (who: Person = 'customer') => ({ Authorization: `Bearer ${tokens[who]}` });
const date = new Date(Date.now() + 86400000).toISOString().slice(0, 10);
const retryDate = new Date(Date.now() + 2 * 86400000).toISOString().slice(0, 10);
const address = {
  label: 'Test site',
  name: 'Test customer',
  phone: '+919999999981',
  line1: '12 test site road',
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
  packSize: '50 kg',
  pricePaise: 39000,
  stock: 100,
  active: true,
  images: [],
  description: 'Workflow test material',
  recommendedUse: 'Testing',
};

beforeAll(async () => {
  const existing = await adminDb.$queryRaw<{ exists: boolean }[]>`
    SELECT EXISTS(SELECT 1 FROM pg_database WHERE datname = ${databaseName}) AS exists`;
  if (!existing[0]?.exists) await adminDb.$executeRawUnsafe(`CREATE DATABASE "${databaseName}"`);
  ownsDatabase = true;
  execFileSync(process.execPath, [require.resolve('prisma/build/index.js'), 'migrate', 'deploy'], {
    cwd: process.cwd(),
    env: process.env,
    stdio: 'pipe',
  });
  const { createApp } = await import('../src/app');
  app = await createApp();
  await app.init();
  server = app.getHttpServer();
  db = app.get(Db);
  orders = app.get(OrdersService);
  payments = app.get(PaymentsService);
  work = app.get(OwnerWorkService);
}, 60000);

beforeEach(async () => {
  await db.$executeRawUnsafe(
    'TRUNCATE TABLE "PriceUpdateBatch", "RateSource", "FinancialMovement", "User", "Category", "Product", "Order", "Quote", "AuditLog", "OtpChallenge", "AuthRateLimit", "DeliveryZone", "StoreSettings" RESTART IDENTITY CASCADE',
  );
  for (const [index, id] of (Object.keys(tokens) as Person[]).entries())
    await db.user.create({
      data: {
        id,
        phone: `+91999999998${index + 1}`,
        name: id === 'father' ? 'Father — retail' : id === 'uncle' ? 'Uncle — wholesale' : id,
        role: id === 'father' || id === 'uncle' ? 'ADMIN' : 'CUSTOMER',
        sessions: {
          create: {
            accessHash: hash(tokens[id]),
            refreshHash: hash(`${id}-refresh`),
            expiresAt: new Date(Date.now() + 3600000),
            refreshExpiresAt: new Date(Date.now() + 86400000),
          },
        },
        addresses: { create: { id: `${id}-address`, ...address } },
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
      reference: 'Workflow fixture',
      note: 'Opening test stock',
      idempotencyKey: 'opening:cement',
    },
  });
  await db.deliveryZone.create({
    data: {
      id: 'test-zone',
      name: 'Patna test zone',
      deliveryFeePaise: 50000,
      minimumOrderPaise: 0,
      estimate: 'Local test delivery',
      pincodes: { create: { pincode: '800020' } },
    },
  });
  await db.storeSettings.create({
    data: { id: 'store', deliveryFeePaise: 50000, onlinePaymentsEnabled: true },
  });
  // No gateway/SMS calls are permitted. Captures below are explicitly synthetic provider events.
  vi.spyOn(payments, 'gateway').mockRejectedValue(
    new Error('No external provider calls in PostgreSQL workflow tests'),
  );
});
afterEach(() => vi.restoreAllMocks());
afterAll(async () => {
  await app?.close();
  if (ownsDatabase) await adminDb.$executeRawUnsafe(`DROP DATABASE "${databaseName}" WITH (FORCE)`);
  await adminDb.$disconnect();
}, 30000);

async function cart(who: Person = 'customer', quantity = 50) {
  await request(server)
    .put('/api/v1/cart/items')
    .set(auth(who))
    .send({ productId: 'cement', quantity })
    .expect(200);
}
async function review(who: Person = 'customer', paymentMethod = 'COD') {
  const response = await request(server)
    .post('/api/v1/checkout/review')
    .set(auth(who))
    .send({ addressId: `${who}-address`, deliveryDate: date, paymentMethod })
    .expect(201);
  return response.body;
}
async function place(reviewId: string, who: Person = 'customer', idempotencyKey = randomUUID()) {
  return request(server).post('/api/v1/orders').set(auth(who)).send({ reviewId, idempotencyKey });
}
async function order(paymentMethod = 'COD', quantity = 50) {
  await cart('customer', quantity);
  const checked = await review('customer', paymentMethod);
  const placed = await place(checked.id);
  expect(placed.status).toBe(201);
  return placed.body;
}
async function status(id: string, next: string) {
  return request(server)
    .patch(`/api/v1/admin/orders/${id}/status`)
    .set(auth('father'))
    .send({ status: next, note: 'Workflow test action' });
}
async function dispatch(id: string) {
  expect((await status(id, 'PREPARING')).status).toBe(200);
  expect((await status(id, 'OUT_FOR_DELIVERY')).status).toBe(200);
}
async function expiredOnlineOrder() {
  const o = await order('ONLINE');
  await db.payment.update({
    where: { orderId: o.id },
    data: { razorpayOrderId: 'order_workflow' },
  });
  await db.order.update({
    where: { id: o.id },
    data: { reservedUntil: new Date(Date.now() - 60000) },
  });
  return o;
}
function capture(amount = 2000000) {
  const entity = {
    id: 'pay_workflow',
    order_id: 'order_workflow',
    amount,
    currency: 'INR',
    status: 'captured',
  };
  return payments.capture(randomUUID(), hash(JSON.stringify(entity)), entity);
}
function pauseNextTransaction(orderId: string) {
  let attempts = 0;
  let reached!: () => void;
  let release!: () => void;
  const ready = new Promise<void>((resolve) => {
    reached = resolve;
  });
  const resume = new Promise<void>((resolve) => {
    release = resolve;
  });
  const atomic = db.atomic.bind(db);
  vi.spyOn(db, 'atomic').mockImplementationOnce((run) =>
    atomic(async (tx) => {
      attempts++;
      // Establish a real serializable PostgreSQL snapshot before the competing commit.
      await tx.order.findUniqueOrThrow({ where: { id: orderId } });
      reached();
      await resume;
      return run(tx);
    }),
  );
  return {
    ready,
    release,
    get attempts() {
      return attempts;
    },
  };
}

describe('Local shop workflows against isolated PostgreSQL', () => {
  it('commits owner work with the order, deduplicates dispatch, and records a named acknowledgment', async () => {
    const publicHints: unknown[] = [];
    const privateHints: unknown[] = [];
    const publicSubscription = app!
      .get(Events)
      .stream.subscribe((event) => publicHints.push(event));
    const privateSubscription = work.stream.subscribe((event) => privateHints.push(event));
    try {
      await cart();
      const checked = await review();
      const key = randomUUID();
      const first = await place(checked.id, 'customer', key);
      const repeated = await place(checked.id, 'customer', key);
      expect(first.status).toBe(201);
      expect(repeated.body.id).toBe(first.body.id);
      expect(await db.ownerWork.count({ where: { orderId: first.body.id } })).toBe(1);
      expect(await db.product.findUniqueOrThrow({ where: { id: 'cement' } })).toMatchObject({
        stock: 50,
      });
      await Promise.all([work.dispatch(), work.dispatch()]);
      await work.dispatch();
      const outbox = await db.ownerWork.findUniqueOrThrow({ where: { orderId: first.body.id } });
      expect(outbox.deliveredAt).not.toBeNull();
      expect(outbox.lastError).toBeNull();
      expect(
        await db.notification.count({
          where: { dedupeKey: { startsWith: `owner:${outbox.id}:` } },
        }),
      ).toBe(2);
      expect(publicHints.length).toBeGreaterThan(0);
      for (const hint of publicHints) expect(hint).toEqual({ type: 'CATALOG_UPDATED' });
      expect(privateHints.length).toBeGreaterThan(0);
      expect(
        privateHints.every((hint) => JSON.stringify(hint) === '{"type":"OWNER_WORK_UPDATED"}'),
      ).toBe(true);
      await request(server).get('/api/v1/admin/events').expect(401);
      await request(server).get('/api/v1/admin/events').set(auth()).expect(403);
      const acknowledgment = await request(server)
        .post(`/api/v1/admin/orders/${first.body.id}/acknowledge`)
        .set(auth('father'))
        .expect(201);
      expect(acknowledgment.body.assignedTo.name).toBe('Father — retail');
      const repeatedAck = await request(server)
        .post(`/api/v1/admin/orders/${first.body.id}/acknowledge`)
        .set(auth('uncle'))
        .expect(201);
      expect(repeatedAck.body.assignedToId).toBe('father');
      expect(
        await db.auditLog.count({
          where: { entityId: first.body.id, event: 'ORDER_ACKNOWLEDGED' },
        }),
      ).toBe(1);
    } finally {
      publicSubscription.unsubscribe();
      privateSubscription.unsubscribe();
    }
  });

  it('rolls back an order and stock reservation if the transactional owner outbox cannot be written', async () => {
    await cart();
    const checked = await review();
    await db.$executeRawUnsafe(
      'ALTER TABLE "OwnerWork" ADD CONSTRAINT "workflow_reject" CHECK (false) NOT VALID',
    );
    try {
      expect((await place(checked.id)).status).toBe(500);
      expect(await db.order.count()).toBe(0);
      expect(await db.ownerWork.count()).toBe(0);
      expect((await db.product.findUniqueOrThrow({ where: { id: 'cement' } })).stock).toBe(100);
      expect(await db.cartItem.count()).toBe(1);
      await request(server)
        .post('/api/v1/quotes')
        .set(auth())
        .send({
          items: [{ productId: 'cement', quantity: 50 }],
          addressId: 'customer-address',
          deliveryDate: date,
        })
        .expect(500);
      expect(await db.quote.count()).toBe(0);
      expect(await db.ownerWork.count()).toBe(0);
    } finally {
      await db.$executeRawUnsafe('ALTER TABLE "OwnerWork" DROP CONSTRAINT "workflow_reject"');
    }
    expect((await place(checked.id)).status).toBe(201);
  });

  it('makes notification failures visible and retries with backoff without duplicate owner messages', async () => {
    const o = await order();
    await db.user.updateMany({ where: { role: 'ADMIN' }, data: { role: 'CUSTOMER' } });
    const before = new Date();
    await work.dispatch();
    const failed = await db.ownerWork.findUniqueOrThrow({ where: { orderId: o.id } });
    expect(failed).toMatchObject({ deliveredAt: null, attempts: 1 });
    expect(failed.lastError).toContain('No active owner');
    expect(failed.nextAttemptAt.getTime()).toBeGreaterThan(before.getTime() + 25000);
    await db.user.updateMany({
      where: { id: { in: ['father', 'uncle'] } },
      data: { role: 'ADMIN' },
    });
    await work.dispatch();
    expect(await db.notification.count({ where: { dedupeKey: { not: null } } })).toBe(0);
    await db.ownerWork.update({ where: { id: failed.id }, data: { nextAttemptAt: new Date(0) } });
    await Promise.all([work.dispatch(), work.dispatch()]);
    const retried = await db.ownerWork.findUniqueOrThrow({ where: { id: failed.id } });
    expect(retried.deliveredAt).not.toBeNull();
    expect(retried.lastError).toBeNull();
    expect(await db.notification.count({ where: { dedupeKey: { not: null } } })).toBe(2);
  });

  it('completes the 50 bags × ₹390 + ₹500 COD flow without duplicate stock or collection', async () => {
    const o = await order();
    expect(o).toMatchObject({
      status: 'CONFIRMED',
      subtotalPaise: 1950000,
      deliveryFeePaise: 50000,
      totalPaise: 2000000,
    });
    await request(server)
      .post(`/api/v1/admin/orders/${o.id}/acknowledge`)
      .set(auth('father'))
      .expect(201);
    await dispatch(o.id);
    expect((await status(o.id, 'DELIVERED')).status).toBe(409);
    const collections = await Promise.all([
      request(server).post(`/api/v1/admin/orders/${o.id}/cod-received`).set(auth('father')),
      request(server).post(`/api/v1/admin/orders/${o.id}/cod-received`).set(auth('father')),
    ]);
    for (const collection of collections)
      expect(collection.status, JSON.stringify(collection.body)).toBe(201);
    expect((await status(o.id, 'DELIVERED')).status).toBe(200);
    const final = await db.order.findUniqueOrThrow({
      where: { id: o.id },
      include: { payment: true, work: true },
    });
    expect(final).toMatchObject({
      status: 'DELIVERED',
      payment: { status: 'CAPTURED' },
      work: { assignedToId: 'father' },
    });
    expect((await db.product.findUniqueOrThrow({ where: { id: 'cement' } })).stock).toBe(50);
    expect(await db.inventoryMovement.count({ where: { kind: 'ONLINE_ORDER' } })).toBe(1);
    expect(await db.financialMovement.count({ where: { kind: 'COLLECTION' } })).toBe(1);
    await request(server).post(`/api/v1/orders/${o.id}/cancel`).set(auth()).expect(409);
  });

  it('resolves refused delivery through retry and confirmed physical return, restoring only sellable bags', async () => {
    const o = await order();
    await dispatch(o.id);
    const report = {
      action: 'REPORT',
      reason: 'REFUSED',
      note: `Customer ${address.phone} refused at ${address.line1}`,
      idempotencyKey: randomUUID(),
    };
    await request(server)
      .post(`/api/v1/admin/orders/${o.id}/delivery`)
      .set(auth('father'))
      .send(report)
      .expect(201);
    expect((await db.product.findUniqueOrThrow({ where: { id: 'cement' } })).stock).toBe(50);
    expect((await status(o.id, 'DELIVERED')).status).toBe(409);
    await request(server)
      .post(`/api/v1/admin/orders/${o.id}/cod-received`)
      .set(auth('father'))
      .expect(409);
    await request(server)
      .post(`/api/v1/admin/orders/${o.id}/delivery`)
      .set(auth('father'))
      .send({
        action: 'RETRY',
        retryDate,
        note: 'Customer requested another visit',
        idempotencyKey: randomUUID(),
      })
      .expect(201);
    await request(server)
      .post(`/api/v1/admin/orders/${o.id}/delivery`)
      .set(auth('father'))
      .send({ ...report, reason: 'UNAVAILABLE', idempotencyKey: randomUUID() })
      .expect(201);
    await request(server)
      .post(`/api/v1/admin/orders/${o.id}/delivery`)
      .set(auth('father'))
      .send({
        action: 'RETURN',
        note: 'Incomplete physical count',
        items: [{ productId: 'cement', sellableQuantity: 40, damagedQuantity: 5 }],
        idempotencyKey: randomUUID(),
      })
      .expect(400);
    const returned = {
      action: 'RETURN',
      note: `All 50 bags physically returned from ${address.line1}; call ${address.phone}`,
      items: [{ productId: 'cement', sellableQuantity: 45, damagedQuantity: 5 }],
      idempotencyKey: randomUUID(),
    };
    const duplicateReturn = await request(server)
      .post(`/api/v1/admin/orders/${o.id}/delivery`)
      .set(auth('father'))
      .send(returned);
    expect(duplicateReturn.status, JSON.stringify(duplicateReturn.body)).toBe(201);
    await request(server)
      .post(`/api/v1/admin/orders/${o.id}/delivery`)
      .set(auth('father'))
      .send(returned)
      .expect(201);
    const final = await db.order.findUniqueOrThrow({
      where: { id: o.id },
      include: { payment: true, deliveryAttempts: true },
    });
    expect(final.status).toBe('CANCELLED');
    expect(final.payment?.status).toBe('PENDING');
    expect(final.deliveryAttempts).toHaveLength(4);
    expect((await db.product.findUniqueOrThrow({ where: { id: 'cement' } })).stock).toBe(95);
    expect(await db.inventoryMovement.count({ where: { kind: 'RETURN' } })).toBe(1);
    expect(await db.financialMovement.count()).toBe(0);
    const stockEvidence = await db.inventoryMovement.findMany({ where: { reference: o.id } });
    expect(JSON.stringify(stockEvidence)).not.toContain(address.phone);
    expect(JSON.stringify(stockEvidence)).not.toContain(address.line1);
    await request(server)
      .post('/api/v1/me/delete')
      .set(auth())
      .send({ confirmation: 'DELETE' })
      .expect(201);
    const attempts = await db.deliveryAttempt.findMany({ where: { orderId: o.id } });
    expect(attempts).toHaveLength(4);
    expect(attempts.every((attempt) => attempt.note === '')).toBe(true);
    expect(
      attempts
        .filter((attempt) => attempt.action === 'REPORT')
        .map((attempt) => attempt.reason)
        .sort(),
    ).toEqual(['REFUSED', 'UNAVAILABLE']);
    expect(attempts.find((attempt) => attempt.action === 'RETURN')?.items).toEqual([
      { productId: 'cement', sellableQuantity: 45, damagedQuantity: 5 },
    ]);
    expect(JSON.stringify(attempts)).not.toContain(address.phone);
    expect(JSON.stringify(attempts)).not.toContain(address.line1);
    expect(await db.inventoryMovement.findMany({ where: { reference: o.id } })).toEqual(
      stockEvidence,
    );
  });

  it('reconciles an existing quote request after its delivery date has passed', async () => {
    const original = quoteRequestSchema.parse({
      items: [{ productId: 'cement', quantity: 50 }],
      addressId: 'customer-address',
      deliveryDate: date,
      idempotencyKey: randomUUID(),
    });
    const created = await request(server)
      .post('/api/v1/quotes')
      .set(auth())
      .send(original)
      .expect(201);
    const historical = quoteRequestSchema.parse({
      ...original,
      deliveryDate: new Date(Date.now() - 86400000).toISOString().slice(0, 10),
    });
    // Model a persisted request whose delivery date passed before its response was recovered.
    await db.quote.update({
      where: { id: created.body.id },
      data: {
        deliveryDate: historical.deliveryDate,
        requestHash: hash(JSON.stringify(historical)),
      },
    });

    const replay = await request(server)
      .post('/api/v1/quotes')
      .set(auth())
      .send(historical)
      .expect(201);
    expect(replay.body.id).toBe(created.body.id);
    expect(await db.quote.count()).toBe(1);
    expect(await db.ownerWork.count({ where: { quoteId: created.body.id } })).toBe(1);

    const conflict = await request(server)
      .post('/api/v1/quotes')
      .set(auth())
      .send({ ...historical, company: 'Changed request' })
      .expect(409);
    expect(conflict.body.error.code).toBe('IDEMPOTENCY_CONFLICT');
    const invalid = await request(server)
      .post('/api/v1/quotes')
      .set(auth())
      .send({ ...historical, idempotencyKey: randomUUID() })
      .expect(400);
    expect(invalid.body.error.code).toBe('INVALID_DELIVERY_DATE');
    expect(await db.quote.count()).toBe(1);
  });

  it('converts an accepted quote once with negotiated prices and freight, requiring new consent after changed terms', async () => {
    const input = {
      items: [{ productId: 'cement', quantity: 50 }],
      addressId: 'customer-address',
      deliveryDate: date,
      idempotencyKey: randomUUID(),
    };
    const [q, duplicate] = await Promise.all([
      request(server).post('/api/v1/quotes').set(auth()).send(input).expect(201),
      request(server).post('/api/v1/quotes').set(auth()).send(input).expect(201),
    ]);
    expect(duplicate.body.id).toBe(q.body.id);
    expect(await db.ownerWork.count({ where: { quoteId: q.body.id } })).toBe(1);
    const offer = {
      expectedRevision: 0,
      items: [{ productId: 'cement', unitPricePaise: 38000 }],
      deliveryFeePaise: 100000,
      deliveryConfirmed: true,
      validUntil: new Date(Date.now() + 86400000).toISOString(),
      note: 'Negotiated transport included as shown',
    };
    await request(server)
      .post(`/api/v1/admin/quotes/${q.body.id}/offer`)
      .set(auth('uncle'))
      .send(offer)
      .expect(201);
    await request(server)
      .post(`/api/v1/quotes/${q.body.id}/respond`)
      .set(auth())
      .send({ revision: 1, status: 'ACCEPTED' })
      .expect(201);
    await request(server)
      .post(`/api/v1/admin/quotes/${q.body.id}/offer`)
      .set(auth('uncle'))
      .send({ ...offer, expectedRevision: 1, deliveryFeePaise: 150000 })
      .expect(201);
    await request(server)
      .post(`/api/v1/admin/quotes/${q.body.id}/convert`)
      .set(auth('uncle'))
      .send({ revision: 1 })
      .expect(409);
    await request(server)
      .post(`/api/v1/admin/quotes/${q.body.id}/convert`)
      .set(auth('uncle'))
      .send({ revision: 2 })
      .expect(409);
    await request(server)
      .post(`/api/v1/quotes/${q.body.id}/respond`)
      .set(auth())
      .send({ revision: 2, status: 'ACCEPTED' })
      .expect(201);
    await db.product.update({
      where: { id: 'cement' },
      data: { pricePaise: 45000, priceVersion: { increment: 1 } },
    });
    const converted = await Promise.all([
      request(server)
        .post(`/api/v1/admin/quotes/${q.body.id}/convert`)
        .set(auth('uncle'))
        .send({ revision: 2 })
        .expect(201),
      request(server)
        .post(`/api/v1/admin/quotes/${q.body.id}/convert`)
        .set(auth('uncle'))
        .send({ revision: 2 })
        .expect(201),
    ]);
    expect(converted[0]!.body.id).toBe(converted[1]!.body.id);
    expect(converted[0]!.body).toMatchObject({
      quoteId: q.body.id,
      quoteRevision: 2,
      totalPaise: 2050000,
      deliveryFeePaise: 150000,
      items: [{ pricePaise: 38000, quantity: 50 }],
    });
    expect((await db.product.findUniqueOrThrow({ where: { id: 'cement' } })).stock).toBe(50);
    expect(await db.order.count()).toBe(1);
    expect(await db.inventoryMovement.count({ where: { kind: 'ONLINE_ORDER' } })).toBe(1);
  });

  it('lets captured payment win over a selected expired reservation without releasing stock', async () => {
    const o = await expiredOnlineOrder();
    const gate = pauseNextTransaction(o.id);
    const expiry = orders.expireReservations();
    await gate.ready;
    try {
      await capture();
    } finally {
      gate.release();
    }
    await expiry;
    const final = await db.order.findUniqueOrThrow({
      where: { id: o.id },
      include: { payment: true },
    });
    expect(final).toMatchObject({ status: 'CONFIRMED', payment: { status: 'CAPTURED' } });
    expect((await db.product.findUniqueOrThrow({ where: { id: 'cement' } })).stock).toBe(50);
    expect(await db.inventoryMovement.count({ where: { kind: 'ORDER_CANCELLED' } })).toBe(0);
  }, 20000);

  it('rechecks that a selected reservation is still expired inside its cancellation transaction', async () => {
    const o = await expiredOnlineOrder();
    const gate = pauseNextTransaction(o.id);
    const expiry = orders.expireReservations();
    await gate.ready;
    try {
      await db.order.update({
        where: { id: o.id },
        data: { reservedUntil: new Date(Date.now() + 60000) },
      });
    } finally {
      gate.release();
    }
    await expiry;
    expect((await db.order.findUniqueOrThrow({ where: { id: o.id } })).status).toBe(
      'PENDING_PAYMENT',
    );
    expect((await db.product.findUniqueOrThrow({ where: { id: 'cement' } })).stock).toBe(50);
    expect(await db.inventoryMovement.count({ where: { kind: 'ORDER_CANCELLED' } })).toBe(0);
  }, 20000);

  it('revalidates confirmed transport, availability and material units before quote conversion', async () => {
    const q = await request(server)
      .post('/api/v1/quotes')
      .set(auth())
      .send({
        items: [{ productId: 'cement', quantity: 50 }],
        addressId: 'customer-address',
        deliveryDate: date,
      })
      .expect(201);
    const offer = {
      expectedRevision: 0,
      items: [{ productId: 'cement', unitPricePaise: 38000 }],
      deliveryFeePaise: 100000,
      validUntil: new Date(Date.now() + 86400000).toISOString(),
      deliveryConfirmed: false,
    };
    await request(server)
      .post(`/api/v1/admin/quotes/${q.body.id}/offer`)
      .set(auth('uncle'))
      .send(offer)
      .expect(201);
    await request(server)
      .post(`/api/v1/quotes/${q.body.id}/respond`)
      .set(auth())
      .send({ revision: 1, status: 'ACCEPTED' })
      .expect(201);
    const transport = await request(server)
      .post(`/api/v1/admin/quotes/${q.body.id}/convert`)
      .set(auth('uncle'))
      .send({ revision: 1 })
      .expect(409);
    expect(transport.body.error.code).toBe('DELIVERY_CONFIRMATION_REQUIRED');
    await request(server)
      .post(`/api/v1/admin/quotes/${q.body.id}/offer`)
      .set(auth('uncle'))
      .send({ ...offer, expectedRevision: 1, deliveryConfirmed: true })
      .expect(201);
    await request(server)
      .post(`/api/v1/quotes/${q.body.id}/respond`)
      .set(auth())
      .send({ revision: 2, status: 'ACCEPTED' })
      .expect(201);
    await db.product.update({ where: { id: 'cement' }, data: { stock: 40 } });
    await request(server)
      .post(`/api/v1/admin/quotes/${q.body.id}/convert`)
      .set(auth('uncle'))
      .send({ revision: 2 })
      .expect(409);
    await db.product.update({ where: { id: 'cement' }, data: { stock: 100, unit: 'bag' } });
    const changedUnit = await request(server)
      .post(`/api/v1/admin/quotes/${q.body.id}/convert`)
      .set(auth('uncle'))
      .send({ revision: 2 });
    expect(changedUnit.status, JSON.stringify(changedUnit.body)).toBe(409);
    expect(await db.order.count()).toBe(0);
    expect((await db.product.findUniqueOrThrow({ where: { id: 'cement' } })).stock).toBe(100);
    await request(server)
      .post(`/api/v1/admin/quotes/${q.body.id}/offer`)
      .set(auth('uncle'))
      .send({ ...offer, expectedRevision: 2, deliveryConfirmed: true })
      .expect(201);
    await request(server)
      .post(`/api/v1/admin/quotes/${q.body.id}/convert`)
      .set(auth('uncle'))
      .send({ revision: 3 })
      .expect(409);
    await request(server)
      .post(`/api/v1/quotes/${q.body.id}/respond`)
      .set(auth())
      .send({ revision: 3, status: 'ACCEPTED' })
      .expect(201);
    // Only packSize changes here; unit, name, agreed quantities and prices remain the same.
    await db.product.update({ where: { id: 'cement' }, data: { packSize: '25 kg' } });
    const changedPack = await request(server)
      .post(`/api/v1/admin/quotes/${q.body.id}/convert`)
      .set(auth('uncle'))
      .send({ revision: 3 })
      .expect(409);
    expect(changedPack.body.error.code).toBe('QUOTE_CHANGED');
    expect(await db.order.count()).toBe(0);
    const revisedPack = await request(server)
      .post(`/api/v1/admin/quotes/${q.body.id}/offer`)
      .set(auth('uncle'))
      .send({ ...offer, expectedRevision: 3, deliveryConfirmed: true })
      .expect(201);
    expect(revisedPack.body.items[0]).toMatchObject({ unit: 'bag', packSize: '25 kg' });
    await request(server)
      .post(`/api/v1/admin/quotes/${q.body.id}/convert`)
      .set(auth('uncle'))
      .send({ revision: 4 })
      .expect(409);
    await request(server)
      .post(`/api/v1/quotes/${q.body.id}/respond`)
      .set(auth())
      .send({ revision: 4, status: 'ACCEPTED' })
      .expect(201);
    const renewed = await request(server)
      .post(`/api/v1/admin/quotes/${q.body.id}/convert`)
      .set(auth('uncle'))
      .send({ revision: 4 })
      .expect(201);
    expect(renewed.body.items[0]).toMatchObject({
      unit: 'bag',
      packSize: '25 kg',
      quantity: 50,
      pricePaise: 38000,
    });
    expect((await db.product.findUniqueOrThrow({ where: { id: 'cement' } })).stock).toBe(50);
  });

  it('removes customer contact data without destroying persisted quote revision and audit evidence', async () => {
    const q = await request(server)
      .post('/api/v1/quotes')
      .set(auth())
      .send({
        items: [{ productId: 'cement', quantity: 50 }],
        addressId: 'customer-address',
        deliveryDate: date,
        company: 'Private company',
        notes: `Call ${address.phone}`,
      })
      .expect(201);
    await request(server)
      .post(`/api/v1/admin/quotes/${q.body.id}/offer`)
      .set(auth('uncle'))
      .send({
        expectedRevision: 0,
        items: [{ productId: 'cement', unitPricePaise: 39000 }],
        deliveryFeePaise: 50000,
        validUntil: new Date(Date.now() + 86400000).toISOString(),
        deliveryConfirmed: true,
        note: address.line1,
      })
      .expect(201);
    await request(server)
      .post('/api/v1/me/delete')
      .set(auth())
      .send({ confirmation: 'DELETE' })
      .expect(201);
    const revision = await db.quoteRevision.findFirstOrThrow({ where: { quoteId: q.body.id } });
    expect(revision.snapshot).toMatchObject({
      personalDataRemoved: true,
      totalPaise: 2000000,
      deliveryFeePaise: 50000,
      items: [{ productId: 'cement', packSize: '50 kg', quantity: 50, unitPricePaise: 39000 }],
    });
    expect(JSON.stringify(revision.snapshot)).not.toContain(address.phone);
    expect(JSON.stringify(revision.snapshot)).not.toContain(address.line1);
    expect(JSON.stringify(revision.snapshot)).not.toContain('Private company');
    const evidence = await db.auditLog.findFirstOrThrow({
      where: { entityId: q.body.id, event: 'QUOTE_SENT' },
    });
    expect(evidence.details).toMatchObject({ revision: 1, totalPaise: 2000000 });
    await request(server).get('/api/v1/quotes').set(auth()).expect(401);
  });

  it('lets expiry win over a pending capture snapshot and creates a late-payment refund obligation once', async () => {
    const o = await expiredOnlineOrder();
    const gate = pauseNextTransaction(o.id);
    const incoming = capture();
    await gate.ready;
    try {
      await orders.expireReservations();
    } finally {
      gate.release();
    }
    await incoming;
    await capture();
    const final = await db.order.findUniqueOrThrow({
      where: { id: o.id },
      include: { payment: true },
    });
    expect(final).toMatchObject({
      status: 'REFUND_PENDING',
      payment: { status: 'REFUND_PENDING' },
    });
    expect((await db.product.findUniqueOrThrow({ where: { id: 'cement' } })).stock).toBe(100);
    expect(await db.inventoryMovement.count({ where: { kind: 'ORDER_CANCELLED' } })).toBe(1);
    expect(await db.financialMovement.count({ where: { kind: 'COLLECTION' } })).toBe(1);
  }, 20000);

  it('prevents concurrent buyers from reserving the same scarce stock', async () => {
    // Authorize each wholesale request; the original stock-race assertions still apply.
    for (const id of ['customer', 'other']) {
      const user = await db.user.findUniqueOrThrow({ where: { id } });
      await request(server)
        .post('/api/v1/admin/demand-overrides')
        .set(auth('father'))
        .send({
          phone: user.phone,
          kind: 'ORDER',
          maxTotalPaise: 10000000,
          reason: 'Reviewed last-stock wholesale demand',
        })
        .expect(201);
    }

    await cart('customer', 80);
    await cart('other', 80);
    const [a, b] = await Promise.all([review('customer'), review('other')]);
    const responses = await Promise.all([place(a.id, 'customer'), place(b.id, 'other')]);
    expect(responses.map((response) => response.status).sort()).toEqual([201, 409]);
    expect((await db.product.findUniqueOrThrow({ where: { id: 'cement' } })).stock).toBe(20);
    expect(await db.order.count()).toBe(1);
    expect(await db.ownerWork.count()).toBe(1);
  });

  it('reports immutable collection/refund/counter events independently of Payment.updatedAt and preserves sale prices on retry', async () => {
    const o = await order();
    await request(server)
      .post(`/api/v1/admin/orders/${o.id}/cod-received`)
      .set(auth('father'))
      .expect(201);
    const money = await db.financialMovement.findFirstOrThrow({ where: { kind: 'COLLECTION' } });
    await db.payment.update({
      where: { orderId: o.id },
      data: { updatedAt: new Date(Date.now() - 2 * 86400000) },
    });
    const dashboard = await request(server)
      .get('/api/v1/admin/dashboard')
      .set(auth('father'))
      .expect(200);
    expect(dashboard.body.todaySalesPaise).toBe(2000000);
    await expect(
      db.financialMovement.update({ where: { id: money.id }, data: { amountPaise: 1 } }),
    ).rejects.toThrow();
    await expect(db.financialMovement.delete({ where: { id: money.id } })).rejects.toThrow();
    expect(
      (await db.financialMovement.findUniqueOrThrow({ where: { id: money.id } })).occurredAt,
    ).toEqual(money.occurredAt);
    const sale = {
      kind: 'WALK_IN_SALE',
      quantity: 2,
      reference: 'Local counter sale',
      note: 'Cash received',
      idempotencyKey: randomUUID(),
    };
    await request(server)
      .post('/api/v1/admin/products/cement/movements')
      .set(auth('father'))
      .send(sale)
      .expect(201);
    await db.product.update({ where: { id: 'cement' }, data: { pricePaise: 45000 } });
    await request(server)
      .post('/api/v1/admin/products/cement/movements')
      .set(auth('father'))
      .send(sale)
      .expect(201);
    expect(
      (await db.financialMovement.findFirstOrThrow({ where: { kind: 'COUNTER_SALE' } }))
        .amountPaise,
    ).toBe(78000);
    expect((await status(o.id, 'CANCELLED')).status).toBe(200);
    await request(server)
      .post(`/api/v1/admin/orders/${o.id}/cash-refunded`)
      .set(auth('father'))
      .expect(201);
    await request(server)
      .post(`/api/v1/admin/orders/${o.id}/cash-refunded`)
      .set(auth('father'))
      .expect(201);
    const final = await request(server)
      .get('/api/v1/admin/dashboard')
      .set(auth('father'))
      .expect(200);
    expect(final.body).toMatchObject({
      todaySalesPaise: 2000000,
      todayCounterSalesPaise: 78000,
      todayRefundsPaise: 2000000,
      profitPaise: null,
    });
    expect(await db.financialMovement.count()).toBe(3);
  });

  it('admits only one concurrent address addition when the customer has 19 saved addresses', async () => {
    await db.address.createMany({
      data: Array.from({ length: 18 }, (_, index) => ({
        ...address,
        userId: 'customer',
        label: `Saved site ${index + 1}`,
      })),
    });
    let reached!: () => void;
    let release!: () => void;
    const ready = new Promise<void>((resolve) => {
      reached = resolve;
    });
    const resume = new Promise<void>((resolve) => {
      release = resolve;
    });
    // Allow both real count queries to finish, but hold their INSERTs until both are waiting.
    const blocker = db.$transaction(
      async (tx) => {
        await tx.$executeRawUnsafe('LOCK TABLE "Address" IN SHARE MODE');
        reached();
        await resume;
      },
      { timeout: 10000 },
    );
    await ready;
    const pending = ['Concurrent A', 'Concurrent B'].map((label) =>
      request(server)
        .post('/api/v1/me/addresses')
        .set(auth())
        .send({ ...address, label })
        .then((response) => response),
    );
    try {
      await vi.waitFor(
        async () => {
          const [waiting] = await db.$queryRaw<{ count: number }[]>`
          SELECT count(*)::int AS count FROM pg_stat_activity
          WHERE datname = current_database() AND wait_event_type = 'Lock'
            AND query LIKE 'INSERT INTO%' AND query LIKE '%"Address"%'
        `;
          expect(waiting?.count).toBe(2);
        },
        { timeout: 5000, interval: 25 },
      );
    } finally {
      release();
      await blocker;
    }
    const responses = await Promise.all(pending);
    expect(responses.map((response) => response.status).sort()).toEqual([201, 400]);
    expect(responses.find((response) => response.status === 400)?.body.error.code).toBe(
      'ADDRESS_LIMIT',
    );
    expect(await db.address.count({ where: { userId: 'customer' } })).toBe(20);
    expect(await db.address.count({ where: { userId: 'other' } })).toBe(1);
    const added = responses.find((response) => response.status === 201)!.body;
    expect(added.userId).toBe('customer');
    await request(server)
      .patch(`/api/v1/me/addresses/${added.id}`)
      .set(auth('other'))
      .send({ ...address, label: 'Unauthorized update' })
      .expect(404);
    await request(server).delete(`/api/v1/me/addresses/${added.id}`).set(auth('other')).expect(404);
  });

  it('replays a reorder once and returns the current cart while preserving new reorder actions', async () => {
    const original = await order('COD', 20);
    const another = await order('COD', 10);
    await cart('customer', 5);
    const idempotencyKey = randomUUID();
    const reorder = (id = original.id, key: string = idempotencyKey) =>
      request(server)
        .post(`/api/v1/orders/${id}/reorder`)
        .set(auth())
        .send({ idempotencyKey: key });

    const first = await reorder().expect(201);
    const replay = await reorder().expect(201);
    expect(await db.cartItem.findFirstOrThrow()).toMatchObject({ quantity: 25 });
    expect(first.body.cart[0]).toMatchObject({ productId: 'cement', quantity: 25 });
    expect(replay.body.cart).toEqual(first.body.cart);
    expect(replay.body.notices).toEqual(first.body.notices);
    expect(await db.auditLog.count({ where: { event: 'CART_REORDERED' } })).toBe(1);

    const conflict = await reorder(another.id).expect(409);
    expect(conflict.body.error.code).toBe('IDEMPOTENCY_CONFLICT');
    await reorder(original.id, 'not-a-uuid').expect(400);
    await request(server)
      .post(`/api/v1/orders/${original.id}/reorder`)
      .set(auth('other'))
      .send({ idempotencyKey })
      .expect(404);

    await cart('customer', 10);
    const laterReplay = await reorder().expect(201);
    expect(laterReplay.body.cart[0].quantity).toBe(10);
    const intentionalRepeat = await reorder(original.id, randomUUID()).expect(201);
    expect(intentionalRepeat.body.cart[0].quantity).toBe(30);
    const legacy = await request(server)
      .post(`/api/v1/orders/${original.id}/reorder`)
      .set(auth())
      .expect(201);
    expect(legacy.body.cart[0].quantity).toBe(50);

    await cart('other', 10);
    const otherReview = await review('other');
    const otherOrder = await place(otherReview.id, 'other');
    expect(otherOrder.status).toBe(201);
    const otherReorder = await request(server)
      .post(`/api/v1/orders/${otherOrder.body.id}/reorder`)
      .set(auth('other'))
      .send({ idempotencyKey })
      .expect(201);
    expect(otherReorder.body.cart).toHaveLength(1);
    expect(otherReorder.body.cart[0]).toMatchObject({ userId: 'other', quantity: 10 });
    expect(
      await db.cartItem.findUniqueOrThrow({
        where: { userId_productId: { userId: 'customer', productId: 'cement' } },
      }),
    ).toMatchObject({ quantity: 50 });
  });

  it.each([false, true])(
    'serializes concurrent reorder retries with unavailable products: %s',
    async (unavailable) => {
      const original = await order('COD', 20);
      await cart('customer', 5);
      if (unavailable)
        await db.product.update({ where: { id: 'cement' }, data: { active: false } });
      const idempotencyKey = randomUUID();
      const reorder = () =>
        request(server)
          .post(`/api/v1/orders/${original.id}/reorder`)
          .set(auth())
          .send({ idempotencyKey });
      const paused = pauseNextTransaction(original.id);
      const pending = reorder().then((response) => response);
      await paused.ready;
      let winner;
      try {
        winner = await reorder().expect(201);
      } finally {
        paused.release();
      }
      const retried = await pending;
      expect(retried.status).toBe(201);
      expect(paused.attempts).toBe(2);
      expect(await db.cartItem.findFirstOrThrow()).toMatchObject({
        quantity: unavailable ? 5 : 25,
      });
      expect(retried.body.cart).toEqual(winner.body.cart);
      expect(retried.body.notices).toEqual(winner.body.notices);
      expect(retried.body.notices).toHaveLength(unavailable ? 1 : 0);
      expect(await db.auditLog.count({ where: { event: 'CART_REORDERED' } })).toBe(1);
    },
  );

  it('rolls back cart changes if the durable reorder receipt cannot be saved', async () => {
    const original = await order('COD', 20);
    await cart('customer', 5);
    await db.$executeRawUnsafe(
      `ALTER TABLE "AuditLog" ADD CONSTRAINT "workflow_reorder_receipt_failure" CHECK ("event" <> 'CART_REORDERED')`,
    );
    try {
      await request(server)
        .post(`/api/v1/orders/${original.id}/reorder`)
        .set(auth())
        .send({ idempotencyKey: randomUUID() })
        .expect(500);
      expect(await db.cartItem.findFirstOrThrow()).toMatchObject({ quantity: 5 });
      expect(await db.auditLog.count({ where: { event: 'CART_REORDERED' } })).toBe(0);
    } finally {
      await db.$executeRawUnsafe(
        'ALTER TABLE "AuditLog" DROP CONSTRAINT "workflow_reorder_receipt_failure"',
      );
    }
  });

  it('enforces address/order ownership and historical reorder quantity rules and the 50-product cart capacity', async () => {
    await cart();
    await request(server)
      .post('/api/v1/checkout/review')
      .set(auth())
      .send({ addressId: 'other-address', deliveryDate: date, paymentMethod: 'COD' })
      .expect(400);
    await request(server).delete('/api/v1/me/addresses/other-address').set(auth()).expect(404);
    const o = await order();
    await request(server).get(`/api/v1/orders/${o.id}`).set(auth('other')).expect(404);
    await request(server).post(`/api/v1/orders/${o.id}/reorder`).set(auth('other')).expect(404);
    await request(server).post(`/api/v1/orders/${o.id}/cancel`).set(auth()).expect(201);
    await db.product.update({
      where: { id: 'cement' },
      data: { minQuantity: 60, quantityStep: 10 },
    });
    const invalid = await request(server)
      .post(`/api/v1/orders/${o.id}/reorder`)
      .set(auth())
      .expect(201);
    expect(invalid.body.notices).toHaveLength(1);
    expect(await db.cartItem.count()).toBe(0);
    await db.product.update({
      where: { id: 'cement' },
      data: {
        minQuantity: 10,
        quantityStep: 10,
        pricePaise: 42000,
        priceVersion: { increment: 1 },
      },
    });
    const valid = await request(server)
      .post(`/api/v1/orders/${o.id}/reorder`)
      .set(auth())
      .expect(201);
    expect(valid.body.notices[0]).toContain('price has changed');
    expect(await db.cartItem.findFirstOrThrow()).toMatchObject({
      quantity: 50,
      seenPricePaise: 42000,
    });
    await db.cartItem.deleteMany();
    await db.product.createMany({
      data: Array.from({ length: 50 }, (_, index) => ({ ...product, id: `filler-${index}` })),
    });
    await db.cartItem.createMany({
      data: Array.from({ length: 50 }, (_, index) => ({
        userId: 'customer',
        productId: `filler-${index}`,
        quantity: 1,
        seenPricePaise: 39000,
        seenPriceVersion: 1,
      })),
    });
    const full = await request(server)
      .post(`/api/v1/orders/${o.id}/reorder`)
      .set(auth())
      .expect(201);
    expect(full.body.notices).toHaveLength(1);
    expect(await db.cartItem.count()).toBe(50);
    await request(server)
      .put('/api/v1/cart/items')
      .set(auth())
      .send({ productId: 'filler-0', quantity: 2 })
      .expect(200);
    const capacity = await request(server)
      .put('/api/v1/cart/items')
      .set(auth())
      .send({ productId: 'cement', quantity: 50 })
      .expect(400);
    expect(capacity.body.error.code).toBe('CART_LIMIT');
    expect(await db.cartItem.count()).toBe(50);
  });
});
