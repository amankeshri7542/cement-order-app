import 'reflect-metadata';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { Server } from 'node:http';
import { loadEnvFile } from 'node:process';
import type { INestApplication } from '@nestjs/common';
import { RequestMethod } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app';
import { Db } from '../src/db';
import type { CanRule } from '../src/http';
import { addPerson, tokenFor } from './staff-helper';

// Plan v4 A3: two firms. Money names its firm, balances are per firm, and someone limited to one
// firm sees nothing of the other, whichever route they try.
if (existsSync('.env.test')) loadEnvFile('.env.test');
process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
process.env.OTP_PROVIDER = 'mock';
process.env.OTP_HASH_SECRET = 'two-firms-test-only-secret-not-for-production';
process.env.CORS_ORIGINS = 'http://localhost:3000';
if (!process.env.DATABASE_URL || !new URL(process.env.DATABASE_URL).pathname.endsWith('_test'))
  throw new Error('Firm tests require a dedicated TEST_DATABASE_URL ending in _test.');

const FIRM_A = 'firm_main';
const FIRM_B = 'firm_two_test';
const SHOP_A = 'loc_main';
const SHOP_B = 'loc_two_b';
const GODOWN_B = 'loc_two_godown_b';
// Marks that must never reach someone limited to firm A.
const B_ONLY_NAME = 'Zorawar Bonly';
const B_ONLY_PAISE = 7_777_700;
let app: INestApplication;
let server: Server;
let db: Db;
const as = (id: string) => ({ Authorization: `Bearer ${tokenFor(id)}` });
const key = () => randomUUID();

async function adjust(customer: string, firmId: string, amountPaise: number) {
  return request(server)
    .post(`/api/v1/admin/customers/${customer}/khata/adjust`)
    .set(as('owner'))
    .send({ amountPaise, firmId, note: 'Test opening figure', idempotencyKey: key() })
    .expect(201);
}

beforeAll(async () => {
  const { createApp } = await import('../src/app');
  app = await createApp();
  await app.listen(0, '127.0.0.1');
  server = app.getHttpServer();
  db = app.get(Db);
  await db.$executeRawUnsafe(
    'TRUNCATE TABLE "PriceUpdateBatch", "RateSource", "FinancialMovement", "User", "Category", "Product", "Order", "Quote", "AuditLog", "OtpChallenge", "AuthRateLimit", "DeliveryZone", "StoreSettings" RESTART IDENTITY CASCADE',
  );
  await db.firm.upsert({
    where: { id: FIRM_B },
    update: { active: true },
    create: { id: FIRM_B, legalName: 'Second Firm (test)', tradeName: 'Second Firm' },
  });
  for (const [id, slug, kind] of [
    [SHOP_B, 'two-b', 'SHOP'],
    [GODOWN_B, 'two-godown-b', 'GODOWN'],
  ] as const)
    await db.location.upsert({
      where: { id },
      update: { active: true },
      create: { id, firmId: FIRM_B, slug, name: id, kind, stockStartedAt: new Date() },
    });
  let phone = 9100000100;
  const next = () => `+91${++phone}`;
  await addPerson(db, { id: 'owner', role: 'OWNER', phone: next() });
  await addPerson(db, { id: 'cashierb', role: 'CASHIER', shops: [SHOP_B], phone: next() });
  // An accountant for firm A only: a membership with no shop and a firm.
  await addPerson(db, { id: 'accounta', phone: next() });
  await db.user.update({ where: { id: 'accounta' }, data: { role: 'ADMIN' } });
  await db.session.updateMany({ where: { userId: 'accounta' }, data: { surface: 'DESK' } });
  await db.staffMembership.create({
    data: {
      userId: 'accounta',
      locationId: null,
      role: 'ACCOUNTANT',
      firmId: FIRM_A,
      grantedById: 'fixture',
    },
  });
  // One customer of both firms, one of firm B only (with marks that must never leak to firm A).
  await addPerson(db, { id: 'both', phone: next() });
  await addPerson(db, { id: 'bonly', phone: next() });
  await db.user.update({ where: { id: 'bonly' }, data: { name: B_ONLY_NAME } });
  await adjust('both', FIRM_A, 300000);
  await adjust('both', FIRM_B, 500000);
  await adjust('bonly', FIRM_B, B_ONLY_PAISE);
}, 60000);

afterAll(async () => {
  // Leave the shared test database with one open firm, as other suites expect.
  await db.location.updateMany({ where: { firmId: { not: FIRM_A } }, data: { active: false } });
  await db.firm.updateMany({ where: { id: { not: FIRM_A } }, data: { active: false } });
  await app.close();
});

describe('money names its firm', () => {
  it('a payment an owner types at the main shop for a firm B debt lands in firm B', async () => {
    const before = await db.customerFirmBalance.findMany({ where: { customerId: 'both' } });
    const res = await request(server)
      .post('/api/v1/admin/customers/both/khata/payment')
      .set(as('owner'))
      .send({
        amountPaise: 100000,
        firmId: FIRM_B,
        channel: 'CASH',
        locationId: SHOP_A,
        note: 'Paid at the counter',
        idempotencyKey: key(),
      })
      .expect(201);
    expect(res.body.firmId).toBe(FIRM_B);
    expect(res.body.locationId).toBe(SHOP_A);
    const money = await db.financialMovement.findUniqueOrThrow({
      where: { id: res.body.financialMovementId },
    });
    expect(money).toMatchObject({ firmId: FIRM_B, locationId: SHOP_A, kind: 'KHATA_PAYMENT' });
    const after = await db.customerFirmBalance.findMany({ where: { customerId: 'both' } });
    const of = (rows: typeof after, firm: string) =>
      rows.find((r) => r.firmId === firm)!.balancePaise;
    expect(of(after, FIRM_B)).toBe(of(before, FIRM_B) - 100000);
    expect(of(after, FIRM_A)).toBe(of(before, FIRM_A));
  });

  it('with no firm chosen, a payment goes to the firm owed longest', async () => {
    const res = await request(server)
      .post('/api/v1/admin/customers/both/khata/payment')
      .set(as('owner'))
      .send({
        amountPaise: 1000,
        channel: 'UPI',
        locationId: SHOP_A,
        note: 'Paid at the counter',
        idempotencyKey: key(),
      })
      .expect(201);
    // Firm A's figure was entered first, so it is the oldest due.
    expect(res.body.firmId).toBe(FIRM_A);
  });

  it('a closed or unknown firm is refused', async () => {
    const res = await request(server)
      .post('/api/v1/admin/customers/both/khata/payment')
      .set(as('owner'))
      .send({
        amountPaise: 1000,
        firmId: 'no-such-firm',
        channel: 'CASH',
        locationId: SHOP_A,
        note: 'Paid at the counter',
        idempotencyKey: key(),
      })
      .expect(400);
    expect(res.body.error.code).toBe('INVALID_FIRM');
  });

  it('balances per firm equal their ledger sums, and the total equals both', async () => {
    const rows = await db.$queryRaw<{ off: bigint }[]>`
      SELECT count(*) AS off FROM "CustomerFirmBalance" b
      FULL JOIN (SELECT "customerId", "firmId", SUM("amountPaise") AS s FROM "CustomerLedgerEntry" GROUP BY 1, 2) l
        ON l."customerId" = b."customerId" AND l."firmId" = b."firmId"
      WHERE COALESCE(b."balancePaise", 0) <> COALESCE(l.s, 0)`;
    expect(Number(rows[0]!.off)).toBe(0);
    const total = await db.user.findUniqueOrThrow({ where: { id: 'both' } });
    const firms = await db.customerFirmBalance.aggregate({
      where: { customerId: 'both' },
      _sum: { balancePaise: true },
    });
    expect(total.khataBalancePaise).toBe(firms._sum.balancePaise);
  });

  it('a reversal keeps its firm, and the database refuses one in the wrong firm', async () => {
    const payment = await db.customerLedgerEntry.findFirstOrThrow({
      where: { customerId: 'both', firmId: FIRM_B, kind: 'PAYMENT_RECEIVED' },
    });
    const res = await request(server)
      .post(`/api/v1/admin/customers/both/khata/reverse/${payment.id}`)
      .set(as('owner'))
      .send({ note: 'Typed twice', idempotencyKey: key() })
      .expect(201);
    expect(res.body.firmId).toBe(FIRM_B);
    const money = await db.financialMovement.findFirstOrThrow({
      where: { kind: 'KHATA_PAYMENT_REVERSAL' },
    });
    expect(money.firmId).toBe(FIRM_B);
    const original = await db.customerLedgerEntry.findFirstOrThrow({
      where: { customerId: 'both', firmId: FIRM_A, kind: 'ADJUSTMENT' },
    });
    await expect(
      db.customerLedgerEntry.create({
        data: {
          customerId: 'both',
          firmId: FIRM_B,
          kind: 'REVERSAL',
          amountPaise: -original.amountPaise,
          balanceAfterPaise: 0,
          reversesId: original.id,
          actorId: 'test',
          occurredAt: new Date(),
        },
      }),
    ).rejects.toThrow(/FIRM_MISMATCH/);
  });

  it('the database refuses an order or a galla entry in a firm other than its shop', async () => {
    await expect(
      db.order.create({
        data: {
          number: 'SC-TEST-FIRM1',
          userId: 'both',
          idempotencyKey: key(),
          status: 'CONFIRMED',
          source: 'PHONE',
          locationId: SHOP_B,
          firmId: FIRM_A,
          address: {},
          deliveryDate: '2026-11-09',
          notes: '',
          subtotalPaise: 100,
          deliveryFeePaise: 0,
          totalPaise: 100,
        },
      }),
    ).rejects.toThrow(/FIRM_MISMATCH/);
    await expect(
      db.gallaEntry.create({
        data: {
          locationId: SHOP_B,
          firmId: FIRM_A,
          day: '2026-11-08',
          kind: 'PAID_OUT',
          amountPaise: 100,
          reason: 'Test',
          actorId: 'test',
          idempotencyKey: key(),
        },
      }),
    ).rejects.toThrow(/FIRM_MISMATCH/);
  });

  it('a shop with records never moves to the other firm', async () => {
    await expect(
      db.location.update({ where: { id: SHOP_A }, data: { firmId: FIRM_B } }),
    ).rejects.toThrow(/FIRM_MISMATCH/);
  });

  it("a firm's own credit limit is kept beside the customer's", async () => {
    const res = await request(server)
      .patch('/api/v1/admin/customers/both')
      .set(as('owner'))
      .send({ firmId: FIRM_B, creditLimitPaise: 2000000 })
      .expect(200);
    expect(res.body).toMatchObject({ firmId: FIRM_B, creditLimitPaise: 2000000 });
    await request(server)
      .patch('/api/v1/admin/customers/both')
      .set(as('owner'))
      .send({ firmId: FIRM_B, creditLimitPaise: 2000000, area: 'Kankarbagh' })
      .expect(400);
  });
});

describe('stock stays in its firm', () => {
  it('a transfer to the other firm is refused, by the route and by the database', async () => {
    await db.category.upsert({
      where: { slug: 'cement' },
      update: {},
      create: { id: 'cement', name: 'Cement', slug: 'cement' },
    });
    await db.product.upsert({
      where: { id: 'two-firm-cement' },
      update: {},
      create: {
        id: 'two-firm-cement',
        name: 'Cement',
        brand: 'Test',
        categoryId: 'cement',
        type: 'PPC',
        grade: 'PPC',
        unit: 'bag',
        pricePaise: 40000,
        description: 'Test',
        recommendedUse: 'Test',
        images: [],
      },
    });
    const res = await request(server)
      .post('/api/v1/admin/stock/transfers')
      .set(as('owner'))
      .send({
        fromLocationId: SHOP_A,
        toLocationId: GODOWN_B,
        lines: [{ productId: 'two-firm-cement', quantity: 1 }],
        idempotencyKey: key(),
      });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('OTHER_FIRM');
    await expect(
      db.stockTransfer.create({
        data: {
          fromLocationId: SHOP_A,
          toLocationId: GODOWN_B,
          sentById: 'owner',
          idempotencyKey: key(),
        },
      }),
    ).rejects.toThrow(/OTHER_FIRM/);
  });
});

describe('openings are per firm', () => {
  it('each firm drafts and signs its own opening for the same customer', async () => {
    await addPerson(db, { id: 'opener', phone: '+919100000999' });
    for (const firmId of [FIRM_A, FIRM_B]) {
      const draft = await request(server)
        .post('/api/v1/admin/khata/opening-sheet')
        .set(as('owner'))
        .send({
          customerId: 'opener',
          asOf: '2026-04-01',
          paperPaise: firmId === FIRM_A ? 11100 : 22200,
          firmId,
        })
        .expect(201);
      expect(draft.body.firmId).toBe(firmId);
      const signed = await request(server)
        .post('/api/v1/admin/khata/opening-sheet/approve')
        .set(as('owner'))
        .send({
          rows: [
            {
              customerId: 'opener',
              firmId,
              draftVersion: draft.body.version,
              chosenPaise: draft.body.paperPaise,
            },
          ],
        })
        .expect(201);
      expect(signed.body.signed).toBe(1);
    }
    const openings = await db.customerLedgerEntry.findMany({
      where: { customerId: 'opener', kind: 'OPENING_BALANCE' },
    });
    expect(openings.map((row) => [row.firmId, row.amountPaise]).sort()).toEqual([
      [FIRM_A, 11100],
      [FIRM_B, 22200],
    ]);
    // Signing firm B again is refused; firm A's signature did not count for it.
    const again = await request(server)
      .post('/api/v1/admin/khata/opening-sheet')
      .set(as('owner'))
      .send({ customerId: 'opener', asOf: '2026-04-01', paperPaise: 1, firmId: FIRM_B })
      .expect(409);
    expect(again.body.error.code).toBe('ALREADY_SIGNED');
  });
});

describe('someone limited to firm A', () => {
  it('sees firm A’s share of a customer of both firms, and nothing of firm B', async () => {
    const ledger = await request(server)
      .get('/api/v1/admin/customers/both/khata')
      .set(as('accounta'))
      .expect(200);
    expect(ledger.body.byFirm.map((row: { firmId: string }) => row.firmId)).toEqual([FIRM_A]);
    expect(
      ledger.body.entries.items.every((row: { firmId: string }) => row.firmId === FIRM_A),
    ).toBe(true);
    const a = await db.customerFirmBalance.findUniqueOrThrow({
      where: { customerId_firmId: { customerId: 'both', firmId: FIRM_A } },
    });
    expect(ledger.body.balancePaise).toBe(a.balancePaise);
  });

  it('cannot find a customer of firm B only', async () => {
    await request(server).get('/api/v1/admin/customers/bonly').set(as('accounta')).expect(404);
    await request(server)
      .get('/api/v1/admin/customers/bonly/khata')
      .set(as('accounta'))
      .expect(404);
    const list = await request(server)
      .get('/api/v1/admin/customers')
      .set(as('accounta'))
      .expect(200);
    expect(JSON.stringify(list.body)).not.toContain(B_ONLY_NAME);
  });

  it('the khata summary shows firm A only', async () => {
    const summary = await request(server)
      .get('/api/v1/admin/khata/summary')
      .set(as('accounta'))
      .expect(200);
    expect(summary.body.byFirm.map((row: { firmId: string }) => row.firmId)).toEqual([FIRM_A]);
  });

  it('a shop B cashier takes payments for firm B only', async () => {
    const res = await request(server)
      .post('/api/v1/admin/customers/both/khata/payment')
      .set(as('cashierb'))
      .send({
        amountPaise: 1000,
        firmId: FIRM_A,
        channel: 'CASH',
        note: 'Paid at the counter',
        idempotencyKey: key(),
      })
      .expect(403);
    expect(res.body.error.code).toBe('FORBIDDEN');
  });

  it('every customer, khata and report route keeps firm B out (the matrix)', async () => {
    // Every GET route the accountant may call, with ids standing in for firm B's customer.
    const controllers: (new (...args: never[]) => object)[] =
      Reflect.getMetadata('controllers', AppModule) ?? [];
    const gets = controllers.flatMap((controller) => {
      const base = String(Reflect.getMetadata('path', controller) ?? '');
      return Object.getOwnPropertyNames(controller.prototype).flatMap((name) => {
        const handler = (controller.prototype as Record<string, unknown>)[name] as object;
        if (typeof handler !== 'function' || name === 'constructor') return [];
        const declared = Reflect.getMetadata('path', handler) as string | string[] | undefined;
        if (declared === undefined) return [];
        if ((Reflect.getMetadata('method', handler) as RequestMethod) !== RequestMethod.GET)
          return [];
        if (Reflect.getMetadata('__sse__', handler)) return [];
        const can = (Reflect.getMetadata('can', handler) ??
          Reflect.getMetadata('can', controller)) as CanRule | undefined;
        if (!can) return [];
        const path = (Array.isArray(declared) ? declared[0]! : declared)
          .split('/')
          .map((part) => (part.startsWith(':') ? 'bonly' : part))
          .join('/');
        return [
          `/${['api/v1', base, path].filter((p) => p && p !== '/').join('/')}`.replace(/\/+/g, '/'),
        ];
      });
    });
    expect(gets.length).toBeGreaterThan(40);
    const leaks: string[] = [];
    for (const path of gets) {
      const res = await request(server).get(path).set(as('accounta'));
      const body = res.text;
      if (
        body.includes(B_ONLY_NAME) ||
        body.includes(String(B_ONLY_PAISE)) ||
        body.includes(FIRM_B)
      )
        leaks.push(`${path} (${res.status})`);
    }
    expect(leaks).toEqual([]);
  }, 120000);
});

describe('firm management', () => {
  it('owners add a firm with its own prefix and bill series; prefixes and GSTINs stay unique', async () => {
    // Firms are never deleted, so each run uses a prefix and GSTIN of its own.
    const letters = () =>
      Array.from({ length: 5 }, () =>
        String.fromCharCode(65 + Math.floor(Math.random() * 26)),
      ).join('');
    const tag = letters();
    const prefix = `T${tag.slice(0, 4)}`;
    const gstin = `10${tag}1234F1Z5`;
    const res = await request(server)
      .post('/api/v1/admin/firms')
      .set(as('owner'))
      .send({ legalName: `Third Firm ${tag} (test)`, billPrefix: prefix, gstin })
      .expect(201);
    expect(res.body.billSeries).toHaveLength(1);
    expect(res.body.billSeries[0]).toMatchObject({ prefix, nextNumber: 1 });
    const dupe = await request(server)
      .post('/api/v1/admin/firms')
      .set(as('owner'))
      .send({ legalName: 'Fourth Firm', billPrefix: prefix })
      .expect(409);
    expect(dupe.body.error.code).toBe('PREFIX_IN_USE');
    const gst = await request(server)
      .post('/api/v1/admin/firms')
      .set(as('owner'))
      .send({ legalName: 'Fifth Firm', gstin })
      .expect(409);
    expect(gst.body.error.code).toBe('GSTIN_IN_USE');
    await request(server)
      .patch(`/api/v1/admin/firms/${res.body.id}`)
      .set(as('owner'))
      .send({ active: false })
      .expect(200);
  });

  it('a firm with open shops cannot close, and the accountant cannot manage firms', async () => {
    const res = await request(server)
      .patch(`/api/v1/admin/firms/${FIRM_B}`)
      .set(as('owner'))
      .send({ active: false })
      .expect(409);
    expect(res.body.error.code).toBe('FIRM_HAS_SHOPS');
    await request(server).get('/api/v1/admin/firms').set(as('accounta')).expect(403);
  });

  it('with two firms open, a new shop must say which firm it belongs to', async () => {
    const res = await request(server)
      .post('/api/v1/admin/locations')
      .set(as('owner'))
      .send({ name: 'No Firm Shop' })
      .expect(400);
    expect(res.body.error.code).toBe('FIRM_REQUIRED');
  });

  it('only an accountant can be limited to one firm, and the limit cannot be edited in place', async () => {
    await expect(
      db.staffMembership.create({
        data: {
          userId: 'owner',
          locationId: null,
          role: 'OWNER',
          firmId: FIRM_A,
          grantedById: 'fixture',
        },
      }),
    ).rejects.toThrow();
    const membership = await db.staffMembership.findFirstOrThrow({ where: { userId: 'accounta' } });
    await expect(
      db.staffMembership.update({ where: { id: membership.id }, data: { firmId: FIRM_B } }),
    ).rejects.toThrow(/can only be ended/);
  });
});

describe('migrations', () => {
  it('never run UPDATE or DELETE on an append-only table', () => {
    const appendOnly = [
      'CustomerLedgerEntry',
      'FinancialMovement',
      'GallaEntry',
      'InventoryMovement',
      'CashHandover',
      'AuditLog',
      'DayClose',
      'StaffLedgerEntry',
      'PayLine',
      'PayAdjustment',
      'AttendanceEvent',
      'DeliveryProof',
      'KhataSignoff',
      'OrderAmendment',
      'DemoBatch',
    ];
    const dir = join(__dirname, '../prisma/migrations');
    const offending: string[] = [];
    for (const name of readdirSync(dir)) {
      const file = join(dir, name, 'migration.sql');
      if (!existsSync(file)) continue;
      const sql = readFileSync(file, 'utf8').replace(/--.*$/gm, '');
      for (const table of appendOnly)
        if (new RegExp(`\\b(UPDATE|DELETE\\s+FROM)\\s+"${table}"`, 'i').test(sql))
          offending.push(`${name}: ${table}`);
    }
    expect(offending).toEqual([]);
  });
});
