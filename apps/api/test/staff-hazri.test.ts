import 'reflect-metadata';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import type { Server } from 'node:http';
import { loadEnvFile } from 'node:process';
import type { INestApplication } from '@nestjs/common';
import { istToday, punchMessage, qrCounter, staffNoticeVersion } from '@shiv/shared';
import request from 'supertest';
import { Db } from '../src/db';
import { Attendance } from '../src/staff/attendance';
import { brokenAt } from '../src/staff/chain';
import { qrText } from '../src/staff/secret';
import { addPerson, clearShopWork, tokenFor } from './staff-helper';
import { linkPhone, makePhone, signedPunch, type Phone } from './staff-helper-app';

if (existsSync('.env.test')) loadEnvFile('.env.test');
process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
process.env.OTP_PROVIDER = 'mock';
process.env.OTP_HASH_SECRET = 'staff-hazri-test-only-secret-not-for-production';
process.env.CORS_ORIGINS = 'http://localhost:3000';
if (!process.env.DATABASE_URL || !new URL(process.env.DATABASE_URL).pathname.endsWith('_test'))
  throw new Error('These tests require a dedicated TEST_DATABASE_URL ending in _test.');

const MAIN = 'loc_main';
const SECOND = 'loc_hazri_b';
const SHOP = { lat: 25.6, lng: 85.1 };
const FAR = { lat: 25.7, lng: 85.2 };
let app: INestApplication;
let server: Server;
let db: Db;
let attendance: Attendance;

const desk = (id: string) => ({ Authorization: `Bearer ${tokenFor(id)}` });
const adminGet = (who: string, path: string) =>
  request(server).get(`/api/v1/admin/${path}`).set(desk(who));
const adminPost = (who: string, path: string, body: object = {}) =>
  request(server).post(`/api/v1/admin/${path}`).set(desk(who)).send(body);
const phoneNumber: Record<string, string> = {
  papa: '+919000005001',
  chacha: '+919000005002',
  manager: '+919000005003',
  keeper: '+919000005004',
  cashier: '+919000005005',
  driver: '+919000005006',
  accountant: '+919000005007',
  managerb: '+919000005008',
  keeperb: '+919000005009',
};
type Linked = { id: string; phone: Phone; token: string; refresh: string };
const app_ = (token: string) => ({ Authorization: `Bearer ${token}` });
/** Asking for a second code at once is refused by the resend limit, as it should be. */
const relink = async (id: string, phone: Phone, extra: object = {}) => {
  await db.otpChallenge.deleteMany({ where: { phone: phoneNumber[id]! } });
  await db.authRateLimit.deleteMany({});
  return linkPhone(server, phoneNumber[id]!, phone, extra);
};

/** A person with a phone an owner or manager has agreed to. */
async function linked(id: string): Promise<Linked> {
  const phone = makePhone();
  const { body } = await linkPhone(server, phoneNumber[id]!, phone).expect(201);
  const request_ = await db.deviceLinkRequest.findFirstOrThrow({
    where: { userId: id, status: 'PENDING' },
  });
  await adminPost(id === 'papa' ? 'chacha' : 'papa', `device-requests/${request_.id}/decide`, {
    decision: 'APPROVE',
  }).expect(201);
  await request(server)
    .post('/api/v1/staff/me/notice')
    .set(app_(body.accessToken))
    .send({ version: staffNoticeVersion })
    .expect(201);
  return { id, phone, token: body.accessToken, refresh: body.refreshToken };
}
const screenFor = async (locationId = MAIN) => {
  const made = await adminPost('papa', 'screens', { locationId }).expect(201);
  const paired = await request(server)
    .post('/api/v1/screen/pair')
    .send({ code: made.body.pairingCode })
    .expect(201);
  const screen = await db.shopScreen.findUniqueOrThrow({ where: { id: made.body.id } });
  return { screen, token: paired.body.token as string };
};
const liveQr = (screen: { id: string; code: string; epoch: number }, secondsAgo = 0) =>
  qrText(screen, qrCounter(Date.now() - secondsAgo * 1000));
const punch = (who: Linked, body: object) =>
  request(server).post('/api/v1/attendance/punch').set(app_(who.token)).send(body);

beforeAll(async () => {
  const { createApp } = await import('../src/app');
  app = await createApp();
  await app.listen(0, '127.0.0.1');
  server = app.getHttpServer();
  db = app.get(Db);
  attendance = app.get(Attendance);
}, 30000);
beforeEach(async () => {
  await clearShopWork(db);
  await db.$executeRawUnsafe(
    'TRUNCATE TABLE "User", "AuditLog", "AuthRateLimit", "OtpChallenge", "Notification", "OutboundMessage" RESTART IDENTITY CASCADE',
  );
  await db.location.upsert({
    where: { id: SECOND },
    update: { active: true, attendanceOn: true, ...SHOP, radiusM: 100, graceMinutes: 10 },
    create: {
      id: SECOND,
      firmId: 'firm_main',
      slug: 'hazri-b',
      name: 'Second shop',
      attendanceOn: true,
      ...FAR,
    },
  });
  await db.location.update({ where: { id: SECOND }, data: FAR });
  await db.location.update({
    where: { id: MAIN },
    data: { attendanceOn: true, ...SHOP, radiusM: 100, graceMinutes: 10 },
  });
  for (const [id, role, shops] of [
    ['papa', 'OWNER', undefined],
    ['chacha', 'OWNER', undefined],
    ['manager', 'MANAGER', [MAIN]],
    ['managerb', 'MANAGER', [SECOND]],
    ['keeper', 'STOCK_KEEPER', [MAIN]],
    ['keeperb', 'STOCK_KEEPER', [SECOND]],
    ['cashier', 'CASHIER', [MAIN]],
    ['driver', 'DRIVER', [MAIN]],
    ['accountant', 'ACCOUNTANT', undefined],
  ] as const)
    await addPerson(db, {
      id,
      role,
      phone: phoneNumber[id]!,
      ...(shops ? { shops: [...shops] } : {}),
    });
  await addPerson(db, { id: 'customer', phone: '+919000005100' });
});
afterAll(async () => {
  await app?.close();
});

describe('linking a phone', () => {
  it('a number not on the staff never gets in, and no account is made', async () => {
    const phone = makePhone();
    const stranger = '+919000005999';
    const res = await linkPhone(server, stranger, phone).expect(403);
    expect(res.body.error.code).toBe('NOT_STAFF');
    expect(await db.user.findUnique({ where: { phone: stranger } })).toBeNull();
    const customer = await linkPhone(server, '+919000005100', phone).expect(403);
    expect(customer.body.error.code).toBe('NOT_STAFF');
  });
  it('a wrong code gets nowhere', async () => {
    const phone = makePhone();
    await request(server)
      .post('/api/v1/auth/otp/request')
      .send({ phone: phoneNumber.keeper })
      .expect(201);
    await request(server)
      .post('/api/v1/staff-auth/verify')
      .send({
        phone: phoneNumber.keeper,
        code: '000000',
        publicKey: phone.publicKey,
        signature: phone.sign(`link-verify|${phoneNumber.keeper}|000000`),
      })
      .expect(401);
  });
  it('naming someone’s public key gets nowhere without the phone that holds it', async () => {
    const first = await linked('keeper');
    await db.otpChallenge.deleteMany({ where: { phone: phoneNumber.keeper! } });
    await db.authRateLimit.deleteMany({});
    const thief = makePhone();
    const res = await linkPhone(server, phoneNumber.keeper!, {
      publicKey: first.phone.publicKey,
      sign: thief.sign,
    });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('BAD_SIGNATURE');
    await request(server).get('/api/v1/staff/me/today').set(app_(first.token)).expect(200);
  });
  it('a nonsense number is refused plainly, not with a crash', async () => {
    const phone = makePhone();
    const res = await request(server)
      .post('/api/v1/staff-auth/verify')
      .send({
        phone: 'abcdefghijkl',
        code: '123456',
        publicKey: phone.publicKey,
        signature: phone.sign('link-verify|abcdefghijkl|123456'),
      });
    expect(res.status).toBe(400);
  });
  it('a key the server cannot use is refused at once', async () => {
    const res = await linkPhone(server, phoneNumber.keeper!, {
      publicKey: Buffer.from(
        'not a real key at all, not a real key at all, not a real key',
      ).toString('base64'),
      sign: () => '',
    });
    expect(res.status).toBe(400);
  });
  it('a first phone waits for a manager or owner, and can do nothing until then', async () => {
    const phone = makePhone();
    const { body } = await linkPhone(server, phoneNumber.keeper!, phone).expect(201);
    expect(body.device.status).toBe('PENDING');
    const headers = app_(body.accessToken);
    const state = await request(server).get('/api/v1/staff/me/link').set(headers).expect(200);
    expect(state.body.request).toMatchObject({ kind: 'FIRST', status: 'PENDING' });
    const { screen } = await screenFor();
    await request(server)
      .post('/api/v1/attendance/punch')
      .set(headers)
      .send(signedPunch(phone, liveQr(screen)))
      .expect(403);
    await request(server).get('/api/v1/admin/stock').set(headers).expect(403);
  });
  it('the people who decide are told, with no typed reason on a lock screen', async () => {
    await linkPhone(server, phoneNumber.keeper!, makePhone(), {
      reason: 'Purana toot gaya, private',
    }).expect(201);
    const told = await db.notification.findMany({
      where: { dedupeKey: { startsWith: 'device:' } },
    });
    expect(new Set(told.map((row) => row.userId))).toEqual(new Set(['papa', 'chacha', 'manager']));
    expect(JSON.stringify(told)).not.toContain('private');
  });
  it('a manager can agree to a first phone at their own shop, and not at another', async () => {
    await linkPhone(server, phoneNumber.keeper!, makePhone()).expect(201);
    const asked = await db.deviceLinkRequest.findFirstOrThrow({ where: { userId: 'keeper' } });
    await adminPost('managerb', `device-requests/${asked.id}/decide`, {
      decision: 'APPROVE',
    }).expect(403);
    const mine = await adminGet('manager', 'device-requests').expect(200);
    expect(mine.body.items.map((row: { id: string }) => row.id)).toEqual([asked.id]);
    expect((await adminGet('managerb', 'device-requests').expect(200)).body.items).toEqual([]);
    await adminPost('manager', `device-requests/${asked.id}/decide`, {
      decision: 'APPROVE',
    }).expect(201);
    expect(await db.staffDevice.count({ where: { userId: 'keeper', status: 'ACTIVE' } })).toBe(1);
  });
  it('a cashier and a driver cannot decide about phones', async () => {
    await linkPhone(server, phoneNumber.keeper!, makePhone()).expect(201);
    const asked = await db.deviceLinkRequest.findFirstOrThrow({ where: { userId: 'keeper' } });
    for (const who of ['cashier', 'driver', 'keeper'])
      await adminPost(who, `device-requests/${asked.id}/decide`, { decision: 'APPROVE' }).expect(
        403,
      );
  });
  it('nobody agrees to their own phone, even an owner', async () => {
    await linkPhone(server, phoneNumber.papa!, makePhone()).expect(201);
    const asked = await db.deviceLinkRequest.findFirstOrThrow({ where: { userId: 'papa' } });
    const res = await adminPost('papa', `device-requests/${asked.id}/decide`, {
      decision: 'APPROVE',
    }).expect(403);
    expect(res.body.error.code).toBe('OWN_REQUEST');
    await adminPost('chacha', `device-requests/${asked.id}/decide`, {
      decision: 'APPROVE',
    }).expect(201);
  });
  it('the database itself refuses someone deciding their own request', async () => {
    await linkPhone(server, phoneNumber.keeper!, makePhone()).expect(201);
    const asked = await db.deviceLinkRequest.findFirstOrThrow({ where: { userId: 'keeper' } });
    await expect(
      db.deviceLinkRequest.update({ where: { id: asked.id }, data: { decidedById: 'keeper' } }),
    ).rejects.toThrow();
  });
  it('a new phone needs an owner, a manager cannot, and the old one works until then', async () => {
    const first = await linked('keeper');
    const second = makePhone();
    const asked = await relink('keeper', second, { reason: 'Toot gaya' });
    expect(asked.status).toBe(201);
    expect(asked.body.device.status).toBe('PENDING');
    const row = await db.deviceLinkRequest.findFirstOrThrow({
      where: { userId: 'keeper', status: 'PENDING' },
    });
    expect(row.kind).toBe('CHANGE');
    await adminPost('manager', `device-requests/${row.id}/decide`, { decision: 'APPROVE' }).expect(
      403,
    );
    expect((await adminGet('manager', 'device-requests').expect(200)).body.items).toEqual([]);
    await request(server).get('/api/v1/staff/me/today').set(app_(first.token)).expect(200);
    const card = (await adminGet('papa', 'device-requests').expect(200)).body.items[0];
    expect(card).toMatchObject({ kind: 'CHANGE', oldModel: 'Test phone', reason: 'Toot gaya' });
    await adminPost('papa', `device-requests/${row.id}/decide`, { decision: 'APPROVE' }).expect(
      201,
    );
    const old = await request(server)
      .get('/api/v1/staff/me/today')
      .set(app_(first.token))
      .expect(401);
    expect(old.body.error.code).toBe('DEVICE_REVOKED');
    await request(server)
      .get('/api/v1/staff/me/today')
      .set(app_(asked.body.accessToken))
      .expect(200);
  });
  describe('renewing a sign-in', () => {
    const renew = async (phone: Phone, refreshToken: string) => {
      const { body } = await request(server).get('/api/v1/staff-auth/nonce').expect(200);
      return request(server)
        .post('/api/v1/staff-auth/renew')
        .send({
          refreshToken,
          nonce: body.nonce,
          signature: phone.sign(`renew|${body.nonce}`),
        });
    };
    it('an unknown token is a sign-in that ran out, so the phone keeps what it is holding', async () => {
      const keeper = await linked('keeper');
      const res = await renew(keeper.phone, 'x'.repeat(64));
      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe('UNAUTHORIZED');
    });
    it('a phone that really was cut off hears that it was', async () => {
      const keeper = await linked('keeper');
      const session = await db.session.findFirstOrThrow({
        where: { surface: 'STAFF_APP', userId: 'keeper' },
        select: { staffDeviceId: true },
      });
      await db.staffDevice.update({
        where: { id: session.staffDeviceId! },
        data: { status: 'REVOKED' },
      });
      const res = await renew(keeper.phone, keeper.refresh);
      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe('DEVICE_REVOKED');
    });
  });
  describe('proving a new phone stood at the shop', () => {
    const prove = (phone: Phone, token: string, qr: string) =>
      request(server)
        .post('/api/v1/staff/devices/qr-proof')
        .set(app_(token))
        .send({ qr, signature: phone.sign(`link|${qr}`) });
    it('the live code counts, and a photo of an old one does not', async () => {
      const first = await linked('keeper');
      const { screen } = await screenFor();
      const phone = makePhone();
      const asked = await relink('keeper', phone, { reason: 'Toot gaya' });
      const token = asked.body.accessToken;
      const stale = await prove(phone, token, liveQr(screen, 3600));
      expect(stale.status).toBe(400);
      expect(stale.body.error.code).toBe('BAD_QR');
      const pending = () =>
        db.deviceLinkRequest.findFirstOrThrow({
          where: { userId: 'keeper', status: 'PENDING' },
        });
      expect((await pending()).qrScannedAt).toBeNull();
      await prove(phone, token, liveQr(screen)).expect(201);
      expect((await pending()).qrScannedAt).toBeInstanceOf(Date);
      expect(first.phone).toBeTruthy();
    });
    it('a phone that did not sign it, and a code that is not ours, are refused', async () => {
      await linked('keeper');
      const { screen } = await screenFor();
      const phone = makePhone();
      const asked = await relink('keeper', phone, { reason: 'Toot gaya' });
      const qr = liveQr(screen);
      const other = makePhone();
      const unsigned = await request(server)
        .post('/api/v1/staff/devices/qr-proof')
        .set(app_(asked.body.accessToken))
        .send({ qr, signature: other.sign(`link|${qr}`) });
      expect(unsigned.status).toBe(403);
      expect((await prove(phone, asked.body.accessToken, 'SHV1.NOPE.1.AAAA')).status).toBe(400);
    });
  });
  it('refusing leaves the old phone as it was', async () => {
    const first = await linked('keeper');
    const asked = await relink('keeper', makePhone());
    const row = await db.deviceLinkRequest.findFirstOrThrow({
      where: { userId: 'keeper', status: 'PENDING' },
    });
    await adminPost('papa', `device-requests/${row.id}/decide`, { decision: 'REFUSE' }).expect(201);
    await request(server).get('/api/v1/staff/me/today').set(app_(first.token)).expect(200);
    const refused = await request(server)
      .get('/api/v1/staff/me/today')
      .set(app_(asked.body.accessToken));
    expect(refused.status).toBe(401);
  });
  it('a second person deciding sees it is done, not a crash', async () => {
    await linkPhone(server, phoneNumber.keeper!, makePhone()).expect(201);
    const row = await db.deviceLinkRequest.findFirstOrThrow({ where: { userId: 'keeper' } });
    await adminPost('papa', `device-requests/${row.id}/decide`, { decision: 'APPROVE' }).expect(
      201,
    );
    const again = await adminPost('chacha', `device-requests/${row.id}/decide`, {
      decision: 'REFUSE',
    }).expect(409);
    expect(again.body.error.code).toBe('ALREADY_DECIDED');
    expect(await db.staffDevice.count({ where: { userId: 'keeper', status: 'ACTIVE' } })).toBe(1);
  });
  it('one phone cannot be two people', async () => {
    const shared = makePhone();
    await linkPhone(server, phoneNumber.keeper!, shared).expect(201);
    const row = await db.deviceLinkRequest.findFirstOrThrow({ where: { userId: 'keeper' } });
    await adminPost('papa', `device-requests/${row.id}/decide`, { decision: 'APPROVE' }).expect(
      201,
    );
    const res = await linkPhone(server, phoneNumber.driver!, shared).expect(409);
    expect(res.body.error.code).toBe('DEVICE_TAKEN');
  });
  it('signing in again on the same phone needs nobody, and ends the older session', async () => {
    const first = await linked('keeper');
    const again = await relink('keeper', first.phone);
    expect(again.body.device.status).toBe('ACTIVE');
    await request(server).get('/api/v1/staff/me/today').set(app_(first.token)).expect(401);
    await request(server)
      .get('/api/v1/staff/me/today')
      .set(app_(again.body.accessToken))
      .expect(200);
    expect(await db.deviceLinkRequest.count({ where: { userId: 'keeper' } })).toBe(1);
  });
  it('a lost phone is cut off at once, from the new phone or the profile', async () => {
    const first = await linked('keeper');
    const second = await relink('keeper', makePhone());
    await request(server)
      .post('/api/v1/staff/devices/lost')
      .set(app_(second.body.accessToken))
      .expect(201);
    expect(
      (await request(server).get('/api/v1/staff/me/today').set(app_(first.token))).status,
    ).toBe(401);
    // Reporting it does not approve the new phone. That is still an owner's.
    expect(await db.staffDevice.count({ where: { userId: 'keeper', status: 'ACTIVE' } })).toBe(0);

    const driver = await linked('driver');
    await adminPost('manager', 'staff/driver/device/revoke').expect(201);
    expect(
      (await request(server).get('/api/v1/staff/me/today').set(app_(driver.token))).status,
    ).toBe(401);
  });
  it('a manager cannot cut off someone at another shop, or themselves from here', async () => {
    await linked('keeper');
    await adminPost('managerb', 'staff/keeper/device/revoke').expect(403);
    await adminPost('manager', 'staff/manager/device/revoke').expect(403);
    expect(await db.staffDevice.count({ where: { userId: 'keeper', status: 'ACTIVE' } })).toBe(1);
  });
});

describe('what a phone may reach', () => {
  it('a phone holds its narrow list of rights, even for an owner', async () => {
    const owner = await linked('chacha');
    for (const path of ['admin/rates', 'admin/reports/money', 'admin/users', 'admin/customers'])
      await request(server).get(`/api/v1/${path}`).set(app_(owner.token)).expect(403);
    await request(server).get('/api/v1/admin/stock').set(app_(owner.token)).expect(200);
  });
  it('a stock keeper’s phone reaches stock jobs; a driver’s does not', async () => {
    const keeper = await linked('keeper');
    const driver = await linked('driver');
    await request(server).get('/api/v1/admin/stock').set(app_(keeper.token)).expect(200);
    await request(server).get('/api/v1/admin/stock').set(app_(driver.token)).expect(403);
  });
  it('a stolen token cannot renew without the phone’s key', async () => {
    const keeper = await linked('keeper');
    const { body } = await request(server).get('/api/v1/staff-auth/nonce').expect(200);
    await request(server)
      .post('/api/v1/staff-auth/renew')
      .send({
        refreshToken: keeper.refresh,
        nonce: body.nonce,
        signature: makePhone().sign(`renew|${body.nonce}`),
      })
      .expect(401);
    await request(server)
      .post('/api/v1/auth/refresh')
      .send({ refreshToken: keeper.refresh })
      .expect(401);
    const renewed = await request(server)
      .post('/api/v1/staff-auth/renew')
      .send({
        refreshToken: keeper.refresh,
        nonce: body.nonce,
        signature: keeper.phone.sign(`renew|${body.nonce}`),
      })
      .expect(201);
    await request(server)
      .get('/api/v1/staff/me/today')
      .set(app_(renewed.body.accessToken))
      .expect(200);
  });
  it('a nonce that is made up or old is refused', async () => {
    const keeper = await linked('keeper');
    for (const nonce of ['1700000000000.abc', '1234.defgh', 'nonsense!'])
      await request(server)
        .post('/api/v1/staff-auth/renew')
        .send({
          refreshToken: keeper.refresh,
          nonce,
          signature: keeper.phone.sign(`renew|${nonce}`),
        })
        .expect(401);
  });
  it('a desk token cannot punch, even with a good key', async () => {
    const keeper = makePhone();
    const { screen } = await screenFor();
    await request(server)
      .post('/api/v1/attendance/punch')
      .set(desk('keeper'))
      .send(signedPunch(keeper, liveQr(screen)))
      .expect(403);
  });
  it('nobody scans before reading the notice', async () => {
    const phone = makePhone();
    const { body } = await linkPhone(server, phoneNumber.keeper!, phone).expect(201);
    const asked = await db.deviceLinkRequest.findFirstOrThrow({ where: { userId: 'keeper' } });
    await adminPost('papa', `device-requests/${asked.id}/decide`, { decision: 'APPROVE' }).expect(
      201,
    );
    const { screen } = await screenFor();
    const refused = await request(server)
      .post('/api/v1/attendance/punch')
      .set(app_(body.accessToken))
      .send(signedPunch(phone, liveQr(screen)))
      .expect(409);
    expect(refused.body.error.code).toBe('NOTICE_NEEDED');
    expect(await db.attendanceEvent.count()).toBe(0);
    await request(server)
      .post('/api/v1/attendance/problem')
      .set(app_(body.accessToken))
      .send({ captureId: randomUUID(), problem: 'NO_QR', kind: 'IN' })
      .expect(409);
  });
  it('the notice is read once, and only the current version counts', async () => {
    const phone = makePhone();
    const linkedNow = await linkPhone(server, phoneNumber.keeper!, phone).expect(201);
    const asked = await db.deviceLinkRequest.findFirstOrThrow({ where: { userId: 'keeper' } });
    await adminPost('papa', `device-requests/${asked.id}/decide`, { decision: 'APPROVE' }).expect(
      201,
    );
    const keeper = { token: linkedNow.body.accessToken as string };
    const today = async () =>
      (await request(server).get('/api/v1/staff/me/today').set(app_(keeper.token)).expect(200))
        .body;
    expect((await today()).noticeAccepted).toBe(false);
    await request(server)
      .post('/api/v1/staff/me/notice')
      .set(app_(keeper.token))
      .send({ version: staffNoticeVersion + 1 })
      .expect(400);
    await request(server)
      .post('/api/v1/staff/me/notice')
      .set(app_(keeper.token))
      .send({ version: staffNoticeVersion })
      .expect(201);
    expect((await today()).noticeAccepted).toBe(true);
  });
});

describe('a scan', () => {
  it('fresh code, own phone, inside: green, in the server’s time, and on the wall', async () => {
    const keeper = await linked('keeper');
    const { screen, token } = await screenFor();
    const before = Date.now();
    const { body } = await punch(keeper, signedPunch(keeper.phone, liveQr(screen))).expect(201);
    expect(body).toMatchObject({ result: 'GREEN', kind: 'IN', reasons: [] });
    expect(new Date(body.serverAt).getTime()).toBeGreaterThanOrEqual(before - 1000);
    const wall = await request(server)
      .get('/api/v1/screen/today')
      .set('x-shop-screen', token)
      .expect(200);
    expect(wall.body.people).toEqual([
      expect.objectContaining({ name: 'keeper', firstInAt: expect.any(String) }),
    ]);
    // First names and times: nothing about late, and no one's phone.
    expect(JSON.stringify(wall.body)).not.toMatch(/late|phone|\+91/i);
  });
  it('the phone’s clock is never used, whatever it claims', async () => {
    const keeper = await linked('keeper');
    const { screen } = await screenFor();
    const before = Date.now();
    const { body } = await punch(
      keeper,
      signedPunch(keeper.phone, liveQr(screen), { claimedAgeMs: 30000 }),
    ).expect(201);
    expect(new Date(body.serverAt).getTime()).toBeGreaterThanOrEqual(before - 1000);
    expect(new Date(body.serverAt).getTime()).toBeLessThanOrEqual(Date.now() + 1000);
  });
  it('a second arrival says when the first was, and writes nothing new', async () => {
    const keeper = await linked('keeper');
    const { screen } = await screenFor();
    const first = await punch(keeper, signedPunch(keeper.phone, liveQr(screen))).expect(201);
    const second = await punch(keeper, signedPunch(keeper.phone, liveQr(screen))).expect(201);
    expect(second.body).toMatchObject({ already: true, serverAt: first.body.serverAt });
    expect(await db.attendanceEvent.count({ where: { userId: 'keeper' } })).toBe(1);
  });
  it('the same capture sent twice is one record, with the first answer', async () => {
    const keeper = await linked('keeper');
    const { screen } = await screenFor();
    const body = signedPunch(keeper.phone, liveQr(screen));
    const first = await punch(keeper, body).expect(201);
    const second = await punch(keeper, body).expect(201);
    expect(second.body).toMatchObject({ id: first.body.id, replay: true });
    expect(await db.attendanceEvent.count({ where: { userId: 'keeper' } })).toBe(1);
  });
  it('in and then out gives the day its hours', async () => {
    const keeper = await linked('keeper');
    const { screen } = await screenFor();
    await punch(keeper, signedPunch(keeper.phone, liveQr(screen))).expect(201);
    const out = await punch(
      keeper,
      signedPunch(keeper.phone, liveQr(screen), { kind: 'OUT' }),
    ).expect(201);
    expect(out.body).toMatchObject({ result: 'GREEN', kind: 'OUT' });
    const today = await request(server)
      .get('/api/v1/staff/me/today')
      .set(app_(keeper.token))
      .expect(200);
    expect(today.body).toMatchObject({ next: 'IN', status: 'PRESENT' });
    expect(today.body.minutes).toBe(0);
  });
  it('going home with no arrival is written down, and a person looks', async () => {
    const keeper = await linked('keeper');
    const { screen } = await screenFor();
    const { body } = await punch(
      keeper,
      signedPunch(keeper.phone, liveQr(screen), { kind: 'OUT' }),
    ).expect(201);
    expect(body).toMatchObject({ result: 'REVIEW', reasons: ['NO_IN'] });
    expect(await db.attendanceReview.count()).toBe(1);
  });
  it('a code that is not ours saves nothing', async () => {
    const keeper = await linked('keeper');
    await punch(keeper, signedPunch(keeper.phone, 'SHV1.ABC123.100.AAAAAAAAAAAAAAAA')).expect(400);
    await punch(keeper, signedPunch(keeper.phone, 'HELLO')).expect(400);
    const { screen } = await screenFor();
    const good = liveQr(screen);
    const forged = `${good.slice(0, -1)}${good.endsWith('A') ? 'B' : 'A'}`;
    expect((await punch(keeper, signedPunch(keeper.phone, forged))).body.error.code).toBe('BAD_QR');
    expect(await db.attendanceEvent.count()).toBe(0);
  });
  it('a tampered scan fails the phone’s signature, and saves nothing', async () => {
    const keeper = await linked('keeper');
    const { screen } = await screenFor();
    const signed = signedPunch(keeper.phone, liveQr(screen));
    const res = await punch(keeper, { ...signed, lat: FAR.lat, mocked: false }).expect(403);
    expect(res.body.error.code).toBe('BAD_SIGNATURE');
    const otherPhone = signedPunch(makePhone(), liveQr(screen));
    await punch(keeper, otherPhone).expect(403);
    expect(await db.attendanceEvent.count()).toBe(0);
  });
  it('an old code at the shop just asks for another scan, with no manager', async () => {
    const keeper = await linked('keeper');
    const { screen } = await screenFor();
    const { body } = await punch(keeper, signedPunch(keeper.phone, liveQr(screen, 120))).expect(
      201,
    );
    expect(body).toMatchObject({ result: 'RETRY', reasons: ['OLD_QR'] });
    expect(await db.attendanceReview.count()).toBe(0);
    const today = await request(server)
      .get('/api/v1/staff/me/today')
      .set(app_(keeper.token))
      .expect(200);
    expect(today.body).toMatchObject({ next: 'IN', status: 'ABSENT' });
    // The attempt stays on record.
    expect(await db.attendanceEvent.count({ where: { userId: 'keeper' } })).toBe(1);
  });
  it('a friend’s photo from home: old code and far away goes to a person', async () => {
    const keeper = await linked('keeper');
    const { screen } = await screenFor();
    const { body } = await punch(
      keeper,
      signedPunch(keeper.phone, liveQr(screen, 120), FAR),
    ).expect(201);
    expect(body.result).toBe('REVIEW');
    expect(body.reasons).toEqual(expect.arrayContaining(['FAR', 'OLD_QR']));
  });
  it('a fresh relayed code with fake GPS is caught by the mark', async () => {
    const keeper = await linked('keeper');
    const { screen } = await screenFor();
    const { body } = await punch(
      keeper,
      signedPunch(keeper.phone, liveQr(screen), { mocked: true }),
    ).expect(201);
    expect(body).toMatchObject({ result: 'REVIEW', reasons: ['MOCKED'] });
  });
  it('location refused, GPS off or approximate is never turned away, and a person looks', async () => {
    const { screen } = await screenFor();
    for (const [who, location] of [
      ['keeper', 'DENIED'],
      ['cashier', 'GPS_OFF'],
      ['driver', 'APPROXIMATE'],
    ] as const) {
      const person = await linked(who);
      const {
        lat: _a,
        lng: _b,
        accuracyM: _c,
        ...rest
      } = {
        lat: 0,
        lng: 0,
        accuracyM: 0,
        location,
      };
      const body = signedPunch(person.phone, liveQr(screen), {
        ...rest,
        lat: undefined,
        lng: undefined,
        accuracyM: undefined,
      });
      const res = await punch(person, body).expect(201);
      expect(res.body.result).toBe('REVIEW');
    }
  });
  it('a weak fix now and then is green with a note, and too many go to a person', async () => {
    const keeper = await linked('keeper');
    const { screen } = await screenFor();
    const weak = () =>
      signedPunch(keeper.phone, liveQr(screen), {
        location: 'NO_FIX',
        lat: undefined,
        lng: undefined,
        accuracyM: undefined,
      });
    for (let index = 0; index < 3; index++) {
      const inn = await punch(keeper, weak()).expect(201);
      expect(inn.body.result).toBe('GREEN_NOTE');
      await punch(keeper, signedPunch(keeper.phone, liveQr(screen), { kind: 'OUT' })).expect(201);
    }
    const fourth = await punch(keeper, weak()).expect(201);
    expect(fourth.body).toMatchObject({ result: 'REVIEW', reasons: ['MANY_WEAK'] });
  });
  it('a shop they do not work at goes to a person at that shop', async () => {
    const keeper = await linked('keeper');
    const { screen } = await screenFor(SECOND);
    const { body } = await punch(keeper, signedPunch(keeper.phone, liveQr(screen), FAR)).expect(
      201,
    );
    expect(body.reasons).toContain('OTHER_SHOP');
    expect((await adminGet('managerb', 'attendance/reviews').expect(200)).body.count).toBe(1);
    expect((await adminGet('manager', 'attendance/reviews').expect(200)).body.count).toBe(0);
  });
  it('two shops too far apart for the time between them are looked at', async () => {
    const owner = await linked('papa');
    const one = await screenFor();
    const two = await screenFor(SECOND);
    await punch(owner, signedPunch(owner.phone, liveQr(one.screen))).expect(201);
    await punch(owner, signedPunch(owner.phone, liveQr(one.screen), { kind: 'OUT' })).expect(201);
    const { body } = await punch(owner, signedPunch(owner.phone, liveQr(two.screen), FAR)).expect(
      201,
    );
    expect(body.reasons).toContain('IMPOSSIBLE_TRAVEL');
  });
  it('a scan carried offline shows both times, and accepting uses the time it was taken', async () => {
    const keeper = await linked('keeper');
    const { screen } = await screenFor();
    const ageMs = 3 * 3600000;
    const { body } = await punch(
      keeper,
      signedPunch(keeper.phone, qrText(screen, qrCounter(Date.now() - ageMs)), {
        claimedAgeMs: ageMs,
      }),
    ).expect(201);
    expect(body.reasons).toContain('OFFLINE');
    const card = (await adminGet('manager', 'attendance/reviews').expect(200)).body.items[0];
    expect(card).toMatchObject({ claimedAgeMs: ageMs, kind: 'OFFLINE' });
    await adminPost('manager', `attendance/reviews/${card.id}/decide`, {
      decision: 'ACCEPT',
    }).expect(201);
    const row = await db.attendanceDay.findFirstOrThrow({ where: { userId: 'keeper' } });
    const taken = new Date(row.firstInAt!).getTime();
    expect(Math.abs(taken - (new Date(body.serverAt).getTime() - ageMs))).toBeLessThan(2000);
  });
  it('a day shows a scan on the day it was taken, once accepted, not the day it arrived', async () => {
    const keeper = await linked('keeper');
    const { screen } = await screenFor();
    const sinceMidnight = Date.now() - new Date(`${istToday()}T00:00:00+05:30`).getTime();
    const ageMs = sinceMidnight + 2 * 3600000;
    const taken = istToday(new Date(Date.now() - ageMs));
    const { body } = await punch(
      keeper,
      signedPunch(keeper.phone, qrText(screen, qrCounter(Date.now() - ageMs)), {
        claimedAgeMs: ageMs,
      }),
    ).expect(201);
    const on = async (day: string) =>
      (await adminGet('manager', `attendance/person/keeper/${day}`).expect(200)).body.events.map(
        (row: { id: string }) => row.id,
      );
    // Until someone accepts it, it counts when it reached us.
    expect(await on(istToday())).toContain(body.id);
    expect(await on(taken)).not.toContain(body.id);
    const card = (await adminGet('manager', 'attendance/reviews').expect(200)).body.items[0];
    await adminPost('manager', `attendance/reviews/${card.id}/decide`, {
      decision: 'ACCEPT',
    }).expect(201);
    expect(await on(taken)).toContain(body.id);
    expect(await on(istToday())).not.toContain(body.id);
  });
  it('a new shift cannot be dated in the past, and a second one for a date keeps the first on record', async () => {
    const shift = (effectiveFrom: string, startMinute = 540) =>
      request(server)
        .put('/api/v1/admin/staff/keeper/schedule')
        .set(desk('papa'))
        .send({ effectiveFrom, startMinute, endMinute: 1140, breakMinutes: 60, weeklyOffs: [0] });
    const past = await shift(istToday(new Date(Date.now() - 86400000))).expect(400);
    expect(past.body.error.code).toBe('BAD_DAY');
    expect(await db.staffSchedule.count({ where: { userId: 'keeper' } })).toBe(0);
    await shift(istToday()).expect(200);
    await shift(istToday(), 600).expect(200);
    const logged = await db.auditLog.findFirstOrThrow({
      where: { event: 'STAFF_SCHEDULE_CHANGED', entityId: 'keeper' },
      orderBy: { createdAt: 'desc' },
    });
    expect(logged.details).toMatchObject({ replaced: { startMinute: 540 } });
  });
  it('an offline claim that disagrees with the code’s own time is called out', async () => {
    const keeper = await linked('keeper');
    const { screen } = await screenFor();
    // A code from just now, claiming it was scanned three hours ago to look early.
    const { body } = await punch(
      keeper,
      signedPunch(keeper.phone, liveQr(screen), { claimedAgeMs: 3 * 3600000 }),
    ).expect(201);
    expect(body.reasons).toEqual(expect.arrayContaining(['OFFLINE', 'TIME_MISMATCH']));
    const card = (await adminGet('manager', 'attendance/reviews').expect(200)).body.items[0];
    expect(card.qrShownAt).toBeTruthy();
  });
  it('a shop where hazri has not started refuses, and saves nothing', async () => {
    const keeper = await linked('keeper');
    const { screen } = await screenFor();
    await db.location.update({ where: { id: MAIN }, data: { attendanceOn: false } });
    const res = await punch(keeper, signedPunch(keeper.phone, liveQr(screen))).expect(409);
    expect(res.body.error.code).toBe('ATTENDANCE_OFF');
    expect(await db.attendanceEvent.count()).toBe(0);
  });
  it('exact position is kept only for a scan someone must judge', async () => {
    const keeper = await linked('keeper');
    const { screen } = await screenFor();
    await punch(keeper, signedPunch(keeper.phone, liveQr(screen))).expect(201);
    expect(await db.attendanceGeo.count()).toBe(0);
    await punch(keeper, signedPunch(keeper.phone, liveQr(screen), { ...FAR, kind: 'OUT' })).expect(
      201,
    );
    expect(await db.attendanceGeo.count()).toBe(1);
    const [geo] = await db.attendanceGeo.findMany();
    expect(geo!.geoEnc).not.toContain(String(FAR.lat));
    const card = (await adminGet('manager', 'attendance/reviews').expect(200)).body.items[0];
    expect(card.position).toEqual(FAR);
  });
  it('late is a fact on the record and moves nothing else', async () => {
    const keeper = await linked('keeper');
    const { screen } = await screenFor();
    await adminPost('papa', 'attendance/shops').expect(404);
    await db.staffSchedule.create({
      data: {
        userId: 'keeper',
        effectiveFrom: '2020-01-01',
        startMinute: 0,
        endMinute: 1,
        breakMinutes: 0,
        weeklyOffs: [],
        createdById: 'papa',
      },
    });
    const { body } = await punch(keeper, signedPunch(keeper.phone, liveQr(screen))).expect(201);
    expect(body.result).toBe('GREEN');
    expect(body.lateMinutes).toBeGreaterThanOrEqual(0);
  });
  it('malformed scans are refused', async () => {
    const keeper = await linked('keeper');
    const { screen } = await screenFor();
    for (const change of [
      { qr: '<script>' },
      { captureId: 'not-a-uuid' },
      { lat: 500 },
      { kind: 'SIDEWAYS' },
      { location: 'MAYBE' },
      { extra: true },
    ])
      await punch(keeper, { ...signedPunch(keeper.phone, liveQr(screen)), ...change }).expect(400);
  });
});

describe('Problem hai?', () => {
  const problem = (who: Linked, extra: object = {}) =>
    request(server)
      .post('/api/v1/attendance/problem')
      .set(app_(who.token))
      .send({ captureId: randomUUID(), problem: 'NO_QR', kind: 'IN', ...extra });
  it('always goes through, in the server’s time, and reaches a manager', async () => {
    const keeper = await linked('keeper');
    const { body } = await problem(keeper, { note: 'Screen band hai' }).expect(201);
    expect(body).toMatchObject({ result: 'REVIEW', reasons: ['PROBLEM_NO_QR'] });
    const card = (await adminGet('manager', 'attendance/reviews').expect(200)).body.items[0];
    expect(card).toMatchObject({ kind: 'PROBLEM_NO_QR', note: 'Screen band hai', name: 'keeper' });
  });
  it('the same tap twice is one card', async () => {
    const keeper = await linked('keeper');
    const captureId = randomUUID();
    await problem(keeper, { captureId }).expect(201);
    await problem(keeper, { captureId }).expect(201);
    expect(await db.attendanceReview.count()).toBe(1);
  });
  it('a phone that is not linked cannot use it', async () => {
    const { body } = await linkPhone(server, phoneNumber.keeper!, makePhone()).expect(201);
    await request(server)
      .post('/api/v1/attendance/problem')
      .set(app_(body.accessToken))
      .send({ captureId: randomUUID(), problem: 'NO_QR', kind: 'IN' })
      .expect(403);
  });
  it('another shop is refused', async () => {
    const keeper = await linked('keeper');
    await problem(keeper, { locationId: SECOND }).expect(403);
  });
});

describe('settling the cards', () => {
  async function card(who: Linked = undefined as never) {
    const person = who ?? (await linked('keeper'));
    const { screen } = await screenFor();
    await punch(person, signedPunch(person.phone, liveQr(screen), FAR)).expect(201);
    return (await db.attendanceReview.findFirstOrThrow({ where: { userId: person.id } })).id;
  }
  it('says what the checks saw, in codes the screen turns into words', async () => {
    const id = await card();
    const { body } = await adminGet('manager', 'attendance/reviews').expect(200);
    expect(body.items[0]).toMatchObject({
      id,
      reasons: ['FAR'],
      name: 'keeper',
      punch: 'IN',
      shopName: expect.any(String),
    });
    expect(body.items[0].distanceM).toBeGreaterThan(1000);
  });
  it('accepting keeps the first time, and goes on the record', async () => {
    const id = await card();
    const event = await db.attendanceEvent.findFirstOrThrow({ where: { userId: 'keeper' } });
    await adminPost('manager', `attendance/reviews/${id}/decide`, {
      decision: 'ACCEPT',
      note: 'Dekh liya',
    }).expect(201);
    const day = await db.attendanceDay.findFirstOrThrow({ where: { userId: 'keeper' } });
    expect(day.firstInAt).toEqual(event.serverAt);
    expect(day.status).toBe('PRESENT');
    expect(await db.attendanceEvent.count({ where: { userId: 'keeper', kind: 'DECISION' } })).toBe(
      1,
    );
  });
  it('rejecting removes it from the day, and the entry stays', async () => {
    const id = await card();
    await adminPost('manager', `attendance/reviews/${id}/decide`, { decision: 'REJECT' }).expect(
      201,
    );
    expect((await db.attendanceDay.findFirstOrThrow({ where: { userId: 'keeper' } })).status).toBe(
      'ABSENT',
    );
    expect(await db.attendanceEvent.count({ where: { userId: 'keeper' } })).toBe(2);
  });
  it('a manager’s own card goes to an owner, with no way around it', async () => {
    const manager = await linked('manager');
    const id = await card(manager);
    expect((await adminGet('manager', 'attendance/reviews').expect(200)).body.count).toBe(0);
    await adminPost('manager', `attendance/reviews/${id}/decide`, { decision: 'ACCEPT' }).expect(
      403,
    );
    expect((await db.attendanceReview.findUniqueOrThrow({ where: { id } })).toOwner).toBe(true);
    expect((await adminGet('papa', 'attendance/reviews').expect(200)).body.count).toBe(1);
    await adminPost('papa', `attendance/reviews/${id}/decide`, { decision: 'ACCEPT' }).expect(201);
  });
  it('sent up, a manager can no longer settle it', async () => {
    const id = await card();
    await adminPost('manager', `attendance/reviews/${id}/decide`, { decision: 'TO_OWNER' }).expect(
      201,
    );
    await adminPost('manager', `attendance/reviews/${id}/decide`, { decision: 'ACCEPT' }).expect(
      403,
    );
    expect((await adminGet('manager', 'attendance/reviews').expect(200)).body.count).toBe(0);
  });
  it('the database itself refuses someone settling their own', async () => {
    const id = await card();
    await expect(
      db.attendanceReview.update({ where: { id }, data: { decidedById: 'keeper' } }),
    ).rejects.toThrow();
  });
  it('asking for another shop by name shows nothing, and is refused', async () => {
    await card();
    await adminGet('managerb', `attendance/reviews?locationId=${MAIN}`).expect(403);
    expect((await adminGet('managerb', 'attendance/reviews').expect(200)).body.count).toBe(0);
  });
  it('a card with no shop is for owners alone', async () => {
    const owner = await linked('chacha');
    await request(server)
      .post('/api/v1/staff/me/query')
      .set(app_(owner.token))
      .send({ day: istToday(), note: 'Kuch galat hai' })
      .expect(201);
    const row = await db.attendanceReview.findFirstOrThrow({ where: { userId: 'chacha' } });
    expect(row.locationId).toBeNull();
    expect((await adminGet('manager', 'attendance/reviews').expect(200)).body.count).toBe(0);
    await adminPost('manager', `attendance/reviews/${row.id}/decide`, {
      decision: 'ACCEPT',
    }).expect(403);
    await adminPost('papa', `attendance/reviews/${row.id}/decide`, { decision: 'ACCEPT' }).expect(
      201,
    );
  });
  it('those who may not review are refused', async () => {
    const id = await card();
    for (const who of ['cashier', 'keeper', 'driver', 'accountant', 'managerb'])
      await adminPost(who, `attendance/reviews/${id}/decide`, { decision: 'ACCEPT' }).expect(403);
  });
  it('decided twice: the second sees it is done', async () => {
    const id = await card();
    await adminPost('manager', `attendance/reviews/${id}/decide`, { decision: 'ACCEPT' }).expect(
      201,
    );
    const again = await adminPost('papa', `attendance/reviews/${id}/decide`, {
      decision: 'REJECT',
    }).expect(409);
    expect(again.body.error.code).toBe('ALREADY_DECIDED');
  });
  it('bulk accept takes only what this person may decide', async () => {
    const keeper = await linked('keeper');
    const manager = await linked('manager');
    const first = await card(keeper);
    const own = await card(manager);
    const { body } = await adminPost('manager', 'attendance/reviews/bulk', {
      ids: [first, own],
      note: 'Dukaan ka net band tha',
    }).expect(201);
    expect(body.accepted).toBe(1);
    expect((await db.attendanceReview.findUniqueOrThrow({ where: { id: own } })).status).toBe(
      'OPEN',
    );
  });
  it('a card left too long goes up to the owners, and is never decided by a machine', async () => {
    const id = await card();
    await db.attendanceReview.update({
      where: { id },
      data: { createdAt: new Date(Date.now() - 49 * 3600000) },
    });
    await attendance.housekeeping();
    const row = await db.attendanceReview.findUniqueOrThrow({ where: { id } });
    expect(row).toMatchObject({ toOwner: true, status: 'OPEN' });
  });
  it('someone can see where their own stands, and ask a question', async () => {
    const keeper = await linked('keeper');
    await card(keeper);
    const day = istToday();
    const mine = await request(server)
      .get(`/api/v1/staff/me/attendance/${day}`)
      .set(app_(keeper.token))
      .expect(200);
    expect(mine.body.events[0].review.status).toBe('OPEN');
    const month = await request(server)
      .get(`/api/v1/staff/me/attendance?month=${day.slice(0, 7)}`)
      .set(app_(keeper.token))
      .expect(200);
    expect(month.body.days[0]).toMatchObject({ day, status: 'REVIEW' });
    await request(server)
      .post('/api/v1/staff/me/query')
      .set(app_(keeper.token))
      .send({ day, note: 'Main subah aaya tha' })
      .expect(201);
    const cards = (await adminGet('manager', 'attendance/reviews').expect(200)).body.items;
    expect(cards.map((row: { kind: string }) => row.kind)).toContain('QUERY');
  });
});

describe('hand marks and corrections', () => {
  const mark = (who: string, userId: string, extra: object = {}) =>
    adminPost(who, 'attendance/manual', {
      userId,
      kind: 'MANUAL_IN',
      locationId: MAIN,
      idempotencyKey: randomUUID(),
      ...extra,
    });
  it('at the time now, by name, and never one’s own', async () => {
    const before = Date.now();
    const { body } = await mark('manager', 'keeper').expect(201);
    expect(new Date(body.serverAt).getTime()).toBeGreaterThanOrEqual(before - 1000);
    const event = await db.attendanceEvent.findFirstOrThrow({ where: { userId: 'keeper' } });
    expect(event).toMatchObject({ actorId: 'manager', kind: 'MANUAL_IN', reasons: ['BY_HAND'] });
    expect((await mark('manager', 'manager').expect(403)).body.error.code).toBe('OWN_RECORD');
  });
  it('those at other shops, and those who do not mark, are refused', async () => {
    await mark('managerb', 'keeper').expect(403);
    await mark('cashier', 'keeper').expect(403);
    await mark('keeper', 'driver').expect(403);
  });
  it('someone who does not work at the shop cannot be marked there', async () => {
    expect((await mark('manager', 'keeperb').expect(409)).body.error.code).toBe('NOT_ASSIGNED');
  });
  it('going home needs an arrival', async () => {
    expect(
      (await mark('manager', 'keeper', { kind: 'MANUAL_OUT' }).expect(409)).body.error.code,
    ).toBe('NO_OPEN_SHIFT');
  });
  it('the same tap twice marks once', async () => {
    const idempotencyKey = randomUUID();
    await mark('manager', 'keeper', { idempotencyKey }).expect(201);
    await mark('manager', 'keeper', { idempotencyKey }).expect(201);
    expect(await db.attendanceEvent.count({ where: { userId: 'keeper' } })).toBe(1);
  });
  const correct = (who: string, userId: string, extra: object = {}) =>
    adminPost(who, 'attendance/corrections', {
      userId,
      day: istToday(),
      corrects: 'IN',
      minute: 1,
      reason: 'Galat time',
      idempotencyKey: randomUUID(),
      ...extra,
    });
  const yesterday = () => istToday(new Date(Date.now() - 86400000));
  it('a time that has not come yet is refused, and nothing is written', async () => {
    const { body } = await correct('manager', 'keeper', { minute: 1439 }).expect(400);
    expect(body.error.code).toBe('BAD_DAY');
    expect(await db.attendanceEvent.count({ where: { userId: 'keeper' } })).toBe(0);
  });
  it('going home before arriving is refused, from either side', async () => {
    const day = yesterday();
    await correct('manager', 'keeper', { day, minute: 600 }).expect(201);
    const early = await correct('manager', 'keeper', {
      day,
      corrects: 'OUT',
      minute: 540,
    }).expect(400);
    expect(early.body.error.code).toBe('TIME_ORDER');
    await correct('manager', 'keeper', { day, corrects: 'OUT', minute: 1080 }).expect(201);
    const late = await correct('manager', 'keeper', { day, minute: 1100 }).expect(400);
    expect(late.body.error.code).toBe('TIME_ORDER');
    const row = await db.attendanceDay.findFirstOrThrow({ where: { userId: 'keeper', day } });
    expect(row.lastOutAt!.getTime()).toBeGreaterThan(row.firstInAt!.getTime());
    expect(row.minutes).toBeGreaterThanOrEqual(0);
  });
  it('a correction sits beside the original, and changes the day', async () => {
    await mark('manager', 'keeper').expect(201);
    await correct('manager', 'keeper').expect(201);
    expect(await db.attendanceEvent.count({ where: { userId: 'keeper' } })).toBe(2);
    const day = await db.attendanceDay.findFirstOrThrow({ where: { userId: 'keeper' } });
    expect(day.flags).toContain('CORRECTED');
    expect(day.firstInAt!.toISOString()).toBe(
      new Date(`${istToday()}T00:01:00+05:30`).toISOString(),
    );
  });
  it('a manager cannot read or correct an owner’s record', async () => {
    await correct('manager', 'chacha').expect(403);
    await adminGet('manager', `attendance/person/chacha/${istToday()}`).expect(403);
    await correct('papa', 'chacha').expect(201);
  });
  it('nobody corrects their own, or at another shop', async () => {
    expect((await correct('manager', 'manager').expect(403)).body.error.code).toBe('OWN_RECORD');
    await correct('managerb', 'keeper').expect(403);
    await correct('cashier', 'keeper').expect(403);
  });
  it('needs a reason, and no future day', async () => {
    await correct('manager', 'keeper', { reason: '' }).expect(400);
    await correct('manager', 'keeper', { day: '2099-01-01' }).expect(400);
  });
});

describe('the record cannot be changed', () => {
  it('the database refuses any change or removal', async () => {
    await adminPost('manager', 'attendance/manual', {
      userId: 'keeper',
      kind: 'MANUAL_IN',
      locationId: MAIN,
      idempotencyKey: randomUUID(),
    }).expect(201);
    const row = await db.attendanceEvent.findFirstOrThrow();
    await expect(
      db.attendanceEvent.update({ where: { id: row.id }, data: { reason: 'changed' } }),
    ).rejects.toThrow();
    await expect(db.attendanceEvent.delete({ where: { id: row.id } })).rejects.toThrow();
  });
  it('a chain adds up, and a change made behind the app breaks it', async () => {
    for (const kind of ['MANUAL_IN', 'MANUAL_OUT', 'MANUAL_IN'])
      await adminPost('manager', 'attendance/manual', {
        userId: 'keeper',
        kind,
        locationId: MAIN,
        idempotencyKey: randomUUID(),
      }).expect(201);
    const day = istToday();
    const good = await adminGet('papa', `attendance/proof/keeper/${day}`).expect(200);
    expect(good.body.chainOk).toBe(true);
    expect((await adminGet('papa', 'attendance/chain-check').expect(200)).body.broken).toBe(0);
    // Someone with full database access, with the guard lifted.
    await db.$executeRawUnsafe(
      'ALTER TABLE "AttendanceEvent" DISABLE TRIGGER attendance_event_append_only',
    );
    const rows = await db.attendanceEvent.findMany({ orderBy: { seq: 'asc' } });
    await db.attendanceEvent.update({
      where: { id: rows[1]!.id },
      data: { serverAt: new Date('2020-01-01T00:00:00Z') },
    });
    await db.$executeRawUnsafe(
      'ALTER TABLE "AttendanceEvent" ENABLE TRIGGER attendance_event_append_only',
    );
    const bad = await adminGet('papa', `attendance/proof/keeper/${day}`).expect(200);
    expect(bad.body).toMatchObject({ chainOk: false, brokenAtSeq: 2 });
    expect((await adminGet('papa', 'attendance/chain-check').expect(200)).body.broken).toBe(1);
  });
  it('a removed row breaks the chain too', () => {
    const rows = [
      { seq: 1, prevHash: '', hash: 'a' },
      { seq: 3, prevHash: 'b', hash: 'c' },
    ];
    expect(brokenAt(rows)).toBe(1);
  });
  it('only owners read the proof', async () => {
    for (const who of ['manager', 'accountant', 'cashier', 'keeper'])
      await adminGet(who, `attendance/proof/keeper/${istToday()}`).expect(403);
  });
});

describe('the shop screen', () => {
  it('pairs once with six digits, and holds only its own narrow credential', async () => {
    const made = await adminPost('manager', 'screens', {
      locationId: MAIN,
      label: 'Counter',
    }).expect(201);
    expect(made.body.pairingCode).toMatch(/^\d{6}$/);
    const paired = await request(server)
      .post('/api/v1/screen/pair')
      .send({ code: made.body.pairingCode })
      .expect(201);
    await request(server)
      .post('/api/v1/screen/pair')
      .send({ code: made.body.pairingCode })
      .expect(400);
    // The credential opens the wall and nothing else: it is not a person's session.
    await request(server)
      .get('/api/v1/admin/stock')
      .set('Authorization', `Bearer ${paired.body.token}`)
      .expect(401);
    const wall = await request(server)
      .get('/api/v1/screen/today')
      .set('x-shop-screen', paired.body.token)
      .expect(200);
    expect(wall.body.qr).toMatch(/^SHV1\.[A-Z0-9]+\.\d+\.[A-Z2-7]{16}$/);
    expect(wall.body.msLeft).toBeGreaterThan(0);
  });
  it('an expired or wrong code is refused', async () => {
    const made = await adminPost('papa', 'screens', { locationId: MAIN }).expect(201);
    await db.shopScreen.update({
      where: { id: made.body.id },
      data: { pairingExpiresAt: new Date(Date.now() - 1000) },
    });
    await request(server)
      .post('/api/v1/screen/pair')
      .send({ code: made.body.pairingCode })
      .expect(400);
    await request(server).post('/api/v1/screen/pair').send({ code: 'abc' }).expect(400);
  });
  it('turning a screen off stops it, and its old codes', async () => {
    const keeper = await linked('keeper');
    const { screen, token } = await screenFor();
    const qr = liveQr(screen);
    await adminPost('manager', `screens/${screen.id}/revoke`).expect(201);
    await request(server).get('/api/v1/screen/today').set('x-shop-screen', token).expect(401);
    await punch(keeper, signedPunch(keeper.phone, qr)).expect(400);
  });
  it('without a credential, or another shop’s manager, nothing', async () => {
    await request(server).get('/api/v1/screen/today').expect(401);
    await request(server).get('/api/v1/screen/today').set('x-shop-screen', 'made-up').expect(401);
    await adminPost('managerb', 'screens', { locationId: MAIN }).expect(403);
    await adminPost('cashier', 'screens', { locationId: MAIN }).expect(403);
  });
  it('"show it here" works when the screen is dead, and the record says so', async () => {
    const keeper = await linked('keeper');
    const { body } = await adminGet('manager', `screens/here/${MAIN}`).expect(200);
    const res = await punch(keeper, signedPunch(keeper.phone, body.qr)).expect(201);
    expect(res.body.result).toBe('GREEN');
    const event = await db.attendanceEvent.findFirstOrThrow({ where: { userId: 'keeper' } });
    const screen = await db.shopScreen.findUniqueOrThrow({ where: { id: event.screenId! } });
    expect(screen.kind).toBe('MANAGER_PHONE');
    await adminGet('managerb', `screens/here/${MAIN}`).expect(403);
    await adminGet('cashier', `screens/here/${MAIN}`).expect(403);
    // It stays usable until someone turns it off, so the desk has to be able to see it.
    const listed = (await adminGet('papa', 'attendance/shops').expect(200)).body.items.find(
      (shop: { id: string }) => shop.id === MAIN,
    );
    expect(listed.handCodes).toEqual([
      expect.objectContaining({ id: screen.id, label: 'manager', status: 'ACTIVE' }),
    ]);
    expect(listed.screens.map((row: { id: string }) => row.id)).not.toContain(screen.id);
    await adminPost('manager', `screens/${screen.id}/revoke`).expect(201);
    const after = (await adminGet('papa', 'attendance/shops').expect(200)).body.items.find(
      (shop: { id: string }) => shop.id === MAIN,
    );
    expect(after.handCodes).toEqual([]);
  });
  it('shop setup: range checks, and hazri cannot start without a position', async () => {
    const set = (who: string, body: object, id = MAIN) =>
      request(server).patch(`/api/v1/admin/locations/${id}/hazri`).set(desk(who)).send(body);
    await set('manager', { radiusM: 40 }).expect(400);
    await set('manager', { radiusM: 301 }).expect(400);
    await set('manager', { lat: 25.6 }).expect(400);
    await set('managerb', { radiusM: 120 }).expect(403);
    await set('cashier', { radiusM: 120 }).expect(403);
    await set('manager', { lat: null, lng: null, attendanceOn: false }).expect(200);
    const refused = await set('manager', { attendanceOn: true }).expect(409);
    expect(refused.body.error.code).toBe('PIN_NEEDED');
    const saved = await set('manager', { ...SHOP, radiusM: 150, attendanceOn: true }).expect(200);
    expect(saved.body).toMatchObject({ radiusM: 150, attendanceOn: true });
  });
  it('a shop whose position has not been taken gives a note, and blames nobody', async () => {
    const keeper = await linked('keeper');
    const { screen } = await screenFor();
    await db.location.update({ where: { id: MAIN }, data: { lat: null, lng: null } });
    const { body } = await punch(keeper, signedPunch(keeper.phone, liveQr(screen))).expect(201);
    expect(body).toMatchObject({ result: 'GREEN_NOTE', reasons: ['NO_PIN'] });
  });
});

describe('who sees the roster', () => {
  it('a manager sees their own shop, an owner any, and others nothing', async () => {
    await adminPost('manager', 'attendance/manual', {
      userId: 'keeper',
      kind: 'MANUAL_IN',
      locationId: MAIN,
      idempotencyKey: randomUUID(),
    }).expect(201);
    const roster = await adminGet('manager', `attendance/day?locationId=${MAIN}`).expect(200);
    expect(
      roster.body.items.find((row: { userId: string }) => row.userId === 'keeper'),
    ).toMatchObject({
      status: 'PRESENT',
      linked: false,
    });
    await adminGet('manager', `attendance/day?locationId=${SECOND}`).expect(403);
    await adminGet('papa', `attendance/day?locationId=${SECOND}`).expect(200);
    await adminGet('accountant', `attendance/day?locationId=${MAIN}`).expect(200);
    for (const who of ['cashier', 'keeper', 'driver'])
      await adminGet(who, `attendance/day?locationId=${MAIN}`).expect(403);
    await adminGet('manager', `attendance/person/keeper/${istToday()}`).expect(200);
    await adminGet('managerb', `attendance/person/keeper/${istToday()}`).expect(403);
  });
  it('someone’s month is only their own', async () => {
    const keeper = await linked('keeper');
    await adminPost('manager', 'attendance/manual', {
      userId: 'driver',
      kind: 'MANUAL_IN',
      locationId: MAIN,
      idempotencyKey: randomUUID(),
    }).expect(201);
    const mine = await request(server)
      .get(`/api/v1/staff/me/attendance?month=${istToday().slice(0, 7)}`)
      .set(app_(keeper.token))
      .expect(200);
    expect(mine.body.days).toEqual([]);
    await request(server)
      .get('/api/v1/staff/me/attendance?month=nonsense')
      .set(app_(keeper.token))
      .expect(400);
  });
  it('only owners set shifts and the no-phone mark', async () => {
    const put = (who: string, path: string, body: object) =>
      request(server).put(`/api/v1/admin/staff/keeper/${path}`).set(desk(who)).send(body);
    const shift = {
      effectiveFrom: istToday(),
      startMinute: 540,
      endMinute: 1140,
      weeklyOffs: [0],
    };
    await put('manager', 'schedule', shift).expect(403);
    await put('manager', 'no-phone', { noPhone: true }).expect(403);
    await put('papa', 'schedule', shift).expect(200);
    await put('papa', 'schedule', { ...shift, endMinute: 100 }).expect(400);
    await put('papa', 'no-phone', { noPhone: true }).expect(200);
  });
});

describe('the night', () => {
  it('makes one code a night, tells the owners, and only after 11 PM', async () => {
    await adminPost('manager', 'attendance/manual', {
      userId: 'keeper',
      kind: 'MANUAL_IN',
      locationId: MAIN,
      idempotencyKey: randomUUID(),
    }).expect(201);
    await db.user.update({ where: { id: 'papa' }, data: { whatsappAlerts: true } });
    const day = istToday();
    await attendance.nightly(new Date(`${day}T22:59:00+05:30`));
    expect(await db.proofAnchor.count({ where: { day } })).toBe(0);
    await db.proofAnchor.deleteMany({});
    const late = new Date(`${day}T23:01:00+05:30`);
    await attendance.nightly(late);
    await attendance.nightly(late);
    expect(await db.proofAnchor.count({ where: { day } })).toBe(1);
    const told = await db.notification.findMany({
      where: { dedupeKey: { startsWith: `night:${day}:` } },
    });
    expect(new Set(told.map((row) => row.userId))).toEqual(new Set(['papa', 'chacha']));
    const messages = await db.outboundMessage.findMany({
      where: {
        template: 'shiv_night_summary',
        dedupeKey: { startsWith: `night-whatsapp:${day}:` },
      },
    });
    expect(messages.map((row) => row.userId)).toEqual(['papa']);
  });
  it('a night the server was down gets its code on the next run', async () => {
    const day = istToday();
    const yesterday = istToday(new Date(Date.now() - 86400000));
    await attendance.nightly(new Date(`${day}T10:00:00+05:30`));
    expect(await db.proofAnchor.count({ where: { day: yesterday } })).toBe(1);
    expect(await db.proofAnchor.count({ where: { day } })).toBe(0);
  });
  it('a broken record tells the owners that same night', async () => {
    await adminPost('manager', 'attendance/manual', {
      userId: 'keeper',
      kind: 'MANUAL_IN',
      locationId: MAIN,
      idempotencyKey: randomUUID(),
    }).expect(201);
    await db.$executeRawUnsafe(
      'ALTER TABLE "AttendanceEvent" DISABLE TRIGGER attendance_event_append_only',
    );
    await db.attendanceEvent.updateMany({ data: { reason: 'tampered' } });
    await db.$executeRawUnsafe(
      'ALTER TABLE "AttendanceEvent" ENABLE TRIGGER attendance_event_append_only',
    );
    await attendance.nightly(new Date(`${istToday()}T23:30:00+05:30`));
    expect(await db.notification.count({ where: { dedupeKey: { startsWith: 'chain:' } } })).toBe(2);
  });
  it('a screen gone quiet in shop hours is told to its manager and the owners, once an hour', async () => {
    const { screen } = await screenFor();
    // Measured from the noon below, so the test does not depend on the hour it runs at.
    const noon = new Date(`${istToday()}T12:00:00+05:30`);
    await db.shopScreen.update({
      where: { id: screen.id },
      data: { lastSeenAt: new Date(noon.getTime() - 3600000) },
    });
    await attendance.watchScreens(new Date(noon.getTime()));
    await attendance.watchScreens(new Date(noon.getTime()));
    const told = await db.notification.findMany({
      where: { dedupeKey: { startsWith: 'screen:' } },
    });
    expect(new Set(told.map((row) => row.userId))).toEqual(new Set(['papa', 'chacha', 'manager']));
    expect(told).toHaveLength(3);
    await db.notification.deleteMany({ where: { dedupeKey: { startsWith: 'screen:' } } });
    await attendance.watchScreens(new Date(`${istToday()}T22:00:00+05:30`));
    expect(await db.notification.count({ where: { dedupeKey: { startsWith: 'screen:' } } })).toBe(
      0,
    );
  });
  it('tonight’s summary names a moved position and a code shown by hand', async () => {
    const keeper = await linked('keeper');
    await request(server)
      .patch(`/api/v1/admin/locations/${MAIN}/hazri`)
      .set(desk('manager'))
      .send({ lat: 25.61, lng: 85.11 })
      .expect(200);
    const { body: shown } = await adminGet('manager', `screens/here/${MAIN}`).expect(200);
    await punch(keeper, signedPunch(keeper.phone, shown.qr, { lat: 25.61, lng: 85.11 })).expect(
      201,
    );
    const { body } = await adminGet('papa', 'attendance/summary').expect(200);
    await linked('keeperb');
    const phonesFor = async (who: string) =>
      (await adminGet(who, 'attendance/summary').expect(200)).body.phonesAsked;
    // The owner hears of every shop's new phones; a manager only of their own shop's.
    expect(await phonesFor('papa')).toBeGreaterThan(await phonesFor('manager'));
    expect(body.setupChanges).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          event: 'SHOP_HAZRI_CHANGED',
          by: 'manager',
          positionChanged: true,
        }),
      ]),
    );
    expect(body.scansOnManagerCode).toEqual([{ name: 'keeper', codeOf: 'manager' }]);
  });
  it('the summary names hand marks and corrections, by whom', async () => {
    await adminPost('manager', 'attendance/manual', {
      userId: 'keeper',
      kind: 'MANUAL_IN',
      locationId: MAIN,
      idempotencyKey: randomUUID(),
    }).expect(201);
    await adminPost('manager', 'attendance/corrections', {
      userId: 'keeper',
      day: istToday(),
      corrects: 'IN',
      minute: 540,
      reason: 'Galat time',
      idempotencyKey: randomUUID(),
    }).expect(201);
    const { body } = await adminGet('papa', 'attendance/summary').expect(200);
    expect(body.byHand).toEqual([expect.objectContaining({ name: 'keeper', by: 'manager' })]);
    expect(body.corrections).toEqual([
      expect.objectContaining({ name: 'keeper', by: 'manager', reason: 'Galat time' }),
    ]);
    expect(body.shops.find((shop: { id: string }) => shop.id === MAIN).present).toBe(1);
    await adminGet('keeper', 'attendance/summary').expect(403);
  });
  it('old positions are erased, and the record stays', async () => {
    const keeper = await linked('keeper');
    const { screen } = await screenFor();
    await punch(keeper, signedPunch(keeper.phone, liveQr(screen), FAR)).expect(201);
    await db.attendanceGeo.updateMany({ data: { retainUntil: new Date(Date.now() - 1000) } });
    await attendance.housekeeping();
    const [geo] = await db.attendanceGeo.findMany();
    expect(geo).toMatchObject({ geoEnc: null, erasedAt: expect.any(Date) });
    expect(await db.attendanceEvent.count({ where: { userId: 'keeper' } })).toBe(1);
  });
});

void punchMessage;
