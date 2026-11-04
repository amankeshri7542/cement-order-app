import type { WaService } from '../src/whatsapp/service';
import 'reflect-metadata';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { existsSync } from 'node:fs';
import type { Server } from 'node:http';
import { loadEnvFile } from 'node:process';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { Db } from '../src/db';
import { AlertsService } from '../src/alerts';
import { hash } from '../src/http';
import { Maintenance } from '../src/integrations';
import { KhataService } from '../src/khata';
import type { OrdersService } from '../src/orders';
import type { OwnerWorkService } from '../src/owner-work';
import { addPerson } from './staff-helper';

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
process.env.OTP_HASH_SECRET = 'worker-test-only-secret-not-for-production';
process.env.CORS_ORIGINS = 'http://localhost:3000';
process.env.WEB_PUSH_PUBLIC_KEY = 'B'.repeat(87);
process.env.WEB_PUSH_PRIVATE_KEY = 'p'.repeat(43);
process.env.WEB_PUSH_SUBJECT = 'mailto:test@example.test';
if (!process.env.DATABASE_URL || !new URL(process.env.DATABASE_URL).pathname.endsWith('_test'))
  throw new Error('Worker tests require a dedicated TEST_DATABASE_URL ending in _test.');

let app: INestApplication;
let server: Server;
let db: Db;
const silently = async <T>(run: () => Promise<T>) => {
  const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
  try {
    return await run();
  } finally {
    spy.mockRestore();
  }
};
function worker(
  steps: {
    expireReservations?: () => Promise<unknown>;
    dispatch?: () => Promise<unknown>;
    deliver?: () => Promise<unknown>;
  } = {},
) {
  return new Maintenance(
    db,
    {
      expireReservations: steps.expireReservations ?? (async () => ({})),
    } as unknown as OrdersService,
    { dispatch: steps.dispatch ?? (async () => {}) } as unknown as OwnerWorkService,
    { deliver: steps.deliver ?? (async () => {}) } as unknown as AlertsService,
    new KhataService(db),
    { runDue: async () => 0, purge: async () => {} } as unknown as WaService,
  );
}
const ack = (token: unknown) => request(server).post('/api/v1/admin/push/ack').send({ token });

beforeAll(async () => {
  const { createApp } = await import('../src/app');
  app = await createApp();
  await app.listen(0, '127.0.0.1');
  server = app.getHttpServer();
  db = app.get(Db);
}, 30000);
beforeEach(async () => {
  await db.$executeRawUnsafe(
    'TRUNCATE TABLE "PriceUpdateBatch", "RateSource", "FinancialMovement", "User", "Category", "Product", "Order", "Quote", "AuditLog", "OtpChallenge", "AuthRateLimit", "DeliveryZone", "StoreSettings", "WorkerHeartbeat", "OutboundMessage" RESTART IDENTITY CASCADE',
  );
  push.send.mockClear();
  await addPerson(db, { id: 'owner', role: 'OWNER', phone: '+919000000701' });
  await db.pushSubscription.create({
    data: { userId: 'owner', endpoint: 'https://fcm.googleapis.com/phone', p256dh: 'p', auth: 'a' },
  });
});
afterEach(() => vi.restoreAllMocks());
afterAll(async () => {
  await app?.close();
});

describe('worker lanes', () => {
  it('each lane records when it last ran', async () => {
    await worker().runLane('fast');
    const rows = await db.workerHeartbeat.findMany();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ lane: 'fast', lastStep: '' });
    expect(rows[0]?.lastOkAt).toBeTruthy();
  });
  it('a failed step is named, the others still run, and the last good time stays put', async () => {
    const after = vi.fn(async () => {});
    await worker().runLane('fast');
    const good = await db.workerHeartbeat.findUniqueOrThrow({ where: { lane: 'fast' } });
    await new Promise((resolve) => setTimeout(resolve, 5));
    await silently(() =>
      worker({
        dispatch: async () => {
          throw new Error('provider down');
        },
        deliver: after,
      }).runLane('fast'),
    );
    expect(after).toHaveBeenCalledOnce();
    const failed = await db.workerHeartbeat.findUniqueOrThrow({ where: { lane: 'fast' } });
    expect(failed.lastStep).toBe('ownerWork');
    expect(failed.lastOkAt).toEqual(good.lastOkAt);
    expect(failed.lastRunAt.getTime()).toBeGreaterThan(good.lastRunAt.getTime());
  });
  it('a stuck provider in one lane does not hold up the other', async () => {
    let release = () => {};
    const stuck = new Promise<void>((resolve) => {
      release = resolve;
    });
    const instance = worker({ deliver: () => stuck });
    const fast = instance.runLane('fast');
    await instance.runLane('timers');
    expect(await db.workerHeartbeat.count({ where: { lane: 'timers' } })).toBe(1);
    expect(await db.workerHeartbeat.count({ where: { lane: 'fast' } })).toBe(0);
    release();
    await fast;
  });
  it('held stock is released even while every messaging service hangs', async () => {
    let release = () => {};
    const stuck = new Promise<void>((resolve) => {
      release = resolve;
    });
    const expire = vi.fn(async () => ({}));
    const instance = worker({ deliver: () => stuck, expireReservations: expire });
    const fast = instance.runLane('fast');
    await instance.runLane('release');
    expect(expire).toHaveBeenCalledOnce();
    release();
    await fast;
  });
  it('a lane that is still running is not started twice', async () => {
    let release = () => {};
    const stuck = new Promise<void>((resolve) => {
      release = resolve;
    });
    const deliver = vi.fn(() => stuck);
    const instance = worker({ deliver });
    const first = instance.runLane('fast');
    await instance.runLane('fast');
    release();
    await first;
    expect(deliver).toHaveBeenCalledOnce();
  });
  it('a heartbeat failure never stops the work', async () => {
    const run = vi.fn(async () => {});
    const instance = worker({ deliver: run });
    const original = db.workerHeartbeat.upsert;
    vi.spyOn(db.workerHeartbeat, 'upsert').mockRejectedValue(new Error('no grant'));
    await silently(() => instance.runLane('fast'));
    expect(run).toHaveBeenCalledOnce();
    void original;
  });
  it('old action tokens are cleared by housekeeping', async () => {
    for (const [tokenHash, age] of [
      ['old', 2 * 86400000],
      ['new', -3600000],
    ] as const)
      await db.pushActionToken.create({
        data: {
          tokenHash,
          userId: 'owner',
          notificationId: 'n',
          purpose: 'ack',
          expiresAt: new Date(Date.now() - age),
        },
      });
    await worker().runLane('timers');
    expect((await db.pushActionToken.findMany()).map((row) => row.tokenHash)).toEqual(['new']);
  });
  it('the system page can see the lanes, and only the people who run the system', async () => {
    await addPerson(db, { id: 'tech', role: 'TECH_OPERATOR', phone: '+919000000702' });
    await addPerson(db, {
      id: 'cashier',
      role: 'CASHIER',
      shops: ['loc_main'],
      phone: '+919000000703',
    });
    await worker().runLane('fast');
    const { tokenFor } = await import('./staff-helper');
    const { body } = await request(server)
      .get('/api/v1/admin/security-status')
      .set('Authorization', `Bearer ${tokenFor('tech')}`)
      .expect(200);
    expect(body.workers[0]).toMatchObject({ lane: 'fast', lastStep: '' });
    await request(server)
      .get('/api/v1/admin/security-status')
      .set('Authorization', `Bearer ${tokenFor('cashier')}`)
      .expect(403);
  });
});

describe('where the work runs', () => {
  it('a web process starts no background work', async () => {
    const config = await import('../src/config');
    const real = config.getConfig();
    vi.spyOn(config, 'getConfig').mockReturnValue({
      ...real,
      NODE_ENV: 'production',
      SHIV_ROLE: 'web',
    });
    const timers = vi.spyOn(globalThis, 'setInterval');
    worker().onModuleInit();
    expect(timers).not.toHaveBeenCalled();
  });
  it('a worker process starts one timer per lane', async () => {
    const config = await import('../src/config');
    const real = config.getConfig();
    vi.spyOn(config, 'getConfig').mockReturnValue({
      ...real,
      NODE_ENV: 'production',
      SHIV_ROLE: 'worker',
    });
    const instance = worker();
    const timers = vi.spyOn(globalThis, 'setInterval');
    instance.onModuleInit();
    expect(timers).toHaveBeenCalledTimes(4);
    instance.onModuleDestroy();
  });
});

describe('sending WhatsApp messages from two workers', () => {
  it('each message goes once', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    await db.outboundMessage.createMany({
      data: Array.from({ length: 6 }, (_, index) => ({
        channel: 'WHATSAPP',
        recipient: '919000000701',
        template: 'shiv_test_alert',
        params: ['x'],
        dedupeKey: `lanes-${index}`,
      })),
    });
    const alerts = app.get(AlertsService);
    await Promise.all([alerts.deliver(), alerts.deliver(), alerts.deliver()]);
    const sent = log.mock.calls.filter(([line]) => String(line).includes('WHATSAPP_FAKE_SENT'));
    expect(sent).toHaveLength(6);
    expect(await db.outboundMessage.count({ where: { status: 'SENT', attempts: 1 } })).toBe(6);
  });
  it('a message held by a crashed worker is sent again later', async () => {
    await db.outboundMessage.create({
      data: {
        channel: 'WHATSAPP',
        recipient: '919000000701',
        template: 'shiv_test_alert',
        params: ['x'],
        dedupeKey: 'lanes-held',
        nextAttemptAt: new Date(Date.now() + 5 * 60000),
      },
    });
    const alerts = app.get(AlertsService);
    vi.spyOn(console, 'log').mockImplementation(() => {});
    await alerts.deliver();
    expect(await db.outboundMessage.count({ where: { status: 'PENDING' } })).toBe(1);
    await db.outboundMessage.updateMany({ data: { nextAttemptAt: new Date(Date.now() - 1000) } });
    await alerts.deliver();
    expect(await db.outboundMessage.count({ where: { status: 'SENT' } })).toBe(1);
  });
});

describe('the alert delivery report', () => {
  const pushed = async () => {
    const note = await db.notification.create({
      data: { userId: 'owner', title: 'Naya order', body: 'SC-1' },
    });
    await app.get(AlertsService).deliver();
    const payload = JSON.parse(String(push.send.mock.calls.at(-1)?.[1])) as { ack: string };
    return { note, token: payload.ack };
  };
  it('each alert carries its own token, stored only as a hash', async () => {
    const { token, note } = await pushed();
    expect(token.length).toBeGreaterThanOrEqual(20);
    const row = await db.pushActionToken.findFirstOrThrow({ where: { notificationId: note.id } });
    expect(row).toMatchObject({ userId: 'owner', purpose: 'ack', usedAt: null });
    expect(row.tokenHash).toBe(hash(token));
    expect(JSON.stringify(row)).not.toContain(token);
    const second = await pushed();
    expect(second.token).not.toBe(token);
  });
  it('the phone reports delivery with the token alone', async () => {
    const { token, note } = await pushed();
    await ack(token).expect(201);
    const row = await db.notification.findUniqueOrThrow({ where: { id: note.id } });
    expect(row.deliveredAt).toBeTruthy();
    expect((await db.pushActionToken.findFirstOrThrow()).usedAt).toBeTruthy();
  });
  it('a stuck push service gives up instead of holding the lane', async () => {
    await pushed();
    expect(push.send.mock.calls.at(-1)?.[2]).toMatchObject({ timeout: 15000 });
  });
  it('an alert about access opens the people page', async () => {
    await db.notification.create({
      data: { userId: 'owner', title: 't', body: 'b', dedupeKey: 'people:test' },
    });
    await app.get(AlertsService).deliver();
    const payload = JSON.parse(String(push.send.mock.calls.at(-1)?.[1])) as { url: string };
    expect(payload.url).toBe('/users');
  });
  it('a replay changes nothing, as a second phone may report the same alert', async () => {
    const { token, note } = await pushed();
    await ack(token).expect(201);
    const first = await db.notification.findUniqueOrThrow({ where: { id: note.id } });
    await new Promise((resolve) => setTimeout(resolve, 5));
    await ack(token).expect(201);
    const after = await db.notification.findUniqueOrThrow({ where: { id: note.id } });
    expect(after.deliveredAt).toEqual(first.deliveredAt);
  });
  it('reports racing each other record one time', async () => {
    const { token } = await pushed();
    const results = await Promise.all(Array.from({ length: 5 }, () => ack(token)));
    expect(results.every((result) => result.status === 201)).toBe(true);
    expect(await db.notification.count({ where: { deliveredAt: { not: null } } })).toBe(1);
  });
  it('an expired token is refused', async () => {
    const { token, note } = await pushed();
    await db.pushActionToken.updateMany({ data: { expiresAt: new Date(Date.now() - 1000) } });
    await ack(token).expect(410);
    expect(
      (await db.notification.findUniqueOrThrow({ where: { id: note.id } })).deliveredAt,
    ).toBeNull();
  });
  it('a made-up token gets the same answer, so it reveals nothing', async () => {
    const { body } = await ack('z'.repeat(32)).expect(410);
    expect(body.error.code).toBe('INVALID_TOKEN');
  });
  it('a token for something else is refused here', async () => {
    const { token } = await pushed();
    await db.pushActionToken.updateMany({ data: { purpose: 'confirm' } });
    await ack(token).expect(410);
  });
  it.each([
    ['too short', 'abc'],
    ['too long', 'a'.repeat(101)],
    ['not text', { $ne: '' }],
    ['missing', undefined],
  ])('a %s token is bad input', async (_name, token) => {
    await ack(token).expect(400);
  });
  it('extra fields are refused', async () => {
    await request(server)
      .post('/api/v1/admin/push/ack')
      .send({ token: 'a'.repeat(32), notificationId: 'other' })
      .expect(400);
  });
  it('a paused or departed person gets no more alerts', async () => {
    await db.user.update({ where: { id: 'owner' }, data: { staffPausedAt: new Date() } });
    await db.notification.create({ data: { userId: 'owner', title: 't', body: 'b' } });
    await app.get(AlertsService).deliver();
    expect(push.send).not.toHaveBeenCalled();
  });
  it('an alert whose claim fails is left for the next pass', async () => {
    const note = await db.notification.create({ data: { userId: 'owner', title: 't', body: 'b' } });
    const failing = vi.spyOn(console, 'error').mockImplementation(() => {});
    const spy = vi.spyOn(db, 'atomic').mockRejectedValueOnce(new Error('database away'));
    await app.get(AlertsService).deliver();
    spy.mockRestore();
    failing.mockRestore();
    expect(
      (await db.notification.findUniqueOrThrow({ where: { id: note.id } })).pushedAt,
    ).toBeNull();
    await app.get(AlertsService).deliver();
    expect(push.send).toHaveBeenCalledOnce();
  });
});
