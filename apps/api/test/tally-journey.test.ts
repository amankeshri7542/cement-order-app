import 'reflect-metadata';
import { afterAll, beforeAll, beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { generateKeyPairSync } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import type { Server } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadEnvFile } from 'node:process';
import type { AddressInfo } from 'node:net';
import type { INestApplication } from '@nestjs/common';
import { dayShift, istToday } from '@shiv/shared';
import request from 'supertest';
import { Db } from '../src/db';
import { TallyIngest } from '../src/tally/ingest';
import { TallyRecon } from '../src/tally/recon';
import { addPerson, tokenFor } from './staff-helper';
import { bridgeFile, clearTally } from './tally-helper';

// The real program, the real API and a real database, with only Tally itself pretended. Nothing here
// has run against real Tally: the pretend one answers the XML shapes plan 09 wrote down.

if (existsSync('.env.test')) loadEnvFile('.env.test');
process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
process.env.OTP_PROVIDER = 'mock';
process.env.OTP_HASH_SECRET = 'tally-journey-test-only-secret-not-for-production';
process.env.CORS_ORIGINS = 'http://localhost:3000';
if (!process.env.DATABASE_URL || !new URL(process.env.DATABASE_URL).pathname.endsWith('_test'))
  throw new Error('These tests require a dedicated TEST_DATABASE_URL ending in _test.');

// Each journey is a morning of real work, through real HTTP and a real database.
vi.setConfig({ testTimeout: 120000, hookTimeout: 60000 });

let app: INestApplication;
let server: Server;
let db: Db;
let ingest: TallyIngest;
let recon: TallyRecon;
let base: string;
const folders: string[] = [];

const as = (id: string) => ({ Authorization: `Bearer ${tokenFor(id)}` });
const post = (who: string, path: string, body: object = {}) =>
  request(server).post(`/api/v1/admin/tally/${path}`).set(as(who)).send(body);
const get = (who: string, path: string) =>
  request(server).get(`/api/v1/admin/tally/${path}`).set(as(who));
const today = istToday();

// Loaded by path: the program has no package to import, on purpose.
const load = (file: string) => import(/* @vite-ignore */ bridgeFile(file));

async function setup(worldOptions: Record<string, unknown> = {}) {
  const fake = await load('fake/fake-tally.mjs');
  const { Agent } = await load('src/agent.mjs');
  const { BridgeApi, pair, loadIdentity } = await load('src/api-client.mjs');
  const { Spool } = await load('src/spool.mjs');
  const { TallyClient } = await load('src/tally-client.mjs');
  const company = fake.makeCompany();
  const tally = new fake.FakeTally({ companies: [company], ...worldOptions });
  await tally.listen();
  const dir = mkdtempSync(join(tmpdir(), 'shiv-journey-'));
  folders.push(dir);
  const code = (await post('tech', 'devices/pair', { name: 'Dukaan 1' }).expect(201)).body.code;
  const privateKey = await loadIdentity(dir);
  const paired = await pair({
    base,
    code,
    privateKey,
    version: '1.0.0',
    os: 'Test Windows x64',
    allowLoopbackHttp: true,
  });
  const state = { deviceId: paired.deviceId };
  const api = new BridgeApi({
    base,
    privateKey,
    state,
    saveState: async () => undefined,
    allowLoopbackHttp: true,
  });
  const spool = new Spool(join(dir, 'spool'));
  await spool.ready();
  const agent = new Agent({
    tally: new TallyClient({ port: tally.port, idleMs: 1000, requestMs: 5000 }),
    api,
    spool,
    platform: {
      osText: () => 'Test Windows x64',
      tallyRunning: async () => false,
      caps: async () => ({ diskFreeMb: 5000 }),
    },
    version: '1.0.0',
    sleep: async () => undefined,
    retryWaitMs: 0,
  });
  return { fake, company, tally, agent, api, spool, dir, deviceId: paired.deviceId as string };
}
type World = Awaited<ReturnType<typeof setup>>;

/** Runs the PC and the worker until there is nothing left to do, as a morning of real time would. */
async function settle(world: World, limit = 200) {
  let idle = 0;
  for (let turn = 0; turn < limit; turn++) {
    // Nothing here waits on a clock: Tally's quiet time and failure pauses are simply over.
    await db.tallyCompany.updateMany({
      data: {
        marksChangedAt: { set: new Date(Date.now() - 6 * 60000) },
        lastFailureAt: new Date(Date.now() - 3600000),
      },
    });
    world.agent.lastProbeAt = 0;
    const reply = await world.agent.tick();
    await ingest.runDue(20);
    // Tally's marks may have only just moved, so one quiet turn is not enough to call it finished.
    const open = await db.tallySyncJob.count({
      where: { status: { in: ['QUEUED', 'LEASED', 'UPLOADED', 'INGESTING'] } },
    });
    idle = !reply?.job && !open ? idle + 1 : 0;
    if (idle >= 3) {
      await recon.runDue();
      return turn;
    }
  }
  throw new Error('It never settled');
}
async function bench(world: World) {
  const { fake, company } = world;
  fake.addLedger(company, {
    guid: 'led-a',
    name: 'Asha Traders',
    mobile: '9876500001',
    gstin: '10ABCDE1234F1Z5',
  });
  fake.addLedger(company, { guid: 'led-b', name: 'राम सीमेंट', opening: -500000n });
  fake.addLedger(company, {
    guid: 'led-c',
    name: 'Supplier One',
    class: 'CREDITOR',
    opening: 7000000n,
  });
  fake.sale(company, {
    guid: 'v-1',
    date: dayShift(today, -40),
    party: 'Asha Traders',
    paise: 1000000n,
    type: 'GST Sale',
  });
  fake.receipt(company, {
    guid: 'v-2',
    date: dayShift(today, -20),
    party: 'Asha Traders',
    paise: 250000n,
  });
  fake.sale(company, {
    guid: 'v-3',
    date: dayShift(today, -3),
    party: 'राम सीमेंट',
    paise: 123450n,
  });
}
/** Turned on by a person, after which the first morning's copy runs to the end. */
async function approveAndCopy(world: World, windowDays = 400) {
  world.agent.lastProbeAt = 0;
  await world.agent.tick();
  const company = await db.tallyCompany.findFirstOrThrow();
  expect(company.role).toBe('PENDING');
  await post('owner', `companies/${company.id}`, { role: 'PRIMARY' }).expect(201);
  // One big window keeps most journeys short. One journey below goes the long way, a week at a time.
  await db.tallyCompany.update({
    where: { id: company.id },
    data: { backfillWindowDays: windowDays },
  });
  await settle(world);
  return company.id;
}

beforeAll(async () => {
  const { createApp } = await import('../src/app');
  app = await createApp();
  await app.listen(0, '127.0.0.1');
  server = app.getHttpServer();
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  db = app.get(Db);
  ingest = app.get(TallyIngest);
  recon = app.get(TallyRecon);
}, 30000);
beforeEach(async () => {
  await clearTally(db);
  await db.$executeRawUnsafe(
    'TRUNCATE TABLE "User", "AuditLog", "AuthRateLimit", "OtpChallenge", "Notification" RESTART IDENTITY CASCADE',
  );
  let phone = 9000008000;
  for (const [id, role] of [
    ['owner', 'OWNER'],
    ['accountant', 'ACCOUNTANT'],
    ['tech', 'TECH_OPERATOR'],
  ] as const)
    await addPerson(db, { id, role, phone: `+91${++phone}` });
  await addPerson(db, { id: 'customer', phone: '+919876500001' });
});
afterEach(async () => {
  for (const dir of folders.splice(0)) rmSync(dir, { recursive: true, force: true });
});
afterAll(async () => {
  await app?.close();
});

describe('the whole road: PC, API, database', () => {
  it('copies a company, and proves every party to the paisa', async () => {
    const world = await setup();
    await bench(world);
    const companyId = await approveAndCopy(world);
    const company = await db.tallyCompany.findUniqueOrThrow({ where: { id: companyId } });
    expect(company.phase).toBe('LIVE');
    expect(company.tieOut).toMatchObject({ status: 'OK', total: 3, failed: 0 });
    expect(company.freshAt).toBeTruthy();
    const ledgers = await db.tallyLedger.findMany({ orderBy: { guid: 'asc' } });
    expect(ledgers.map((row) => [row.guid, row.name, row.closingPaise, row.tieOutOk])).toEqual([
      ['led-a', 'Asha Traders', -750000n, true],
      ['led-b', 'राम सीमेंट', -623450n, true],
      ['led-c', 'Supplier One', 7000000n, true],
    ]);
    expect(ledgers[0]!.phones).toEqual(['+919876500001']);
    expect(ledgers[0]!.gstin).toBe('10ABCDE1234F1Z5');
    expect(await db.tallyVoucher.count()).toBe(3);
    expect(await db.tallyVoucherItem.count()).toBe(2);
    expect((await db.tallyVoucher.findFirstOrThrow({ where: { guid: 'v-1' } })).baseType).toBe(
      'Sales',
    );
    await world.tally.close();
  });
  it('every request Tally ever heard was an Export, in UTF-16, and it never asked to write', async () => {
    const world = await setup();
    await bench(world);
    await approveAndCopy(world);
    expect(world.tally.requests.length).toBeGreaterThan(20);
    expect(world.tally.writeAttempts ?? 0).toBe(0);
    for (const row of world.tally.requests) {
      expect(row.utf16).toBe(true);
      expect(row.body).toContain('<TALLYREQUEST>Export</TALLYREQUEST>');
    }
    await world.tally.close();
  });
  it('the long way: a week at a time, newest first, to the same result', async () => {
    const world = await setup();
    await bench(world);
    await approveAndCopy(world, 7);
    expect((await db.tallyCompany.findFirstOrThrow()).tieOut).toMatchObject({
      status: 'OK',
      failed: 0,
    });
    const windows = await db.tallySyncJob.count({ where: { kind: 'WINDOW' } });
    expect(windows).toBeGreaterThan(20);
    await world.tally.close();
  }, 60000);
  it('the status page says so, in states and counts', async () => {
    const world = await setup();
    await bench(world);
    await approveAndCopy(world);
    const { body } = await get('tech', 'health').expect(200);
    expect(body.connected).toBe(true);
    expect(body.devices[0]).toMatchObject({
      state: 'OK',
      paused: false,
      revoked: false,
      version: '1.0.0',
    });
    expect(body.companies[0]).toMatchObject({ phase: 'LIVE', copiedPercent: 100, vouchers: 3 });
    expect(body.companies[0].tieOut).toMatchObject({ status: 'OK', total: 3, failed: 0 });
    await world.tally.close();
  });
  it('a sale typed later: mirrored, proved, and its time moves on', async () => {
    const world = await setup();
    await bench(world);
    const companyId = await approveAndCopy(world);
    const before = (await db.tallyCompany.findUniqueOrThrow({ where: { id: companyId } })).freshAt!;
    world.fake.sale(world.company, {
      guid: 'v-4',
      date: today,
      party: 'Asha Traders',
      paise: 50000n,
    });
    await new Promise((resolve) => setTimeout(resolve, 5));
    await settle(world);
    const led = await db.tallyLedger.findFirstOrThrow({ where: { guid: 'led-a' } });
    expect(led).toMatchObject({ closingPaise: -800000n, tieOutOk: true });
    const company = await db.tallyCompany.findUniqueOrThrow({ where: { id: companyId } });
    expect(company.tieOut).toMatchObject({ status: 'OK' });
    expect(company.freshAt!.getTime()).toBeGreaterThan(before.getTime());
    expect(await db.tallySyncJob.count({ where: { kind: 'DELTA', status: 'APPLIED' } })).toBe(1);
    await world.tally.close();
  });
  it('nothing changed in Tally: only its marks are read, and the time still moves', async () => {
    const world = await setup();
    await bench(world);
    const companyId = await approveAndCopy(world);
    const asked = world.tally.requests.length;
    const before = (await db.tallyCompany.findUniqueOrThrow({ where: { id: companyId } })).freshAt!;
    await new Promise((resolve) => setTimeout(resolve, 5));
    world.agent.lastProbeAt = 0;
    const reply = await world.agent.tick();
    expect(reply.job).toBeNull();
    const fresh = world.tally.requests.slice(asked);
    expect(fresh).toHaveLength(1);
    for (const row of fresh) expect(row.body).toContain('<TYPE>Company</TYPE>');
    expect(
      (await db.tallyCompany.findUniqueOrThrow({ where: { id: companyId } })).freshAt!.getTime(),
    ).toBeGreaterThan(before.getTime());
    await world.tally.close();
  });
  it('a back-dated bill and an alteration: mirrored, logged and proved', async () => {
    const world = await setup();
    await bench(world);
    await approveAndCopy(world);
    world.fake.sale(world.company, {
      guid: 'v-back',
      date: dayShift(today, -100),
      party: 'Asha Traders',
      paise: 11100n,
    });
    world.fake.alterVoucher(world.company, 'v-1', {
      lines: [
        { ledger: 'Asha Traders', amount: -900000n },
        { ledger: 'Sales Account', amount: 900000n },
      ],
      items: [{ item: 'Test Cement PPC', qty: '9 Bag', rate: '1000/Bag', amount: 900000n }],
    });
    await settle(world);
    const led = await db.tallyLedger.findFirstOrThrow({ where: { guid: 'led-a' } });
    expect(led).toMatchObject({ closingPaise: -661100n, tieOutOk: true });
    const change = await db.tallyVoucherChange.findFirstOrThrow({ where: { kind: 'ALTERED' } });
    expect(change).toMatchObject({ oldAmountPaise: -1000000n, newAmountPaise: -900000n });
    await world.tally.close();
  });
  it('a delete: nothing marks it, the morning’s sweep finds it, and the proof still holds', async () => {
    const world = await setup();
    await bench(world);
    const companyId = await approveAndCopy(world);
    world.fake.removeVoucher(world.company, 'v-3');
    await db.tallyCompany.update({
      where: { id: companyId },
      data: { lastSweepOn: dayShift(today, -1) },
    });
    await settle(world);
    expect(
      (await db.tallyVoucher.findFirstOrThrow({ where: { guid: 'v-3' } })).deletedAt,
    ).toBeTruthy();
    expect(await db.tallyVoucherChange.count({ where: { kind: 'DELETED' } })).toBe(1);
    const led = await db.tallyLedger.findFirstOrThrow({ where: { guid: 'led-b' } });
    expect(led).toMatchObject({ closingPaise: -500000n, tieOutOk: true });
    expect(
      (await db.tallyCompany.findUniqueOrThrow({ where: { id: companyId } })).tieOut,
    ).toMatchObject({ status: 'OK' });
    await world.tally.close();
  });
  it('a ledger renamed in Tally: same row, link held, and old lines still count', async () => {
    const world = await setup();
    await bench(world);
    await approveAndCopy(world);
    const row = await db.tallyLedger.findFirstOrThrow({ where: { guid: 'led-a' } });
    await post('owner', `parties/${row.id}/link`, { userId: 'customer', method: 'PHONE' }).expect(
      201,
    );
    const ledger = world.company.ledgers.find((entry: { guid: string }) => entry.guid === 'led-a');
    ledger.name = 'Asha Traders (New)';
    world.company.vouchers.forEach((voucher: { lines: { ledger: string }[]; party: string }) => {
      if (voucher.party === 'Asha Traders') voucher.party = 'Asha Traders (New)';
      for (const line of voucher.lines)
        if (line.ledger === 'Asha Traders') line.ledger = 'Asha Traders (New)';
    });
    world.company.altMstId += 1n;
    await settle(world);
    const after = await db.tallyLedger.findUniqueOrThrow({ where: { id: row.id } });
    expect(after).toMatchObject({
      name: 'Asha Traders (New)',
      tieOutOk: true,
      closingPaise: -750000n,
    });
    const numbers = await get('accountant', 'customers/customer/numbers').expect(200);
    expect(numbers.body.parties[0].name).toBe('Asha Traders (New)');
    expect(numbers.body.tally.closingPaise).toBe('-750000');
    await world.tally.close();
  });
  it('a backup restored over Tally: marks fall, it reads everything again, and the links hold', async () => {
    const world = await setup();
    await bench(world);
    const companyId = await approveAndCopy(world);
    const row = await db.tallyLedger.findFirstOrThrow({ where: { guid: 'led-a' } });
    await post('owner', `parties/${row.id}/link`, { userId: 'customer' }).expect(201);
    world.fake.removeVoucher(world.company, 'v-2');
    world.company.altVchId = 1n;
    world.company.vouchers.find((voucher: { guid: string }) => voucher.guid === 'v-1').alterId = 1n;
    world.company.vouchers.find((voucher: { guid: string }) => voucher.guid === 'v-3').alterId = 1n;
    world.agent.lastProbeAt = 0;
    await world.agent.beat();
    const fallen = await db.tallyCompany.findUniqueOrThrow({ where: { id: companyId } });
    expect(fallen.rewrittenAt).toBeTruthy();
    expect(fallen.tieOut).toMatchObject({ status: 'REWRITTEN' });
    await db.tallyCompany.update({ where: { id: companyId }, data: { backfillWindowDays: 400 } });
    await settle(world);
    const after = await db.tallyCompany.findUniqueOrThrow({ where: { id: companyId } });
    expect(after.phase).toBe('LIVE');
    expect(after.rewrittenAt).toBeNull();
    expect(after.tieOut).toMatchObject({ status: 'OK' });
    expect(
      (await db.tallyVoucher.findFirstOrThrow({ where: { guid: 'v-2' } })).deletedAt,
    ).toBeTruthy();
    expect((await db.tallyPartyLink.findFirstOrThrow()).userId).toBe('customer');
    await world.tally.close();
  }, 60000);
  it('Tally closed: says so, keeps reporting, and carries on by itself when it opens', async () => {
    const world = await setup();
    await bench(world);
    await approveAndCopy(world);
    const port = world.tally.port;
    await world.tally.close();
    world.agent.lastProbeAt = 0;
    await world.agent.tick();
    const device = await db.tallyDevice.findFirstOrThrow();
    expect(device.state).toBe('TALLY_CLOSED');
    expect(device.lastHeartbeatAt).toBeTruthy();
    const again = new world.fake.FakeTally({ companies: [world.company] });
    await again.listen(port);
    world.fake.sale(world.company, {
      guid: 'v-5',
      date: today,
      party: 'Asha Traders',
      paise: 1000n,
    });
    await settle(world);
    expect((await db.tallyDevice.findFirstOrThrow()).state).toBe('OK');
    expect((await db.tallyLedger.findFirstOrThrow({ where: { guid: 'led-a' } })).closingPaise).toBe(
      -751000n,
    );
    await again.close();
  });
  it('a company closed in Tally mid-life: said plainly, and the mirror keeps its numbers', async () => {
    const world = await setup();
    await bench(world);
    await approveAndCopy(world);
    const held = world.tally.companies;
    world.tally.companies = [];
    world.agent.lastProbeAt = 0;
    await world.agent.tick();
    expect((await db.tallyDevice.findFirstOrThrow()).state).toBe('NO_COMPANY');
    expect((await db.tallyLedger.findFirstOrThrow({ where: { guid: 'led-a' } })).closingPaise).toBe(
      -750000n,
    );
    world.tally.companies = held;
    await world.tally.close();
  });
  it('two companies open: only the one a person chose is copied', async () => {
    const world = await setup();
    await bench(world);
    world.tally.companies.push(
      world.fake.makeCompany({ guid: 'co-other', name: 'Private Family Books' }),
    );
    world.agent.lastProbeAt = 0;
    await world.agent.tick();
    const chosen = await db.tallyCompany.findUniqueOrThrow({ where: { guid: 'co-guid-0001' } });
    await post('owner', `companies/${chosen.id}`, { role: 'PRIMARY' }).expect(201);
    await db.tallyCompany.update({ where: { id: chosen.id }, data: { backfillWindowDays: 400 } });
    await settle(world);
    const asks = world.tally.requests
      .map((row: { body: string }) => row.body)
      .filter((body: string) => body.includes('Private Family Books'));
    expect(asks).toEqual([]);
    const other = await db.tallyCompany.findUniqueOrThrow({ where: { guid: 'co-other' } });
    expect(other.role).toBe('PENDING');
    expect(await db.tallyLedger.count({ where: { companyId: other.id } })).toBe(0);
    await world.tally.close();
  });
  it('a second PC with the same company stays out, and cannot change anything', async () => {
    const world = await setup();
    await bench(world);
    await approveAndCopy(world);
    const second = await setup({ companies: [world.company] });
    second.agent.lastProbeAt = 0;
    const reply = await second.agent.tick();
    expect(reply.job).toBeNull();
    expect(reply.companies).toEqual([{ guid: 'co-guid-0001', status: 'OWNED_ELSEWHERE' }]);
    expect((await db.tallyCompany.findFirstOrThrow()).ownerDeviceId).toBe(world.deviceId);
    await world.tally.close();
    await second.tally.close();
  });
  it('a Tally that answers short: the count catches it, and nothing moves', async () => {
    const world = await setup();
    await bench(world);
    world.tally.quirks.shortBy = 1;
    world.agent.lastProbeAt = 0;
    await world.agent.tick();
    const company = await db.tallyCompany.findFirstOrThrow();
    await post('owner', `companies/${company.id}`, { role: 'PRIMARY' }).expect(201);
    await db.tallyCompany.update({
      where: { id: company.id },
      data: { lastFailureAt: new Date(Date.now() - 3600000) },
    });
    world.agent.lastProbeAt = 0;
    const reply = await world.agent.tick();
    expect(reply.job.kind).toBe('MASTERS');
    await ingest.runDue();
    expect((await db.tallySyncJob.findFirstOrThrow()).error).toBe('COUNT_SHORT');
    expect(await db.tallyLedger.count()).toBe(0);
    world.tally.quirks.shortBy = 0;
    await settle(world);
    expect((await db.tallyCompany.findFirstOrThrow()).tieOut).toMatchObject({ status: 'OK' });
    await world.tally.close();
  });
  it('a Tally that ignores the date window: rows outside it are dropped, and the copy still holds', async () => {
    const world = await setup();
    await bench(world);
    world.tally.quirks.ignoreDates = true;
    const companyId = await approveAndCopy(world, 30);
    expect(
      (await db.tallyCompany.findUniqueOrThrow({ where: { id: companyId } })).tieOut,
    ).toMatchObject({ status: 'OK', failed: 0 });
    expect(await db.tallyVoucher.count()).toBe(3);
    await world.tally.close();
  }, 60000);
  it('a jammed Tally mid-copy: it stops asking, and the company waits', async () => {
    const world = await setup();
    await bench(world);
    world.agent.tally.idleMs = 50;
    world.agent.tally.requestMs = 100;
    world.agent.lastProbeAt = 0;
    await world.agent.tick();
    const company = await db.tallyCompany.findFirstOrThrow();
    await post('owner', `companies/${company.id}`, { role: 'PRIMARY' }).expect(201);
    // The marks answer; then Tally jams as soon as the job starts asking.
    const realSmall = world.agent.tally.small.bind(world.agent.tally);
    let asked = 0;
    world.agent.tally.small = async (xml: string, max?: number) => {
      const answer = await realSmall(xml, max);
      if (++asked >= 2) world.tally.quirks.hang = true;
      return answer;
    };
    world.agent.lastProbeAt = 0;
    await world.agent.tick();
    expect(await db.tallySyncJob.count({ where: { status: 'FAILED', error: 'BUSY' } })).toBe(1);
    expect(world.agent.holdUntil).toBeGreaterThan(Date.now());
    world.tally.quirks.hang = false;
    await world.tally.close();
  });
  it('garbled XML from Tally: its own state, no job, and the mirror untouched', async () => {
    const world = await setup();
    await bench(world);
    const companyId = await approveAndCopy(world);
    const before = await db.tallyCompany.findUniqueOrThrow({ where: { id: companyId } });
    world.tally.quirks.garbled = true;
    world.agent.lastProbeAt = 0;
    const reply = await world.agent.tick();
    expect(reply.job).toBeNull();
    expect((await db.tallyDevice.findFirstOrThrow()).state).toBe('BAD_ANSWER');
    const after = await db.tallyCompany.findUniqueOrThrow({ where: { id: companyId } });
    expect(after.altVchId).toBe(before.altVchId);
    expect(after.freshAt).toEqual(before.freshAt);
    world.tally.quirks.garbled = false;
    await world.tally.close();
  });
  it('an XML bomb from Tally’s port goes no further than its own state', async () => {
    const world = await setup();
    await bench(world);
    world.tally.quirks.dtd = true;
    world.agent.lastProbeAt = 0;
    await world.agent.tick();
    expect((await db.tallyDevice.findFirstOrThrow()).state).toBe('BAD_ANSWER');
    expect(await db.tallyCompany.count()).toBe(0);
    await world.tally.close();
  });
  it('an answer far too big stops at the cap, is reported, and nothing is kept', async () => {
    const world = await setup();
    await bench(world);
    world.agent.lastProbeAt = 0;
    await world.agent.tick();
    const company = await db.tallyCompany.findFirstOrThrow();
    await post('owner', `companies/${company.id}`, { role: 'PRIMARY' }).expect(201);
    world.agent.tally.maxBytes = 200 * 1024;
    const realSmall = world.agent.tally.small.bind(world.agent.tally);
    let asked = 0;
    world.agent.tally.small = async (xml: string, max?: number) => {
      const answer = await realSmall(xml, max);
      if (++asked >= 1) world.tally.quirks.huge = 50 * 1024 * 1024;
      return answer;
    };
    world.agent.lastProbeAt = 0;
    await world.agent.tick();
    const job = await db.tallySyncJob.findFirstOrThrow();
    expect(job).toMatchObject({ status: 'FAILED', error: 'TOO_BIG' });
    expect(await db.tallyLedger.count()).toBe(0);
    expect(await world.spool.pending()).toEqual([]);
    world.tally.quirks.huge = 0;
    await world.tally.close();
  });
  it('a company closed in Tally does not hold up one that is open', async () => {
    const world = await setup();
    await bench(world);
    const other = world.fake.makeCompany({ guid: 'co-two', name: 'Bench Two' });
    world.tally.companies.push(other);
    world.agent.lastProbeAt = 0;
    await world.agent.tick();
    for (const row of await db.tallyCompany.findMany())
      await post('owner', `companies/${row.id}`, { role: 'PRIMARY' }).expect(201);
    await db.tallyCompany.updateMany({ data: { backfillWindowDays: 400 } });
    world.tally.companies = [other];
    await settle(world);
    expect(await db.tallySyncJob.count({ where: { status: 'FAILED' } })).toBe(0);
    const two = await db.tallyCompany.findUniqueOrThrow({ where: { guid: 'co-two' } });
    expect(two.phase).toBe('LIVE');
    await world.tally.close();
  });
  it('a pulled cable mid-copy: it picks up where it left off, and the count still matches', async () => {
    const world = await setup();
    await bench(world);
    world.agent.lastProbeAt = 0;
    await world.agent.tick();
    const company = await db.tallyCompany.findFirstOrThrow();
    await post('owner', `companies/${company.id}`, { role: 'PRIMARY' }).expect(201);
    await db.tallyCompany.update({ where: { id: company.id }, data: { backfillWindowDays: 400 } });
    const realChunk = world.api.chunk.bind(world.api);
    let cuts = 0;
    world.api.chunk = async (...args: unknown[]) => {
      if (cuts++ === 2) throw new TypeError('fetch failed');
      return realChunk(...args);
    };
    world.agent.lastProbeAt = 0;
    await world.agent.tick();
    expect((await world.spool.pending()).length).toBe(1);
    world.agent.uploadHoldUntil = 0;
    await settle(world);
    expect((await db.tallyCompany.findFirstOrThrow()).tieOut).toMatchObject({ status: 'OK' });
    expect(await db.tallyVoucher.count()).toBe(3);
    await world.tally.close();
  });
  it('the same upload sent again after a lost reply changes nothing', async () => {
    const world = await setup();
    await bench(world);
    world.agent.lastProbeAt = 0;
    await world.agent.tick();
    const company = await db.tallyCompany.findFirstOrThrow();
    await post('owner', `companies/${company.id}`, { role: 'PRIMARY' }).expect(201);
    await db.tallyCompany.update({ where: { id: company.id }, data: { backfillWindowDays: 400 } });
    const realFinish = world.api.finish.bind(world.api);
    let lost = 0;
    world.api.finish = async (...args: unknown[]) => {
      const reply = await realFinish(...args);
      if (lost++ === 0) throw new TypeError('reply never arrived');
      return reply;
    };
    world.agent.lastProbeAt = 0;
    await world.agent.tick();
    world.agent.uploadHoldUntil = 0;
    await settle(world);
    expect(await db.tallyLedger.count()).toBe(3);
    expect(await db.tallyVoucherLine.count()).toBe(6);
    expect((await db.tallyCompany.findFirstOrThrow()).tieOut).toMatchObject({ status: 'OK' });
    await world.tally.close();
  });
  it('a PC with a wrong clock and a lost counter puts itself right', async () => {
    const world = await setup();
    await bench(world);
    world.api.now = () => Date.now() - 3 * 86400000;
    world.api.offsetMs = 0;
    world.agent.lastProbeAt = 0;
    const reply = await world.agent.tick();
    expect(reply).toBeTruthy();
    world.api.now = () => Date.now();
    world.api.offsetMs = 0;
    world.api.state.seq = 5;
    world.agent.lastProbeAt = 0;
    expect(await world.agent.tick()).toBeTruthy();
    await world.tally.close();
  });
  it('revoked from the desk: the real program stops, and wipes its spool', async () => {
    const world = await setup();
    await bench(world);
    await approveAndCopy(world);
    await post('tech', `devices/${world.deviceId}/revoke`).expect(201);
    world.agent.lastProbeAt = 0;
    await world.agent.tick();
    expect(world.agent.stopped).toBe('REVOKED');
    expect((await world.spool.pending()).length).toBe(0);
    await world.tally.close();
  });
  it('Bridge roko: the real program asks Tally nothing at all, until told', async () => {
    const world = await setup();
    await bench(world);
    await approveAndCopy(world);
    await post('owner', 'pause', { paused: true }).expect(201);
    world.agent.lastProbeAt = 0;
    await world.agent.tick();
    const asked = world.tally.requests.length;
    world.fake.sale(world.company, {
      guid: 'v-p',
      date: today,
      party: 'Asha Traders',
      paise: 1000n,
    });
    for (let turn = 0; turn < 3; turn++) {
      world.agent.lastProbeAt = 0;
      await world.agent.tick();
    }
    expect(world.tally.requests.length).toBe(asked);
    await post('owner', 'pause', { paused: false }).expect(201);
    world.agent.lastProbeAt = 0;
    await world.agent.tick();
    await settle(world);
    expect((await db.tallyLedger.findFirstOrThrow({ where: { guid: 'led-a' } })).closingPaise).toBe(
      -751000n,
    );
    await world.tally.close();
  });
  it('a hacked server’s job is refused by the program itself, and Tally hears nothing', async () => {
    const world = await setup();
    await bench(world);
    const asked = world.tally.requests.length;
    const realFinish = world.api.finish.bind(world.api);
    const reports: { error?: string }[] = [];
    world.api.finish = async (_id: string, body: { error?: string }) => {
      reports.push(body);
      return { status: 'FAILED' };
    };
    await world.agent.runJob({
      id: 'job_hackedone',
      kind: 'MASTERS',
      reads: [{ read: 'import', params: { company: 'x' } }],
    });
    await world.agent.runJob({
      id: 'job_hackedtwo',
      kind: 'MASTERS',
      reads: [
        {
          read: 'vouchers',
          params: { company: 'x', after: '1', upto: '2', types: ['Sales" OR 1=1 OR "'] },
        },
      ],
    });
    expect(reports.map((row) => row.error)).toEqual(['BAD_JOB', 'BAD_JOB']);
    expect(world.tally.requests.length).toBe(asked);
    world.api.finish = realFinish;
    await world.tally.close();
  });
  describe('a signed update, through the desk, to the real program', () => {
    async function release() {
      const { makeRelease } = await load('tools/sign-release.mjs');
      const { Updater } = await load('src/update.mjs');
      const { AGENT_VERSION } = await load('src/version.mjs');
      const keys = generateKeyPairSync('ed25519');
      const made = makeRelease({
        version: AGENT_VERSION,
        keyPem: keys.privateKey.export({ format: 'pem', type: 'pkcs8' }),
        sourceDir: fileURLToPath(bridgeFile('src/')),
      });
      await post('tech', 'releases', made).expect(201);
      const world = await setup();
      let ready = 0;
      world.agent.updater = new Updater({
        dataDir: world.dir,
        currentVersion: '0.9.0',
        publicKeyPem: keys.publicKey.export({ format: 'pem', type: 'spki' }),
        onReady: () => ready++,
      });
      world.agent.version = '0.9.0';
      return { world, version: AGENT_VERSION as string, ready: () => ready };
    }
    it('arrives only when a person chose it, and is unpacked for the launcher', async () => {
      const { world, version, ready } = await release();
      world.agent.lastProbeAt = 0;
      await world.agent.tick();
      expect(ready()).toBe(0);
      await post('tech', `devices/${world.deviceId}/release`, { version }).expect(201);
      world.agent.lastProbeAt = 0;
      await world.agent.tick();
      expect(ready()).toBe(1);
      expect(existsSync(join(world.dir, 'versions', version, 'main.mjs'))).toBe(true);
      expect(JSON.parse(readFileSync(join(world.dir, 'pending.json'), 'utf8'))).toEqual({
        version,
      });
      await world.tally.close();
    });
    it('changed on the server, it is refused, and nothing reaches the disk', async () => {
      const { world, version, ready } = await release();
      const held = await db.tallyRelease.findUniqueOrThrow({ where: { version } });
      await db.tallyRelease.update({
        where: { version },
        data: {
          files: {
            ...(held.files as Record<string, string>),
            'main.mjs': Buffer.from('process.exit(0);').toString('base64'),
          },
        },
      });
      await post('tech', `devices/${world.deviceId}/release`, { version }).expect(201);
      world.agent.lastProbeAt = 0;
      await world.agent.tick();
      expect(ready()).toBe(0);
      expect(existsSync(join(world.dir, 'versions', version))).toBe(false);
      expect(existsSync(join(world.dir, 'pending.json'))).toBe(false);
      await world.tally.close();
    });
  });
  it('the first number on the customer page comes all the way from Tally', async () => {
    const world = await setup();
    await bench(world);
    await approveAndCopy(world);
    const { body: list } = await get('accountant', 'parties').expect(200);
    const asha = list.items.find((row: { name: string }) => row.name === 'Asha Traders');
    expect(asha.suggestions[0]).toMatchObject({ userId: 'customer', by: 'PHONE' });
    await post('accountant', `parties/${asha.id}/link`, {
      userId: 'customer',
      method: 'PHONE',
      score: 100,
    }).expect(201);
    const { body } = await get('owner', 'customers/customer/numbers').expect(200);
    expect(body.state).toBe('READY');
    expect(body.khataPaise).toBe(0);
    expect(body.tally).toMatchObject({
      closingPaise: '-750000',
      appEquivalentPaise: '750000',
      tieOut: 'OK',
      stale: false,
      differencePaise: '-750000',
      unexplainedPaise: '0',
    });
    expect(
      body.lines
        .map((line: { reason: string; amountPaise: string }) => [line.reason, line.amountPaise])
        .sort(),
    ).toEqual([
      ['TALLY_ONLY', '-1000000'],
      ['TALLY_ONLY', '250000'],
    ]);
    await recon.runDue();
    expect((await get('owner', 'differences').expect(200)).body.items[0]).toMatchObject({
      customerId: 'customer',
      differencePaise: '-750000',
      unexplainedPaise: '0',
    });
    await world.tally.close();
  });
  it('non-ASCII names, formulas and scripts make the whole road and stay plain text', async () => {
    const world = await setup();
    const { fake, company } = world;
    fake.addLedger(company, { guid: 'x1', name: 'शिव & सन्स "पटना" <b>' });
    fake.addLedger(company, { guid: 'x2', name: '=CMD|calc!A1' });
    fake.addLedger(company, { guid: 'x3', name: '<script>alert(1)</script>' });
    fake.sale(company, {
      guid: 'vx',
      date: dayShift(today, -1),
      party: 'शिव & सन्स "पटना" <b>',
      paise: 100n,
    });
    await approveAndCopy(world);
    const names = (await db.tallyLedger.findMany()).map((row) => row.name).sort();
    expect(names).toEqual(
      ['<script>alert(1)</script>', '=CMD|calc!A1', 'शिव & सन्स "पटना" <b>'].sort(),
    );
    expect((await db.tallyCompany.findFirstOrThrow()).tieOut).toMatchObject({
      status: 'OK',
      failed: 0,
    });
    const res = await get('owner', 'parties').expect(200);
    expect(res.headers['content-type']).toMatch(/application\/json/);
    expect(res.text).toContain('<script>alert(1)</script>');
    await world.tally.close();
  });
});
