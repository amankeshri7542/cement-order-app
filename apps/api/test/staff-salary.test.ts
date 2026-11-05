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
import { Attendance } from '../src/staff/attendance';
import { addPerson, clearShopWork, tokenFor } from './staff-helper';

if (existsSync('.env.test')) loadEnvFile('.env.test');
process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
process.env.OTP_PROVIDER = 'mock';
process.env.OTP_HASH_SECRET = 'staff-salary-test-only-secret-not-for-production';
process.env.CORS_ORIGINS = 'http://localhost:3000';
if (!process.env.DATABASE_URL || !new URL(process.env.DATABASE_URL).pathname.endsWith('_test'))
  throw new Error('These tests require a dedicated TEST_DATABASE_URL ending in _test.');

const MAIN = 'loc_main';
let app: INestApplication;
let server: Server;
let db: Db;
const as = (id: string) => ({ Authorization: `Bearer ${tokenFor(id)}` });
const get = (who: string, path: string) =>
  request(server).get(`/api/v1/admin/salary/${path}`).set(as(who));
const post = (who: string, path: string, body: object = {}) =>
  request(server).post(`/api/v1/admin/salary/${path}`).set(as(who)).send(body);
const put = (who: string, path: string, body: object) =>
  request(server).put(`/api/v1/admin/salary/${path}`).set(as(who)).send(body);
// A month that is already over, whatever day the tests run.
const MONTH = '2026-09';
const NEXT = '2026-10';
const terms = (
  who = 'papa',
  userId = 'keeper',
  amountPaise = 1_500_000,
  effectiveFrom = '2026-01-01',
) => put(who, `terms/${userId}`, { effectiveFrom, amountPaise });
const adjust = (extra: object = {}, who = 'papa', month = MONTH) =>
  post(who, `runs/${month}/adjustments`, {
    userId: 'keeper',
    kind: 'DEDUCTION',
    amountPaise: 100_000,
    reason: 'Maal ka nuksan, baat ho gayi',
    idempotencyKey: randomUUID(),
    ...extra,
  });
const lock = (who = 'papa', month = MONTH) => post(who, `runs/${month}/lock`, { confirm: true });
const pay = (extra: object = {}, who = 'papa', month = MONTH) =>
  post(who, `runs/${month}/pay`, {
    userId: 'keeper',
    amountPaise: 1_500_000,
    channel: 'UPI',
    paidFrom: 'OWNER',
    idempotencyKey: randomUUID(),
    ...extra,
  });
const advance = (extra: object = {}, who = 'papa') =>
  post(who, 'advances', {
    userId: 'keeper',
    amountPaise: 500_000,
    recoveryPaise: 200_000,
    channel: 'CASH',
    paidFrom: 'OWNER',
    idempotencyKey: randomUUID(),
    ...extra,
  });
const lineOf = async (who = 'papa', month = MONTH, userId = 'keeper') =>
  (await get(who, `runs/${month}`).expect(200)).body.lines.find(
    (row: { userId: string }) => row.userId === userId,
  );

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
    'TRUNCATE TABLE "FinancialMovement", "User", "AuditLog", "AuthRateLimit", "Notification" RESTART IDENTITY CASCADE',
  );
  for (const [id, role, shops] of [
    ['papa', 'OWNER', undefined],
    ['chacha', 'OWNER', undefined],
    ['manager', 'MANAGER', [MAIN]],
    ['keeper', 'STOCK_KEEPER', [MAIN]],
    ['cashier', 'CASHIER', [MAIN]],
    ['driver', 'DRIVER', [MAIN]],
    ['accountant', 'ACCOUNTANT', undefined],
    ['tech', 'TECH_OPERATOR', undefined],
  ] as const) {
    const n = 7000 + [...id].reduce((sum, char) => sum + char.charCodeAt(0), 0);
    await addPerson(db, {
      id,
      role,
      phone: `+91900000${n}`,
      ...(shops ? { shops: [...shops] } : {}),
    });
  }
  await db.location.update({ where: { id: MAIN }, data: { attendanceOn: true } });
});
afterAll(async () => {
  await app?.close();
});

describe('who sees what', () => {
  it('only owners move pay, the accountant reads, and a manager sees nothing of anyone', async () => {
    await terms().expect(200);
    for (const who of ['manager', 'cashier', 'keeper', 'driver', 'tech']) {
      await get(who, `runs/${MONTH}`).expect(403);
      await get(who, 'terms').expect(403);
      await get(who, 'people/keeper').expect(403);
      await terms(who).expect(403);
      await adjust({}, who).expect(403);
      await lock(who).expect(403);
      await pay({}, who).expect(403);
      await advance({}, who).expect(403);
    }
    await get('accountant', `runs/${MONTH}`).expect(200);
    await terms('accountant').expect(403);
    await lock('accountant').expect(403);
    await adjust({}, 'accountant').expect(403);
    await pay({}, 'accountant').expect(403);
    await advance({}, 'accountant').expect(403);
  });
  it('someone sees their own pay and nobody else’s', async () => {
    await terms().expect(200);
    await terms('papa', 'driver', 1_000_000).expect(200);
    await lock().expect(201);
    const mine = await request(server).get('/api/v1/staff/me/pay').set(as('keeper')).expect(200);
    expect(mine.body).toMatchObject({ monthlyPaise: 1_500_000, wagesDuePaise: 1_500_000 });
    expect(mine.body.slips).toEqual([{ month: MONTH, netPaise: 1_500_000 }]);
    expect(JSON.stringify(mine.body)).not.toContain('1000000');
    await request(server).get(`/api/v1/staff/me/slips/${MONTH}`).set(as('keeper')).expect(200);
    await request(server).get('/api/v1/staff/me/slips/nonsense').set(as('keeper')).expect(400);
    await request(server).get('/api/v1/staff/me/slips/2020-01').set(as('keeper')).expect(404);
  });
  it('the activity log never holds an amount', async () => {
    await terms().expect(200);
    await adjust().expect(201);
    await advance().expect(201);
    await lock().expect(201);
    await pay({ amountPaise: 100 }).expect(201);
    const rows = await db.auditLog.findMany({
      where: { event: { startsWith: 'PAY' } },
    });
    expect(rows.length).toBeGreaterThan(2);
    expect(JSON.stringify(rows)).not.toMatch(/1500000|100000|500000/);
  });
});

describe('the month, before it is locked', () => {
  it('is the fixed amount, with attendance beside it moving nothing', async () => {
    await terms().expect(200);
    await db.attendanceDay.create({
      data: {
        userId: 'keeper',
        day: `${MONTH}-10`,
        locationIds: [MAIN],
        firstInAt: new Date(`${MONTH}-10T09:40:00+05:30`),
        lateMinutes: 40,
        status: 'PRESENT',
      },
    });
    const line = await lineOf();
    expect(line.line.netPaise).toBe(1_500_000);
    expect(line.facts).toMatchObject({ daysPresent: 1, daysLate: 1 });
  });
  it('someone with no pay set is listed, not guessed at', async () => {
    const { body } = await get('papa', `runs/${MONTH}`).expect(200);
    const named = body.noTerms.map((row: { userId: string }) => row.userId);
    expect(named).toContain('keeper');
    expect(named).toContain('accountant');
    expect(body.lines).toEqual([]);
  });
  it('owners and the technical login draw no salary, so they are not chased for one', async () => {
    const { body } = await get('papa', `runs/${MONTH}`).expect(200);
    const named = body.noTerms.map((row: { userId: string }) => row.userId);
    expect(named).not.toContain('papa');
    expect(named).not.toContain('chacha');
    expect(named).not.toContain('tech');
  });
  describe('nobody changes their own pay', () => {
    it('not the rate, a line, the recovery or a payment', async () => {
      const own = async (call: { expect: (code: number) => Promise<request.Response> }) =>
        expect((await call.expect(403)).body.error.code).toBe('OWN_RECORD');
      await own(terms('papa', 'papa'));
      await terms('chacha', 'papa').expect(200);
      await own(adjust({ userId: 'papa' }));
      await own(
        post('papa', `runs/${MONTH}/recovery`, {
          userId: 'papa',
          recoveryPaise: 0,
          reason: 'Aaram se',
        }),
      );
      await own(pay({ userId: 'papa' }));
      const { body } = await adjust({ userId: 'papa' }, 'chacha').expect(201);
      await own(post('papa', `adjustments/${body.id}/reverse`, { reason: 'Galti' }));
    });
  });
  describe('a rate that has started keeps its figure', () => {
    const today = istToday();
    const later = (days: number) => istToday(new Date(Date.now() + days * 86400000));
    it('the same date with the same figure is harmless', async () => {
      await terms('papa', 'keeper', 1_500_000, today).expect(200);
      await terms('papa', 'keeper', 1_500_000, today).expect(200);
    });
    it('a different figure for a date that has come is refused, and the first stays', async () => {
      await terms('papa', 'keeper', 1_500_000, today).expect(200);
      const { body } = await terms('papa', 'keeper', 1_400_000, today).expect(409);
      expect(body.error.code).toBe('PAY_TERMS_DATED');
      const rows = await db.staffPayTerms.findMany({ where: { userId: 'keeper' } });
      expect(rows.map((row) => row.amountPaise)).toEqual([1_500_000]);
      await terms('papa', 'keeper', 1_400_000, later(1)).expect(200);
      expect(await db.staffPayTerms.count({ where: { userId: 'keeper' } })).toBe(2);
    });
    it('a date still ahead can be fixed before it comes', async () => {
      await terms('papa', 'keeper', 1_500_000, later(5)).expect(200);
      await terms('papa', 'keeper', 1_600_000, later(5)).expect(200);
      const rows = await db.staffPayTerms.findMany({ where: { userId: 'keeper' } });
      expect(rows.map((row) => row.amountPaise)).toEqual([1_600_000]);
    });
    it('nothing can be dated inside a locked month', async () => {
      await terms().expect(200);
      await lock().expect(201);
      const { body } = await terms('papa', 'keeper', 1_700_000, `${MONTH}-15`).expect(409);
      expect(body.error.code).toBe('MONTH_LOCKED');
      await terms('papa', 'keeper', 1_700_000, `${NEXT}-01`).expect(200);
    });
  });
  it('a new rate from a date leaves earlier months alone', async () => {
    await terms().expect(200);
    await terms('papa', 'keeper', 2_000_000, '2026-10-01').expect(200);
    expect((await lineOf('papa', MONTH)).monthlyPaise).toBe(1_500_000);
    expect((await lineOf('papa', NEXT)).monthlyPaise).toBe(2_000_000);
  });
  it('a deduction needs a reason, and more than half the month is refused', async () => {
    await terms().expect(200);
    await adjust({ reason: '' }).expect(400);
    await adjust({ amountPaise: 700_000 }).expect(201);
    const over = await adjust({ amountPaise: 100_000 }).expect(400);
    expect(over.body.error.code).toBe('DEDUCTIONS_OVER_LIMIT');
    expect((await lineOf()).line.deductionsPaise).toBe(700_000);
  });
  it('an addition raises what the limit is worked on', async () => {
    await terms().expect(200);
    await adjust({ kind: 'ADDITION', amountPaise: 500_000 }).expect(201);
    await adjust({ amountPaise: 1_000_000 }).expect(201);
    expect((await lineOf()).line.netPaise).toBe(1_000_000);
  });
  it('the same tap twice adds once, and a key cannot change its figure', async () => {
    await terms().expect(200);
    const idempotencyKey = randomUUID();
    await adjust({ idempotencyKey }).expect(201);
    await adjust({ idempotencyKey }).expect(201);
    expect((await lineOf()).line.deductionsPaise).toBe(100_000);
    await adjust({ idempotencyKey, amountPaise: 1 }).expect(409);
  });
  it('a wrong line is taken back with a reason, and both stay', async () => {
    await terms().expect(200);
    const { body } = await adjust().expect(201);
    await post('papa', `adjustments/${body.id}/reverse`, { reason: 'Galti se' }).expect(201);
    const line = await lineOf();
    expect(line.line.deductionsPaise).toBe(0);
    expect(line.adjustments).toHaveLength(2);
    expect(
      (await post('papa', `adjustments/${body.id}/reverse`, { reason: 'Phir' }).expect(409)).body
        .error.code,
    ).toBe('REVERSED_ALREADY');
  });
  it('nonsense is refused', async () => {
    await terms().expect(200);
    await adjust({ amountPaise: 0 }).expect(400);
    await adjust({ amountPaise: -5 }).expect(400);
    await adjust({ kind: 'FINE' }).expect(400);
    await adjust({}, 'papa', 'nonsense').expect(400);
    await terms('papa', 'keeper', 0).expect(400);
    await terms('papa', 'nobody').expect(404);
    await get('papa', 'runs/2026-13').expect(400);
  });
});

describe('locking a month', () => {
  it('freezes every slip, in one go, and it is never reopened', async () => {
    await terms().expect(200);
    await terms('papa', 'driver', 1_000_000).expect(200);
    await adjust().expect(201);
    const { body } = await lock().expect(201);
    expect(body).toMatchObject({ status: 'LOCKED', people: 2 });
    const line = await lineOf();
    expect(line).toMatchObject({ locked: true, netPaise: 1_400_000, wagesDuePaise: 1_400_000 });
    expect(line.slip).toMatchObject({ monthlyPaise: 1_500_000, deductionsPaise: 100_000 });
    expect((await lock().expect(409)).body.error.code).toBe('MONTH_LOCKED');
    expect(await db.staffLedgerEntry.count({ where: { kind: 'EARNED' } })).toBe(2);
  });
  it('a change after locking is refused: it goes into next month', async () => {
    await terms().expect(200);
    const { body } = await adjust().expect(201);
    await lock().expect(201);
    expect((await adjust().expect(409)).body.error.code).toBe('MONTH_LOCKED');
    await post('papa', `adjustments/${body.id}/reverse`, { reason: 'Galti' }).expect(409);
    await adjust({ kind: 'ADDITION', reason: 'September ka baaki' }, 'papa', NEXT).expect(201);
    expect((await lineOf('papa', MONTH)).netPaise).toBe(1_400_000);
  });
  it('a changed rate after locking changes nothing on the slip', async () => {
    await terms().expect(200);
    await lock().expect(201);
    await terms('papa', 'keeper', 2_000_000, `${NEXT}-01`).expect(200);
    expect((await lineOf()).slip.monthlyPaise).toBe(1_500_000);
  });
  it('a month still going on cannot be locked', async () => {
    const res = await lock('papa', istToday().slice(0, 7)).expect(409);
    expect(res.body.error.code).toBe('MONTH_NOT_OVER');
  });
  it('open hazri cards from the month must be settled first', async () => {
    await terms().expect(200);
    const event = await db.attendanceEvent.create({
      data: {
        userId: 'keeper',
        stream: 'att:keeper',
        seq: 1,
        prevHash: '',
        hash: 'x',
        kind: 'IN',
        serverAt: new Date(`${MONTH}-10T09:00:00+05:30`),
        actorId: 'keeper',
      },
    });
    const review = await db.attendanceReview.create({
      data: {
        eventId: event.id,
        userId: 'keeper',
        kind: 'FAR',
        createdAt: new Date(`${MONTH}-10T09:00:00+05:30`),
      },
    });
    const res = await lock().expect(409);
    expect(res.body.error).toMatchObject({ code: 'REVIEWS_OPEN', details: { open: 1 } });
    await db.attendanceReview.update({ where: { id: review.id }, data: { status: 'ACCEPTED' } });
    await lock().expect(201);
  });
  it('asks to be meant', async () => {
    await post('papa', `runs/${MONTH}/lock`, {}).expect(400);
    await post('papa', `runs/${MONTH}/lock`, { confirm: false }).expect(400);
  });
  it('two owners locking at once: one wins, and it happens once', async () => {
    await terms().expect(200);
    const results = await Promise.all([lock('papa'), lock('chacha')]);
    expect(results.map((res) => res.status).sort()).toEqual([201, 409]);
    expect(await db.staffLedgerEntry.count({ where: { kind: 'EARNED' } })).toBe(1);
  });
});

describe('paying', () => {
  const ready = async () => {
    await terms().expect(200);
    await lock().expect(201);
  };
  it('cannot happen before the month is locked', async () => {
    await terms().expect(200);
    expect((await pay().expect(409)).body.error.code).toBe('MONTH_NOT_LOCKED');
  });
  it('from the owner’s own account leaves the drawer alone', async () => {
    await ready();
    await pay().expect(201);
    expect(await db.financialMovement.count()).toBe(0);
    expect((await lineOf()).wagesDuePaise).toBe(0);
  });
  it('from the drawer shows there without a name', async () => {
    await ready();
    await pay({ channel: 'CASH', paidFrom: 'GALLA', locationId: MAIN }).expect(201);
    const [row] = await db.financialMovement.findMany();
    expect(row).toMatchObject({ kind: 'STAFF_PAY', amountPaise: 1_500_000, counterParty: '' });
    const sheet = await request(server)
      .get(`/api/v1/admin/galla?locationId=${MAIN}`)
      .set(as('cashier'))
      .expect(200);
    expect(sheet.body).toMatchObject({ staffPaid: 1_500_000, expectedPaise: -1_500_000 });
    expect(JSON.stringify(sheet.body)).not.toContain('keeper');
  });
  it('the drawer pays cash, from a shop that is named', async () => {
    await ready();
    await pay({ channel: 'UPI', paidFrom: 'GALLA', locationId: MAIN }).expect(400);
    expect((await pay({ channel: 'CASH', paidFrom: 'GALLA' }).expect(400)).body.error.code).toBe(
      'SHOP_NEEDED',
    );
    await pay({ channel: 'CASH', paidFrom: 'GALLA', locationId: 'nowhere' }).expect(400);
  });
  it('more than is owed is refused, even in pieces', async () => {
    await ready();
    await pay({ amountPaise: 1_000_000 }).expect(201);
    expect((await pay({ amountPaise: 600_000 }).expect(409)).body.error.code).toBe(
      'PAYING_TOO_MUCH',
    );
    await pay({ amountPaise: 500_000 }).expect(201);
  });
  it('the same tap twice pays once, and a key cannot change its figure', async () => {
    await ready();
    const idempotencyKey = randomUUID();
    await pay({ idempotencyKey, amountPaise: 100_000 }).expect(201);
    await pay({ idempotencyKey, amountPaise: 100_000 }).expect(201);
    expect((await lineOf()).wagesDuePaise).toBe(1_400_000);
    await pay({ idempotencyKey, amountPaise: 200_000 }).expect(409);
  });
  it('a wrong payment is taken back with a reason, both show, and the drawer gets it back', async () => {
    await ready();
    const { body } = await pay({ channel: 'CASH', paidFrom: 'GALLA', locationId: MAIN }).expect(
      201,
    );
    await post('papa', `ledger/${body.id}/reverse`, {
      reason: 'Do baar likha gaya',
      idempotencyKey: randomUUID(),
    }).expect(201);
    expect((await lineOf()).wagesDuePaise).toBe(1_500_000);
    const sheet = await request(server)
      .get(`/api/v1/admin/galla?locationId=${MAIN}`)
      .set(as('cashier'))
      .expect(200);
    expect(sheet.body.staffPaid).toBe(0);
    const again = await post('papa', `ledger/${body.id}/reverse`, {
      reason: 'Phir',
      idempotencyKey: randomUUID(),
    }).expect(409);
    expect(again.body.error.code).toBe('REVERSED_ALREADY');
    const ledger = await get('papa', 'people/keeper').expect(200);
    expect(ledger.body.items.map((row: { kind: string }) => row.kind)).toEqual(
      expect.arrayContaining(['EARNED', 'PAID', 'REVERSAL']),
    );
    await post('manager', `ledger/${body.id}/reverse`, {
      reason: 'x y',
      idempotencyKey: randomUUID(),
    }).expect(403);
  });
  it('an earning itself cannot be taken back: a locked month stays', async () => {
    await ready();
    const earned = await db.staffLedgerEntry.findFirstOrThrow({ where: { kind: 'EARNED' } });
    await post('papa', `ledger/${earned.id}/reverse`, {
      reason: 'Galti hai',
      idempotencyKey: randomUUID(),
    }).expect(400);
  });
  it('someone says "mil gaya", or "nahi mila", which reaches the owners with no amount shown', async () => {
    await ready();
    const { body } = await pay().expect(201);
    const ack = (who: string, answer: string) =>
      request(server)
        .post(`/api/v1/staff/me/payments/${body.id}/ack`)
        .set(as(who))
        .send({ answer });
    await ack('driver', 'GOT').expect(403);
    await ack('keeper', 'MAYBE').expect(400);
    await ack('keeper', 'GOT').expect(201);
    expect(
      await db.notification.count({ where: { dedupeKey: { startsWith: 'pay-not-got' } } }),
    ).toBe(0);
    await ack('keeper', 'NOT_GOT').expect(201);
    const told = await db.notification.findMany({
      where: { dedupeKey: { startsWith: 'pay-not-got' } },
    });
    expect(new Set(told.map((row) => row.userId))).toEqual(new Set(['papa', 'chacha']));
    expect(JSON.stringify(told)).not.toMatch(/15,?000|keeper/);
    const mine = await request(server).get('/api/v1/staff/me/pay').set(as('keeper')).expect(200);
    expect(mine.body.payments[0].ack).toBe('NOT_GOT');
  });
});

describe('advances', () => {
  it('an owner gives one, and it is recovered as planned at the lock', async () => {
    await terms().expect(200);
    await advance().expect(201);
    expect((await lineOf()).line.recoveryPaise).toBe(200_000);
    await lock().expect(201);
    const ledger = await get('papa', 'people/keeper').expect(200);
    expect(ledger.body).toMatchObject({
      advancePaise: 300_000,
      wagesDuePaise: 1_300_000,
      chainOk: true,
    });
    expect((await lineOf('papa', NEXT)).line.recoveryPaise).toBe(200_000);
  });
  it('the limit holds: what cannot be recovered stays for next month', async () => {
    await terms().expect(200);
    await adjust({ amountPaise: 700_000 }).expect(201);
    await advance({ amountPaise: 900_000, recoveryPaise: 500_000 }).expect(201);
    await lock().expect(201);
    expect((await lineOf()).slip).toMatchObject({ recoveryPaise: 50_000, netPaise: 750_000 });
    expect((await get('papa', 'people/keeper').expect(200)).body.advancePaise).toBe(850_000);
  });
  it('an owner can change this month’s recovery, even to nothing', async () => {
    await terms().expect(200);
    await advance().expect(201);
    await post('papa', `runs/${MONTH}/recovery`, {
      userId: 'keeper',
      recoveryPaise: 0,
      reason: 'Is mahine mat kaato',
    }).expect(201);
    expect((await lineOf()).line.recoveryPaise).toBe(0);
  });
  it('from the drawer it shows there, and comes back if taken back', async () => {
    const { body } = await advance({ paidFrom: 'GALLA', locationId: MAIN }).expect(201);
    const sheet = () =>
      request(server).get(`/api/v1/admin/galla?locationId=${MAIN}`).set(as('cashier')).expect(200);
    expect((await sheet()).body.staffPaid).toBe(500_000);
    await post('papa', `ledger/${body.id}/reverse`, {
      reason: 'Galat aadmi',
      idempotencyKey: randomUUID(),
    }).expect(201);
    expect((await sheet()).body.staffPaid).toBe(0);
    expect((await get('papa', 'people/keeper').expect(200)).body.advancePaise).toBe(0);
  });
  it('nobody gives themselves one, even an owner', async () => {
    expect((await advance({ userId: 'papa' }).expect(403)).body.error.code).toBe('OWN_REQUEST');
    await advance({ userId: 'papa' }, 'chacha').expect(201);
  });
  it('the same tap twice gives once', async () => {
    const idempotencyKey = randomUUID();
    await advance({ idempotencyKey }).expect(201);
    await advance({ idempotencyKey }).expect(201);
    expect((await get('papa', 'people/keeper').expect(200)).body.advancePaise).toBe(500_000);
    await advance({ idempotencyKey, amountPaise: 1 }).expect(409);
  });
  const ask = (who: string, extra: object = {}) =>
    post(who, 'advances/ask', {
      userId: 'keeper',
      amountPaise: 300_000,
      recoveryPaise: 100_000,
      channel: 'CASH',
      paidFrom: 'OWNER',
      idempotencyKey: randomUUID(),
      ...extra,
    });
  it('someone who handles no cash cannot ask for money, though they can ask for other things', async () => {
    const { body } = await ask('keeper', { userId: 'driver' }).expect(403);
    expect(body.error.code).toBeTruthy();
    expect(await db.approvalRequest.count({ where: { kind: 'ADVANCE' } })).toBe(0);
  });
  it('a manager or cashier can ask, and it goes through only on an owner’s yes', async () => {
    const { body } = await ask('manager').expect(201);
    expect((await get('papa', 'people/keeper').expect(200)).body.advancePaise).toBe(0);
    const cards = await request(server).get('/api/v1/admin/approvals').set(as('papa')).expect(200);
    expect(cards.body.items[0]).toMatchObject({
      kind: 'ADVANCE',
      detail: { name: 'keeper', amountPaise: 300_000, channel: 'CASH', paidFrom: 'OWNER' },
    });
    await request(server)
      .post(`/api/v1/admin/approvals/${body.id}/decide`)
      .set(as('manager'))
      .send({ decision: 'APPROVE' })
      .expect(403);
    await request(server)
      .post(`/api/v1/admin/approvals/${body.id}/decide`)
      .set(as('papa'))
      .send({ decision: 'APPROVE' })
      .expect(201);
    expect((await get('papa', 'people/keeper').expect(200)).body.advancePaise).toBe(300_000);
  });
  it('whoever may ask gets names at their own shops, and nothing about pay', async () => {
    await db.location.upsert({
      where: { id: 'loc_salary_b' },
      update: { active: true },
      create: { id: 'loc_salary_b', firmId: 'firm_main', slug: 'salary-b', name: 'Doosri' },
    });
    await addPerson(db, {
      id: 'elsewhere',
      phone: '+919000006099',
      role: 'STOCK_KEEPER',
      shops: ['loc_salary_b'],
    });
    const { body } = await get('cashier', 'advances/people').expect(200);
    const ids = body.items.map((row: { id: string }) => row.id);
    expect(ids).toContain('keeper');
    expect(ids).not.toContain('cashier');
    expect(ids).not.toContain('elsewhere');
    expect(Object.keys(body.items[0]).sort()).toEqual(['id', 'name']);
    expect(
      (await get('papa', 'advances/people').expect(200)).body.items.map(
        (row: { id: string }) => row.id,
      ),
    ).toContain('elsewhere');
    for (const who of ['keeper', 'driver', 'accountant', 'tech'])
      await get(who, 'advances/people').expect(403);
    await request(server).get('/api/v1/admin/salary/advances/people').expect(401);
    await db.location.update({ where: { id: 'loc_salary_b' }, data: { active: false } });
  });
  it('a no gives nothing; nobody asks for themselves; a keeper cannot ask for others’ pay to be seen', async () => {
    const { body } = await ask('cashier').expect(201);
    await request(server)
      .post(`/api/v1/admin/approvals/${body.id}/decide`)
      .set(as('papa'))
      .send({ decision: 'REJECT' })
      .expect(201);
    expect((await get('papa', 'people/keeper').expect(200)).body.advancePaise).toBe(0);
    expect((await ask('keeper').expect(403)).body.error.code).toBe('OWN_REQUEST');
    await ask('driver').expect(403);
    const mine = await request(server)
      .get('/api/v1/admin/approvals')
      .set(as('manager'))
      .expect(200);
    expect(mine.body.items).toEqual([]);
  });
});

describe('the record cannot be changed', () => {
  it('the database refuses changes to entries, slips and lines', async () => {
    await terms().expect(200);
    await adjust().expect(201);
    await lock().expect(201);
    const entry = await db.staffLedgerEntry.findFirstOrThrow();
    await expect(
      db.staffLedgerEntry.update({ where: { id: entry.id }, data: { amountPaise: 1 } }),
    ).rejects.toThrow();
    await expect(db.staffLedgerEntry.delete({ where: { id: entry.id } })).rejects.toThrow();
    const line = await db.payLine.findFirstOrThrow();
    await expect(
      db.payLine.update({ where: { id: line.id }, data: { netPaise: 1 } }),
    ).rejects.toThrow();
    const row = await db.payAdjustment.findFirstOrThrow();
    await expect(
      db.payAdjustment.update({ where: { id: row.id }, data: { amountPaise: 1 } }),
    ).rejects.toThrow();
  });
  it('the database refuses someone approving their own advance', async () => {
    await advance().expect(201);
    const entry = await db.staffLedgerEntry.findFirstOrThrow();
    await db.$executeRawUnsafe(
      'ALTER TABLE "StaffLedgerEntry" DISABLE TRIGGER staff_ledger_append_only',
    );
    await expect(
      db.staffLedgerEntry.update({ where: { id: entry.id }, data: { approvedById: 'keeper' } }),
    ).rejects.toThrow();
    await db.$executeRawUnsafe(
      'ALTER TABLE "StaffLedgerEntry" ENABLE TRIGGER staff_ledger_append_only',
    );
  });
  it('a change behind the app breaks the chain, and the night check sees it', async () => {
    await advance().expect(201);
    await advance().expect(201);
    expect((await app.get(Attendance).checkChains()).broken).toBe(0);
    await db.$executeRawUnsafe(
      'ALTER TABLE "StaffLedgerEntry" DISABLE TRIGGER staff_ledger_append_only',
    );
    await db.staffLedgerEntry.updateMany({ where: { seq: 1 }, data: { amountPaise: 1 } });
    await db.$executeRawUnsafe(
      'ALTER TABLE "StaffLedgerEntry" ENABLE TRIGGER staff_ledger_append_only',
    );
    expect((await get('papa', 'people/keeper').expect(200)).body.chainOk).toBe(false);
    expect((await app.get(Attendance).checkChains()).broken).toBe(1);
  });
  it('the night code covers pay too', async () => {
    await advance().expect(201);
    const at = new Date(`${istToday()}T23:30:00+05:30`);
    await app.get(Attendance).nightly(at);
    const first = await db.proofAnchor.findUniqueOrThrow({ where: { day: istToday() } });
    expect(first.root).toHaveLength(64);
  });
});

describe('the spreadsheet', () => {
  it('is only for a locked month, and a name cannot become a formula', async () => {
    await terms().expect(200);
    await db.user.update({ where: { id: 'keeper' }, data: { name: '=HYPERLINK("x")' } });
    await get('accountant', `runs/${MONTH}/export.csv`).expect(409);
    await lock().expect(201);
    const csv = await get('accountant', `runs/${MONTH}/export.csv`).expect(200);
    expect(csv.text).toContain(`"'=HYPERLINK(""x"")"`);
    expect(csv.text).toContain('15000.00');
    await get('manager', `runs/${MONTH}/export.csv`).expect(403);
  });
});
