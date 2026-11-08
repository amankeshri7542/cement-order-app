import 'reflect-metadata';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loadEnvFile } from 'node:process';
import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import request from 'supertest';
import { PrismaClient } from '@prisma/client';
import { hash } from '../src/http';

// The demo seed against real databases. It drops and recreates its own throwaway database, so
// it never touches the shared test database other suites use.
if (existsSync('.env.test')) loadEnvFile('.env.test');
const base = process.env.TEST_DATABASE_URL;
if (!base || !new URL(base).pathname.endsWith('_test'))
  throw new Error('Seed tests require a dedicated TEST_DATABASE_URL ending in _test.');
const seedUrl = (() => {
  const u = new URL(base);
  u.pathname = '/shiv_cement_seedcheck_test';
  return u.toString();
})();
const env = { DATABASE_URL: seedUrl, NODE_ENV: 'test' };
const dir = mkdtempSync(join(tmpdir(), 'seed-demo-'));
const args = (file: string, ...more: string[]) => [
  '--size',
  'small',
  '--seed',
  '42',
  '--today',
  '2026-11-08',
  '--manifest',
  join(dir, file),
  ...more,
];

let db: PrismaClient;
let runSeed: typeof import('../scripts/seed-demo/index').runSeed;
type Manifest = Awaited<ReturnType<typeof runSeed>>['manifest'];
let first: Manifest;

beforeAll(async () => {
  ({ runSeed } = await import('../scripts/seed-demo/index'));
  first = (await runSeed(args('first.json', '--fresh'), env)).manifest;
  db = new PrismaClient({ datasources: { db: { url: seedUrl } } });
}, 120000);
afterAll(async () => {
  await db?.$disconnect();
});

describe('demo seed, small', () => {
  it('builds the planned business and writes its manifest', () => {
    expect(first.counts).toMatchObject({ products: 120, customers: 200, staff: 15 });
    expect(first.counts.orders as number).toBeGreaterThan(2500);
    expect(first.counts.orders as number).toBeLessThan(3500);
    expect(first.counts.waOpenCards as number).toBeGreaterThan(0);
    expect(first.udhaar.customersOwing as number).toBeGreaterThan(0);
    // Every door and every step of the trail is there.
    expect(Object.keys(first.ordersBySource).sort()).toEqual([
      'APP',
      'PHONE',
      'WALK_IN',
      'WHATSAPP',
    ]);
    expect(first.ordersByStatus).toHaveProperty('DELIVERED');
    expect(first.ordersByStatus).toHaveProperty('CANCELLED');
    expect(JSON.parse(readFileSync(join(dir, 'first.json'), 'utf8'))).toEqual(first);
  });

  it('keeps the invariants the API relies on (the seed checks them itself, and here they are again)', async () => {
    const [row] = await db.$queryRaw<{ off: bigint }[]>`
      SELECT count(*) AS off FROM "User" u
      LEFT JOIN (SELECT "customerId", sum("amountPaise") AS s FROM "CustomerLedgerEntry" GROUP BY 1) l ON l."customerId" = u.id
      WHERE u."khataBalancePaise" <> COALESCE(l.s, 0)`;
    expect(Number(row!.off)).toBe(0);
    const [stock] = await db.$queryRaw<{ off: bigint }[]>`
      SELECT count(*) AS off FROM "Product" p
      LEFT JOIN (SELECT "productId", sum(quantity) AS q FROM "InventoryMovement" GROUP BY 1) m ON m."productId" = p.id
      WHERE p.stock <> COALESCE(m.q, 0)`;
    expect(Number(stock!.off)).toBe(0);
  });

  it('uses only made-up names and valid Indian mobiles, and nothing is left to send', async () => {
    const users = await db.user.findMany({
      where: { id: { startsWith: 'demo-' } },
      select: { phone: true },
    });
    expect(users.every((u) => /^\+91[6-9]\d{9}$/.test(u.phone))).toBe(true);
    expect(await db.ownerWork.count({ where: { deliveredAt: null } })).toBe(0);
    expect(await db.outboundMessage.count()).toBe(0);
    expect(await db.notification.count({ where: { sentAt: null } })).toBe(0);
  });

  it('refuses to load twice: rows in append-only tables cannot be deleted', async () => {
    await expect(runSeed(args('again.json'), env)).rejects.toThrow(/already loaded.*--fresh/);
  });

  it('the same seed gives the same manifest; another seed gives another', async () => {
    const again = (await runSeed(args('same.json', '--fresh'), env)).manifest;
    expect(again).toEqual(first);
    const other = (
      await runSeed(
        [
          '--size',
          'small',
          '--seed',
          '7',
          '--today',
          '2026-11-08',
          '--fresh',
          '--manifest',
          join(dir, 'o.json'),
        ],
        env,
      )
    ).manifest;
    expect(other.counts.orders).not.toEqual(first.counts.orders);
    // Leave the database as the first run made it for the tests below. Dropping it closed this
    // file's connections, so open new ones.
    await runSeed(args('back.json', '--fresh'), env);
    await db.$disconnect();
    db = new PrismaClient({ datasources: { db: { url: seedUrl } } });
  }, 120000);

  it('protects its batch row: no delete, and the manifest is set once', async () => {
    const batch = await db.demoBatch.findFirstOrThrow();
    await expect(db.demoBatch.delete({ where: { id: batch.id } })).rejects.toThrow(
      /cannot be removed/,
    );
    await expect(
      db.demoBatch.update({ where: { id: batch.id }, data: { manifest: { forged: true } } }),
    ).rejects.toThrow(/only gets its manifest once/);
    await expect(
      db.demoBatch.update({ where: { id: batch.id }, data: { seed: 1 } }),
    ).rejects.toThrow();
    // TRUNCATE skips row triggers; emptying the table would lift the sink lock.
    await expect(db.$executeRawUnsafe('TRUNCATE "DemoBatch"')).rejects.toThrow(/cannot be removed/);
    expect(await db.demoBatch.count()).toBe(1);
  });

  it('will not drop a database on another machine without a second yes', async () => {
    const remote = new URL(seedUrl);
    remote.hostname = 'db.example.com';
    await expect(
      runSeed(args('r.json', '--fresh'), { DATABASE_URL: remote.toString() }),
    ).rejects.toThrow(/not on this machine.*SEED_DEMO_REMOTE_DROP/);
  });

  it('refuses a database holding an order it did not make', async () => {
    await db.$executeRawUnsafe(`
      INSERT INTO "Order" (id, number, "userId", "idempotencyKey", status, source, address, "deliveryDate", notes,
        "subtotalPaise", "deliveryFeePaise", "totalPaise", "updatedAt")
      SELECT 'real-order-1', 'SC-2026-REAL0001', "userId", 'real-key-1', 'CONFIRMED', 'PHONE', address, "deliveryDate", '',
        100, 0, 100, now() FROM "Order" WHERE id LIKE 'demo-%' LIMIT 1`);
    await expect(runSeed(args('foreign.json'), env)).rejects.toThrow(
      /1 order\(s\) the demo seed did not create/,
    );
    await db.$executeRawUnsafe(`DELETE FROM "Order" WHERE id = 'real-order-1'`);
  });

  it('refuses production and a non-demo database name before touching anything', async () => {
    await expect(runSeed(args('p.json'), { ...env, NODE_ENV: 'production' })).rejects.toThrow(
      /production/,
    );
    const prod = new URL(seedUrl);
    prod.pathname = '/shiv_cement';
    await expect(
      runSeed(args('p.json', '--fresh'), { DATABASE_URL: prod.toString() }),
    ).rejects.toThrow(/_dev, _demo or _test/);
  });
});

describe('the desk on seeded data, and the sink lock', () => {
  const token = 'seeddemo'.padEnd(43, 'x');
  const setEnv = (extra: Record<string, string | undefined> = {}) => {
    Object.assign(process.env, {
      NODE_ENV: 'test',
      DATABASE_URL: seedUrl,
      OTP_PROVIDER: 'mock',
      OTP_HASH_SECRET: 'seed-demo-test-only-secret-not-for-production',
      CORS_ORIGINS: 'http://localhost:3000',
      WHATSAPP_PROVIDER: 'fake',
      WA_REPLY_PROVIDER: 'off',
    });
    for (const [k, v] of Object.entries(extra)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  };

  it('shows the seeded figures on the desk pages', async () => {
    setEnv({ FIREBASE_PROJECT_ID: undefined });
    const { resetConfigForTests } = await import('../src/config');
    resetConfigForTests();
    await db.session.create({
      data: {
        userId: 'demo-u-owner-a',
        surface: 'DESK',
        accessHash: hash(token),
        refreshHash: hash(`${token}-r`),
        expiresAt: new Date(Date.now() + 3600000),
        refreshExpiresAt: new Date(Date.now() + 86400000),
      },
    });
    const { createApp } = await import('../src/app');
    const app = await createApp();
    try {
      await app.init();
      const server = app.getHttpServer();
      const auth = { Authorization: `Bearer ${token}` };
      const khata = await request(server).get('/api/v1/admin/khata/summary').set(auth).expect(200);
      expect(khata.body.customersWithDue).toBe(first.udhaar.customersOwing);
      expect(khata.body.totalDuePaise).toBe(first.udhaar.totalOwedPaise);
      const close = await db.dayClose.findFirstOrThrow({
        where: { locationId: 'loc_main', day: '2026-11-07' },
      });
      const galla = await request(server)
        .get('/api/v1/admin/galla?locationId=loc_main&day=2026-11-07')
        .set(auth)
        .expect(200);
      expect(galla.body.expectedPaise).toBe(close.expectedPaise);
      expect(galla.body.close.countedPaise).toBe(close.countedPaise);
      const stock = await request(server)
        .get('/api/v1/admin/stock?locationId=loc_main')
        .set(auth)
        .expect(200);
      expect(JSON.stringify(stock.body)).toContain('demo-p01-1');
      const orders = await request(server).get('/api/v1/admin/orders').set(auth).expect(200);
      expect(JSON.stringify(orders.body)).toContain('SC-2026-');
    } finally {
      await app.close();
    }
  }, 60000);

  it('refuses to start on demo data with a real sender configured', async () => {
    setEnv({ FIREBASE_PROJECT_ID: 'demo-project' });
    const { resetConfigForTests } = await import('../src/config');
    resetConfigForTests();
    const { createApp } = await import('../src/app');
    await expect(createApp()).rejects.toThrow(/Demo data is loaded.*app push/);
    setEnv({ FIREBASE_PROJECT_ID: undefined });
    resetConfigForTests();
  }, 60000);

  it('a real WhatsApp alert waits untouched while demo data is loaded', async () => {
    setEnv({ WHATSAPP_PROVIDER: 'fake' });
    const { resetConfigForTests } = await import('../src/config');
    const { forgetDemoLock } = await import('../src/demo-lock');
    resetConfigForTests();
    forgetDemoLock();
    const message = await db.outboundMessage.create({
      data: {
        channel: 'WHATSAPP',
        recipient: '919876543210',
        template: 'new_order',
        params: ['SC-2026-TEST'],
        dedupeKey: 'seed-demo-lock-test',
      },
    });
    // The live provider switched on after startup (a seed loaded under a running API). Any real
    // request would fail the test: fetch is replaced by one that records calls.
    setEnv({
      WHATSAPP_PROVIDER: 'meta',
      WHATSAPP_ACCESS_TOKEN: 'test-token-never-used',
      WHATSAPP_PHONE_NUMBER_ID: '000000',
    });
    resetConfigForTests();
    const calls: string[] = [];
    const realFetch = globalThis.fetch;
    globalThis.fetch = (async (input: string | URL | Request) => {
      calls.push(String(input));
      throw new Error('No network in this test');
    }) as typeof fetch;
    try {
      const { AlertsService } = await import('../src/alerts');
      const alerts = new AlertsService(db as never);
      await (alerts as unknown as { whatsapp: () => Promise<void> }).whatsapp();
    } finally {
      globalThis.fetch = realFetch;
      setEnv({
        WHATSAPP_PROVIDER: 'fake',
        WHATSAPP_ACCESS_TOKEN: undefined,
        WHATSAPP_PHONE_NUMBER_ID: undefined,
      });
      resetConfigForTests();
    }
    expect(calls).toEqual([]);
    const after = await db.outboundMessage.findUniqueOrThrow({ where: { id: message.id } });
    expect(after.status).toBe('PENDING');
    expect(after.attempts).toBe(0);
  });
});
