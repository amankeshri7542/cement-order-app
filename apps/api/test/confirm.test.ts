import 'reflect-metadata';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import type { Server } from 'node:http';
import { loadEnvFile } from 'node:process';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { Db } from '../src/db';
import { AlertsService } from '../src/alerts';
import { decisionWords } from '../src/confirm';
import { clearHeldMessages } from '../src/notify';
import { customerView } from '../src/orders';
import { OwnerWorkService } from '../src/owner-work';
import { addPerson, tokenFor } from './staff-helper';

const push = vi.hoisted(() => ({
  send: vi.fn(async (_subscription: unknown, _payload: string, _options?: object) => ({})),
}));
vi.mock('web-push', () => ({
  default: { setVapidDetails: vi.fn(), sendNotification: push.send },
}));

if (existsSync('.env.test')) loadEnvFile('.env.test');
process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
process.env.OTP_PROVIDER = 'mock';
process.env.OTP_HASH_SECRET = 'confirm-test-only-secret-not-for-production';
process.env.CORS_ORIGINS = 'http://localhost:3000';
process.env.WEB_PUSH_PUBLIC_KEY = 'B'.repeat(87);
process.env.WEB_PUSH_PRIVATE_KEY = 'p'.repeat(43);
process.env.WEB_PUSH_SUBJECT = 'mailto:test@example.test';
process.env.WHATSAPP_CUSTOMER_UPDATES = 'true';
if (!process.env.DATABASE_URL || !new URL(process.env.DATABASE_URL).pathname.endsWith('_test'))
  throw new Error('Confirm tests require a dedicated TEST_DATABASE_URL ending in _test.');

const MAIN = 'loc_main';
const SECOND = 'loc_confirm_b';
const customerPhone = '+919000000801';
let app: INestApplication;
let server: Server;
let db: Db;

const as = (id: string) => ({ Authorization: `Bearer ${tokenFor(id)}` });
const address = {
  label: 'Site',
  name: 'Ramesh Yadav',
  phone: customerPhone,
  line1: 'Plot 12',
  area: 'Kankarbagh',
  city: 'Patna',
  state: 'Bihar',
  pincode: '800020',
  landmark: '',
};
const day = (from = 2) => new Date(Date.now() + from * 86400000).toISOString().slice(0, 10);

/** A customer's own order, placed through the real checkout. */
async function placeOrder(quantity = 10, notes = '') {
  await request(server)
    .put('/api/v1/cart/items')
    .set(as('customer'))
    .send({ productId: 'cement', quantity })
    .expect(200);
  const review = await request(server)
    .post('/api/v1/checkout/review')
    .set(as('customer'))
    .send({ addressId: 'site', deliveryDate: day(), paymentMethod: 'COD', notes })
    .expect(201);
  const placed = await request(server)
    .post('/api/v1/orders')
    .set(as('customer'))
    .send({ reviewId: review.body.id, idempotencyKey: randomUUID() })
    .expect(201);
  return placed.body as { id: string; number: string; totalPaise: number; status: string };
}
const fresh = (id: string) =>
  db.order.findUniqueOrThrow({
    where: { id },
    include: { items: true, payment: true, work: true },
  });
const stockAt = async (locationId: string, productId = 'cement') =>
  (
    await db.stockLevel.findUnique({
      where: { productId_locationId: { productId, locationId } },
    })
  )?.quantity ?? 0;
const confirm = async (
  id: string,
  who = 'papa',
  extra: Record<string, unknown> = {},
  version?: number,
) =>
  request(server)
    .post(`/api/v1/admin/orders/${id}/confirm`)
    .set(as(who))
    .send({
      expectedVersion: version ?? (await fresh(id)).version,
      decisionKey: randomUUID(),
      ...extra,
    });
const refuse = async (id: string, who = 'papa', extra: Record<string, unknown> = {}) =>
  request(server)
    .post(`/api/v1/admin/orders/${id}/refuse`)
    .set(as(who))
    .send({
      expectedVersion: (await fresh(id)).version,
      decisionKey: randomUUID(),
      reason: 'OUT_OF_STOCK',
      ...extra,
    });
const undo = async (id: string, who = 'papa', version?: number) =>
  request(server)
    .post(`/api/v1/admin/orders/${id}/undo-decision`)
    .set(as(who))
    .send({ expectedVersion: version ?? (await fresh(id)).version });
const inbox = (who = 'papa') => request(server).get('/api/v1/admin/inbox').set(as(who));
const change = (lines: Record<string, unknown>[], rest: Record<string, unknown> = {}) => ({
  changes: { lines, ...rest },
});
/** Runs out the 10-second hold. */
const holdPasses = async (id: string) => {
  const past = new Date(Date.now() - 1000);
  await db.order.update({ where: { id }, data: { decisionHoldUntil: past } });
  await db.notification.updateMany({ where: { orderId: id }, data: { sendAfter: past } });
};
const customerSees = async (id: string) =>
  (await request(server).get(`/api/v1/orders/${id}`).set(as('customer')).expect(200)).body;
const customerNotes = async () =>
  (await request(server).get('/api/v1/me/notifications').set(as('customer')).expect(200)).body as {
    title: string;
    body: string;
    orderId: string;
  }[];

beforeAll(async () => {
  const { createApp } = await import('../src/app');
  app = await createApp();
  await app.listen(0, '127.0.0.1');
  server = app.getHttpServer();
  db = app.get(Db);
}, 30000);
beforeEach(async () => {
  await db.$executeRawUnsafe(
    'TRUNCATE TABLE "PriceUpdateBatch", "RateSource", "FinancialMovement", "User", "Category", "Product", "Order", "Quote", "AuditLog", "OtpChallenge", "AuthRateLimit", "DeliveryZone", "StoreSettings", "OutboundMessage", "OrderAmendment" RESTART IDENTITY CASCADE',
  );
  push.send.mockClear();
  await db.location.update({ where: { id: MAIN }, data: { managerRateCapPercent: 5 } });
  await db.location.upsert({
    where: { id: SECOND },
    update: { active: true, stockStartedAt: new Date() },
    create: {
      id: SECOND,
      firmId: 'firm_main',
      slug: 'confirm-b',
      name: 'Second shop',
      stockStartedAt: new Date(),
    },
  });
  await addPerson(db, { id: 'papa', role: 'OWNER', phone: '+919000000810' });
  await addPerson(db, { id: 'chacha', role: 'OWNER', phone: '+919000000811' });
  await addPerson(db, { id: 'manager', role: 'MANAGER', shops: [MAIN], phone: '+919000000812' });
  await addPerson(db, { id: 'managerb', role: 'MANAGER', shops: [SECOND], phone: '+919000000813' });
  await addPerson(db, { id: 'cashier', role: 'CASHIER', shops: [MAIN], phone: '+919000000814' });
  await addPerson(db, {
    id: 'keeper',
    role: 'STOCK_KEEPER',
    shops: [MAIN],
    phone: '+919000000815',
  });
  await addPerson(db, { id: 'accountant', role: 'ACCOUNTANT', phone: '+919000000816' });
  await addPerson(db, { id: 'customer', phone: customerPhone });
  await addPerson(db, { id: 'other', phone: '+919000000802' });
  await db.user.update({
    where: { id: 'customer' },
    data: { name: 'Ramesh Yadav', language: 'hi' },
  });
  await db.address.create({ data: { id: 'site', userId: 'customer', ...address } });
  await db.category.create({ data: { id: 'category', name: 'Cement', slug: 'cement' } });
  for (const [id, stock] of [
    ['cement', 100],
    ['sand', 40],
  ] as const)
    await db.product.create({
      data: {
        id,
        name: id === 'cement' ? 'UltraTech Super' : 'Balu',
        brand: 'Test',
        categoryId: 'category',
        type: 'PPC',
        grade: 'PPC',
        unit: 'bag',
        pricePaise: 40000,
        stock,
        minQuantity: 1,
        description: 'Test product',
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
});
afterEach(() => vi.restoreAllMocks());
afterAll(async () => {
  await app?.close();
});

describe('a customer’s order waits for a person', () => {
  it('starts waiting, holds its stock, and tells the customer no call is needed', async () => {
    const order = await placeOrder();
    expect(order.status).toBe('AWAITING_CONFIRMATION');
    expect(await stockAt(MAIN)).toBe(90);
    const notes = await customerNotes();
    expect(notes[0]?.body).toContain('pakka');
    expect(JSON.stringify(notes)).not.toMatch(/call|phone kar/i);
  });
  it('cannot be moved along by the ordinary status buttons', async () => {
    const order = await placeOrder();
    for (const status of ['CONFIRMED', 'PREPARING', 'CANCELLED']) {
      const { body } = await request(server)
        .patch(`/api/v1/admin/orders/${order.id}/status`)
        .set(as('papa'))
        .send({ status, note: 'x' });
      expect(body.error?.code).toMatch(/NOT_WAITING|INVALID_TRANSITION|INVALID_INPUT/);
    }
    expect((await fresh(order.id)).status).toBe('AWAITING_CONFIRMATION');
  });
  it('the customer may still cancel it, and the stock comes back', async () => {
    const order = await placeOrder();
    await request(server).post(`/api/v1/orders/${order.id}/cancel`).set(as('customer')).expect(201);
    expect((await fresh(order.id)).status).toBe('CANCELLED');
    expect(await stockAt(MAIN)).toBe(100);
  });
  it('counts as pending for the limits on unpaid orders', async () => {
    await placeOrder();
    const { pendingCod } = await import('../src/abuse');
    expect(await db.order.count({ where: pendingCod })).toBe(1);
  });
});

describe('the queue', () => {
  it('lists waiting orders oldest first, with what the card needs', async () => {
    const first = await placeOrder(10);
    const second = await placeOrder(5);
    const { body } = await inbox().expect(200);
    expect(body.count).toBe(2);
    expect(body.items.map((card: { id: string }) => card.id)).toEqual([first.id, second.id]);
    const card = body.items[0];
    expect(card).toMatchObject({
      status: 'AWAITING_CONFIRMATION',
      source: 'APP',
      shopName: expect.any(String),
      paymentMethod: 'COD',
      clean: true,
      decided: null,
      customer: { name: 'Ramesh Yadav', phone: customerPhone, balancePaise: 0 },
    });
    expect(card.can).toMatchObject({ confirm: true, change: true, rate: true });
    expect(card.lines[0]).toMatchObject({
      name: 'UltraTech Super',
      quantity: 10,
      pricePaise: 40000,
      listPricePaise: 40000,
      stockHere: 85,
    });
  });
  it('an order with a customer’s note is not a one-tap card', async () => {
    await placeOrder(10, 'Sunday ko hi bhejna');
    const { body } = await inbox().expect(200);
    expect(body.items[0]).toMatchObject({ clean: false, notes: 'Sunday ko hi bhejna' });
  });
  it('a delivery day that has passed needs a look', async () => {
    const order = await placeOrder();
    await db.order.update({ where: { id: order.id }, data: { deliveryDate: '2020-01-01' } });
    const { body } = await inbox().expect(200);
    expect(body.items[0]).toMatchObject({ clean: false, blockers: ['DATE_PASSED'] });
    const { body: refused } = await confirm(order.id);
    expect(refused.error.code).toBe('INVALID_DELIVERY_DATE');
  });
  it('a shop’s people see their shop’s orders only', async () => {
    const order = await placeOrder();
    expect((await inbox('manager').expect(200)).body.items).toHaveLength(1);
    const other = await inbox('managerb').expect(200);
    expect(other.body).toMatchObject({ count: 0, items: [] });
    await request(server).get(`/api/v1/admin/inbox/${order.id}`).set(as('managerb')).expect(403);
  });
  it.each(['keeper', 'accountant', 'customer'])('%s has no queue', async (who) => {
    const order = await placeOrder();
    await inbox(who).expect(403);
    await request(server).get(`/api/v1/admin/inbox/${order.id}`).set(as(who)).expect(403);
  });
  it('a deep link opens the card, and says who already decided it', async () => {
    const order = await placeOrder();
    await confirm(order.id, 'chacha').then((r) => expect(r.status).toBe(201));
    const { body } = await request(server)
      .get(`/api/v1/admin/inbox/${order.id}`)
      .set(as('papa'))
      .expect(200);
    expect(body.decided).toMatchObject({ status: 'CONFIRMED', byName: 'chacha' });
    expect(body.can.confirm).toBe(false);
  });
  it('a decision on hold stays on the card, so a reload does not lose the undo', async () => {
    const order = await placeOrder();
    await confirm(order.id);
    const { body } = await inbox().expect(200);
    expect(body.count).toBe(0);
    expect(body.items[0]).toMatchObject({ id: order.id, decided: { byName: 'papa' } });
    expect(body.items[0].decided.holdUntil).toBeTruthy();
  });
  it('a cashier sees whether they may confirm', async () => {
    const order = await placeOrder();
    await db.payment.update({ where: { orderId: order.id }, data: { method: 'CREDIT' } });
    const { body } = await inbox('cashier').expect(200);
    expect(body.items[0].can).toMatchObject({ confirm: false, rate: false, credit: false });
  });
  it('someone who cannot read udhaar sees no balance', async () => {
    await db.user.update({ where: { id: 'customer' }, data: { khataBalancePaise: 500 } });
    await placeOrder();
    await addPerson(db, {
      id: 'nobalance',
      role: 'STOCK_KEEPER',
      shops: [MAIN],
      phone: '+919000000817',
    });
    await db.staffMembership.create({
      data: { userId: 'nobalance', role: 'CASHIER', locationId: SECOND, grantedById: 'x' },
    });
    const { body } = await inbox('cashier').expect(200);
    expect(body.items[0].customer.balancePaise).toBe(500);
  });
});

describe('Pakka karo', () => {
  it('confirms at once, in one tap, and holds the message for 10 seconds', async () => {
    const order = await placeOrder();
    const before = Date.now();
    const { body, status } = await confirm(order.id);
    expect(status).toBe(201);
    expect(body.status).toBe('CONFIRMED');
    const hold = new Date(body.holdUntil).getTime() - before;
    expect(hold).toBeGreaterThan(9000);
    expect(hold).toBeLessThan(11000);
    const saved = await fresh(order.id);
    expect(saved).toMatchObject({ status: 'CONFIRMED', confirmedById: 'papa', version: 2 });
    expect(saved.confirmedAt).toBeTruthy();
    expect(saved.work).toMatchObject({ assignedToId: 'papa' });
    expect(saved.work?.acknowledgedAt).toBeTruthy();
    // Stock was already held: confirming moves nothing.
    expect(await stockAt(MAIN)).toBe(90);
    expect(
      await db.auditLog.count({ where: { event: 'ORDER_CONFIRMED', entityId: order.id } }),
    ).toBe(1);
  });
  it('the customer hears nothing and sees it waiting until the hold passes', async () => {
    const order = await placeOrder();
    await confirm(order.id);
    expect((await customerSees(order.id)).status).toBe('AWAITING_CONFIRMATION');
    expect(await customerNotes()).toHaveLength(1);
    await holdPasses(order.id);
    expect((await customerSees(order.id)).status).toBe('CONFIRMED');
    const notes = await customerNotes();
    expect(notes).toHaveLength(2);
    expect(notes[0]?.title).toContain('pakka');
  });
  it('a WhatsApp message also waits, even if the worker runs during the hold', async () => {
    const order = await placeOrder();
    await confirm(order.id);
    const message = await db.outboundMessage.findFirstOrThrow({
      where: { dedupeKey: { startsWith: `wa:decision:${order.id}` } },
    });
    expect(message.nextAttemptAt.getTime()).toBeGreaterThan(Date.now() + 5000);
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    await app.get(AlertsService).deliver();
    expect(log.mock.calls.flat().join()).not.toContain('WHATSAPP_FAKE_SENT');
    expect((await db.outboundMessage.findUniqueOrThrow({ where: { id: message.id } })).status).toBe(
      'PENDING',
    );
  });
  it('what the customer never sees: who at the shop decided', async () => {
    const order = await placeOrder();
    await confirm(order.id);
    await holdPasses(order.id);
    const seen = await customerSees(order.id);
    expect(seen).not.toHaveProperty('confirmedById');
    expect(seen).not.toHaveProperty('decisionKey');
    const { body } = await request(server).get('/api/v1/orders').set(as('customer')).expect(200);
    expect(body.items[0]).not.toHaveProperty('confirmedById');
  });
  it('the same tap arriving twice is one confirmation', async () => {
    const order = await placeOrder();
    const payload = { expectedVersion: 1, decisionKey: randomUUID() };
    const send = () =>
      request(server)
        .post(`/api/v1/admin/orders/${order.id}/confirm`)
        .set(as('papa'))
        .send(payload);
    const results = await Promise.all([send(), send(), send()]);
    expect(results.map((r) => r.status)).toEqual([201, 201, 201]);
    expect(await db.auditLog.count({ where: { event: 'ORDER_CONFIRMED' } })).toBe(1);
    expect(await db.notification.count({ where: { dedupeKey: { startsWith: 'decision:' } } })).toBe(
      1,
    );
  });
  it('two people at once: one wins, and the other is told who, not given an error', async () => {
    const order = await placeOrder();
    const [a, b] = await Promise.all([
      confirm(order.id, 'papa', {}, 1),
      confirm(order.id, 'chacha', {}, 1),
    ]);
    const statuses = [a.status, b.status].sort();
    expect(statuses).toEqual([201, 409]);
    const loser = a.status === 409 ? a : b;
    const winner = a.status === 409 ? 'chacha' : 'papa';
    expect(loser.body.error.code).toBe('ALREADY_DECIDED');
    expect(loser.body.error.details).toMatchObject({ status: 'CONFIRMED', byName: winner });
    expect(await db.auditLog.count({ where: { event: 'ORDER_CONFIRMED' } })).toBe(1);
  });
  it('a card that went out of date is refused, so nobody confirms what they did not see', async () => {
    const order = await placeOrder();
    await db.order.update({ where: { id: order.id }, data: { version: 5 } });
    const { body, status } = await confirm(order.id, 'papa', {}, 1);
    expect(status).toBe(409);
    expect(body.error.code).toBe('ORDER_CHANGED');
    expect((await fresh(order.id)).status).toBe('AWAITING_CONFIRMATION');
  });
  it('a customer cancelling first beats the tap', async () => {
    const order = await placeOrder();
    await request(server).post(`/api/v1/orders/${order.id}/cancel`).set(as('customer')).expect(201);
    const { body, status } = await confirm(order.id, 'papa', {}, 1);
    expect(status).toBe(409);
    expect(body.error.code).toBe('ALREADY_DECIDED');
  });
  it('a customer cancelling during the hold takes the message back', async () => {
    const order = await placeOrder();
    await confirm(order.id);
    await request(server).post(`/api/v1/orders/${order.id}/cancel`).set(as('customer')).expect(201);
    expect(await db.notification.count({ where: { dedupeKey: { startsWith: 'decision:' } } })).toBe(
      0,
    );
    expect(await db.outboundMessage.count({ where: { status: 'CANCELLED' } })).toBe(1);
    expect((await fresh(order.id)).status).toBe('CANCELLED');
    expect(await stockAt(MAIN)).toBe(100);
    const { status } = await undo(order.id);
    expect(status).toBe(409);
  });
  it.each([
    ['keeper', 403],
    ['accountant', 403],
    ['customer', 403],
    ['managerb', 403],
  ])('%s cannot confirm', async (who, code) => {
    const order = await placeOrder();
    const { status } = await confirm(order.id, who);
    expect(status).toBe(code);
    expect((await fresh(order.id)).status).toBe('AWAITING_CONFIRMATION');
  });
  it('nobody signed out can', async () => {
    const order = await placeOrder();
    await request(server)
      .post(`/api/v1/admin/orders/${order.id}/confirm`)
      .send({ expectedVersion: 1, decisionKey: randomUUID() })
      .expect(401);
  });
  it('a paused owner cannot', async () => {
    const order = await placeOrder();
    await db.user.update({ where: { id: 'papa' }, data: { staffPausedAt: new Date() } });
    expect((await confirm(order.id)).status).toBe(403);
  });
  it('a cashier confirms cash and not udhaar', async () => {
    const cash = await placeOrder(5);
    expect((await confirm(cash.id, 'cashier')).status).toBe(201);
    const udhaar = await placeOrder(5);
    await db.payment.update({ where: { orderId: udhaar.id }, data: { method: 'CREDIT' } });
    await db.user.update({
      where: { id: 'customer' },
      data: { creditAllowed: true, creditLimitPaise: 100000000 },
    });
    expect((await confirm(udhaar.id, 'cashier')).status).toBe(403);
    expect((await confirm(udhaar.id, 'manager')).status).toBe(201);
  });
  it('a phone order was made by a person, so it never waits', async () => {
    const { body } = await request(server)
      .post('/api/v1/admin/orders/phone')
      .set(as('papa'))
      .send({
        customerPhone,
        customerName: 'Ramesh Yadav',
        address,
        items: [{ productId: 'cement', quantity: 1 }],
        deliveryDate: 'today',
        paymentMethod: 'COD',
        idempotencyKey: randomUUID(),
      })
      .expect(201);
    expect(body.status).toBe('CONFIRMED');
    expect((await fresh(body.id)).confirmedById).toBe('papa');
    expect((await inbox().expect(200)).body.count).toBe(0);
  });
  it.each([
    ['no version', { decisionKey: randomUUID() }],
    ['a bad key', { expectedVersion: 1, decisionKey: 'not-a-uuid' }],
    ['an extra field', { expectedVersion: 1, decisionKey: randomUUID(), status: 'DELIVERED' }],
    ['a tampered customer', { expectedVersion: 1, decisionKey: randomUUID(), userId: 'other' }],
  ])('refuses %s', async (_name, body) => {
    const order = await placeOrder();
    await request(server)
      .post(`/api/v1/admin/orders/${order.id}/confirm`)
      .set(as('papa'))
      .send(body)
      .expect(400);
  });
  it('an order that does not exist is a plain 404', async () => {
    await request(server)
      .post('/api/v1/admin/orders/nope/confirm')
      .set(as('papa'))
      .send({ expectedVersion: 1, decisionKey: randomUUID() })
      .expect(404);
  });
});

describe('Wapas lo', () => {
  it('puts the card back exactly, and the customer never hears', async () => {
    const order = await placeOrder();
    await confirm(order.id);
    const { status, body } = await undo(order.id);
    expect(status).toBe(201);
    expect(body.status).toBe('AWAITING_CONFIRMATION');
    const saved = await fresh(order.id);
    expect(saved).toMatchObject({
      status: 'AWAITING_CONFIRMATION',
      confirmedAt: null,
      confirmedById: null,
      decisionHoldUntil: null,
      version: 3,
    });
    expect(saved.work?.acknowledgedAt).toBeNull();
    expect(await stockAt(MAIN)).toBe(90);
    expect(await db.notification.count({ where: { dedupeKey: { startsWith: 'decision:' } } })).toBe(
      0,
    );
    const message = await db.outboundMessage.findFirstOrThrow({
      where: { dedupeKey: { startsWith: `wa:decision:${order.id}` } },
    });
    expect(message.status).toBe('CANCELLED');
    expect(await customerNotes()).toHaveLength(1);
    expect((await inbox().expect(200)).body.count).toBe(1);
    expect(await db.auditLog.count({ where: { event: 'ORDER_DECISION_UNDONE' } })).toBe(1);
  });
  it('the card can then be confirmed again', async () => {
    const order = await placeOrder();
    await confirm(order.id);
    expect((await undo(order.id)).status).toBe(201);
    expect((await confirm(order.id)).status).toBe(201);
    expect((await fresh(order.id)).status).toBe('CONFIRMED');
    expect(await db.notification.count({ where: { dedupeKey: { startsWith: 'decision:' } } })).toBe(
      1,
    );
  });
  it('after the hold it is too late, and nothing changes', async () => {
    const order = await placeOrder();
    await confirm(order.id);
    await holdPasses(order.id);
    const { status, body } = await undo(order.id);
    expect(status).toBe(409);
    expect(body.error.code).toBe('UNDO_TOO_LATE');
    expect((await fresh(order.id)).status).toBe('CONFIRMED');
  });
  it('an order nobody decided cannot be undone', async () => {
    const order = await placeOrder();
    expect((await undo(order.id)).body.error.code).toBe('UNDO_TOO_LATE');
  });
  it('once it moved on it cannot be undone', async () => {
    const order = await placeOrder();
    await confirm(order.id);
    await request(server)
      .patch(`/api/v1/admin/orders/${order.id}/status`)
      .set(as('papa'))
      .send({ status: 'PREPARING', note: 'x' })
      .expect(200);
    expect((await undo(order.id)).body.error.code).toBe('UNDO_TOO_LATE');
  });
  it('undoing twice at once happens once', async () => {
    const order = await placeOrder();
    await confirm(order.id);
    const results = await Promise.all([undo(order.id), undo(order.id)]);
    expect(results.map((r) => r.status).sort()).toEqual([201, 409]);
    expect(await db.auditLog.count({ where: { event: 'ORDER_DECISION_UNDONE' } })).toBe(1);
  });
  it.each(['keeper', 'customer', 'managerb'])('%s cannot undo', async (who) => {
    const order = await placeOrder();
    await confirm(order.id);
    expect((await undo(order.id, who)).status).toBe(403);
    expect((await fresh(order.id)).status).toBe('CONFIRMED');
  });
  it('the other owner may undo too', async () => {
    const order = await placeOrder();
    await confirm(order.id);
    expect((await undo(order.id, 'chacha')).status).toBe(201);
  });
});

describe('Nahi ho payega', () => {
  it('cancels, gives the stock back, and holds the message', async () => {
    const order = await placeOrder();
    const { status, body } = await refuse(order.id);
    expect(status).toBe(201);
    expect(body.status).toBe('CANCELLED');
    expect((await fresh(order.id)).status).toBe('CANCELLED');
    expect(await stockAt(MAIN)).toBe(100);
    expect((await customerSees(order.id)).status).toBe('AWAITING_CONFIRMATION');
    await holdPasses(order.id);
    expect((await customerSees(order.id)).status).toBe('CANCELLED');
    const note = (await customerNotes())[0];
    expect(note?.title).toContain('nahi ho payega');
    expect(note?.body).toContain('maal nahi');
  });
  it('a written reason goes to the customer, and stays out of the permanent log', async () => {
    const order = await placeOrder();
    const secret = 'Sharma ji ka maal pehle jayega';
    expect((await refuse(order.id, 'papa', { reason: 'OTHER', note: secret })).status).toBe(201);
    await holdPasses(order.id);
    expect((await customerNotes())[0]?.body).toBe(secret);
    expect(JSON.stringify(await db.auditLog.findMany())).not.toContain('Sharma');
    const log = await db.auditLog.findFirstOrThrow({ where: { event: 'ORDER_REFUSED' } });
    expect(log.details).toMatchObject({ reason: 'OTHER' });
  });
  it('“something else” needs words', async () => {
    const order = await placeOrder();
    expect((await refuse(order.id, 'papa', { reason: 'OTHER' })).status).toBe(400);
  });
  it('a note cannot be longer than a message', async () => {
    const order = await placeOrder();
    expect((await refuse(order.id, 'papa', { note: 'x'.repeat(201) })).status).toBe(400);
  });
  it('undo brings the order and its stock back', async () => {
    const order = await placeOrder();
    await refuse(order.id);
    expect(await stockAt(MAIN)).toBe(100);
    expect((await undo(order.id)).status).toBe(201);
    expect((await fresh(order.id)).status).toBe('AWAITING_CONFIRMATION');
    expect(await stockAt(MAIN)).toBe(90);
    expect(await db.notification.count({ where: { dedupeKey: { startsWith: 'decision:' } } })).toBe(
      0,
    );
  });
  it('undo is refused if the stock has since gone, rather than overselling', async () => {
    const order = await placeOrder(10);
    await refuse(order.id);
    await db.product.update({ where: { id: 'cement' }, data: { stock: 5 } });
    const { status, body } = await undo(order.id);
    expect(status).toBe(409);
    expect(body.error.code).toBe('STOCK_SHORT');
    expect((await fresh(order.id)).status).toBe('CANCELLED');
  });
  it('a paid order refused owes the money back, and undo restores that', async () => {
    const order = await placeOrder();
    await db.payment.update({
      where: { orderId: order.id },
      data: { status: 'CAPTURED', method: 'ONLINE' },
    });
    const { body } = await refuse(order.id);
    expect(body.status).toBe('REFUND_PENDING');
    expect((await fresh(order.id)).payment?.status).toBe('REFUND_PENDING');
    expect((await undo(order.id)).status).toBe(201);
    expect((await fresh(order.id)).payment?.status).toBe('CAPTURED');
  });
  it.each(['keeper', 'customer', 'accountant', 'managerb'])('%s cannot refuse', async (who) => {
    const order = await placeOrder();
    expect((await refuse(order.id, who)).status).toBe(403);
    expect(await stockAt(MAIN)).toBe(90);
  });
  it('the same refusal twice is one, and the stock comes back once', async () => {
    const order = await placeOrder();
    const payload = { expectedVersion: 1, decisionKey: randomUUID(), reason: 'OUT_OF_STOCK' };
    const send = () =>
      request(server).post(`/api/v1/admin/orders/${order.id}/refuse`).set(as('papa')).send(payload);
    const results = await Promise.all([send(), send()]);
    expect(results.map((r) => r.status)).toEqual([201, 201]);
    expect(await stockAt(MAIN)).toBe(100);
  });
  it('confirm and refuse racing: one wins, and stock stays right', async () => {
    const order = await placeOrder();
    const [a, b] = await Promise.all([
      confirm(order.id, 'papa', {}, 1),
      refuse(order.id, 'chacha'),
    ]);
    expect([a.status, b.status].sort()).toEqual([201, 409]);
    const saved = await fresh(order.id);
    expect(await stockAt(MAIN)).toBe(saved.status === 'CONFIRMED' ? 90 : 100);
  });
});

describe('Badal kar pakka karo', () => {
  const lines = (quantity: number, extra: Record<string, unknown> = {}) => [
    { productId: 'cement', quantity, ...extra },
  ];
  it('changes the amount and stock in one step, and tells the customer the new total', async () => {
    const order = await placeOrder(10);
    const { status } = await confirm(order.id, 'papa', change(lines(15)));
    expect(status).toBe(201);
    const saved = await fresh(order.id);
    expect(saved.items[0]).toMatchObject({ quantity: 15, lineTotalPaise: 15 * 40000 });
    expect(saved.subtotalPaise).toBe(15 * 40000);
    expect(saved.totalPaise).toBe(15 * 40000 + saved.deliveryFeePaise);
    expect(saved.payment?.amountPaise).toBe(saved.totalPaise);
    expect(await stockAt(MAIN)).toBe(85);
    await holdPasses(order.id);
    const note = (await customerNotes())[0];
    expect(note?.title).toContain('badlav');
    expect(note?.body).toContain('₹');
  });
  it('less stock gives the rest back', async () => {
    const order = await placeOrder(10);
    expect((await confirm(order.id, 'papa', change(lines(4)))).status).toBe(201);
    expect(await stockAt(MAIN)).toBe(96);
  });
  it('an owner may set any rate, on the record, beside the list rate', async () => {
    const order = await placeOrder(10);
    expect((await confirm(order.id, 'papa', change(lines(10, { pricePaise: 30000 })))).status).toBe(
      201,
    );
    const saved = await fresh(order.id);
    expect(saved.items[0]).toMatchObject({ pricePaise: 30000, listPricePaise: 40000 });
    const log = await db.auditLog.findFirstOrThrow({
      where: { event: 'ORDER_CHANGED_AT_CONFIRM' },
    });
    expect(log.details).toMatchObject({
      lines: [{ productId: 'cement', pricePaise: 30000, listPricePaise: 40000 }],
    });
  });
  it('a manager may go as far as their shop’s cap', async () => {
    const order = await placeOrder(10);
    expect(
      (await confirm(order.id, 'manager', change(lines(10, { pricePaise: 38000 })))).status,
    ).toBe(201);
  });
  it('a manager one paisa below the cap is refused, with the limit', async () => {
    const order = await placeOrder(10);
    const { status, body } = await confirm(
      order.id,
      'manager',
      change(lines(10, { pricePaise: 37999 })),
    );
    expect(status).toBe(403);
    expect(body.error.code).toBe('RATE_CAP');
    expect(body.error.details).toMatchObject({ floorPaise: 38000, capPercent: 5 });
    expect((await fresh(order.id)).items[0]?.pricePaise).toBe(40000);
  });
  it('with a cap of 0 a manager cannot lower a rate at all', async () => {
    await db.location.update({ where: { id: MAIN }, data: { managerRateCapPercent: 0 } });
    const order = await placeOrder(10);
    expect(
      (await confirm(order.id, 'manager', change(lines(10, { pricePaise: 39999 })))).status,
    ).toBe(403);
  });
  it('a manager cannot beat the cap in two small steps, as it is from the list rate', async () => {
    const order = await placeOrder(10);
    await db.orderItem.updateMany({
      where: { orderId: order.id },
      data: { pricePaise: 38000, lineTotalPaise: 380000 },
    });
    await db.order.update({
      where: { id: order.id },
      data: { subtotalPaise: 380000, totalPaise: 430000 },
    });
    const { status } = await confirm(order.id, 'manager', change(lines(10, { pricePaise: 37000 })));
    expect(status).toBe(403);
  });
  it('a manager’s lower delivery charge has the same cap', async () => {
    const order = await placeOrder(10);
    const { status } = await confirm(
      order.id,
      'manager',
      change(lines(10), { deliveryFeePaise: 1000 }),
    );
    expect(status).toBe(403);
    expect(
      (await confirm(order.id, 'papa', change(lines(10), { deliveryFeePaise: 1000 }))).status,
    ).toBe(201);
    expect((await fresh(order.id)).deliveryFeePaise).toBe(1000);
  });
  it('a cashier may change a quantity but not a rate or a delivery charge', async () => {
    const order = await placeOrder(10);
    expect(
      (await confirm(order.id, 'cashier', change(lines(10, { pricePaise: 39000 })))).status,
    ).toBe(403);
    expect(
      (await confirm(order.id, 'cashier', change(lines(10), { deliveryFeePaise: 1000 }))).status,
    ).toBe(403);
    expect((await confirm(order.id, 'cashier', change(lines(12)))).status).toBe(201);
  });
  it.each([
    ['a price of nothing', { pricePaise: 0 }],
    ['a negative price', { pricePaise: -100 }],
    ['a fractional price', { pricePaise: 100.5 }],
    ['an absurd price', { pricePaise: 100_000_001 }],
  ])('refuses %s', async (_name, extra) => {
    const order = await placeOrder(10);
    expect((await confirm(order.id, 'papa', change(lines(10, extra)))).status).toBe(400);
  });
  it.each([
    ['no lines', []],
    ['a quantity of nothing', [{ productId: 'cement', quantity: 0 }]],
    ['a negative quantity', [{ productId: 'cement', quantity: -5 }]],
    [
      'the same product twice',
      [
        { productId: 'cement', quantity: 1 },
        { productId: 'cement', quantity: 2 },
      ],
    ],
  ])('refuses %s', async (_name, input) => {
    const order = await placeOrder(10);
    expect((await confirm(order.id, 'papa', change(input))).status).toBe(400);
    expect(await stockAt(MAIN)).toBe(90);
  });
  it('adds a material at its list rate, and removes one', async () => {
    const order = await placeOrder(10);
    expect(
      (await confirm(order.id, 'papa', change([{ productId: 'sand', quantity: 3 }]))).status,
    ).toBe(201);
    const saved = await fresh(order.id);
    expect(saved.items.map((item) => item.productId)).toEqual(['sand']);
    expect(saved.items[0]).toMatchObject({ pricePaise: 40000, listPricePaise: 40000 });
    expect(await stockAt(MAIN)).toBe(100);
    expect(await stockAt(MAIN, 'sand')).toBe(37);
  });
  it('a material no longer sold cannot be added', async () => {
    await db.product.update({ where: { id: 'sand' }, data: { active: false } });
    const order = await placeOrder(10);
    const { status } = await confirm(
      order.id,
      'papa',
      change([{ productId: 'sand', quantity: 1 }]),
    );
    expect(status).toBe(404);
  });
  it('a quantity against the selling rules is refused', async () => {
    await db.product.update({ where: { id: 'cement' }, data: { minQuantity: 5, quantityStep: 5 } });
    const order = await placeOrder(10);
    const { status, body } = await confirm(order.id, 'papa', change(lines(7)));
    expect(status).toBe(400);
    expect(body.error.code).toBe('INVALID_QUANTITY');
  });
  it('more than the shop’s count is refused with the numbers', async () => {
    const order = await placeOrder(10);
    const { status, body } = await confirm(order.id, 'papa', change(lines(500)));
    expect(status).toBe(409);
    expect(body.error.code).toBe('STOCK_SHORT');
    expect(body.error.details).toMatchObject({ have: 90, need: 490, name: 'UltraTech Super' });
    expect(await stockAt(MAIN)).toBe(90);
    expect((await fresh(order.id)).status).toBe('AWAITING_CONFIRMATION');
  });
  it('“goods are there” lets an owner fix the count, on the record', async () => {
    const order = await placeOrder(10);
    const { status } = await confirm(
      order.id,
      'papa',
      change(lines(500), { stockFixes: ['cement'] }),
    );
    expect(status).toBe(201);
    expect((await fresh(order.id)).items[0]?.quantity).toBe(500);
    expect(await stockAt(MAIN)).toBe(0);
    const log = await db.auditLog.findFirstOrThrow({
      where: { event: 'STOCK_CORRECTED_AT_CONFIRM' },
    });
    expect(log.details).toMatchObject({ productId: 'cement', from: 90, to: 490 });
    expect(await db.inventoryMovement.count({ where: { kind: 'MANUAL_ADJUSTMENT' } })).toBe(1);
  });
  it('a manager cannot fix the count, as only owners change stock', async () => {
    const order = await placeOrder(10);
    const { status } = await confirm(
      order.id,
      'manager',
      change(lines(500), { stockFixes: ['cement'] }),
    );
    expect(status).toBe(403);
    expect(await db.inventoryMovement.count({ where: { kind: 'MANUAL_ADJUSTMENT' } })).toBe(0);
  });
  it('moves an order to another shop, stock and all', async () => {
    await db.stockLevel.create({
      data: { productId: 'cement', locationId: SECOND, quantity: 0 },
    });
    await request(server)
      .post('/api/v1/admin/products/cement/movements')
      .set(as('papa'))
      .send({
        kind: 'PURCHASE_IN',
        quantity: 50,
        locationId: SECOND,
        note: 'x',
        idempotencyKey: randomUUID(),
      })
      .expect(201);
    const order = await placeOrder(10);
    expect(
      (await confirm(order.id, 'papa', change(lines(10), { locationId: SECOND }))).status,
    ).toBe(201);
    expect(await stockAt(MAIN)).toBe(100);
    expect(await stockAt(SECOND)).toBe(40);
    expect((await fresh(order.id)).locationId).toBe(SECOND);
  });
  it('a manager cannot send an order to a shop they do not hold', async () => {
    const order = await placeOrder(10);
    const { status } = await confirm(
      order.id,
      'manager',
      change(lines(10), { locationId: SECOND }),
    );
    expect(status).toBe(403);
    expect(await stockAt(MAIN)).toBe(90);
  });
  it('a closed shop or a made-up one is refused', async () => {
    const order = await placeOrder(10);
    expect(
      (await confirm(order.id, 'papa', change(lines(10), { locationId: 'nope' }))).status,
    ).toBe(400);
  });
  it('a past delivery day is refused, and a new day works', async () => {
    const order = await placeOrder(10);
    expect(
      (await confirm(order.id, 'papa', change(lines(10), { deliveryDate: '2020-01-01' }))).status,
    ).toBe(400);
    expect(
      (await confirm(order.id, 'papa', change(lines(10), { deliveryDate: day(3) }))).status,
    ).toBe(201);
    expect((await fresh(order.id)).deliveryDate).toBe(day(3));
  });
  it('a paid order’s amounts stay as they are', async () => {
    const order = await placeOrder(10);
    await db.payment.update({
      where: { orderId: order.id },
      data: { status: 'CAPTURED', method: 'ONLINE' },
    });
    const { body } = await confirm(order.id, 'papa', change(lines(5)));
    expect(body.error.code).toBe('PAID_ORDER_LOCKED');
    expect((await confirm(order.id)).status).toBe(201);
  });
  it('undo puts back the lines, amounts, shop and stock exactly', async () => {
    const order = await placeOrder(10);
    const before = await fresh(order.id);
    await confirm(
      order.id,
      'papa',
      change(
        [
          { productId: 'cement', quantity: 20, pricePaise: 30000 },
          { productId: 'sand', quantity: 2 },
        ],
        { deliveryFeePaise: 0, deliveryDate: day(4) },
      ),
    );
    expect(await stockAt(MAIN)).toBe(80);
    expect(await stockAt(MAIN, 'sand')).toBe(38);
    expect((await undo(order.id)).status).toBe(201);
    const after = await fresh(order.id);
    expect(after).toMatchObject({
      totalPaise: before.totalPaise,
      subtotalPaise: before.subtotalPaise,
      deliveryFeePaise: before.deliveryFeePaise,
      deliveryDate: before.deliveryDate,
      locationId: before.locationId,
    });
    expect(
      after.items.map(({ productId, quantity, pricePaise }) => [productId, quantity, pricePaise]),
    ).toEqual([['cement', 10, 40000]]);
    expect(after.payment?.amountPaise).toBe(before.totalPaise);
    expect(await stockAt(MAIN)).toBe(90);
    expect(await stockAt(MAIN, 'sand')).toBe(40);
    expect(await db.orderAmendment.count({ where: { orderId: order.id } })).toBe(2);
  });
  it('the record of what changed cannot be rewritten', async () => {
    const order = await placeOrder(10);
    await confirm(order.id, 'papa', change(lines(12)));
    await expect(
      db.$executeRawUnsafe(`UPDATE "OrderAmendment" SET "actorId" = 'nobody'`),
    ).rejects.toThrow(/append-only/);
    await expect(db.$executeRawUnsafe(`DELETE FROM "OrderAmendment"`)).rejects.toThrow(
      /append-only/,
    );
  });
});

describe('udhaar at confirm', () => {
  const udhaar = (extra: Record<string, unknown> = {}) =>
    change([{ productId: 'cement', quantity: 10 }], { paymentMethod: 'CREDIT', ...extra });
  it('is refused for a customer not allowed it', async () => {
    const order = await placeOrder(10);
    const { body } = await confirm(order.id, 'papa', udhaar());
    expect(body.error.code).toBe('CREDIT_NOT_ALLOWED');
  });
  it('within the limit goes through, and posts on delivery as before', async () => {
    await db.user.update({
      where: { id: 'customer' },
      data: { creditAllowed: true, creditLimitPaise: 100000000 },
    });
    const order = await placeOrder(10);
    expect((await confirm(order.id, 'manager', udhaar())).status).toBe(201);
    const saved = await fresh(order.id);
    expect(saved.payment?.method).toBe('CREDIT');
    expect(await db.customerLedgerEntry.count({ where: { orderId: order.id } })).toBe(0);
  });
  it('a cashier’s sheet has no udhaar', async () => {
    await db.user.update({
      where: { id: 'customer' },
      data: { creditAllowed: true, creditLimitPaise: 100000000 },
    });
    const order = await placeOrder(10);
    expect((await confirm(order.id, 'cashier', udhaar())).status).toBe(403);
  });
  describe('above the limit', () => {
    beforeEach(() =>
      db.user.update({
        where: { id: 'customer' },
        data: { creditAllowed: true, creditLimitPaise: 100 },
      }),
    );
    it('is refused without saying so', async () => {
      const order = await placeOrder(10);
      const { status, body } = await confirm(order.id, 'papa', udhaar());
      expect(status).toBe(409);
      expect(body.error.code).toBe('CREDIT_LIMIT_EXCEEDED');
    });
    it('a manager cannot pass it even by asking', async () => {
      const order = await placeOrder(10);
      const { body } = await confirm(order.id, 'manager', udhaar({ overrideLimit: true }));
      expect(body.error.code).toBe('CREDIT_LIMIT_EXCEEDED');
    });
    it('either owner can, on the record', async () => {
      const order = await placeOrder(10);
      expect((await confirm(order.id, 'chacha', udhaar({ overrideLimit: true }))).status).toBe(201);
      expect(await db.auditLog.count({ where: { event: 'CREDIT_LIMIT_OVERRIDE' } })).toBe(1);
    });
  });
});

describe('the preview', () => {
  const preview = (id: string, body: Record<string, unknown>, who = 'papa') =>
    request(server).post(`/api/v1/admin/orders/${id}/preview`).set(as(who)).send(body);
  it('shows exactly what the customer will get, and changes nothing', async () => {
    const order = await placeOrder(10);
    const { body } = await preview(order.id, {
      decision: 'CONFIRM',
      changes: { lines: [{ productId: 'cement', quantity: 12 }] },
    }).expect(201);
    expect(body.totalPaise).toBe(12 * 40000 + 50000);
    expect(body.title).toContain('badlav');
    expect((await fresh(order.id)).version).toBe(1);
    expect(await stockAt(MAIN)).toBe(90);
    await confirm(order.id, 'papa', change([{ productId: 'cement', quantity: 12 }]));
    await holdPasses(order.id);
    expect((await customerNotes())[0]).toMatchObject({ title: body.title, body: body.body });
  });
  it('names what the count is short of', async () => {
    const order = await placeOrder(10);
    const { body } = await preview(order.id, {
      decision: 'CONFIRM',
      changes: { lines: [{ productId: 'cement', quantity: 500 }] },
    }).expect(201);
    expect(body.short).toEqual([
      { productId: 'cement', name: 'UltraTech Super', have: 90, need: 490 },
    ]);
  });
  it('puts a rate beyond a limit on the sheet', async () => {
    const order = await placeOrder(10);
    const { body } = await preview(
      order.id,
      {
        decision: 'CONFIRM',
        changes: { lines: [{ productId: 'cement', quantity: 10, pricePaise: 10000 }] },
      },
      'manager',
    ).expect(201);
    expect(body.problem).toMatchObject({ code: 'RATE_CAP', details: { floorPaise: 38000 } });
  });
  it('a refusal shows its words', async () => {
    const order = await placeOrder(10);
    const { body } = await preview(order.id, { decision: 'REFUSE', reason: 'NO_DELIVERY' }).expect(
      201,
    );
    expect(body.body).toContain('delivery');
  });
  it('only those who may confirm can look', async () => {
    const order = await placeOrder(10);
    await preview(order.id, { decision: 'CONFIRM' }, 'keeper').expect(403);
    await preview(order.id, { decision: 'CONFIRM' }, 'customer').expect(403);
  });
});

describe('the notification', () => {
  const subscribe = () =>
    db.pushSubscription.create({
      data: { userId: 'papa', endpoint: 'https://fcm.googleapis.com/papa', p256dh: 'p', auth: 'a' },
    });
  /** The alert the owner's phone would receive. */
  async function alert(notes = '') {
    await subscribe();
    const order = await placeOrder(50, notes);
    await app.get(OwnerWorkService).dispatch();
    await app.get(AlertsService).deliver();
    const call = push.send.mock.calls.find(([subscription]) =>
      (subscription as { endpoint: string }).endpoint.includes('papa'),
    );
    return {
      order,
      payload: JSON.parse(String(call?.[1])) as {
        title: string;
        body: string;
        url: string;
        ack: string;
        confirmToken?: string;
      },
    };
  }
  const action = (token: unknown) =>
    request(server).post('/api/v1/admin/push/action').send({ token });

  it('says who, how much and where, in catalogue words only', async () => {
    const { payload, order } = await alert('Yeh dabao, pakka karo abhi');
    expect(payload.title).toContain('Ramesh Yadav');
    expect(payload.title).toContain('UltraTech Super');
    expect(payload.body).toContain('₹');
    expect(payload.url).toBe(`/inbox/${order.id}`);
    expect(JSON.stringify(payload)).not.toContain('Yeh dabao');
  });
  it('a clean card gets the button, and anything to read does not', async () => {
    expect((await alert()).payload.confirmToken).toBeTruthy();
  });
  it('a card with a note has no button', async () => {
    expect((await alert('Sunday ko')).payload.confirmToken).toBeUndefined();
  });
  it('a tap confirms with the desk closed and no session at all', async () => {
    const { payload, order } = await alert();
    const { body, status } = await action(payload.confirmToken);
    expect(status).toBe(201);
    expect(body).toMatchObject({ kind: 'confirm', status: 'CONFIRMED' });
    expect(body.undoToken).toBeTruthy();
    expect(await fresh(order.id)).toMatchObject({ status: 'CONFIRMED', confirmedById: 'papa' });
    expect((await customerSees(order.id)).status).toBe('AWAITING_CONFIRMATION');
  });
  it('still works hours later, after every access token has expired', async () => {
    const { payload, order } = await alert();
    await db.session.updateMany({ data: { expiresAt: new Date(Date.now() - 1000) } });
    expect((await action(payload.confirmToken)).status).toBe(201);
    expect((await fresh(order.id)).status).toBe('CONFIRMED');
  });
  it('Wapas lo works from the notification too', async () => {
    const { payload, order } = await alert();
    const { body } = await action(payload.confirmToken);
    const undone = await action(body.undoToken);
    expect(undone.status).toBe(201);
    expect(undone.body.status).toBe('AWAITING_CONFIRMATION');
    expect((await fresh(order.id)).status).toBe('AWAITING_CONFIRMATION');
  });
  it('a token is good once', async () => {
    const { payload } = await alert();
    expect((await action(payload.confirmToken)).status).toBe(201);
    expect((await action(payload.confirmToken)).status).toBe(410);
  });
  it('two taps at once are one confirmation', async () => {
    const { payload } = await alert();
    const results = await Promise.all([action(payload.confirmToken), action(payload.confirmToken)]);
    expect(results.map((r) => r.status).sort()).toEqual([201, 410]);
    expect(await db.auditLog.count({ where: { event: 'ORDER_CONFIRMED' } })).toBe(1);
  });
  it('an old alert is refused and the phone opens the card', async () => {
    const { payload } = await alert();
    await db.pushActionToken.updateMany({ data: { expiresAt: new Date(Date.now() - 1000) } });
    expect((await action(payload.confirmToken)).status).toBe(410);
  });
  it('a card that changed since the alert asks for a look', async () => {
    const { payload, order } = await alert();
    await db.order.update({ where: { id: order.id }, data: { version: 9 } });
    const { status, body } = await action(payload.confirmToken);
    expect(status).toBe(409);
    expect(body.error.code).toBe('ORDER_CHANGED');
    // Nothing was spent: the failed tap can be followed by opening the card.
    expect((await fresh(order.id)).status).toBe('AWAITING_CONFIRMATION');
  });
  it('a card that gained something to read since the alert asks for a look', async () => {
    const { payload, order } = await alert();
    await db.order.update({ where: { id: order.id }, data: { notes: 'Ruk jao' } });
    expect((await action(payload.confirmToken)).status).toBe(409);
    expect((await fresh(order.id)).status).toBe('AWAITING_CONFIRMATION');
  });
  it('someone else getting there first is news', async () => {
    const { payload, order } = await alert();
    await confirm(order.id, 'chacha');
    const { status, body } = await action(payload.confirmToken);
    expect(status).toBe(409);
    expect(body.error.code).toBe('ALREADY_DECIDED');
    expect(body.error.details.byName).toBe('chacha');
  });
  it('a paused or departed person’s old alert does nothing', async () => {
    const { payload, order } = await alert();
    await db.user.update({ where: { id: 'papa' }, data: { staffPausedAt: new Date() } });
    expect((await action(payload.confirmToken)).status).toBe(410);
    expect((await fresh(order.id)).status).toBe('AWAITING_CONFIRMATION');
  });
  it('someone whose role changed since the alert cannot use it', async () => {
    const { payload, order } = await alert();
    await db.staffMembership.updateMany({
      where: { userId: 'papa', endedAt: null },
      data: { endedAt: new Date(), endedById: 'chacha' },
    });
    await db.staffMembership.create({
      data: { userId: 'papa', role: 'STOCK_KEEPER', locationId: MAIN, grantedById: 'chacha' },
    });
    expect((await action(payload.confirmToken)).status).toBe(409);
    expect((await fresh(order.id)).status).toBe('AWAITING_CONFIRMATION');
  });
  it('signing someone out everywhere kills their buttons', async () => {
    const { payload, order } = await alert();
    await request(server)
      .post('/api/v1/admin/users/papa/sign-out')
      .set(as('chacha'))
      .send({})
      .expect(201);
    expect((await action(payload.confirmToken)).status).toBe(410);
    expect((await fresh(order.id)).status).toBe('AWAITING_CONFIRMATION');
  });
  it('the undo token only undoes, and only during the hold', async () => {
    const { payload, order } = await alert();
    const { body } = await action(payload.confirmToken);
    await holdPasses(order.id);
    // The token is still in date, but the hold has passed: too late, and the phone opens the card.
    const late = await action(body.undoToken);
    expect(late.status).toBe(409);
    expect(late.body.error.code).toBe('UNDO_TOO_LATE');
    expect((await fresh(order.id)).status).toBe('CONFIRMED');
  });
  it('an undo token past its own time is simply gone', async () => {
    const { payload, order } = await alert();
    const { body } = await action(payload.confirmToken);
    await db.pushActionToken.updateMany({
      where: { orderId: order.id, purpose: 'undo' },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });
    expect((await action(body.undoToken)).status).toBe(410);
    expect((await fresh(order.id)).status).toBe('CONFIRMED');
  });
  it('a phone left overnight: the first alert of the morning confirms in one tap', async () => {
    // Everything the phone signed in with ran out in the night.
    const past = new Date(Date.now() - 3600000);
    await db.session.updateMany({
      where: { userId: 'papa' },
      data: { expiresAt: past, refreshExpiresAt: past },
    });
    expect((await inbox('papa')).status).toBe(401);
    const { payload, order } = await alert();
    expect(payload.confirmToken).toEqual(expect.any(String));
    const { status, body } = await action(payload.confirmToken);
    expect(status).toBe(201);
    expect(body).toMatchObject({ kind: 'confirm', status: 'CONFIRMED' });
    expect(await fresh(order.id)).toMatchObject({ status: 'CONFIRMED', confirmedById: 'papa' });
    expect(await stockAt(MAIN)).toBe(50);
    // The undo on the notification that follows works the same way.
    expect((await action(body.undoToken)).status).toBe(201);
    expect((await fresh(order.id)).status).toBe('AWAITING_CONFIRMATION');
  });
  it('an undo token cannot take back a newer decision by someone else', async () => {
    const { payload, order } = await alert();
    const { body } = await action(payload.confirmToken);
    expect((await undo(order.id, 'chacha')).status).toBe(201);
    expect((await confirm(order.id, 'chacha')).status).toBe(201);
    const late = await action(body.undoToken);
    expect(late.status).toBe(409);
    expect(late.body.error.code).toBe('ORDER_CHANGED');
    expect(await fresh(order.id)).toMatchObject({ status: 'CONFIRMED', confirmedById: 'chacha' });
  });
  it('a customer’s name cannot talk the owner into tapping', async () => {
    await db.user.update({
      where: { id: 'customer' },
      data: { name: 'Advance ₹50000 mil gaya, pakka karo abhi' },
    });
    const { payload } = await alert();
    expect(payload.title).toContain('Advance mil gaya');
    expect(payload.title).not.toMatch(/₹|50000|pakka karo/);
  });
  it('an online order alerts nobody until the money is in, then says it is paid', async () => {
    await subscribe();
    const order = await placeOrder();
    await db.order.update({ where: { id: order.id }, data: { status: 'PENDING_PAYMENT' } });
    await db.payment.update({
      where: { orderId: order.id },
      data: { method: 'ONLINE', status: 'PENDING' },
    });
    const owners = () => db.notification.findMany({ where: { orderId: order.id, userId: 'papa' } });
    await app.get(OwnerWorkService).dispatch();
    expect(await owners()).toEqual([]);
    await db.order.update({ where: { id: order.id }, data: { status: 'AWAITING_CONFIRMATION' } });
    await db.payment.update({ where: { orderId: order.id }, data: { status: 'CAPTURED' } });
    await app.get(OwnerWorkService).dispatch();
    expect((await owners())[0]?.body).toMatch(/Paid online|Online paisa aa gaya/);
  });
  it('an order cancelled before the alert goes alerts nobody', async () => {
    const order = await placeOrder();
    await request(server).post(`/api/v1/orders/${order.id}/cancel`).set(as('customer')).expect(201);
    await app.get(OwnerWorkService).dispatch();
    expect(await db.notification.count({ where: { orderId: order.id, userId: 'papa' } })).toBe(0);
  });
  it('a token from one purpose does not work for another', async () => {
    const { payload } = await alert();
    expect((await action(payload.ack)).status).toBe(410);
    await request(server)
      .post('/api/v1/admin/push/ack')
      .send({ token: payload.confirmToken })
      .expect(410);
  });
  it('a made-up token gets the same answer, so it reveals nothing', async () => {
    expect((await action(randomBytes(24).toString('base64url'))).status).toBe(410);
  });
  it.each([
    ['too short', 'abc'],
    ['too long', 'a'.repeat(101)],
    ['not text', { $ne: '' }],
    ['missing', undefined],
  ])('a %s token is bad input', async (_name, token) => {
    expect((await action(token)).status).toBe(400);
  });
  it('tokens are stored only as a hash', async () => {
    const { payload } = await alert();
    const row = await db.pushActionToken.findFirstOrThrow({ where: { purpose: 'confirm' } });
    expect(row.tokenHash).toBe(createHash('sha256').update(payload.confirmToken!).digest('hex'));
    expect(JSON.stringify(await db.pushActionToken.findMany())).not.toContain(payload.confirmToken);
  });
});

describe('the rate cap', () => {
  const setCap = (value: unknown, who = 'papa') =>
    request(server)
      .patch(`/api/v1/admin/locations/${MAIN}`)
      .set(as(who))
      .send({ managerRateCapPercent: value });
  it('owners set it, on the record', async () => {
    const { body } = await setCap(10).expect(200);
    expect(body.managerRateCapPercent).toBe(10);
    const log = await db.auditLog.findFirstOrThrow({ where: { event: 'SHOP_UPDATED' } });
    expect(log.details).toMatchObject({ managerRateCapPercent: 10 });
  });
  it.each(['manager', 'cashier', 'customer'])('%s cannot', async (who) => {
    await setCap(50, who).expect(403);
  });
  it.each([-1, 51, 2.5, '10'])('refuses %s', async (value) => {
    await setCap(value).expect(400);
  });
  it('the database refuses a cap beyond the rule too', async () => {
    await expect(
      db.$executeRawUnsafe(`UPDATE "Location" SET "managerRateCapPercent" = 60`),
    ).rejects.toThrow();
  });
});

describe('what the customer can tell during and after a decision', () => {
  const secrets = ['version', 'decisionHoldUntil', 'decisionKey', 'confirmedById', 'amendments'];
  it('inside the hold, a change is invisible: lines, amounts, date, money and who', async () => {
    const order = await placeOrder(10);
    const before = await fresh(order.id);
    const { status } = await confirm(
      order.id,
      'papa',
      change([{ productId: 'cement', quantity: 20, pricePaise: 39000 }], {
        deliveryFeePaise: 0,
        deliveryDate: day(3),
      }),
    );
    expect(status).toBe(201);
    const seen = await customerSees(order.id);
    expect(seen).toMatchObject({
      status: 'AWAITING_CONFIRMATION',
      confirmedAt: null,
      totalPaise: before.totalPaise,
      deliveryFeePaise: before.deliveryFeePaise,
      subtotalPaise: before.subtotalPaise,
      deliveryDate: before.deliveryDate,
      locationId: before.locationId,
      work: { acknowledgedAt: null, assignedTo: null },
      payment: { amountPaise: before.totalPaise, method: 'COD' },
    });
    expect(seen.items).toHaveLength(1);
    expect(seen.items[0]).toMatchObject({ quantity: 10, pricePaise: 40000 });
    expect(seen.history.map((row: { status: string }) => row.status)).toEqual([
      'AWAITING_CONFIRMATION',
    ]);
    await holdPasses(order.id);
    const after = await customerSees(order.id);
    expect(after).toMatchObject({ status: 'CONFIRMED', totalPaise: 780000 });
    expect(after.items[0]).toMatchObject({ quantity: 20, pricePaise: 39000 });
    expect(after.work.assignedTo).not.toBeNull();
  });
  it('never carries the fields only the shop uses, in the hold or after it', async () => {
    const order = await placeOrder();
    await confirm(order.id);
    for (const seen of [
      await customerSees(order.id),
      await holdPasses(order.id).then(() => customerSees(order.id)),
    ]) {
      for (const field of secrets) expect(seen).not.toHaveProperty(field);
      expect(seen.items[0]).not.toHaveProperty('listPricePaise');
      expect(seen.history[0]).not.toHaveProperty('actorId');
    }
  });
  it('inside the hold, a refused paid order still reads as paid', async () => {
    const order = await placeOrder();
    await db.payment.update({
      where: { orderId: order.id },
      data: { status: 'CAPTURED', method: 'ONLINE' },
    });
    expect((await refuse(order.id)).status).toBe(201);
    const seen = await customerSees(order.id);
    expect(seen.status).toBe('AWAITING_CONFIRMATION');
    expect(seen.payment.status).toBe('CAPTURED');
  });
  it('a decision taken back never shows, then or under a later decision', async () => {
    const order = await placeOrder();
    await confirm(order.id);
    expect((await undo(order.id)).status).toBe(201);
    const waitingAgain = await customerSees(order.id);
    expect(waitingAgain.history.map((row: { status: string }) => row.status)).toEqual([
      'AWAITING_CONFIRMATION',
    ]);
    expect(JSON.stringify(waitingAgain)).not.toMatch(/taken back/i);
    await confirm(order.id);
    await holdPasses(order.id);
    expect(
      (await customerSees(order.id)).history.map((row: { status: string }) => row.status),
    ).toEqual(['AWAITING_CONFIRMATION', 'CONFIRMED']);
  });
  it('payment arriving keeps its step: only a decision can be taken back', async () => {
    const seen = customerView({
      items: [],
      amendments: [],
      decisionHoldUntil: null,
      history: [
        { id: '1', status: 'PENDING_PAYMENT', actorId: 'x', note: '' },
        { id: '2', status: 'AWAITING_CONFIRMATION', actorId: 'razorpay', note: '' },
      ],
    } as never);
    expect(seen.history.map((row) => row.status)).toEqual([
      'PENDING_PAYMENT',
      'AWAITING_CONFIRMATION',
    ]);
  });
  it('placing the same order again during the hold tells them nothing', async () => {
    await request(server)
      .put('/api/v1/cart/items')
      .set(as('customer'))
      .send({ productId: 'cement', quantity: 10 })
      .expect(200);
    const review = await request(server)
      .post('/api/v1/checkout/review')
      .set(as('customer'))
      .send({ addressId: 'site', deliveryDate: day(), paymentMethod: 'COD', notes: '' })
      .expect(201);
    const body = { reviewId: review.body.id, idempotencyKey: randomUUID() };
    const place = () => request(server).post('/api/v1/orders').set(as('customer')).send(body);
    const placed = await place().expect(201);
    await confirm(placed.body.id);
    const again = await place().expect(201);
    expect(again.body.id).toBe(placed.body.id);
    expect(again.body.status).toBe('AWAITING_CONFIRMATION');
    for (const field of secrets) expect(again.body).not.toHaveProperty(field);
  });
  it('a refusal reads as what the customer was told, with no reason code', async () => {
    const order = await placeOrder();
    await refuse(order.id, 'papa', { reason: 'OTHER', note: 'Truck kharab hai' });
    await holdPasses(order.id);
    const { history } = await customerSees(order.id);
    expect(history.at(-1).note).toBe('Truck kharab hai');
    expect(JSON.stringify(history)).not.toContain('OTHER');
  });
  it('a profile name with direction tricks is refused', async () => {
    const { status } = await request(server)
      .patch('/api/v1/me')
      .set(as('customer'))
      .send({ name: `Ramesh${String.fromCodePoint(0x202e)}ayadaY`, language: 'hi' });
    expect(status).toBe(400);
  });
});

describe('a message that was held', () => {
  const decisionNote = (orderId: string) =>
    db.notification.findFirstOrThrow({
      where: { orderId, dedupeKey: { startsWith: 'decision:' } },
    });
  it('cannot go until an undo begun in time has had its whole life', async () => {
    const order = await placeOrder();
    await confirm(order.id);
    const { decisionHoldUntil } = await fresh(order.id);
    const message = await db.outboundMessage.findFirstOrThrow({
      where: { dedupeKey: { startsWith: `wa:decision:${order.id}:` } },
    });
    const hold = decisionHoldUntil!.getTime();
    expect((await decisionNote(order.id)).sendAfter!.getTime()).toBe(hold + 10000);
    expect(message.nextAttemptAt.getTime()).toBe(hold + 10000);
  });
  it('is taken back by an undo that began in time, however late that undo finishes', async () => {
    const order = await placeOrder();
    await confirm(order.id);
    const began = new Date();
    await db.notification.updateMany({
      where: { orderId: order.id, dedupeKey: { startsWith: 'decision:' } },
      data: { sendAfter: new Date(began.getTime() + 1) },
    });
    await new Promise((resolve) => setTimeout(resolve, 5));
    await clearHeldMessages(db, order.id, began);
    expect(
      await db.notification.count({
        where: { orderId: order.id, dedupeKey: { startsWith: 'decision:' } },
      }),
    ).toBe(0);
  });
});

describe('a decision is exactly what was asked', () => {
  it('one key does not answer a different decision', async () => {
    const order = await placeOrder(10);
    const decisionKey = randomUUID();
    expect((await confirm(order.id, 'papa', { decisionKey })).status).toBe(201);
    const refused = await refuse(order.id, 'papa', { decisionKey });
    expect(refused.status).toBe(409);
    expect(refused.body.error.code).toBe('ALREADY_DECIDED');
    const changed = await confirm(order.id, 'papa', {
      decisionKey,
      ...change([{ productId: 'cement', quantity: 20 }]),
    });
    expect(changed.status).toBe(409);
    expect(changed.body.error.code).toBe('ALREADY_DECIDED');
    // The same tap again still repeats the answer.
    const again = await confirm(order.id, 'papa', { decisionKey });
    expect(again.status).toBe(201);
    expect(again.body.status).toBe('CONFIRMED');
    expect(await fresh(order.id)).toMatchObject({
      status: 'CONFIRMED',
      totalPaise: order.totalPaise,
    });
  });
  it('a refusal retried with the same words repeats, with other words is news', async () => {
    const order = await placeOrder();
    const decisionKey = randomUUID();
    const first = { decisionKey, reason: 'NO_DELIVERY' };
    expect((await refuse(order.id, 'papa', first)).status).toBe(201);
    const again = await refuse(order.id, 'papa', first);
    expect(again.status).toBe(201);
    expect(again.body.status).toBe('CANCELLED');
    expect((await refuse(order.id, 'papa', { decisionKey, reason: 'OUT_OF_STOCK' })).status).toBe(
      409,
    );
    expect((await confirm(order.id, 'papa', { decisionKey })).status).toBe(409);
  });
  it('a sheet sent back unchanged is a plain confirm, with nothing to explain', async () => {
    const order = await placeOrder(10);
    const unchanged = change([{ productId: 'cement', quantity: 10, pricePaise: 40000 }]);
    const preview = await request(server)
      .post(`/api/v1/admin/orders/${order.id}/preview`)
      .set(as('papa'))
      .send({ decision: 'CONFIRM', ...unchanged })
      .expect(201);
    expect((await confirm(order.id, 'papa', unchanged)).status).toBe(201);
    const row = await fresh(order.id);
    const plain = decisionWords(
      { number: order.number },
      { kind: 'CONFIRM', changed: false, totalPaise: row.totalPaise, date: row.deliveryDate },
      'hi',
    );
    expect(preview.body.body).toBe(plain.body);
    const note = await db.notification.findFirstOrThrow({
      where: { orderId: order.id, dedupeKey: { startsWith: 'decision:' } },
    });
    expect(note.body).toBe(plain.body);
    expect(await db.orderAmendment.count({ where: { orderId: order.id } })).toBe(0);
    expect(
      await db.auditLog.count({
        where: { entityId: order.id, event: 'ORDER_CHANGED_AT_CONFIRM' },
      }),
    ).toBe(0);
  });
  it('an unchanged sheet still carries an owner’s pass over the udhaar limit', async () => {
    const order = await placeOrder(10);
    await db.payment.update({ where: { orderId: order.id }, data: { method: 'CREDIT' } });
    await db.user.update({
      where: { id: 'customer' },
      data: { creditAllowed: true, creditLimitPaise: 100 },
    });
    const same = [{ productId: 'cement', quantity: 10 }];
    expect((await confirm(order.id, 'papa', change(same))).status).toBe(409);
    const passed = await confirm(order.id, 'papa', change(same, { overrideLimit: true }));
    expect(passed.status).toBe(201);
    expect(
      await db.auditLog.count({ where: { entityId: order.id, event: 'CREDIT_LIMIT_OVERRIDE' } }),
    ).toBe(1);
    expect(await db.orderAmendment.count({ where: { orderId: order.id } })).toBe(0);
  });
});

describe('Wapas lo, in the awkward cases', () => {
  it('takes back only the decision the person is looking at', async () => {
    const order = await placeOrder();
    const first = await confirm(order.id);
    expect((await undo(order.id, 'chacha')).status).toBe(201);
    expect((await confirm(order.id, 'chacha')).status).toBe(201);
    const late = await undo(order.id, 'papa', first.body.version);
    expect(late.status).toBe(409);
    expect(late.body.error.code).toBe('ORDER_CHANGED');
    expect(await fresh(order.id)).toMatchObject({ status: 'CONFIRMED', confirmedById: 'chacha' });
  });
  it('needs to say which decision', async () => {
    const order = await placeOrder();
    await confirm(order.id);
    const { status } = await request(server)
      .post(`/api/v1/admin/orders/${order.id}/undo-decision`)
      .set(as('papa'))
      .send({});
    expect(status).toBe(400);
    expect((await fresh(order.id)).status).toBe('CONFIRMED');
  });
  it('stops once cash is on the record, as that record can never change', async () => {
    const order = await placeOrder(10);
    await confirm(order.id, 'papa', change([{ productId: 'cement', quantity: 20 }]));
    await request(server)
      .post(`/api/v1/admin/orders/${order.id}/cod-received`)
      .set(as('papa'))
      .send({ channel: 'CASH' })
      .expect(201);
    const held = await fresh(order.id);
    const late = await undo(order.id);
    expect(late.status).toBe(409);
    expect(late.body.error.code).toBe('ORDER_CHANGED');
    expect(await fresh(order.id)).toMatchObject({
      status: 'CONFIRMED',
      totalPaise: held.totalPaise,
      payment: { status: 'CAPTURED', amountPaise: held.totalPaise },
    });
    expect(await stockAt(MAIN)).toBe(80);
  });
  it('leaves a corrected count corrected, as the goods are still there', async () => {
    const order = await placeOrder(10);
    await db.stockLevel.update({
      where: { productId_locationId: { productId: 'cement', locationId: MAIN } },
      data: { quantity: 2 },
    });
    const { status } = await confirm(
      order.id,
      'papa',
      change([{ productId: 'cement', quantity: 15 }], { stockFixes: ['cement'] }),
    );
    expect(status).toBe(201);
    expect(await stockAt(MAIN)).toBe(0);
    expect((await undo(order.id)).status).toBe(201);
    expect(await stockAt(MAIN)).toBe(5);
    expect(
      await db.auditLog.count({
        where: { entityId: order.id, event: 'STOCK_CORRECTED_AT_CONFIRM' },
      }),
    ).toBe(1);
  });
});

describe('who may do what, at the edges', () => {
  const alsoAt = (userId: string, role: 'CASHIER' | 'MANAGER', locationId: string) =>
    db.staffMembership.create({ data: { userId, role, locationId, grantedById: 'papa' } });
  const paid = (orderId: string) =>
    db.payment.update({ where: { orderId }, data: { status: 'CAPTURED', method: 'ONLINE' } });
  it('a cashier cannot refuse a paid order, as that owes the customer money', async () => {
    const order = await placeOrder(10);
    await paid(order.id);
    const { body: card } = await request(server)
      .get(`/api/v1/admin/inbox/${order.id}`)
      .set(as('cashier'))
      .expect(200);
    expect(card.can.refuse).toBe(false);
    expect((await refuse(order.id, 'cashier')).status).toBe(403);
    expect((await fresh(order.id)).status).toBe('AWAITING_CONFIRMATION');
    expect(await stockAt(MAIN)).toBe(90);
    // A manager holds the refund right, so the card and the route agree for them.
    const { body: theirs } = await request(server)
      .get(`/api/v1/admin/inbox/${order.id}`)
      .set(as('manager'))
      .expect(200);
    expect(theirs.can.refuse).toBe(true);
    expect((await refuse(order.id, 'manager')).status).toBe(201);
  });
  it('a cashier cannot decide udhaar by refusing it or moving it to cash', async () => {
    const order = await placeOrder(10);
    await db.payment.update({ where: { orderId: order.id }, data: { method: 'CREDIT' } });
    const { body: card } = await request(server)
      .get(`/api/v1/admin/inbox/${order.id}`)
      .set(as('cashier'))
      .expect(200);
    expect(card.can).toMatchObject({ confirm: false, refuse: false, change: false });
    expect((await refuse(order.id, 'cashier')).status).toBe(403);
    expect(
      (
        await confirm(
          order.id,
          'cashier',
          change([{ productId: 'cement', quantity: 10 }], { paymentMethod: 'COD' }),
        )
      ).status,
    ).toBe(403);
    expect(await fresh(order.id)).toMatchObject({
      status: 'AWAITING_CONFIRMATION',
      payment: { method: 'CREDIT' },
    });
  });
  it('a rate given for another shop needs the right to give rates there', async () => {
    await alsoAt('manager', 'CASHIER', SECOND);
    const order = await placeOrder(10);
    const { status } = await confirm(
      order.id,
      'manager',
      change([{ productId: 'cement', quantity: 10, pricePaise: 39000 }], { locationId: SECOND }),
    );
    expect(status).toBe(403);
    expect((await fresh(order.id)).locationId).toBe(MAIN);
  });
  it('a rate given for another shop keeps to the lower of the two limits', async () => {
    await alsoAt('manager', 'MANAGER', SECOND);
    await db.location.update({ where: { id: MAIN }, data: { managerRateCapPercent: 20 } });
    await db.location.update({ where: { id: SECOND }, data: { managerRateCapPercent: 5 } });
    const order = await placeOrder(10);
    const moved = await confirm(
      order.id,
      'manager',
      change([{ productId: 'cement', quantity: 10, pricePaise: 36000 }], { locationId: SECOND }),
    );
    expect(moved.status).toBe(403);
    expect(moved.body.error.code).toBe('RATE_CAP');
    expect(moved.body.error.details.capPercent).toBe(5);
    // Without the move, the same rate is inside this shop's own limit.
    const stayed = await confirm(
      order.id,
      'manager',
      change([{ productId: 'cement', quantity: 10, pricePaise: 36000 }]),
    );
    expect(stayed.status).toBe(201);
  });
});
