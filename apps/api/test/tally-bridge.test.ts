import 'reflect-metadata';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { existsSync } from 'node:fs';
import type { Server } from 'node:http';
import { generateKeyPairSync } from 'node:crypto';
import { loadEnvFile } from 'node:process';
import { gzipSync } from 'node:zlib';
import type { INestApplication } from '@nestjs/common';
import { bridgePairMessage, dayShift, istToday, PERMISSIONS_VERSION } from '@shiv/shared';
import request from 'supertest';
import { Db } from '../src/db';
import { TallyDesk } from '../src/tally/desk';
import { TallyIngest } from '../src/tally/ingest';
import { addPerson, tokenFor } from './staff-helper';
import {
  beat,
  clearTally,
  companyRow,
  licenceRow,
  makePc,
  pairBody,
  rows,
  sha,
  signed,
  smallAnswer,
  utf16gz,
  type Pc,
} from './tally-helper';

if (existsSync('.env.test')) loadEnvFile('.env.test');
process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
process.env.OTP_PROVIDER = 'mock';
process.env.OTP_HASH_SECRET = 'tally-bridge-test-only-secret-not-for-production';
process.env.CORS_ORIGINS = 'http://localhost:3000';
if (!process.env.DATABASE_URL || !new URL(process.env.DATABASE_URL).pathname.endsWith('_test'))
  throw new Error('These tests require a dedicated TEST_DATABASE_URL ending in _test.');

let app: INestApplication;
let server: Server;
let db: Db;
let ingest: TallyIngest;
let desk: TallyDesk;

const as = (id: string) => ({ Authorization: `Bearer ${tokenFor(id)}` });
const adminPost = (who: string, path: string, body: object = {}) =>
  request(server).post(`/api/v1/admin/tally/${path}`).set(as(who)).send(body);
const adminGet = (who: string, path: string) =>
  request(server).get(`/api/v1/admin/tally/${path}`).set(as(who));
const code = async (name = 'Dukaan 1') =>
  (await adminPost('owner', 'devices/pair', { name }).expect(201)).body.code as string;
const paired = async (name = 'Dukaan 1'): Promise<Pc> => {
  const pc = makePc();
  const { body } = await request(server)
    .post('/api/v1/bridge/pair')
    .send(pairBody(pc, await code(name)))
    .expect(201);
  pc.id = body.deviceId;
  return pc;
};
const hb = (pc: Pc, body: object = beat()) =>
  signed(server, pc, 'post', '/api/v1/bridge/heartbeat', body);
/** A PC that has seen its company, with an owner having said it is the books. */
async function live(pc?: Pc) {
  const device = pc ?? (await paired());
  await hb(device).expect(201);
  const company = await db.tallyCompany.findFirstOrThrow({ where: { guid: 'co-guid-0001' } });
  await adminPost('owner', `companies/${company.id}`, { role: 'PRIMARY' }).expect(201);
  return { pc: device, companyId: company.id };
}

const put = (pc: Pc, jobId: string, seq: number, bytes: Buffer) =>
  signed(server, pc, 'put', `/api/v1/bridge/jobs/${jobId}/chunks/${seq}`, bytes);
const finish = (pc: Pc, jobId: string, body: object) =>
  signed(server, pc, 'post', `/api/v1/bridge/jobs/${jobId}/finish`, body);
const marks = (altVch = '0', altMst = '10', lastDate = '') =>
  smallAnswer(rows([companyRow('co-guid-0001', 'Bench Traders', altMst, altVch, lastDate)]));
const count = (n: number) => smallAnswer(rows([[String(n)]]));

/** Answers a job by hand: one answer per read, in one part each, so a test can lie in any of them. */
async function answer(
  pc: Pc,
  job: { id: string; reads: { count?: boolean }[] },
  answers: (string | Buffer)[],
  counts?: number[],
  marksAfter = marks(),
) {
  const reads = [];
  for (const [index, text] of answers.entries()) {
    const bytes = Buffer.isBuffer(text) ? text : utf16gz(text);
    await put(pc, job.id, index, bytes).expect(200);
    reads.push({
      index,
      parts: [{ seq: index, sha256: sha(bytes) }],
      bytes: bytes.length,
      tookMs: 10,
      readAt: Date.now(),
      ...(job.reads[index]?.count
        ? { counts: [count(counts?.[index] ?? 0), count(counts?.[index] ?? 0)] }
        : {}),
    });
  }
  return finish(pc, job.id, { reads, marksAfter });
}
const partyRow = (guid: string, name: string, closing: string, opening = '0.00', mobile = '') => [
  guid,
  guid,
  '1',
  name,
  'Sundry Debtors',
  mobile,
  '',
  '',
  'Yes',
  opening,
  closing,
];
const typeRows = [
  ['vt1', 'Sales', 'Sales'],
  ['vt2', 'Receipt', 'Receipt'],
  ['vt3', 'Payroll', 'Payroll'],
  ['vt4', 'GST Sale', 'Sales'],
];
/** Masters for a company with two debtors, and on through its baseline to the backfill. */
async function pastMasters(pc: Pc, companyId: string, closing = '-1000.00') {
  const first = (await hb(pc).expect(201)).body.job;
  expect(first.kind).toBe('MASTERS');
  const parties = [
    partyRow('led-a', 'Asha Traders', closing),
    partyRow('led-b', 'राम सीमेंट', '0.00'),
  ];
  await answer(
    pc,
    first,
    [
      rows([['g1', '1', 'Sundry Debtors', 'Assets']]),
      rows(parties),
      '<ENVELOPE></ENVELOPE>',
      rows(typeRows),
      '<ENVELOPE></ENVELOPE>',
      '<ENVELOPE></ENVELOPE>',
    ],
    [1, 2, 0, 4, 0, 0],
  ).then((res) => expect(res.status).toBe(201));
  await ingest.runDue();
  const baseline = (await hb(pc).expect(201)).body.job;
  expect(baseline.kind).toBe('BASELINE');
  await answer(
    pc,
    baseline,
    [
      rows([partyRow('led-a', 'Asha Traders', '0.00'), partyRow('led-b', 'राम सीमेंट', '0.00')]),
      '<ENVELOPE></ENVELOPE>',
    ],
    [2, 0],
  );
  await ingest.runDue();
  expect((await db.tallyCompany.findUniqueOrThrow({ where: { id: companyId } })).phase).toBe(
    'BACKFILL',
  );
  // One window for the whole year keeps these tests short. Windows have a test of their own.
  await db.tallyCompany.update({ where: { id: companyId }, data: { backfillWindowDays: 400 } });
}
const today = istToday();
const vRow = (
  guid: string,
  alterId: string,
  date = today,
  type = 'Sales',
  party = 'Asha Traders',
  extra: Partial<Record<'reference' | 'narration' | 'optional' | 'cancelled', string>> = {},
) => [
  guid,
  guid,
  alterId,
  date,
  type,
  '1',
  party,
  extra.reference ?? '',
  extra.narration ?? '',
  extra.optional ?? 'No',
  extra.cancelled ?? 'No',
];
const saleLines = (guid: string, amount = '1000.00', party = 'Asha Traders') => [
  [guid, party, `-${amount}`],
  [guid, 'Sales Account', amount],
];
const statusOf = async (jobId: string) =>
  db.tallySyncJob.findUniqueOrThrow({ where: { id: jobId } });

beforeAll(async () => {
  const { createApp } = await import('../src/app');
  app = await createApp();
  await app.listen(0, '127.0.0.1');
  server = app.getHttpServer();
  db = app.get(Db);
  ingest = app.get(TallyIngest);
  desk = app.get(TallyDesk);
}, 30000);
beforeEach(async () => {
  await clearTally(db);
  await db.$executeRawUnsafe(
    'TRUNCATE TABLE "User", "AuditLog", "AuthRateLimit", "OtpChallenge", "Notification" RESTART IDENTITY CASCADE',
  );
  let phone = 9000006000;
  for (const [id, role, shops] of [
    ['owner', 'OWNER', undefined],
    ['manager', 'MANAGER', ['loc_main']],
    ['cashier', 'CASHIER', ['loc_main']],
    ['accountant', 'ACCOUNTANT', undefined],
    ['keeper', 'STOCK_KEEPER', ['loc_main']],
    ['driver', 'DRIVER', ['loc_main']],
    ['helper', 'HELPER', ['loc_main']],
    ['tech', 'TECH_OPERATOR', undefined],
  ] as const)
    await addPerson(db, {
      id,
      role,
      phone: `+91${++phone}`,
      ...(shops ? { shops: [...shops] } : {}),
    });
  await addPerson(db, { id: 'customer', phone: `+91${++phone}` });
});
afterAll(async () => {
  await app?.close();
});

describe('the rules changed with care', () => {
  it('the permission table’s version moved, and new audit rows carry it', async () => {
    expect(PERMISSIONS_VERSION).toBeGreaterThanOrEqual(7);
    await code();
    const row = await db.auditLog.findFirstOrThrow({ where: { event: 'TALLY_PAIR_CODE_MADE' } });
    expect(row.permissionsVersion).toBe(PERMISSIONS_VERSION);
  });
});

describe('connecting a PC', () => {
  it.each(['owner', 'tech'])('%s can make a code', async (who) => {
    const { body } = await adminPost(who, 'devices/pair', { name: 'Dukaan 1' }).expect(201);
    expect(body.code).toMatch(/^\d{8}$/);
    expect(new Date(body.expiresAt).getTime()).toBeLessThanOrEqual(Date.now() + 15 * 60000);
  });
  it.each(['manager', 'cashier', 'accountant', 'keeper', 'driver', 'helper', 'customer'])(
    '%s cannot',
    async (who) => {
      await adminPost(who, 'devices/pair', { name: 'x' }).expect(403);
    },
  );
  it('a made-up shop is refused, and a name loses any hidden characters', async () => {
    await adminPost('owner', 'devices/pair', { name: 'x', locationId: 'no-such-shop' }).expect(400);
    await adminPost('owner', 'devices/pair', { name: 'Du\u202Ekaan\u0007 1' }).expect(201);
    expect((await db.tallyPairingCode.findFirstOrThrow()).name).toBe('Dukaan 1');
  });
  it('nobody signed in cannot', async () => {
    await request(server).post('/api/v1/admin/tally/devices/pair').send({ name: 'x' }).expect(401);
  });
  it('a code is kept only as a hash', async () => {
    const made = await code();
    const stored = await db.tallyPairingCode.findFirstOrThrow();
    expect(stored.hash).not.toContain(made);
    expect(stored.hash).toMatch(/^[a-f0-9]{64}$/);
  });
  it('the code works once and only once', async () => {
    const made = await code();
    const first = makePc();
    const { body } = await request(server)
      .post('/api/v1/bridge/pair')
      .send(pairBody(first, made))
      .expect(201);
    expect(body.deviceId).toBeTruthy();
    const second = makePc();
    const again = await request(server)
      .post('/api/v1/bridge/pair')
      .send(pairBody(second, made))
      .expect(400);
    expect(again.body.error.code).toBe('BRIDGE_BAD_CODE');
    expect(await db.tallyDevice.count()).toBe(1);
  });
  it('two PCs racing for one code: exactly one gets in', async () => {
    const made = await code();
    const results = await Promise.all(
      [makePc(), makePc(), makePc(), makePc()].map((pc) =>
        request(server).post('/api/v1/bridge/pair').send(pairBody(pc, made)),
      ),
    );
    expect(results.filter((res) => res.status === 201)).toHaveLength(1);
    expect(await db.tallyDevice.count()).toBe(1);
  });
  it('a code past 15 minutes is refused', async () => {
    const made = await code();
    await db.tallyPairingCode.updateMany({ data: { expiresAt: new Date(Date.now() - 1000) } });
    const { body } = await request(server)
      .post('/api/v1/bridge/pair')
      .send(pairBody(makePc(), made))
      .expect(400);
    expect(body.error.code).toBe('BRIDGE_BAD_CODE');
  });
  it('a wrong code is refused, and tells nothing', async () => {
    await code();
    const { body } = await request(server)
      .post('/api/v1/bridge/pair')
      .send(pairBody(makePc(), '00000000'))
      .expect(400);
    expect(body.error.code).toBe('BRIDGE_BAD_CODE');
  });
  it('guessing runs out quickly', async () => {
    let last = 0;
    for (let i = 0; i < 32; i++)
      last = (
        await request(server)
          .post('/api/v1/bridge/pair')
          .send(pairBody(makePc(), String(i).padStart(8, '0')))
      ).status;
    expect(last).toBe(429);
  });
  it('someone naming a key they do not hold is refused', async () => {
    const made = await code();
    const thief = makePc();
    const victim = makePc();
    const { body } = await request(server)
      .post('/api/v1/bridge/pair')
      .send({
        code: made,
        publicKey: victim.publicKey,
        proof: thief.sign(bridgePairMessage(made, victim.publicKey)),
      })
      .expect(400);
    expect(body.error.code).toBe('BRIDGE_BAD_SIGNATURE');
  });
  it('a key that is not Ed25519, or not a key, is refused', async () => {
    const made = await code();
    const { publicKey, privateKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
    const key = publicKey.export({ format: 'der', type: 'spki' }).toString('base64');
    const { sign } = await import('node:crypto');
    await request(server)
      .post('/api/v1/bridge/pair')
      .send({
        code: made,
        publicKey: key,
        proof: sign('sha256', Buffer.from(bridgePairMessage(made, key)), privateKey).toString(
          'base64',
        ),
      })
      .expect(400);
    await request(server)
      .post('/api/v1/bridge/pair')
      .send({
        code: made,
        publicKey: Buffer.from('not a key at all at all at all at all at').toString('base64'),
        proof: 'A'.repeat(88),
      })
      .expect(400);
  });
  it('the same key cannot register twice', async () => {
    const pc = makePc();
    await request(server)
      .post('/api/v1/bridge/pair')
      .send(pairBody(pc, await code()))
      .expect(201);
    const { body } = await request(server)
      .post('/api/v1/bridge/pair')
      .send(pairBody(pc, await code('Another')))
      .expect(409);
    expect(body.error.code).toBe('BRIDGE_KEY_TAKEN');
  });
  it('a body too big for a pairing is refused', async () => {
    const { status } = await request(server)
      .post('/api/v1/bridge/pair')
      .send({ code: '12345678', publicKey: 'A'.repeat(20000), proof: 'A' });
    expect(status).toBe(413);
  });
  it('a stranger cannot make the server read a large body on the open routes', async () => {
    const big = Buffer.alloc(1024 * 1024, 0x41);
    // Refused before it is all read, so the line may close while the rest is still being written.
    const pairing = await request(server)
      .post('/api/v1/bridge/pair')
      .set('Content-Type', 'text/plain')
      .send(big.toString())
      .catch((error: NodeJS.ErrnoException) => {
        expect(['ECONNRESET', 'EPIPE']).toContain(error.code);
        return null;
      });
    if (pairing) {
      expect(pairing.status).toBe(400);
      expect(pairing.body.error.code).toBe('INVALID_INPUT');
    }
    expect(await db.tallyDevice.count()).toBe(0);
  });
  it('a version or computer name with odd characters gets nowhere, or is cleaned', async () => {
    const pc = makePc();
    await request(server)
      .post('/api/v1/bridge/pair')
      .send({ ...pairBody(pc, await code()), version: '<script>' })
      .expect(400);
    const { body } = await request(server)
      .post('/api/v1/bridge/pair')
      .send({ ...pairBody(pc, await code()), os: 'Win\u202Edows\u0000 11' })
      .expect(201);
    expect((await db.tallyDevice.findUniqueOrThrow({ where: { id: body.deviceId } })).os).toBe(
      'Windows 11',
    );
  });
  it('anyone may read the time, and only the time', async () => {
    const { body } = await request(server).get('/api/v1/bridge/time').expect(200);
    expect(Object.keys(body)).toEqual(['serverNow']);
  });
});

describe('every call must prove itself', () => {
  let pc: Pc;
  beforeEach(async () => {
    pc = await paired();
  });
  it('a good call works, and carries the server’s own time back', async () => {
    const res = await hb(pc).expect(201);
    expect(res.headers['x-bridge-server-time']).toBeTruthy();
    expect(res.body.serverNow).toBeTruthy();
  });
  it.each([
    'X-Bridge-Device',
    'X-Bridge-Time',
    'X-Bridge-Seq',
    'X-Bridge-Signature',
    'X-Bridge-Body-Sha256',
  ])('no %s: refused', async (name) => {
    const { body } = await signed(server, pc, 'post', '/api/v1/bridge/heartbeat', beat(), {
      drop: [name],
    }).expect(401);
    expect(body.error.code).toBe('BRIDGE_UNSIGNED');
  });
  it('no headers at all: refused, as is every route', async () => {
    for (const [method, path] of [
      ['post', '/api/v1/bridge/heartbeat'],
      ['put', '/api/v1/bridge/jobs/x/chunks/0'],
      ['post', '/api/v1/bridge/jobs/x/finish'],
      ['get', '/api/v1/bridge/releases/1.0.0'],
    ] as const)
      await request(server)[method](path).expect(401);
  });
  it('signed by another key: refused', async () => {
    const { body } = await signed(server, pc, 'post', '/api/v1/bridge/heartbeat', beat(), {
      signAs: makePc(),
    }).expect(401);
    expect(body.error.code).toBe('BRIDGE_BAD_SIGNATURE');
  });
  it('a device that does not exist looks the same as a bad signature', async () => {
    const { body } = await signed(server, pc, 'post', '/api/v1/bridge/heartbeat', beat(), {
      device: 'cnosuchdevice',
    }).expect(401);
    expect(body.error.code).toBe('BRIDGE_BAD_SIGNATURE');
  });
  it('a body changed in flight: refused, and its number is not used up', async () => {
    const res = await signed(
      server,
      pc,
      'post',
      '/api/v1/bridge/heartbeat',
      { ...beat(), state: 'BUSY' },
      { signBody: Buffer.from('other') },
    ).expect(400);
    expect(res.body.error.code).toBe('BRIDGE_BAD_BODY');
    await hb(pc).expect(201);
  });
  it('a signature cannot be moved to another path', async () => {
    const { body } = await signed(server, pc, 'post', '/api/v1/bridge/jobs/x/finish', beat(), {
      signPath: '/api/v1/bridge/heartbeat',
    }).expect(401);
    expect(body.error.code).toBe('BRIDGE_BAD_SIGNATURE');
  });
  it('a captured request cannot run twice', async () => {
    const seq = String(++pc.seq);
    const time = String(Date.now());
    await signed(server, pc, 'post', '/api/v1/bridge/heartbeat', beat(), { seq, time }).expect(201);
    const { body } = await signed(server, pc, 'post', '/api/v1/bridge/heartbeat', beat(), {
      seq,
      time,
    }).expect(409);
    expect(body.error.code).toBe('BRIDGE_REPLAY');
    expect(body.error.details.lastSeq).toBe(seq);
  });
  it('sent twice at once, only one runs', async () => {
    const seq = String(++pc.seq);
    const time = String(Date.now());
    const results = await Promise.all(
      Array.from({ length: 6 }, () =>
        signed(server, pc, 'post', '/api/v1/bridge/heartbeat', beat(), { seq, time }),
      ),
    );
    expect(results.filter((res) => res.status === 201)).toHaveLength(1);
    expect(results.filter((res) => res.status === 409)).toHaveLength(5);
  });
  it('an older number is refused too, and the reply lets a real PC correct itself', async () => {
    await hb(pc).expect(201);
    const { body } = await signed(server, pc, 'post', '/api/v1/bridge/heartbeat', beat(), {
      seq: '5',
    }).expect(409);
    expect(BigInt(body.error.details.lastSeq)).toBeGreaterThan(5n);
  });
  it('a stale request is refused, and the reply says what time it really is', async () => {
    const res = await signed(server, pc, 'post', '/api/v1/bridge/heartbeat', beat(), {
      time: String(Date.now() - 16 * 60000),
    }).expect(401);
    expect(res.body.error.code).toBe('BRIDGE_CLOCK');
    expect(res.headers['x-bridge-server-time']).toBeTruthy();
    expect(res.body.error.serverNow).toBeTruthy();
  });
  it('a request from the far future is refused the same way', async () => {
    const { body } = await signed(server, pc, 'post', '/api/v1/bridge/heartbeat', beat(), {
      time: String(Date.now() + 16 * 60000),
    }).expect(401);
    expect(body.error.code).toBe('BRIDGE_CLOCK');
  });
  it('a clock a little off is fine: the PC’s clock is never the point', async () => {
    await signed(server, pc, 'post', '/api/v1/bridge/heartbeat', beat(), {
      time: String(Date.now() - 14 * 60000),
    }).expect(201);
  });
  it('an old program is told so', async () => {
    const { body } = await signed(server, pc, 'post', '/api/v1/bridge/heartbeat', beat(), {
      protocol: '0',
    }).expect(400);
    expect(body.error.code).toBe('BRIDGE_OLD_PROTOCOL');
  });
  it('malformed values are refused, not parsed', async () => {
    await request(server)
      .post('/api/v1/bridge/heartbeat')
      .set({
        'X-Bridge-Protocol': '1',
        'X-Bridge-Device': "'; DROP TABLE x; --",
        'X-Bridge-Time': 'yesterday',
        'X-Bridge-Seq': '-1',
        'X-Bridge-Body-Sha256': 'zz',
        'X-Bridge-Signature': '!!',
      })
      .expect(401);
  });
  it('a PC’s key opens nothing but the bridge', async () => {
    for (const path of [
      '/api/v1/admin/tally/status',
      '/api/v1/admin/customers',
      '/api/v1/admin/orders',
      '/api/v1/me',
    ])
      await signed(server, pc, 'get', path).expect(401);
  });
  it('a person’s login opens nothing on the bridge', async () => {
    await request(server)
      .post('/api/v1/bridge/heartbeat')
      .set(as('owner'))
      .send(beat())
      .expect(401);
  });
});

describe('a stolen or revoked PC', () => {
  it.each(['owner', 'tech'])('%s can cut it off, and the same key stops at once', async (who) => {
    const pc = await paired();
    await hb(pc).expect(201);
    await adminPost(who, `devices/${pc.id}/revoke`).expect(201);
    const { body } = await hb(pc).expect(401);
    expect(body.error.code).toBe('BRIDGE_REVOKED');
    const log = await db.auditLog.findFirstOrThrow({ where: { event: 'TALLY_DEVICE_REVOKED' } });
    expect(log.actorId).toBe(who);
  });
  it.each(['manager', 'cashier', 'accountant', 'keeper', 'driver', 'helper', 'customer'])(
    '%s cannot cut it off',
    async (who) => {
      const pc = await paired();
      await adminPost(who, `devices/${pc.id}/revoke`).expect(403);
      await hb(pc).expect(201);
    },
  );
  it('its open job closes, and what it uploads next goes nowhere', async () => {
    const { pc, companyId } = await live();
    const job = (await hb(pc).expect(201)).body.job;
    await adminPost('owner', `devices/${pc.id}/revoke`).expect(201);
    const { body } = await put(pc, job.id, 0, utf16gz('<ENVELOPE></ENVELOPE>')).expect(401);
    expect(body.error.code).toBe('BRIDGE_REVOKED');
    expect((await statusOf(job.id)).status).toBe('EXPIRED');
    expect(await db.tallyChunk.count()).toBe(0);
    expect(companyId).toBeTruthy();
  });
  it('what it uploaded just before being cut off is not read', async () => {
    const { pc } = await live();
    const job = (await hb(pc).expect(201)).body.job;
    const parties = rows([partyRow('led-a', 'Planted Party', '-99999.00')]);
    await answer(
      pc,
      job,
      [
        '<ENVELOPE></ENVELOPE>',
        parties,
        '<ENVELOPE></ENVELOPE>',
        rows(typeRows),
        '<ENVELOPE></ENVELOPE>',
        '<ENVELOPE></ENVELOPE>',
      ],
      [0, 1, 0, 4, 0, 0],
    );
    await adminPost('owner', `devices/${pc.id}/revoke`).expect(201);
    await ingest.runDue();
    expect((await statusOf(job.id)).status).toBe('EXPIRED');
    expect(await db.tallyLedger.count()).toBe(0);
  });
  it('even if the worker had already picked it up', async () => {
    const { pc } = await live();
    const job = (await hb(pc).expect(201)).body.job;
    await answer(
      pc,
      job,
      job.reads.map(() => '<ENVELOPE></ENVELOPE>'),
      [0, 0, 0, 0, 0, 0],
    );
    await db.tallyDevice.update({ where: { id: pc.id }, data: { revokedAt: new Date() } });
    await ingest.runDue();
    expect(await statusOf(job.id)).toMatchObject({ status: 'FAILED', error: 'DEVICE_REVOKED' });
  });
  it('a stranger learns nothing from a revoked PC’s id', async () => {
    const pc = await paired();
    await adminPost('owner', `devices/${pc.id}/revoke`).expect(201);
    const { body } = await signed(server, pc, 'post', '/api/v1/bridge/heartbeat', beat(), {
      signAs: makePc(),
    }).expect(401);
    expect(body.error.code).toBe('BRIDGE_BAD_SIGNATURE');
  });
  it('a PC revoked twice is simply revoked', async () => {
    const pc = await paired();
    await adminPost('owner', `devices/${pc.id}/revoke`).expect(201);
    const { body } = await adminPost('owner', `devices/${pc.id}/revoke`).expect(201);
    expect(body.already).toBe(true);
    await adminPost('owner', 'devices/nope/revoke').expect(404);
  });
});

describe('what a heartbeat says', () => {
  it('records who is alive, its version and its state', async () => {
    const pc = await paired();
    await hb(pc).expect(201);
    const device = await db.tallyDevice.findUniqueOrThrow({ where: { id: pc.id } });
    expect(device).toMatchObject({ state: 'OK', version: '1.0.0', os: 'Test Windows x64' });
    expect(device.lastHeartbeatAt).toBeTruthy();
    expect(device.lastGoodAt).toBeTruthy();
    expect((device.caps as { licence: { release: string } }).licence.release).toBe(
      'TallyPrime 7.1',
    );
  });
  it('a body it cannot read is refused, and changes nothing', async () => {
    const pc = await paired();
    await signed(server, pc, 'post', '/api/v1/bridge/heartbeat', Buffer.from('{not json')).expect(
      400,
    );
    await signed(server, pc, 'post', '/api/v1/bridge/heartbeat', { state: 'MADE_UP' }).expect(400);
    const device = await db.tallyDevice.findUniqueOrThrow({ where: { id: pc.id } });
    expect(device.lastHeartbeatAt).toBeNull();
  });
  it('a body far too big is refused without a look', async () => {
    const pc = await paired();
    const { body } = await signed(
      server,
      pc,
      'post',
      '/api/v1/bridge/heartbeat',
      Buffer.alloc(600 * 1024, 0x20),
    ).expect(413);
    expect(body.error.code).toBe('UPLOAD_TOO_LARGE');
  });
  it.each([['TALLY_CLOSED'], ['PORT_OFF'], ['BUSY']])(
    '%s is passed on, with no job',
    async (state) => {
      const pc = await paired();
      const { body } = await hb(pc, { state }).expect(201);
      expect(body.job).toBeNull();
      expect((await db.tallyDevice.findUniqueOrThrow({ where: { id: pc.id } })).state).toBe(state);
    },
  );
  it('no company open: says so, and asks for nothing', async () => {
    const pc = await paired();
    const { body } = await hb(pc, beat([])).expect(201);
    expect(body.job).toBeNull();
    expect((await db.tallyDevice.findUniqueOrThrow({ where: { id: pc.id } })).state).toBe(
      'NO_COMPANY',
    );
  });
  it('educational mode shows at once, and stays shown between licence reads', async () => {
    const pc = await paired();
    await hb(pc, beat([companyRow()], licenceRow('Yes'))).expect(201);
    expect((await db.tallyDevice.findUniqueOrThrow({ where: { id: pc.id } })).state).toBe(
      'EDUCATIONAL',
    );
    const marksOnly = beat();
    delete (marksOnly.probe as { licence?: string }).licence;
    await hb(pc, marksOnly).expect(201);
    const device = await db.tallyDevice.findUniqueOrThrow({ where: { id: pc.id } });
    expect(device.state).toBe('EDUCATIONAL');
    expect((device.caps as { licence: { release: string } }).licence.release).toBe(
      'TallyPrime 7.1',
    );
    await hb(pc).expect(201);
    expect((await db.tallyDevice.findUniqueOrThrow({ where: { id: pc.id } })).state).toBe('OK');
  });
  it('garbled answers in a heartbeat are its own state, and do no harm', async () => {
    const pc = await paired();
    const { body } = await hb(pc, {
      ...beat(),
      probe: { companies: smallAnswer('<ENVELOPE><F01>half') },
    }).expect(201);
    expect(body.job).toBeNull();
    expect((await db.tallyDevice.findUniqueOrThrow({ where: { id: pc.id } })).state).toBe(
      'BAD_ANSWER',
    );
    expect(await db.tallyCompany.count()).toBe(0);
  });
  it('an XML bomb in a heartbeat does no harm', async () => {
    const pc = await paired();
    await hb(pc, {
      ...beat(),
      probe: {
        companies: smallAnswer('<!DOCTYPE x [<!ENTITY a "b">]><ENVELOPE><F01>&a;</F01></ENVELOPE>'),
      },
    }).expect(201);
    expect((await db.tallyDevice.findUniqueOrThrow({ where: { id: pc.id } })).state).toBe(
      'BAD_ANSWER',
    );
  });
  it('a compression bomb in a heartbeat does no harm', async () => {
    const pc = await paired();
    const bomb = gzipSync(Buffer.alloc(3 * 1024 * 1024, 0x20)).toString('base64');
    await hb(pc, { ...beat(), probe: { companies: bomb } }).expect(201);
    expect((await db.tallyDevice.findUniqueOrThrow({ where: { id: pc.id } })).state).toBe(
      'BAD_ANSWER',
    );
  });
  it('a wake is noted', async () => {
    const pc = await paired();
    await hb(pc, { ...beat(), woke: true }).expect(201);
    expect(
      (await db.tallyDevice.findUniqueOrThrow({ where: { id: pc.id } })).lastWakeAt,
    ).toBeTruthy();
  });
});

describe('companies', () => {
  it('a new company waits for a person: nothing is copied until then', async () => {
    const pc = await paired();
    const { body } = await hb(pc).expect(201);
    expect(body.job).toBeNull();
    expect(body.companies).toEqual([{ guid: 'co-guid-0001', status: 'WAITING_FOR_PERSON' }]);
    const company = await db.tallyCompany.findFirstOrThrow();
    expect(company).toMatchObject({ role: 'PENDING', ownerDeviceId: pc.id });
    expect((await hb(pc).expect(201)).body.job).toBeNull();
  });
  it('once a person says it is the books, the first job is masters', async () => {
    const { pc, companyId } = await live();
    const { body } = await hb(pc).expect(201);
    expect(body.job.kind).toBe('MASTERS');
    expect(body.job.reads.map((read: { read: string }) => read.read)).toEqual([
      'groups',
      'parties',
      'parties',
      'voucherTypes',
      'stockItems',
      'godowns',
    ]);
    const company = await db.tallyCompany.findUniqueOrThrow({ where: { id: companyId } });
    expect(company.copyFrom).toBeTruthy();
  });
  it.each(['manager', 'cashier', 'accountant', 'keeper', 'driver', 'helper', 'customer'])(
    '%s cannot say so',
    async (who) => {
      const pc = await paired();
      await hb(pc).expect(201);
      const company = await db.tallyCompany.findFirstOrThrow();
      await adminPost(who, `companies/${company.id}`, { role: 'PRIMARY' }).expect(403);
      expect((await db.tallyCompany.findFirstOrThrow()).role).toBe('PENDING');
    },
  );
  it.each(['BRANCH_COPY', 'IGNORE'])('a company set to %s is left alone', async (role) => {
    const pc = await paired();
    await hb(pc).expect(201);
    const company = await db.tallyCompany.findFirstOrThrow();
    await adminPost('owner', `companies/${company.id}`, { role }).expect(201);
    expect((await hb(pc).expect(201)).body.job).toBeNull();
  });
  it('a PC claiming a company another PC owns gets no job, and nothing about it moves', async () => {
    const { pc } = await live();
    await hb(pc).expect(201);
    const before = await db.tallyCompany.findFirstOrThrow();
    const other = await paired('Dukaan 2');
    const { body } = await hb(
      other,
      beat([companyRow('co-guid-0001', 'Evil Rename', '999', '999')]),
    ).expect(201);
    expect(body.job).toBeNull();
    expect(body.companies).toEqual([{ guid: 'co-guid-0001', status: 'OWNED_ELSEWHERE' }]);
    const after = await db.tallyCompany.findFirstOrThrow();
    expect(after.name).toBe(before.name);
    expect(after.altVchId).toBe(before.altVchId);
    expect(after.ownerDeviceId).toBe(pc.id);
    expect(
      (
        (await db.tallyDevice.findUniqueOrThrow({ where: { id: other.id } })).caps as {
          claimedElsewhere: number;
        }
      ).claimedElsewhere,
    ).toBe(1);
  });
  it('there is no standby: the second PC stays out even when the first goes quiet', async () => {
    const { pc } = await live();
    await hb(pc).expect(201);
    await db.tallyDevice.update({
      where: { id: pc.id },
      data: { lastHeartbeatAt: new Date(Date.now() - 86400000) },
    });
    const other = await paired('Dukaan 2');
    const { body } = await hb(other).expect(201);
    expect(body.job).toBeNull();
    expect((await db.tallyCompany.findFirstOrThrow()).ownerDeviceId).toBe(pc.id);
  });
  it('an owner moves a company to another PC by hand', async () => {
    const { pc, companyId } = await live();
    const other = await paired('Dukaan 2');
    await hb(other).expect(201);
    await adminPost('owner', `companies/${companyId}`, { ownerDeviceId: other.id }).expect(201);
    expect((await hb(other).expect(201)).body.job.kind).toBe('MASTERS');
    expect((await hb(pc).expect(201)).body.job).toBeNull();
  });
  it('a company cannot be given to a revoked or made-up PC', async () => {
    const { companyId } = await live();
    const other = await paired('Dukaan 2');
    await adminPost('owner', `devices/${other.id}/revoke`).expect(201);
    await adminPost('owner', `companies/${companyId}`, { ownerDeviceId: other.id }).expect(400);
    await adminPost('owner', `companies/${companyId}`, { ownerDeviceId: 'nope' }).expect(400);
  });
  it('two companies on one PC are told apart', async () => {
    const pc = await paired();
    const { body } = await hb(pc, beat([companyRow(), companyRow('co-2', 'Bench Two')])).expect(
      201,
    );
    expect(body.companies).toHaveLength(2);
    expect(await db.tallyCompany.count()).toBe(2);
  });
  it('a company with an absurd name or id is left out', async () => {
    const pc = await paired();
    await hb(
      pc,
      beat([companyRow('a'.repeat(300), 'Bench'), companyRow('co-x', 'n'.repeat(300))]),
    ).expect(201);
    expect(await db.tallyCompany.count()).toBe(0);
  });
  it('a company back under a new id is flagged, and waits for a person', async () => {
    const { pc, companyId } = await live();
    await hb(pc, beat([companyRow('co-guid-restored', 'Bench Traders')])).expect(201);
    const twin = await db.tallyCompany.findUniqueOrThrow({ where: { guid: 'co-guid-restored' } });
    expect(twin).toMatchObject({ role: 'PENDING', sameNameAsId: companyId });
  });
  it('the old company then shows as missing from this PC', async () => {
    const { pc } = await live();
    await hb(pc, beat([companyRow('co-other', 'Another')])).expect(201);
    expect((await db.tallyDevice.findUniqueOrThrow({ where: { id: pc.id } })).state).toBe(
      'COMPANY_MISSING',
    );
  });
});

describe('uploading', () => {
  it('another PC’s job looks like no job at all', async () => {
    const { pc } = await live();
    const job = (await hb(pc).expect(201)).body.job;
    const other = await paired('Dukaan 2');
    const bytes = utf16gz('<ENVELOPE></ENVELOPE>');
    await put(other, job.id, 0, bytes).expect(404);
    await finish(other, job.id, { reads: [] }).expect(404);
    await finish(other, job.id, { error: 'BUSY' }).expect(404);
    expect((await statusOf(job.id)).status).toBe('LEASED');
  });
  it('parts may arrive in any order, and twice', async () => {
    const { pc } = await live();
    const job = (await hb(pc).expect(201)).body.job;
    const first = utf16gz('<ENVELOPE>');
    const second = utf16gz('</ENVELOPE>');
    await put(pc, job.id, 1, second).expect(200);
    await put(pc, job.id, 0, first).expect(200);
    const again = await put(pc, job.id, 0, first).expect(200);
    expect(again.body.duplicate).toBe(true);
    expect(await db.tallyChunk.count({ where: { jobId: job.id } })).toBe(2);
  });
  it('a different part under a number already used is refused', async () => {
    const { pc } = await live();
    const job = (await hb(pc).expect(201)).body.job;
    await put(pc, job.id, 0, utf16gz('<ENVELOPE>')).expect(200);
    const { body } = await put(pc, job.id, 0, utf16gz('<ENVELOPE>tampered')).expect(409);
    expect(body.error.code).toBe('BRIDGE_PART_CHANGED');
  });
  it('a part that is not gzip, is empty, or has a silly number is refused', async () => {
    const { pc } = await live();
    const job = (await hb(pc).expect(201)).body.job;
    await put(pc, job.id, 0, Buffer.from('plain text')).expect(400);
    await signed(server, pc, 'put', `/api/v1/bridge/jobs/${job.id}/chunks/0`).expect(400);
    await signed(
      server,
      pc,
      'put',
      `/api/v1/bridge/jobs/${job.id}/chunks/9999`,
      utf16gz('x'),
    ).expect(400);
    await signed(
      server,
      pc,
      'put',
      `/api/v1/bridge/jobs/${job.id}/chunks/abc`,
      utf16gz('x'),
    ).expect(400);
    await signed(server, pc, 'put', `/api/v1/bridge/jobs/${job.id}/chunks/-1`, utf16gz('x')).expect(
      400,
    );
    expect(await db.tallyChunk.count()).toBe(0);
  });
  it('a body over 5 MB is refused, signed or not, and an unsigned one is not even read', async () => {
    const { pc } = await live();
    const job = (await hb(pc).expect(201)).body.job;
    const big = Buffer.concat([Buffer.from([0x1f, 0x8b]), Buffer.alloc(6 * 1024 * 1024)]);
    const signedBig = await put(pc, job.id, 0, big);
    expect(signedBig.status).toBe(413);
    // The server answers and hangs up with the body still arriving, which a client may see as either.
    const unsigned = await request(server)
      .put(`/api/v1/bridge/jobs/${job.id}/chunks/0`)
      .set('Content-Type', 'application/gzip')
      .send(big)
      .then((res) => res.status)
      .catch((error: { code?: string }) => error.code);
    expect([401, 'ECONNRESET', 'EPIPE']).toContain(unsigned);
    expect(await db.tallyChunk.count()).toBe(0);
  });
  it('a stolen PC cannot fill the bucket', async () => {
    const { pc } = await live();
    const job = (await hb(pc).expect(201)).body.job;
    const { createHmac } = await import('node:crypto');
    const key = `budget:bridge:bytes:${createHmac('sha256', process.env.OTP_HASH_SECRET!).update(`bridge:bytes:${pc.id}`).digest('hex')}`;
    await db.authRateLimit.create({
      data: { key, count: 2 * 1024 * 1024, expiresAt: new Date(Date.now() + 3600000) },
    });
    const { body } = await put(pc, job.id, 0, utf16gz('<ENVELOPE></ENVELOPE>')).expect(429);
    expect(body.error.code).toBe('RESOURCE_LIMIT');
    expect(await db.tallyChunk.count()).toBe(0);
  });
  it('finishing with a part missing says which, and the job stays open', async () => {
    const { pc } = await live();
    const job = (await hb(pc).expect(201)).body.job;
    const bytes = utf16gz('<ENVELOPE></ENVELOPE>');
    await put(pc, job.id, 0, bytes).expect(200);
    const reads = job.reads.map((_: unknown, index: number) => ({
      index,
      parts: [{ seq: index, sha256: sha(bytes) }],
      bytes: 1,
      tookMs: 1,
      readAt: Date.now(),
    }));
    const { body } = await finish(pc, job.id, { reads, marksAfter: marks() }).expect(409);
    expect(body.error.code).toBe('BRIDGE_PARTS_MISSING');
    expect(body.error.details.missing).toEqual([1, 2, 3, 4, 5]);
    expect((await statusOf(job.id)).status).toBe('LEASED');
  });
  it('finishing with too few reads is refused', async () => {
    const { pc } = await live();
    const job = (await hb(pc).expect(201)).body.job;
    const { body } = await finish(pc, job.id, { reads: [], marksAfter: marks() }).expect(409);
    expect(body.error.code).toBe('BRIDGE_PARTS_MISSING');
  });
  it('finishing with the wrong hash for a part is refused', async () => {
    const { pc } = await live();
    const job = (await hb(pc).expect(201)).body.job;
    const bytes = utf16gz('<ENVELOPE></ENVELOPE>');
    const reads = [];
    for (const [index] of job.reads.entries()) {
      await put(pc, job.id, index, bytes).expect(200);
      reads.push({
        index,
        parts: [{ seq: index, sha256: 'a'.repeat(64) }],
        bytes: 1,
        tookMs: 1,
        readAt: Date.now(),
      });
    }
    await finish(pc, job.id, { reads }).expect(409);
  });
  it('finish twice is the same answer, and a part after finishing is refused', async () => {
    const { pc } = await live();
    const job = (await hb(pc).expect(201)).body.job;
    const answers = job.reads.map(() => '<ENVELOPE></ENVELOPE>');
    const done = await answer(pc, job, answers);
    expect(done.status).toBe(201);
    expect(done.body.status).toBe('UPLOADED');
    const again = await answer(pc, job, answers);
    expect(again.body).toMatchObject({ status: 'UPLOADED', repeat: true });
    const { body } = await put(pc, job.id, 40, utf16gz('x')).expect(409);
    expect(body.error.code).toBe('BRIDGE_JOB_CLOSED');
  });
  it('while the server reads, the PC gets nothing new', async () => {
    const { pc } = await live();
    const job = (await hb(pc).expect(201)).body.job;
    await answer(
      pc,
      job,
      job.reads.map(() => '<ENVELOPE></ENVELOPE>'),
    );
    expect((await hb(pc).expect(201)).body.job).toBeNull();
  });
  it('the same job is offered again until it is done, not a second one', async () => {
    const { pc } = await live();
    const first = (await hb(pc).expect(201)).body.job;
    const second = (await hb(pc).expect(201)).body.job;
    expect(second.id).toBe(first.id);
    expect(await db.tallySyncJob.count()).toBe(1);
  });
  it('a job left for hours is given up on, and its late upload goes nowhere', async () => {
    const { pc } = await live();
    const first = (await hb(pc).expect(201)).body.job;
    await db.tallySyncJob.update({
      where: { id: first.id },
      data: { createdAt: new Date(Date.now() - 7 * 3600000) },
    });
    const second = (await hb(pc).expect(201)).body.job;
    expect(second.id).not.toBe(first.id);
    await put(pc, first.id, 0, utf16gz('x')).expect(409);
  });
  it('a PC reporting a failed read counts against the company, and it waits before asking again', async () => {
    const { pc, companyId } = await live();
    const job = (await hb(pc).expect(201)).body.job;
    await finish(pc, job.id, { error: 'BUSY' }).expect(201);
    const company = await db.tallyCompany.findUniqueOrThrow({ where: { id: companyId } });
    expect(company).toMatchObject({ failures: 1, lastError: 'BUSY' });
    expect((await hb(pc).expect(201)).body.job).toBeNull();
    await db.tallyCompany.update({
      where: { id: companyId },
      data: { lastFailureAt: new Date(Date.now() - 120000) },
    });
    expect((await hb(pc).expect(201)).body.job.kind).toBe('MASTERS');
  });
  it('a report it does not recognise is refused', async () => {
    const { pc } = await live();
    const job = (await hb(pc).expect(201)).body.job;
    await finish(pc, job.id, { error: 'DROP TABLE' }).expect(400);
  });
});

describe('reading answers: nothing untrusted reaches the mirror', () => {
  const expectFailed = async (jobId: string, problem: string) => {
    await ingest.runDue();
    const job = await statusOf(jobId);
    expect(job.status).toBe('FAILED');
    expect(job.error).toBe(problem);
    expect(await db.tallyLedger.count()).toBe(0);
    expect((await db.tallyCompany.findFirstOrThrow()).wmMstId).toBe(0n);
  };
  const withFirst = async (first: string | Buffer) => {
    const { pc } = await live();
    const job = (await hb(pc).expect(201)).body.job;
    const answers = job.reads.map((_: unknown, index: number) =>
      index === 0 ? first : '<ENVELOPE></ENVELOPE>',
    );
    await answer(pc, job, answers, [0, 0, 0, 0, 0, 0]);
    return job.id as string;
  };
  it('an XML bomb', async () => {
    await expectFailed(
      await withFirst(
        '<!DOCTYPE x [<!ENTITY a "aaaa"><!ENTITY b "&a;&a;&a;&a;">]><ENVELOPE><F01>&b;</F01></ENVELOPE>',
      ),
      'XML_DTD_REFUSED',
    );
  });
  it('an external entity', async () => {
    await expectFailed(
      await withFirst(
        '<!DOCTYPE x [<!ENTITY a SYSTEM "file:///etc/passwd">]><ENVELOPE><F01>&a;</F01></ENVELOPE>',
      ),
      'XML_DTD_REFUSED',
    );
  });
  it('a compression bomb', async () => {
    await expectFailed(await withFirst(gzipSync(Buffer.alloc(70 * 1024 * 1024, 0x20))), 'TOO_BIG');
  }, 30000);
  it('a cut-off answer', async () => {
    await expectFailed(await withFirst('<ENVELOPE><F01>g1</F01>'), 'CUT_OFF');
  });
  it('garbled XML', async () => {
    await expectFailed(await withFirst('<ENVELOPE><F01>a<F02>b</F01>'), 'BAD_XML');
  });
  it('a part that unpacks to nothing readable', async () => {
    await expectFailed(await withFirst(gzipSync(Buffer.from([0, 1, 2, 3, 4, 5]))), 'NOT_ENVELOPE');
  });
  it('Tally saying the company is not open', async () => {
    await expectFailed(
      await withFirst(
        "<ENVELOPE><BODY><LINEERROR>Could not set 'SVCurrentCompany' to 'x'</LINEERROR></BODY></ENVELOPE>",
      ),
      'COMPANY_MISSING',
    );
  });
  it('a count that does not match what came back', async () => {
    const { pc } = await live();
    const job = (await hb(pc).expect(201)).body.job;
    const parties = rows([partyRow('led-a', 'A', '0.00')]);
    await answer(
      pc,
      job,
      [
        '<ENVELOPE></ENVELOPE>',
        parties,
        '<ENVELOPE></ENVELOPE>',
        rows(typeRows),
        '<ENVELOPE></ENVELOPE>',
        '<ENVELOPE></ENVELOPE>',
      ],
      [0, 5, 0, 4, 0, 0],
    );
    await expectFailed(job.id, 'COUNT_SHORT');
  });
  it('two counts that disagree', async () => {
    const { pc } = await live();
    const job = (await hb(pc).expect(201)).body.job;
    const bytes = utf16gz('<ENVELOPE></ENVELOPE>');
    const reads = [];
    for (const [index] of job.reads.entries()) {
      await put(pc, job.id, index, bytes).expect(200);
      reads.push({
        index,
        parts: [{ seq: index, sha256: sha(bytes) }],
        bytes: 1,
        tookMs: 1,
        readAt: Date.now(),
        counts: [count(1), count(2)],
      });
    }
    await finish(pc, job.id, { reads, marksAfter: marks() }).expect(201);
    await expectFailed(job.id, 'COUNT_UNSTABLE');
  });
  it('a count that is not a number', async () => {
    const { pc } = await live();
    const job = (await hb(pc).expect(201)).body.job;
    const bytes = utf16gz('<ENVELOPE></ENVELOPE>');
    const reads = [];
    const odd = smallAnswer(rows([['many']]));
    for (const [index] of job.reads.entries()) {
      await put(pc, job.id, index, bytes).expect(200);
      reads.push({
        index,
        parts: [{ seq: index, sha256: sha(bytes) }],
        bytes: 1,
        tookMs: 1,
        readAt: Date.now(),
        counts: [odd, odd],
      });
    }
    await finish(pc, job.id, { reads, marksAfter: marks() }).expect(201);
    await expectFailed(job.id, 'COUNT_MISSING');
  });
  it('an amount it cannot read exactly', async () => {
    const { pc } = await live();
    const job = (await hb(pc).expect(201)).body.job;
    await answer(
      pc,
      job,
      [
        '<ENVELOPE></ENVELOPE>',
        rows([partyRow('led-a', 'A', '12.345')]),
        '<ENVELOPE></ENVELOPE>',
        rows(typeRows),
        '<ENVELOPE></ENVELOPE>',
        '<ENVELOPE></ENVELOPE>',
      ],
      [0, 1, 0, 4, 0, 0],
    );
    await expectFailed(job.id, 'BAD_AMOUNT');
  });
  it('a party with no id, or two parties with one', async () => {
    const { pc } = await live();
    const job = (await hb(pc).expect(201)).body.job;
    await answer(
      pc,
      job,
      [
        '<ENVELOPE></ENVELOPE>',
        rows([partyRow('', 'A', '0')]),
        '<ENVELOPE></ENVELOPE>',
        rows(typeRows),
        '<ENVELOPE></ENVELOPE>',
        '<ENVELOPE></ENVELOPE>',
      ],
      [0, 1, 0, 4, 0, 0],
    );
    await expectFailed(job.id, 'BAD_ROW');
    await db.tallyCompany.updateMany({ data: { failures: 0, lastFailureAt: null } });
    const next = (await hb(pc).expect(201)).body.job;
    await answer(
      pc,
      next,
      [
        '<ENVELOPE></ENVELOPE>',
        rows([partyRow('x', 'A', '0'), partyRow('x', 'B', '0')]),
        '<ENVELOPE></ENVELOPE>',
        rows(typeRows),
        '<ENVELOPE></ENVELOPE>',
        '<ENVELOPE></ENVELOPE>',
      ],
      [0, 2, 0, 4, 0, 0],
    );
    await expectFailed(next.id, 'BAD_ROW');
  });
  it('a company gone from Tally by the end of the read', async () => {
    const { pc } = await live();
    const job = (await hb(pc).expect(201)).body.job;
    const answers = job.reads.map(() => '<ENVELOPE></ENVELOPE>');
    await answer(
      pc,
      job,
      answers,
      [0, 0, 0, 0, 0, 0],
      smallAnswer(rows([companyRow('co-other', 'Other')])),
    );
    await expectFailed(job.id, 'COMPANY_MISSING');
  });
  it('a company moved to another PC while the read was going: the old answer is not wanted', async () => {
    const { pc, companyId } = await live();
    const job = (await hb(pc).expect(201)).body.job;
    const other = await paired('Dukaan 2');
    await adminPost('owner', `companies/${companyId}`, { ownerDeviceId: other.id }).expect(201);
    await answer(
      pc,
      job,
      [
        '<ENVELOPE></ENVELOPE>',
        rows([partyRow('led-a', 'A', '0.00')]),
        '<ENVELOPE></ENVELOPE>',
        rows(typeRows),
        '<ENVELOPE></ENVELOPE>',
        '<ENVELOPE></ENVELOPE>',
      ],
      [0, 1, 0, 4, 0, 0],
    );
    await expectFailed(job.id, 'NOT_OWNER');
  });
  it('a company set aside while the read was going: the same', async () => {
    const { pc, companyId } = await live();
    const job = (await hb(pc).expect(201)).body.job;
    await adminPost('owner', `companies/${companyId}`, { role: 'IGNORE' }).expect(201);
    await answer(
      pc,
      job,
      [
        '<ENVELOPE></ENVELOPE>',
        rows([partyRow('led-a', 'A', '0.00')]),
        '<ENVELOPE></ENVELOPE>',
        rows(typeRows),
        '<ENVELOPE></ENVELOPE>',
        '<ENVELOPE></ENVELOPE>',
      ],
      [0, 1, 0, 4, 0, 0],
    );
    await expectFailed(job.id, 'NOT_PRIMARY');
  });
  it('a failed read is repeated, and its parts kept longer to look at', async () => {
    const id = await withFirst('<ENVELOPE><F01>g1</F01>');
    await ingest.runDue();
    const chunk = await db.tallyChunk.findFirstOrThrow({ where: { jobId: id } });
    expect(chunk.expiresAt.getTime()).toBeGreaterThan(Date.now() + 20 * 86400000);
    await db.tallyCompany.updateMany({ data: { lastFailureAt: new Date(Date.now() - 120000) } });
    const pc = await db.tallyDevice.findFirstOrThrow();
    expect(pc.id).toBeTruthy();
  });
  it('three failures in a row wait ten minutes, and tell the technical operator', async () => {
    const { pc, companyId } = await live();
    for (let i = 0; i < 3; i++) {
      const job = (await hb(pc).expect(201)).body.job;
      await finish(pc, job.id, { error: 'BUSY' }).expect(201);
      await db.tallyCompany.update({
        where: { id: companyId },
        data: { lastFailureAt: new Date(Date.now() - 120000) },
      });
    }
    expect((await hb(pc).expect(201)).body.job).toBeNull();
    await desk.watch(new Date('2026-11-05T06:00:00Z'));
    const notes = await db.notification.findMany({ where: { userId: 'tech' } });
    expect(notes.some((note) => note.dedupeKey?.includes('SYNC_FAILED'))).toBe(true);
  });
});

describe('the mirror, once the answers are good', () => {
  it('masters arrive, with money in paise past what the khata can hold', async () => {
    const { pc, companyId } = await live();
    await pastMasters(pc, companyId, '-30000000.50');
    const ledger = await db.tallyLedger.findFirstOrThrow({ where: { guid: 'led-a' } });
    expect(ledger).toMatchObject({
      name: 'Asha Traders',
      class: 'DEBTOR',
      closingPaise: -3000000050n,
    });
    expect(ledger.closingAsOf).toBeTruthy();
    const company = await db.tallyCompany.findUniqueOrThrow({ where: { id: companyId } });
    expect(company.wmMstId).toBe(10n);
    const types = await db.tallyVoucherType.findMany({ where: { companyId } });
    expect(types.find((row) => row.name === 'GST Sale')?.baseType).toBe('Sales');
    expect(types.find((row) => row.name === 'Payroll')?.baseType).toBe('');
  });
  it('Devanagari names, Indian commas and (-) all come through', async () => {
    const { pc, companyId } = await live();
    await pastMasters(pc, companyId, '(-) 1,23,456.78');
    expect((await db.tallyLedger.findFirstOrThrow({ where: { guid: 'led-a' } })).closingPaise).toBe(
      -12345678n,
    );
    expect((await db.tallyLedger.findFirstOrThrow({ where: { guid: 'led-b' } })).name).toBe(
      'राम सीमेंट',
    );
  });
  it('payroll types are never asked for, and never kept if they arrive anyway', async () => {
    const { pc, companyId } = await live();
    await pastMasters(pc, companyId);
    const job = (await hb(pc).expect(201)).body.job;
    expect(job.kind).toBe('WINDOW');
    expect(job.reads[0].params.types.sort()).toEqual(['GST Sale', 'Receipt', 'Sales']);
    await answer(
      pc,
      job,
      [
        rows([vRow('v1', '1'), vRow('pay1', '2', today, 'Payroll', 'Asha Traders')]),
        rows([...saleLines('v1'), ...saleLines('pay1')]),
        '<ENVELOPE></ENVELOPE>',
      ],
      [2],
    );
    await ingest.runDue();
    expect((await statusOf(job.id)).status).toBe('APPLIED');
    expect(
      (await db.tallyVoucher.findMany({ where: { companyId } })).map((row) => row.guid),
    ).toEqual(['v1']);
    expect(await db.tallyVoucherLine.count({ where: { ledgerName: 'Sales Account' } })).toBe(1);
  });
  it('a voucher that does not net to zero is refused whole, and nothing moves', async () => {
    const { pc, companyId } = await live();
    await pastMasters(pc, companyId);
    const job = (await hb(pc).expect(201)).body.job;
    await answer(
      pc,
      job,
      [
        rows([vRow('v1', '1')]),
        rows([
          ['v1', 'Asha Traders', '-1000.00'],
          ['v1', 'Sales Account', '999.00'],
        ]),
        '<ENVELOPE></ENVELOPE>',
      ],
      [1],
    );
    await ingest.runDue();
    expect((await statusOf(job.id)).error).toBe('NOT_BALANCED');
    expect(await db.tallyVoucher.count()).toBe(0);
    expect((await db.tallyCompany.findUniqueOrThrow({ where: { id: companyId } })).phase).toBe(
      'BACKFILL',
    );
  });
  it('a voucher with no lines means a short answer, and is refused', async () => {
    const { pc, companyId } = await live();
    await pastMasters(pc, companyId);
    const job = (await hb(pc).expect(201)).body.job;
    await answer(
      pc,
      job,
      [rows([vRow('v1', '1')]), '<ENVELOPE></ENVELOPE>', '<ENVELOPE></ENVELOPE>'],
      [1],
    );
    await ingest.runDue();
    expect((await statusOf(job.id)).error).toBe('LINES_SHORT');
  });
  it('Tally ignoring the date window: the dates are filtered again here', async () => {
    const { pc, companyId } = await live();
    await pastMasters(pc, companyId);
    const job = (await hb(pc).expect(201)).body.job;
    const outside = '2020-01-01';
    await answer(
      pc,
      job,
      [
        rows([vRow('v1', '1'), vRow('old', '2', outside)]),
        rows([...saleLines('v1'), ...saleLines('old')]),
        '<ENVELOPE></ENVELOPE>',
      ],
      [2],
    );
    await ingest.runDue();
    expect((await statusOf(job.id)).status).toBe('APPLIED');
    expect((await db.tallyVoucher.findMany()).map((row) => row.guid)).toEqual(['v1']);
  });
  it('a voucher with no party and no goods is kept as its id and no more', async () => {
    const { pc, companyId } = await live();
    await pastMasters(pc, companyId);
    const job = (await hb(pc).expect(201)).body.job;
    await answer(
      pc,
      job,
      [
        rows([
          vRow('rent', '1', today, 'Sales', 'Rent Account', {
            narration: 'private note',
            reference: 'R-1',
          }),
        ]),
        rows([
          ['rent', 'Rent Account', '-500.00'],
          ['rent', 'Cash', '500.00'],
        ]),
        '<ENVELOPE></ENVELOPE>',
      ],
      [1],
    );
    await ingest.runDue();
    const row = await db.tallyVoucher.findFirstOrThrow({
      where: { guid: 'rent' },
      include: { lines: true },
    });
    expect(row).toMatchObject({ party: '', number: '', reference: '', type: '', baseType: '' });
    expect(row.lines).toEqual([]);
  });
  it('the narration itself is not kept, only an order number found in it', async () => {
    const { pc, companyId } = await live();
    await pastMasters(pc, companyId);
    const job = (await hb(pc).expect(201)).body.job;
    await answer(
      pc,
      job,
      [
        rows([
          vRow('v1', '1', today, 'Sales', 'Asha Traders', {
            narration: 'For site SC-2026-ABCD1234 thanks',
          }),
        ]),
        rows(saleLines('v1')),
        '<ENVELOPE></ENVELOPE>',
      ],
      [1],
    );
    await ingest.runDue();
    const row = await db.tallyVoucher.findFirstOrThrow();
    expect(row.orderRef).toBe('SC-2026-ABCD1234');
    expect(JSON.stringify(row, (_k, v) => (typeof v === 'bigint' ? String(v) : v))).not.toContain(
      'thanks',
    );
  });
  it('a formula or a script in a Tally name stays plain text everywhere it goes', async () => {
    const { pc, companyId } = await live();
    const first = (await hb(pc).expect(201)).body.job;
    const nasty = '=HYPERLINK(&quot;http://evil&quot;)&lt;script&gt;alert(1)&lt;/script&gt;';
    await answer(
      pc,
      first,
      [
        rows([['g1', '1', 'Sundry Debtors', 'Assets']]),
        rows([partyRow('led-x', nasty, '0.00', '0.00', '98765 43210')]),
        '<ENVELOPE></ENVELOPE>',
        rows(typeRows),
        '<ENVELOPE></ENVELOPE>',
        '<ENVELOPE></ENVELOPE>',
      ],
      [1, 1, 0, 4, 0, 0],
    );
    await ingest.runDue();
    const ledger = await db.tallyLedger.findFirstOrThrow({ where: { companyId } });
    expect(ledger.name).toBe('=HYPERLINK("http://evil")<script>alert(1)</script>');
    expect(ledger.phones).toEqual(['+919876543210']);
    const res = await adminGet('owner', 'parties').expect(200);
    expect(res.headers['content-type']).toMatch(/application\/json/);
    expect(res.body.items[0].name).toBe(ledger.name);
    // It reaches no log, no alert and no audit row, where it could be rendered or exported.
    await desk.watch();
    const audit = await db.auditLog.findMany();
    const notes = await db.notification.findMany();
    expect(JSON.stringify([audit, notes])).not.toContain('HYPERLINK');
  });
});

describe('replays and out-of-order answers', () => {
  async function toBackfill() {
    const { pc, companyId } = await live();
    await pastMasters(pc, companyId);
    return { pc, companyId };
  }
  it('the same job read twice cannot double anything', async () => {
    const { pc, companyId } = await toBackfill();
    const job = (await hb(pc).expect(201)).body.job;
    await answer(
      pc,
      job,
      [rows([vRow('v1', '1')]), rows(saleLines('v1')), '<ENVELOPE></ENVELOPE>'],
      [1],
    );
    await ingest.runDue();
    await ingest.runDue();
    expect(await db.tallyVoucherLine.count()).toBe(2);
    expect(await db.tallyVoucher.count()).toBe(1);
    expect(companyId).toBeTruthy();
  });
  it('a window read again leaves the mirror as it was, with no false change logged', async () => {
    const { pc, companyId } = await toBackfill();
    const first = (await hb(pc).expect(201)).body.job;
    await answer(
      pc,
      first,
      [rows([vRow('v1', '1')]), rows(saleLines('v1')), '<ENVELOPE></ENVELOPE>'],
      [1],
    );
    await ingest.runDue();
    await db.tallyCompany.update({
      where: { id: companyId },
      data: { phase: 'BACKFILL', backfillCursor: today },
    });
    const second = (await hb(pc).expect(201)).body.job;
    await answer(
      pc,
      second,
      [rows([vRow('v1', '1')]), rows(saleLines('v1')), '<ENVELOPE></ENVELOPE>'],
      [1],
    );
    await ingest.runDue();
    expect(await db.tallyVoucherLine.count()).toBe(2);
    expect(await db.tallyVoucherChange.count()).toBe(0);
  });
  it('an older answer arriving late cannot undo a newer one', async () => {
    const { pc, companyId } = await toBackfill();
    const first = (await hb(pc).expect(201)).body.job;
    await answer(
      pc,
      first,
      [rows([vRow('v1', '9')]), rows(saleLines('v1', '2000.00')), '<ENVELOPE></ENVELOPE>'],
      [1],
    );
    await ingest.runDue();
    await db.tallyCompany.update({
      where: { id: companyId },
      data: { phase: 'BACKFILL', backfillCursor: today },
    });
    const late = (await hb(pc).expect(201)).body.job;
    await answer(
      pc,
      late,
      [rows([vRow('v1', '3')]), rows(saleLines('v1', '1.00')), '<ENVELOPE></ENVELOPE>'],
      [1],
    );
    await ingest.runDue();
    const row = await db.tallyVoucher.findFirstOrThrow({ include: { lines: true } });
    expect(row.alterId).toBe(9n);
    expect(row.partyAmountPaise).toBe(-200000n);
    expect((await statusOf(late.id)).result).toMatchObject({ older: 1, applied: 0 });
  });
  it('a captured finish cannot be replayed against a closed job', async () => {
    const { pc } = await toBackfill();
    const job = (await hb(pc).expect(201)).body.job;
    const seqBefore = pc.seq;
    const done = await answer(
      pc,
      job,
      [rows([vRow('v1', '1')]), rows(saleLines('v1')), '<ENVELOPE></ENVELOPE>'],
      [1],
    );
    expect(done.status).toBe(201);
    await ingest.runDue();
    const again = await finish(pc, job.id, { error: 'BUSY' }).expect(201);
    expect(again.body).toMatchObject({ status: 'APPLIED', repeat: true });
    expect((await statusOf(job.id)).status).toBe('APPLIED');
    expect(seqBefore).toBeLessThan(pc.seq);
  });
  it('a failed job’s part cannot be swapped in after the fact', async () => {
    const { pc } = await toBackfill();
    const job = (await hb(pc).expect(201)).body.job;
    await finish(pc, job.id, { error: 'BUSY' }).expect(201);
    const { body } = await put(pc, job.id, 0, utf16gz('<ENVELOPE></ENVELOPE>')).expect(409);
    expect(body.error.code).toBe('BRIDGE_JOB_CLOSED');
  });
  it('a part changed in storage is caught when it is read', async () => {
    const { pc } = await toBackfill();
    const job = (await hb(pc).expect(201)).body.job;
    await answer(
      pc,
      job,
      [rows([vRow('v1', '1')]), rows(saleLines('v1')), '<ENVELOPE></ENVELOPE>'],
      [1],
    );
    await db.tallyChunk.updateMany({
      where: { jobId: job.id, seq: 0 },
      data: { sha256: 'b'.repeat(64) },
    });
    await ingest.runDue();
    expect((await statusOf(job.id)).error).toBe('PART_MISSING');
  });
  it('two workers cannot read the same job', async () => {
    const { pc } = await toBackfill();
    const job = (await hb(pc).expect(201)).body.job;
    await answer(
      pc,
      job,
      [rows([vRow('v1', '1')]), rows(saleLines('v1')), '<ENVELOPE></ENVELOPE>'],
      [1],
    );
    await Promise.all([ingest.runDue(), ingest.runDue(), ingest.runDue()]);
    expect((await statusOf(job.id)).status).toBe('APPLIED');
    expect(await db.tallyVoucherLine.count()).toBe(2);
  });
  it('a worker that died mid-read leaves the job to be picked up again', async () => {
    const { pc } = await toBackfill();
    const job = (await hb(pc).expect(201)).body.job;
    await answer(
      pc,
      job,
      [rows([vRow('v1', '1')]), rows(saleLines('v1')), '<ENVELOPE></ENVELOPE>'],
      [1],
    );
    await db.tallySyncJob.update({
      where: { id: job.id },
      data: { status: 'INGESTING', leaseUntil: new Date(Date.now() - 1000) },
    });
    await ingest.runDue();
    expect((await statusOf(job.id)).status).toBe('APPLIED');
  });
});

describe('the backfill, delta, sweep and proof', () => {
  /** Backfill done, sweep done, tie-out said OK: a company in daily life. */
  async function livedIn(closing = '-1000.00') {
    const { pc, companyId } = await live();
    await pastMasters(pc, companyId, closing);
    const window = (await hb(pc).expect(201)).body.job;
    await answer(
      pc,
      window,
      [rows([vRow('v1', '1')]), rows(saleLines('v1')), '<ENVELOPE></ENVELOPE>'],
      [1],
    );
    await ingest.runDue();
    // As if Tally's mark stood at 1 all along, so nothing is waiting behind the watermark.
    await db.tallyCompany.update({ where: { id: companyId }, data: { altVchId: 1n, wmVchId: 1n } });
    const sweep = (
      await hb(pc, beat([companyRow('co-guid-0001', 'Bench Traders', '10', '1', today)])).expect(
        201,
      )
    ).body.job;
    return { pc, companyId, sweep };
  }
  const parties = (closing: string) =>
    rows([partyRow('led-a', 'Asha Traders', closing), partyRow('led-b', 'राम सीमेंट', '0.00')]);

  it('windows go newest first, shrink when slow, and end at the start of the year', async () => {
    const { pc, companyId } = await live();
    await pastMasters(pc, companyId);
    await db.tallyCompany.update({ where: { id: companyId }, data: { backfillWindowDays: 7 } });
    const first = (await hb(pc).expect(201)).body.job;
    expect(first.reads[0].params.dayTo).toBe(today.replaceAll('-', ''));
    expect(first.reads[0].params.dayFrom).toBe(dayShift(today, -6).replaceAll('-', ''));
    const answers = ['<ENVELOPE></ENVELOPE>', '<ENVELOPE></ENVELOPE>', '<ENVELOPE></ENVELOPE>'];
    const bytes = utf16gz(answers[0]!);
    const reads = [];
    for (const index of [0, 1, 2]) {
      await put(pc, first.id, index, bytes).expect(200);
      reads.push({
        index,
        parts: [{ seq: index, sha256: sha(bytes) }],
        bytes: 1,
        tookMs: 25000,
        readAt: Date.now(),
        ...(index === 0 ? { counts: [count(0), count(0)] } : {}),
      });
    }
    await finish(pc, first.id, { reads, marksAfter: marks() }).expect(201);
    await ingest.runDue();
    const company = await db.tallyCompany.findUniqueOrThrow({ where: { id: companyId } });
    expect(company.backfillWindowDays).toBe(3);
    expect(company.backfillCursor).toBe(dayShift(today, -7));
    const next = (await hb(pc).expect(201)).body.job;
    expect(next.reads[0].params.dayTo).toBe(dayShift(today, -7).replaceAll('-', ''));
    expect(next.reads[0].params.dayFrom).toBe(dayShift(today, -9).replaceAll('-', ''));
  });
  it('the proof passes when baseline plus lines equal Tally’s closing, to the paisa', async () => {
    const { pc, companyId, sweep } = await livedIn();
    expect(sweep.kind).toBe('SWEEP');
    await answer(
      pc,
      sweep,
      [rows([['v1', '1', today]]), parties('-1000.00'), '<ENVELOPE></ENVELOPE>'],
      [1, 2, 0],
      marks('1', '10', today),
    );
    await ingest.runDue();
    const company = await db.tallyCompany.findUniqueOrThrow({ where: { id: companyId } });
    expect(company.tieOut).toMatchObject({ status: 'OK', total: 2, failed: 0 });
    expect(company.freshAt).toBeTruthy();
    const led = await db.tallyLedger.findFirstOrThrow({ where: { guid: 'led-a' } });
    expect(led).toMatchObject({ tieOutOk: true, tieOutGapPaise: 0n });
  });
  it('one paisa off fails the proof for that party alone, and it reads again once', async () => {
    const { pc, companyId, sweep } = await livedIn();
    await answer(
      pc,
      sweep,
      [rows([['v1', '1', today]]), parties('-1000.01'), '<ENVELOPE></ENVELOPE>'],
      [1, 2, 0],
      marks('1', '10', today),
    );
    await ingest.runDue();
    const company = await db.tallyCompany.findUniqueOrThrow({ where: { id: companyId } });
    expect(company.tieOut).toMatchObject({ status: 'FAILED', total: 2, failed: 1 });
    expect(company.phase).toBe('BACKFILL');
    expect(company.lastRereadOn).toBe(today);
    expect(await db.tallyLedger.findFirstOrThrow({ where: { guid: 'led-a' } })).toMatchObject({
      tieOutOk: false,
      tieOutGapPaise: -1n,
    });
    expect(await db.tallyLedger.findFirstOrThrow({ where: { guid: 'led-b' } })).toMatchObject({
      tieOutOk: true,
    });
    // Only once a day: a second failure stays visible instead of reading all day long.
    await db.tallyCompany.update({
      where: { id: companyId },
      data: { phase: 'LIVE', backfillCursor: null, lastSweepOn: null },
    });
    const next = (
      await hb(pc, beat([companyRow('co-guid-0001', 'Bench Traders', '10', '1', today)])).expect(
        201,
      )
    ).body.job;
    await answer(
      pc,
      next,
      [rows([['v1', '1', today]]), parties('-1000.01'), '<ENVELOPE></ENVELOPE>'],
      [1, 2, 0],
      marks('1', '10', today),
    );
    await ingest.runDue();
    expect((await db.tallyCompany.findUniqueOrThrow({ where: { id: companyId } })).phase).toBe(
      'LIVE',
    );
  });
  it('the accountant typing during the read means no verdict, not a false failure', async () => {
    const { pc, companyId, sweep } = await livedIn();
    await answer(
      pc,
      sweep,
      [rows([['v1', '1', today]]), parties('-1234.00'), '<ENVELOPE></ENVELOPE>'],
      [1, 2, 0],
      marks('2', '10', today),
    );
    await ingest.runDue();
    expect(
      (await db.tallyCompany.findUniqueOrThrow({ where: { id: companyId } })).tieOut,
    ).toMatchObject({ status: 'UNSETTLED' });
  });
  it('with no proof the company is still open, there is no verdict either', async () => {
    const { pc, companyId, sweep } = await livedIn();
    const bytes = utf16gz(rows([['v1', '1', today]]));
    const reads = [];
    const answersList = [bytes, utf16gz(parties('-1000.00')), utf16gz('<ENVELOPE></ENVELOPE>')];
    const counted = [1, 2, 0];
    for (const [index, part] of answersList.entries()) {
      await put(pc, sweep.id, index, part).expect(200);
      reads.push({
        index,
        parts: [{ seq: index, sha256: sha(part) }],
        bytes: 1,
        tookMs: 1,
        readAt: Date.now(),
        counts: [count(counted[index]!), count(counted[index]!)],
      });
    }
    await finish(pc, sweep.id, { reads }).expect(201);
    await ingest.runDue();
    expect(
      (await db.tallyCompany.findUniqueOrThrow({ where: { id: companyId } })).tieOut,
    ).toMatchObject({ status: 'UNSETTLED' });
  });
  it('a delete: the sweep soft-deletes it and writes a fact down, and the fact cannot be edited', async () => {
    const { pc, sweep } = await livedIn('0.00');
    // Its only voucher is gone, so Tally has no last voucher date to reach any more.
    await db.tallyCompany.updateMany({ data: { lastVoucherDate: null } });
    await answer(
      pc,
      sweep,
      ['<ENVELOPE></ENVELOPE>', parties('0.00'), '<ENVELOPE></ENVELOPE>'],
      [0, 2, 0],
      marks('1', '10', ''),
    );
    await ingest.runDue();
    const voucher = await db.tallyVoucher.findFirstOrThrow({ where: { guid: 'v1' } });
    expect(voucher.deletedAt).toBeTruthy();
    const change = await db.tallyVoucherChange.findFirstOrThrow({
      where: { voucherId: voucher.id },
    });
    expect(change).toMatchObject({ kind: 'DELETED', oldAmountPaise: -100000n });
    await expect(
      db.tallyVoucherChange.update({ where: { id: change.id }, data: { kind: 'X' } }),
    ).rejects.toThrow();
    await expect(db.tallyVoucherChange.delete({ where: { id: change.id } })).rejects.toThrow();
  });
  it('a sweep far shorter than what we hold is refused, and nothing is deleted', async () => {
    const { pc, companyId, sweep } = await livedIn();
    await db.tallyVoucher.createMany({
      data: Array.from({ length: 30 }, (_, index) => ({
        companyId,
        guid: `held-${index}`,
        alterId: 1n,
        date: today,
      })),
    });
    await answer(
      pc,
      sweep,
      [rows([['v1', '1', today]]), parties('-1000.00'), '<ENVELOPE></ENVELOPE>'],
      [1, 2, 0],
      marks('1', '10', today),
    );
    await ingest.runDue();
    expect((await statusOf(sweep.id)).error).toBe('SHORT_READ');
    expect(await db.tallyVoucher.count({ where: { deletedAt: { not: null } } })).toBe(0);
  });
  it('a sweep that stops before Tally’s last voucher date is refused as short', async () => {
    const { pc, sweep } = await livedIn();
    await db.tallyCompany.updateMany({ data: { lastVoucherDate: today } });
    await answer(
      pc,
      sweep,
      [rows([['v1', '1', dayShift(today, -5)]]), parties('-1000.00'), '<ENVELOPE></ENVELOPE>'],
      [1, 2, 0],
      marks('1', '10', today),
    );
    await ingest.runDue();
    expect((await statusOf(sweep.id)).error).toBe('SHORT_READ');
  });
  it('a full party read far shorter than what we hold is refused, and no party vanishes', async () => {
    const { pc, companyId, sweep } = await livedIn();
    await db.tallyLedger.createMany({
      data: Array.from({ length: 30 }, (_, index) => ({
        companyId,
        guid: `p${index}`,
        alterId: 1n,
        name: `P${index}`,
        parent: 'x',
        class: 'DEBTOR',
      })),
    });
    await answer(
      pc,
      sweep,
      [rows([['v1', '1', today]]), parties('-1000.00'), '<ENVELOPE></ENVELOPE>'],
      [1, 2, 0],
      marks('1', '10', today),
    );
    await ingest.runDue();
    expect((await statusOf(sweep.id)).error).toBe('SHORT_READ');
    expect(await db.tallyLedger.count({ where: { deletedAt: { not: null } } })).toBe(0);
  });
  it('a change waits for 5 quiet minutes, or 15 at most', async () => {
    const { pc, companyId, sweep } = await livedIn();
    await answer(
      pc,
      sweep,
      [rows([['v1', '1', today]]), parties('-1000.00'), '<ENVELOPE></ENVELOPE>'],
      [1, 2, 0],
      marks('1', '10', today),
    );
    await ingest.runDue();
    const moved = beat([companyRow('co-guid-0001', 'Bench Traders', '10', '2', today)]);
    expect((await hb(pc, moved).expect(201)).body.job).toBeNull();
    await db.tallyCompany.update({
      where: { id: companyId },
      data: { marksChangedAt: new Date(Date.now() - 4 * 60000) },
    });
    expect((await hb(pc, moved).expect(201)).body.job).toBeNull();
    await db.tallyCompany.update({
      where: { id: companyId },
      data: { marksFirstChangedAt: new Date(Date.now() - 16 * 60000) },
    });
    const job = (await hb(pc, moved).expect(201)).body.job;
    expect(job.kind).toBe('DELTA');
    expect(job.reads[0].params).toMatchObject({ after: '1', upto: '2' });
    expect(job.reads.map((read: { read: string }) => read.read)).toEqual([
      'vouchers',
      'voucherLines',
      'voucherStock',
      'parties',
      'parties',
    ]);
  });
  it('a long day’s changes come in bounded windows, with the proof only at the end', async () => {
    const { pc, companyId, sweep } = await livedIn();
    await answer(
      pc,
      sweep,
      [rows([['v1', '1', today]]), parties('-1000.00'), '<ENVELOPE></ENVELOPE>'],
      [1, 2, 0],
      marks('1', '10', today),
    );
    await ingest.runDue();
    const far = beat([companyRow('co-guid-0001', 'Bench Traders', '10', '701', today)]);
    await hb(pc, far).expect(201);
    await db.tallyCompany.update({
      where: { id: companyId },
      data: { marksChangedAt: new Date(Date.now() - 6 * 60000) },
    });
    const job = (await hb(pc, far).expect(201)).body.job;
    expect(job.reads[0].params).toMatchObject({ after: '1', upto: '501' });
    expect(job.reads).toHaveLength(3);
    await answer(
      pc,
      job,
      ['<ENVELOPE></ENVELOPE>', '<ENVELOPE></ENVELOPE>', '<ENVELOPE></ENVELOPE>'],
      [0],
      marks('701', '10', today),
    );
    await ingest.runDue();
    expect((await db.tallyCompany.findUniqueOrThrow({ where: { id: companyId } })).wmVchId).toBe(
      501n,
    );
  });
  it('an alteration replaces the lines and writes the change down', async () => {
    const { pc, companyId, sweep } = await livedIn();
    await answer(
      pc,
      sweep,
      [rows([['v1', '1', today]]), parties('-1000.00'), '<ENVELOPE></ENVELOPE>'],
      [1, 2, 0],
      marks('1', '10', today),
    );
    await ingest.runDue();
    const moved = beat([companyRow('co-guid-0001', 'Bench Traders', '10', '2', today)]);
    await hb(pc, moved).expect(201);
    await db.tallyCompany.update({
      where: { id: companyId },
      data: { marksChangedAt: new Date(Date.now() - 6 * 60000) },
    });
    const job = (await hb(pc, moved).expect(201)).body.job;
    await answer(
      pc,
      job,
      [
        rows([vRow('v1', '2')]),
        rows(saleLines('v1', '1500.00')),
        '<ENVELOPE></ENVELOPE>',
        parties('-1500.00'),
        '<ENVELOPE></ENVELOPE>',
      ],
      [1, 0, 0, 2, 0],
      marks('2', '10', today),
    );
    await ingest.runDue();
    expect((await statusOf(job.id)).status).toBe('APPLIED');
    const voucher = await db.tallyVoucher.findFirstOrThrow({
      where: { guid: 'v1' },
      include: { lines: true },
    });
    expect(voucher.partyAmountPaise).toBe(-150000n);
    expect(voucher.lines).toHaveLength(2);
    expect(
      await db.tallyVoucherChange.findFirstOrThrow({ where: { voucherId: voucher.id } }),
    ).toMatchObject({
      kind: 'ALTERED',
      oldAlterId: 1n,
      newAlterId: 2n,
      oldAmountPaise: -100000n,
      newAmountPaise: -150000n,
    });
    expect(
      (await db.tallyCompany.findUniqueOrThrow({ where: { id: companyId } })).tieOut,
    ).toMatchObject({ status: 'OK' });
  });
  it('marks going backwards: stop trusting it, read it all again, and keep the links', async () => {
    const { pc, companyId, sweep } = await livedIn();
    await answer(
      pc,
      sweep,
      [rows([['v1', '1', today]]), parties('-1000.00'), '<ENVELOPE></ENVELOPE>'],
      [1, 2, 0],
      marks('1', '10', today),
    );
    await ingest.runDue();
    const ledger = await db.tallyLedger.findFirstOrThrow({ where: { guid: 'led-a' } });
    await adminPost('owner', `parties/${ledger.id}/link`, { userId: 'customer' }).expect(201);
    const fallen = beat([companyRow('co-guid-0001', 'Bench Traders', '5', '0', today)]);
    const { body } = await hb(pc, fallen).expect(201);
    expect(body.job.kind).toBe('MASTERS');
    const company = await db.tallyCompany.findUniqueOrThrow({ where: { id: companyId } });
    expect(company).toMatchObject({ phase: 'MASTERS', wmVchId: 0n, wmMstId: 0n, altVchId: 0n });
    expect(company.rewrittenAt).toBeTruthy();
    expect(company.tieOut).toMatchObject({ status: 'REWRITTEN' });
    expect(await db.tallyPartyLink.findFirstOrThrow()).toMatchObject({
      status: 'LINKED',
      userId: 'customer',
    });
    expect(await db.auditLog.count({ where: { event: 'TALLY_HISTORY_REWRITTEN' } })).toBe(1);
    const numbers = await adminGet('owner', 'customers/customer/numbers').expect(200);
    expect(numbers.body.tally.tieOut).toBe('REWRITTEN');
  });
  it('a job already open when history is rewritten goes nowhere', async () => {
    const { pc, sweep } = await livedIn();
    await hb(pc, beat([companyRow('co-guid-0001', 'Bench Traders', '5', '0', today)])).expect(201);
    expect((await statusOf(sweep.id)).status).toBe('EXPIRED');
    await put(pc, sweep.id, 0, utf16gz('x')).expect(409);
  });
});

describe('Bridge roko', () => {
  it.each(['owner', 'tech'])(
    '%s stops every PC, and they get no work at the next heartbeat',
    async (who) => {
      const { pc } = await live();
      await adminPost(who, 'pause', { paused: true }).expect(201);
      const { body } = await hb(pc).expect(201);
      expect(body.paused).toBe(true);
      expect(body.job).toBeNull();
      expect((await adminGet('owner', 'status').expect(200)).body.devices[0].state).toBe('PAUSED');
      await adminPost(who, 'pause', { paused: false }).expect(201);
      const resumed = await hb(pc).expect(201);
      expect(resumed.body.paused).toBe(false);
      expect(resumed.body.job.kind).toBe('MASTERS');
      expect(
        await db.auditLog.count({ where: { event: 'TALLY_BRIDGE_PAUSED', actorId: who } }),
      ).toBe(1);
    },
  );
  it('one PC can be stopped alone', async () => {
    const pc = await paired();
    const other = await paired('Dukaan 2');
    await adminPost('owner', 'pause', { paused: true, deviceId: pc.id }).expect(201);
    expect((await hb(pc).expect(201)).body.paused).toBe(true);
    expect((await hb(other).expect(201)).body.paused).toBe(false);
    await adminPost('owner', 'pause', { paused: true, deviceId: 'nope' }).expect(404);
  });
  it.each(['manager', 'cashier', 'accountant', 'keeper', 'driver', 'helper', 'customer'])(
    '%s cannot',
    async (who) => {
      await adminPost(who, 'pause', { paused: true }).expect(403);
    },
  );
});

describe('alerts when a PC goes quiet', () => {
  const noon = new Date('2026-11-05T06:30:00Z'); // 12:00 in India
  const night = new Date('2026-11-05T17:30:00Z'); // 23:00 in India
  const toTech = () => db.notification.findMany({ where: { userId: 'tech' } });
  const quiet = async (pc: Pc, at: Date) =>
    db.tallyDevice.update({
      where: { id: pc.id },
      data: {
        lastHeartbeatAt: new Date(at.getTime() - 31 * 60000),
        lastGoodAt: new Date(at.getTime() - 31 * 60000),
      },
    });
  it('30 minutes silent in shop hours: the technical operator hears, once a day per PC', async () => {
    const pc = await paired();
    await hb(pc).expect(201);
    await quiet(pc, noon);
    await desk.watch(noon);
    await desk.watch(noon);
    const notes = await toTech();
    expect(notes).toHaveLength(1);
    expect(notes[0]!.body).toContain('Dukaan 1');
    expect((await db.tallyDevice.findUniqueOrThrow({ where: { id: pc.id } })).state).toBe(
      'PC_SILENT',
    );
    const status = await adminGet('tech', 'health').expect(200);
    expect(status.body.devices[0].lastHeartbeatAt).toBeTruthy();
  });
  it('a PC asleep at night is expected: no alert', async () => {
    const pc = await paired();
    await hb(pc).expect(201);
    await quiet(pc, night);
    await desk.watch(night);
    expect(await toTech()).toHaveLength(0);
  });
  it('a stopped PC is not a silent one', async () => {
    const pc = await paired();
    await hb(pc).expect(201);
    await adminPost('owner', 'pause', { paused: true }).expect(201);
    await quiet(pc, noon);
    await desk.watch(noon);
    expect(await toTech()).toHaveLength(0);
  });
  it('a revoked PC is not missed', async () => {
    const pc = await paired();
    await hb(pc).expect(201);
    await adminPost('owner', `devices/${pc.id}/revoke`).expect(201);
    await quiet(pc, noon);
    await desk.watch(noon);
    expect(await toTech()).toHaveLength(0);
  });
  it('owners and everyone else stay out of it until shop hours are set', async () => {
    const pc = await paired();
    await hb(pc).expect(201);
    await quiet(pc, noon);
    await desk.watch(noon);
    expect(await db.notification.count({ where: { userId: { not: 'tech' } } })).toBe(0);
  });
  it('Tally closed for half an hour in shop hours', async () => {
    const pc = await paired();
    await hb(pc, { state: 'TALLY_CLOSED' }).expect(201);
    await db.tallyDevice.update({
      where: { id: pc.id },
      data: { stateSince: new Date(noon.getTime() - 31 * 60000), lastHeartbeatAt: noon },
    });
    await desk.watch(noon);
    expect((await toTech())[0]!.dedupeKey).toContain('TALLY_CLOSED');
  });
  it('educational mode, an update that failed and a nearly full disk do not wait', async () => {
    const pc = await paired();
    await hb(pc, {
      ...beat([companyRow()], licenceRow('Yes')),
      caps: { diskFreeMb: 100, updateFailed: '1.1.0' },
    }).expect(201);
    await db.tallyDevice.update({ where: { id: pc.id }, data: { lastHeartbeatAt: night } });
    await desk.watch(night);
    const keys = (await toTech()).map((note) => note.dedupeKey ?? '');
    expect(keys.some((key) => key.includes('EDUCATIONAL'))).toBe(true);
    expect(keys.some((key) => key.includes('UPDATE_FAILED'))).toBe(true);
    expect(keys.some((key) => key.includes('DISK_LOW'))).toBe(true);
  });
  it('Tally’s release changing is noted, as requests may break', async () => {
    const pc = await paired();
    await hb(pc).expect(201);
    await hb(
      pc,
      beat([companyRow()], ['7', '2', 'TallyPrime 7.2', 'No', 'Yes', 'Yes', 'No', 'No']),
    ).expect(201);
    await desk.watch();
    expect((await toTech()).some((note) => note.dedupeKey?.includes('RELEASE'))).toBe(true);
  });
});

describe('the status page', () => {
  it.each(['owner', 'accountant'])('%s reads it', async (who) => {
    await adminGet(who, 'status').expect(200);
  });
  it.each(['manager', 'cashier', 'keeper', 'driver', 'helper', 'customer', 'tech'])(
    '%s cannot read status',
    async (who) => {
      await adminGet(who, 'status').expect(403);
    },
  );
  it.each(['owner', 'tech'])('%s reads health', async (who) => {
    await adminGet(who, 'health').expect(200);
  });
  it.each(['manager', 'cashier', 'accountant', 'keeper', 'driver', 'helper', 'customer'])(
    '%s cannot read health',
    async (who) => {
      await adminGet(who, 'health').expect(403);
    },
  );
  it('never connected says so', async () => {
    const { body } = await adminGet('owner', 'status').expect(200);
    expect(body.connected).toBe(false);
    expect(body.devices).toEqual([]);
  });
  it('health holds states and times, no party and no amount', async () => {
    const { pc, companyId } = await live();
    await pastMasters(pc, companyId, '-98765.43');
    const { body } = await adminGet('tech', 'health').expect(200);
    const text = JSON.stringify(body);
    expect(body.companies[0].phase).toBe('BACKFILL');
    expect(text).not.toContain('Asha');
    expect(text).not.toContain('98765');
    expect(text).not.toContain('राम');
    expect(body.jobs.length).toBeGreaterThan(0);
  });
  it('the technical operator cannot reach a Tally number by any route', async () => {
    const { pc, companyId } = await live();
    await pastMasters(pc, companyId);
    await adminGet('tech', 'parties').expect(403);
    await adminGet('tech', 'differences').expect(403);
    await adminGet('tech', 'customers/customer/numbers').expect(403);
  });
});

describe('storage of raw parts', () => {
  it('they go after their time, and the rows they became stay', async () => {
    const { pc, companyId } = await live();
    await pastMasters(pc, companyId);
    expect(await db.tallyChunk.count()).toBeGreaterThan(0);
    await db.tallyChunk.updateMany({ data: { expiresAt: new Date(Date.now() - 1000) } });
    await desk.purge();
    expect(await db.tallyChunk.count()).toBe(0);
    expect(await db.tallyLedger.count()).toBe(2);
  });
  it('a key that is not ours is refused', async () => {
    const { TallyParts } = await import('../src/tally/parts');
    const parts = new TallyParts();
    for (const key of ['../../etc/passwd', 'tally-parts/../x', 'tally-parts/abc/1-zz.gz'])
      await expect(parts.get(key)).rejects.toThrow();
  });
  it('without private storage in production, nothing is stored on a local disk', async () => {
    const { TallyParts } = await import('../src/tally/parts');
    const saved = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';
    try {
      await expect(
        new TallyParts().put(`tally-parts/abcdefg/1-${'a'.repeat(64)}.gz`, Buffer.from('x')),
      ).rejects.toThrow();
    } finally {
      process.env.NODE_ENV = saved;
    }
  });
});

describe('signed updates, on the server', () => {
  it('only those who look after the PCs may add or choose a release', async () => {
    const release = {
      version: '1.1.0',
      manifest: '{"a":1}',
      signature: 'A'.repeat(88),
      files: { 'main.mjs': 'AAAA' },
    };
    await adminPost('accountant', 'releases', release).expect(403);
    await adminPost('manager', 'releases', release).expect(403);
    await adminPost('tech', 'releases', release).expect(201);
    await adminPost('tech', 'releases', release).expect(409);
    const pc = await paired();
    await adminPost('cashier', `devices/${pc.id}/release`, { version: '1.1.0' }).expect(403);
    await adminPost('tech', `devices/${pc.id}/release`, { version: '9.9.9' }).expect(404);
    await adminPost('tech', `devices/${pc.id}/release`, { version: '1.1.0' }).expect(201);
  });
  it('a PC is told only of the release chosen for it, and can fetch only that', async () => {
    const pc = await paired();
    const other = await paired('Dukaan 2');
    await adminPost('tech', 'releases', {
      version: '1.1.0',
      manifest: '{"a":1}',
      signature: 'A'.repeat(88),
      files: { 'main.mjs': 'AAAA' },
    }).expect(201);
    expect((await hb(pc).expect(201)).body.update).toBeNull();
    await signed(server, pc, 'get', '/api/v1/bridge/releases/1.1.0').expect(404);
    await adminPost('tech', `devices/${pc.id}/release`, { version: '1.1.0' }).expect(201);
    expect((await hb(pc).expect(201)).body.update).toEqual({ version: '1.1.0' });
    expect((await hb(other).expect(201)).body.update).toBeNull();
    const fetched = await signed(server, pc, 'get', '/api/v1/bridge/releases/1.1.0').expect(200);
    expect(fetched.body.files['main.mjs']).toBe('AAAA');
    await signed(server, other, 'get', '/api/v1/bridge/releases/1.1.0').expect(404);
    await hb(pc, { ...beat(), version: '1.1.0' }).expect(201);
    expect((await hb(pc, { ...beat(), version: '1.1.0' }).expect(201)).body.update).toBeNull();
  });
  it('a file name that could climb out of its folder is refused', async () => {
    await adminPost('tech', 'releases', {
      version: '1.1.0',
      manifest: '{"a":1}',
      signature: 'A'.repeat(88),
      files: { '../evil.mjs': 'AAAA' },
    }).expect(400);
  });
});

describe('no write-back exists anywhere on the server', () => {
  it('no route, table or word for one', async () => {
    const { readdirSync, readFileSync } = await import('node:fs');
    const { join } = await import('node:path');
    const folder = join(__dirname, '../src/tally');
    for (const name of readdirSync(folder)) {
      const text = readFileSync(join(folder, name), 'utf8');
      expect(text, name).not.toMatch(/TALLYREQUEST|REMOTEID|posting|ACTION=/i);
    }
    const schema = readFileSync(join(__dirname, '../prisma/schema.prisma'), 'utf8');
    expect(schema).not.toMatch(/model TallyPosting/);
    expect(schema).not.toMatch(/writeEnabled/);
  });
});
