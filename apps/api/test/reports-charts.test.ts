import 'reflect-metadata';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import type { Server } from 'node:http';
import { join } from 'node:path';
import { loadEnvFile } from 'node:process';
import type { INestApplication } from '@nestjs/common';
import type { LedgerKind, OrderSource, OrderStatus } from '@prisma/client';
import { en, hinglish } from '@shiv/i18n';
import { istToday } from '@shiv/shared';
import request from 'supertest';
import { Db } from '../src/db';
import { addPerson, tokenFor } from './staff-helper';

if (existsSync('.env.test')) loadEnvFile('.env.test');
process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
process.env.OTP_PROVIDER = 'mock';
process.env.OTP_HASH_SECRET = 'reports-charts-test-only-secret-not-for-production';
process.env.CORS_ORIGINS = 'http://localhost:3000';
if (!process.env.DATABASE_URL || !new URL(process.env.DATABASE_URL).pathname.endsWith('_test'))
  throw new Error('These tests require a dedicated TEST_DATABASE_URL ending in _test.');

const MAIN = 'loc_main';
const SECOND = 'loc_reports_b';
const THIRD = 'loc_reports_c';
let app: INestApplication;
let server: Server;
let db: Db;
const as = (id: string) => ({ Authorization: `Bearer ${tokenFor(id)}` });
const get = (who: string, path: string) =>
  request(server).get(`/api/v1/admin/${path}`).set(as(who));

/** A moment on a given day, India time. */
const at = (day: string, time = '12:00') => new Date(`${day}T${time}:00+05:30`);
/** The calendar day this many days ago, India time. */
const dayAgo = (days: number) =>
  new Date(Date.parse(istToday()) - days * 86400000).toISOString().slice(0, 10);

const DAY = '2026-10-05';
const NEXT = '2026-10-06';
const range = `from=${DAY}&to=${NEXT}`;

let orderCount = 0;
function order(input: {
  shop?: string;
  status?: OrderStatus;
  source?: OrderSource;
  createdAt?: Date;
  confirmedAt?: Date | null;
  items?: { productId?: string; unit?: string; quantity?: number; lineTotalPaise: number }[];
}) {
  const number = `SC-T${++orderCount}`;
  const total = (input.items ?? []).reduce((sum, item) => sum + item.lineTotalPaise, 0);
  return db.order.create({
    data: {
      firmId: 'firm_main',
      number,
      userId: 'customer',
      idempotencyKey: randomUUID(),
      status: input.status ?? 'CONFIRMED',
      source: input.source ?? 'WEB',
      address: {},
      deliveryDate: DAY,
      notes: '',
      subtotalPaise: total,
      deliveryFeePaise: 0,
      totalPaise: total,
      locationId: input.shop ?? MAIN,
      createdAt: input.createdAt ?? at(DAY),
      confirmedAt: input.confirmedAt ?? null,
      items: {
        create: (input.items ?? []).map((item) => ({
          productId: item.productId ?? 'cement',
          name: item.productId ?? 'cement',
          unit: item.unit ?? 'bag',
          quantity: item.quantity ?? 1,
          pricePaise: item.lineTotalPaise / (item.quantity ?? 1),
          listPricePaise: item.lineTotalPaise / (item.quantity ?? 1),
          priceVersion: 1,
          lineTotalPaise: item.lineTotalPaise,
        })),
      },
    },
  });
}
const money = (kind: string, amountPaise: number, occurredAt: Date, locationId = MAIN) =>
  db.financialMovement.create({
    data: {
      firmId: 'firm_main',
      kind,
      amountPaise,
      occurredAt,
      locationId,
      actorId: 'papa',
      channel: 'CASH',
    },
  });
/** A line on a customer's khata, with their balance kept in step as the real code does. */
async function khata(
  customerId: string,
  amountPaise: number,
  occurredAt: Date,
  locationId = MAIN,
  // Sales need an order and payments need a money row; a correction needs neither.
  kind: LedgerKind = 'ADJUSTMENT',
) {
  const { khataBalancePaise } = await db.user.findUniqueOrThrow({ where: { id: customerId } });
  const balanceAfterPaise = khataBalancePaise + amountPaise;
  await db.customerLedgerEntry.create({
    data: {
      firmId: 'firm_main',
      customerId,
      amountPaise,
      balanceAfterPaise,
      occurredAt,
      locationId,
      kind,
      actorId: 'papa',
    },
  });
  await db.user.update({
    where: { id: customerId },
    data: { khataBalancePaise: balanceAfterPaise },
  });
  // And each firm's balance, as appendLedger keeps it.
  await db.customerFirmBalance.upsert({
    where: { customerId_firmId: { customerId, firmId: 'firm_main' } },
    create: { customerId, firmId: 'firm_main', balancePaise: amountPaise },
    update: { balancePaise: { increment: amountPaise } },
  });
}

beforeAll(async () => {
  const { createApp } = await import('../src/app');
  app = await createApp();
  await app.listen(0, '127.0.0.1');
  server = app.getHttpServer();
  db = app.get(Db);
}, 30000);
beforeEach(async () => {
  await db.$executeRawUnsafe(
    'TRUNCATE TABLE "FinancialMovement", "User", "Category", "Product", "DeliveryZone", "StoreSettings", "AuditLog", "AuthRateLimit" RESTART IDENTITY CASCADE',
  );
  for (const [id, slug, active] of [
    [SECOND, 'reports-b', true],
    [THIRD, 'reports-c', false],
  ] as const)
    await db.location.upsert({
      where: { id },
      update: { active },
      create: { id, firmId: 'firm_main', slug, name: `Shop ${slug}`, active },
    });
  let phone = 9100000000;
  for (const [id, role, shops] of [
    ['papa', 'OWNER', undefined],
    ['accountant', 'ACCOUNTANT', undefined],
    ['manager', 'MANAGER', [MAIN]],
    ['managerb', 'MANAGER', [SECOND]],
    ['cashier', 'CASHIER', [MAIN]],
    ['keeper', 'STOCK_KEEPER', [MAIN]],
    ['tech', 'TECH_OPERATOR', undefined],
  ] as const)
    await addPerson(db, {
      id,
      role,
      phone: `+91${++phone}`,
      ...(shops ? { shops: [...shops] } : {}),
    });
  for (const id of ['customer', 'customer2', 'customer3'])
    await addPerson(db, { id, phone: `+91${++phone}` });
  await db.category.create({ data: { id: 'cat', name: 'Cement', slug: 'cement' } });
  for (const id of ['cement', 'acc', 'sand', 'steel', 'brick', 'gitti', 'tiles'])
    await db.product.create({
      data: {
        id,
        name: id,
        brand: 'Test',
        categoryId: 'cat',
        type: 'PPC',
        grade: 'PPC',
        unit: 'bag',
        pricePaise: 40000,
        stock: 100,
        stockMode: 'AVAILABILITY',
        minQuantity: 1,
        description: 'Test',
        recommendedUse: 'Test',
        images: [],
      },
    });
});
afterAll(async () => {
  await app?.close();
});

describe('who may read the chart numbers', () => {
  it.each(['cashier', 'keeper', 'tech', 'customer'])('%s is refused on both', async (who) => {
    await get(who, `reports/trends?${range}`).expect(403);
    await get(who, 'reports/udhaar-age').expect(403);
  });
  it('nobody reaches them without signing in', async () => {
    await request(server).get(`/api/v1/admin/reports/trends?${range}`).expect(401);
    await request(server).get('/api/v1/admin/reports/udhaar-age').expect(401);
  });
  it.each(['papa', 'accountant', 'manager'])('%s may read them', async (who) => {
    await get(who, `reports/trends?${range}`).expect(200);
    await get(who, 'reports/udhaar-age').expect(200);
  });
  it('a manager asking for another shop by name is refused, with nothing in the answer', async () => {
    await money('COLLECTION', 900000, at(DAY), SECOND);
    const trend = await get('manager', `reports/trends?${range}&locationId=${SECOND}`).expect(403);
    expect(JSON.stringify(trend.body)).not.toContain('900000');
    await get('manager', `reports/udhaar-age?locationId=${SECOND}`).expect(403);
  });
  it('a repeated or nested shop value never reaches the query and shows no other shop', async () => {
    await money('COLLECTION', 900000, at(DAY), SECOND);
    for (const asked of [
      `locationId=${MAIN}&locationId=${SECOND}`,
      `locationId[not]=${MAIN}`,
      `locationId[in][]=${SECOND}`,
    ]) {
      const { body } = await get('manager', `reports/trends?${range}&${asked}`).expect(200);
      expect(body.shops.map((shop: { id: string }) => shop.id)).toEqual([MAIN]);
    }
  });
});

describe('money in, by shop and by day', () => {
  it('adds money the same way the money report does, so the two never disagree', async () => {
    await money('COLLECTION', 100000, at(DAY));
    await money('KHATA_PAYMENT', 20000, at(DAY));
    await money('COUNTER_SALE', 3000, at(DAY));
    await money('REFUND', 400, at(DAY));
    await money('KHATA_PAYMENT_REVERSAL', 50, at(DAY));
    await money('COLLECTION', 700000, at(NEXT), SECOND);
    const { body } = await get('papa', `reports/trends?${range}`).expect(200);
    const main = body.shops.find((shop: { id: string }) => shop.id === MAIN);
    const second = body.shops.find((shop: { id: string }) => shop.id === SECOND);
    expect(main.days).toEqual([
      { date: DAY, moneyInPaise: 122550 },
      { date: NEXT, moneyInPaise: 0 },
    ]);
    expect(second.days[1]).toEqual({ date: NEXT, moneyInPaise: 700000 });
    const report = (await get('papa', `reports/money?${range}`).expect(200)).body;
    expect(main.totalPaise + second.totalPaise).toBe(report.netPaise);
  });
  it('puts a late-night sale on the India day it happened', async () => {
    await money('COLLECTION', 5000, at(DAY, '23:59'));
    await money('COLLECTION', 7000, at(NEXT, '00:00'));
    const { body } = await get('papa', `reports/trends?${range}`).expect(200);
    const main = body.shops.find((shop: { id: string }) => shop.id === MAIN);
    expect(main.days.map((row: { moneyInPaise: number }) => row.moneyInPaise)).toEqual([
      5000, 7000,
    ]);
  });
  it('a manager sees only their own shop, and an owner may ask for one', async () => {
    await money('COLLECTION', 100000, at(DAY));
    await money('COLLECTION', 700000, at(DAY), SECOND);
    const own = (await get('manager', `reports/trends?${range}`).expect(200)).body;
    expect(own.shops.map((shop: { id: string }) => shop.id)).toEqual([MAIN]);
    expect(own.shops[0].totalPaise).toBe(100000);
    const one = (await get('papa', `reports/trends?${range}&locationId=${SECOND}`).expect(200))
      .body;
    expect(one.shops.map((shop: { id: string }) => shop.id)).toEqual([SECOND]);
    await get('manager', `reports/trends?${range}&locationId=${MAIN}`).expect(200);
  });
  it('a closed shop stays only while it has money in the range', async () => {
    const quiet = (await get('papa', `reports/trends?${range}`).expect(200)).body;
    expect(quiet.shops.map((shop: { id: string }) => shop.id)).not.toContain(THIRD);
    await money('COLLECTION', 100, at(DAY), THIRD);
    const busy = (await get('papa', `reports/trends?${range}`).expect(200)).body;
    expect(busy.shops.map((shop: { id: string }) => shop.id)).toContain(THIRD);
  });
  it('refuses a broken range, in every form', async () => {
    for (const bad of [
      '',
      'from=2026-10-05',
      'from=2026-10-06&to=2026-10-05',
      'from=2024-01-01&to=2026-01-01',
      'from=not-a-day&to=2026-10-05',
      'from=2026-13-01&to=2026-13-02',
      "from=2026-10-05'--&to=2026-10-06",
    ])
      await get('papa', `reports/trends?${bad}`).expect(400);
  });
  it('counts days of history only at the shops this person may see', async () => {
    const empty = (await get('papa', `reports/trends?${range}`).expect(200)).body;
    expect(empty.historyDays).toBe(0);
    await order({ shop: SECOND, createdAt: at(dayAgo(20)) });
    await money('COLLECTION', 100, at(dayAgo(2)));
    expect((await get('papa', `reports/trends?${range}`).expect(200)).body.historyDays).toBe(21);
    expect((await get('manager', `reports/trends?${range}`).expect(200)).body.historyDays).toBe(3);
  });
});

describe('which item brings the money', () => {
  const lines = (productId: string, lineTotalPaise: number, quantity = 1, unit = 'bag') => ({
    productId,
    lineTotalPaise,
    quantity,
    unit,
  });
  it('ranks by rupees, keeps each unit apart, and rolls the rest into one', async () => {
    await order({
      items: [
        lines('cement', 900000, 20),
        lines('acc', 800000),
        lines('sand', 700000, 28, 'cu ft'),
        lines('steel', 600000, 100, 'kg'),
        lines('brick', 500000),
        lines('gitti', 400000),
        lines('tiles', 300000),
      ],
    });
    await order({ items: [lines('cement', 100000, 5)] });
    const { body } = await get('papa', `reports/trends?${range}`).expect(200);
    expect(body.items.map((row: { productId: string }) => row.productId)).toEqual([
      'cement',
      'acc',
      'sand',
      'steel',
      'brick',
    ]);
    expect(body.items[0]).toMatchObject({ quantity: 25, totalPaise: 1000000, unit: 'bag' });
    expect(body.items[2]).toMatchObject({ quantity: 28, unit: 'cu ft' });
    expect(body.otherItems).toEqual({ products: 2, totalPaise: 700000 });
  });
  it('never adds two units of the same item together', async () => {
    await order({ items: [lines('steel', 100, 10, 'kg'), lines('steel', 200, 2, 'bundle')] });
    const { body } = await get('papa', `reports/trends?${range}`).expect(200);
    expect(
      body.items.map((row: { unit: string; quantity: number }) => [row.unit, row.quantity]),
    ).toEqual([
      ['bundle', 2],
      ['kg', 10],
    ]);
  });
  it('leaves out orders nobody agreed to and orders that are gone', async () => {
    for (const status of [
      'PENDING_PAYMENT',
      'AWAITING_CONFIRMATION',
      'CANCELLED',
      'REFUNDED',
      'REFUND_PENDING',
    ] as const)
      await order({ status, items: [lines('acc', 111111)] });
    await order({ status: 'DELIVERED', items: [lines('cement', 5000)] });
    const { body } = await get('papa', `reports/trends?${range}`).expect(200);
    expect(body.items.map((row: { productId: string }) => row.productId)).toEqual(['cement']);
  });
  it('keeps another shop out, and adds past what a 32-bit number can hold', async () => {
    await order({ items: [lines('cement', 2000000000)] });
    await order({ items: [lines('cement', 2000000000)] });
    await order({ shop: SECOND, items: [lines('acc', 900)] });
    const own = (await get('manager', `reports/trends?${range}`).expect(200)).body;
    expect(own.items.map((row: { productId: string }) => row.productId)).toEqual(['cement']);
    expect(own.items[0].totalPaise).toBe(4000000000);
  });
});

describe('where orders came from', () => {
  it('counts every door, zero included, and adds up to the orders figure', async () => {
    await order({ source: 'PHONE' });
    await order({ source: 'PHONE' });
    await order({ source: 'WEB', status: 'CANCELLED' });
    await order({ source: 'WALK_IN', shop: SECOND });
    const { body } = await get('papa', `reports/trends?${range}`).expect(200);
    expect(body.sources[0]).toEqual({ source: 'PHONE', orders: 2 });
    expect(body.sources.map((row: { source: string }) => row.source).sort()).toEqual(
      ['APP', 'PHONE', 'QUOTE', 'WALK_IN', 'WEB', 'WHATSAPP'].sort(),
    );
    const report = (await get('papa', `reports/money?${range}`).expect(200)).body;
    expect(body.sources.reduce((sum: number, row: { orders: number }) => sum + row.orders, 0)).toBe(
      report.orders.placed,
    );
    const own = (await get('manager', `reports/trends?${range}`).expect(200)).body;
    expect(own.sources.find((row: { source: string }) => row.source === 'WALK_IN').orders).toBe(0);
  });
  it('leaves out orders from outside the range', async () => {
    await order({ source: 'PHONE', createdAt: at('2026-10-04', '23:59') });
    await order({ source: 'PHONE', createdAt: at('2026-10-07', '00:00') });
    const { body } = await get('papa', `reports/trends?${range}`).expect(200);
    expect(body.sources.every((row: { orders: number }) => row.orders === 0)).toBe(true);
  });
});

describe('time to confirm', () => {
  const dayOf = async (date: string, who = 'papa') =>
    (await get(who, `reports/trends?${range}`).expect(200)).body.confirm.find(
      (row: { date: string }) => row.date === date,
    );
  const tapped = (from: string, to: string, rest: object = {}) =>
    order({ createdAt: at(DAY, from), confirmedAt: at(DAY, to), ...rest });

  it('takes the middle wait, not the average', async () => {
    await tapped('10:00', '10:02');
    await tapped('10:00', '10:04');
    await tapped('10:00', '11:00');
    expect(await dayOf(DAY)).toEqual({ date: DAY, orders: 3, medianMinutes: 4 });
  });
  it('takes the mean of the middle two when the count is even', async () => {
    await tapped('10:00', '10:02');
    await tapped('10:00', '10:05');
    expect((await dayOf(DAY)).medianMinutes).toBe(3.5);
  });
  it('shows nothing for a day with no tapped orders, instead of zero', async () => {
    expect(await dayOf(NEXT)).toEqual({ date: NEXT, orders: 0, medianMinutes: null });
  });
  it('ignores orders a person at the shop made: they wait for nobody', async () => {
    for (const source of ['PHONE', 'WALK_IN', 'QUOTE'] as const)
      await tapped('10:00', '10:00', { source });
    expect((await dayOf(DAY)).orders).toBe(0);
  });
  it('counts a night order only from when the shop opens, on the day it was tapped', async () => {
    await order({ createdAt: at(DAY, '23:00'), confirmedAt: at(NEXT, '08:07') });
    expect(await dayOf(NEXT)).toMatchObject({ orders: 1, medianMinutes: 7 });
    expect((await dayOf(DAY)).orders).toBe(0);
  });
  it('leaves out an order asked and answered with the shop shut', async () => {
    await tapped('21:00', '21:05');
    expect((await dayOf(DAY)).orders).toBe(0);
  });
  it('leaves out an order still waiting, or whose decision was taken back', async () => {
    await order({ status: 'AWAITING_CONFIRMATION', confirmedAt: null });
    expect((await dayOf(DAY)).orders).toBe(0);
  });
  it('keeps another shop out', async () => {
    await tapped('10:00', '10:30', { shop: SECOND });
    expect((await dayOf(DAY)).medianMinutes).toBe(30);
    expect((await dayOf(DAY, 'manager')).orders).toBe(0);
    expect((await dayOf(DAY, 'managerb')).orders).toBe(1);
  });
  it('works out shop minutes across nights, and never goes negative', async () => {
    const { shopMinutes } = await import('../src/reports');
    const minutes = (a: [string, string], b: [string, string]) => shopMinutes(at(...a), at(...b));
    expect(minutes([DAY, '10:00'], [DAY, '10:30'])).toBe(30);
    expect(minutes([DAY, '18:50'], [NEXT, '08:10'])).toBe(20);
    expect(minutes([DAY, '07:00'], [DAY, '07:30'])).toBe(0);
    expect(minutes([DAY, '20:00'], [DAY, '23:00'])).toBe(0);
    // Two whole shop days of 11 hours between them.
    expect(minutes(['2026-10-04', '19:00'], ['2026-10-07', '08:00'])).toBe(2 * 11 * 60);
    expect(minutes([NEXT, '10:00'], [DAY, '10:00'])).toBe(0);
  });
});

describe('how old the udhaar is', () => {
  const steps = async (who = 'papa', query = '') => {
    const { body } = await get(who, `reports/udhaar-age${query}`).expect(200);
    return {
      total: body.totalPaise,
      list: body.steps.map((row: { paise: number }) => row.paise),
    };
  };
  it('puts each debt in its step, right on the boundaries', async () => {
    await khata('customer', 1000, at(dayAgo(0)));
    await khata('customer', 2000, at(dayAgo(30), '00:00'));
    await khata('customer', 4000, at(dayAgo(31), '23:59'));
    await khata('customer', 8000, at(dayAgo(60), '00:00'));
    await khata('customer', 16000, at(dayAgo(61), '23:59'));
    await khata('customer', 32000, at(dayAgo(90), '00:00'));
    await khata('customer', 64000, at(dayAgo(91), '23:59'));
    expect(await steps()).toEqual({
      total: 127000,
      list: [3000, 12000, 48000, 64000],
    });
  });
  it('lets payments clear the oldest debt first', async () => {
    await khata('customer', 10000, at(dayAgo(100)));
    await khata('customer', 5000, at(dayAgo(10)));
    await khata('customer', -12000, at(dayAgo(5)));
    expect(await steps()).toEqual({ total: 3000, list: [3000, 0, 0, 0] });
  });
  it('agrees with the khata summary to the paisa', async () => {
    await khata('customer', 10000, at(dayAgo(100)));
    await khata('customer', 5000, at(dayAgo(40)));
    await khata('customer', -2000, at(dayAgo(5)));
    await khata('customer2', 7000, at(dayAgo(3)));
    await khata('customer3', 900, at(dayAgo(200)));
    await khata('customer3', -900, at(dayAgo(2)));
    const summary = (await get('papa', 'khata/summary').expect(200)).body;
    const { total, list } = await steps();
    expect(total).toBe(summary.totalDuePaise);
    expect(list[1] + list[2] + list[3]).toBe(
      summary.overdue30d.reduce(
        (sum: number, row: { overduePaise: number }) => sum + row.overduePaise,
        0,
      ),
    );
  });
  it('leaves out those paid up, in advance, removed from the shop, or on staff', async () => {
    await khata('customer', 5000, at(dayAgo(3)));
    await khata('customer', -5000, at(dayAgo(2)));
    await khata('customer2', -3000, at(dayAgo(2)));
    await khata('customer3', 9000, at(dayAgo(2)));
    await db.user.update({ where: { id: 'customer3' }, data: { deletedAt: new Date() } });
    await khata('cashier', 4000, at(dayAgo(2)));
    expect(await steps()).toEqual({ total: 0, list: [0, 0, 0, 0] });
  });
  it('gives a manager only the debts their shop gave, after firm-wide clearing', async () => {
    await khata('customer', 10000, at(dayAgo(100)), SECOND);
    await khata('customer', 6000, at(dayAgo(10)), MAIN);
    // Paid at the second shop: it clears that oldest debt, and part of it stays.
    await khata('customer', -4000, at(dayAgo(5)), SECOND);
    await khata('customer2', 1000, at(dayAgo(70)), MAIN);
    expect(await steps()).toEqual({ total: 13000, list: [6000, 0, 1000, 6000] });
    expect(await steps('manager')).toEqual({ total: 7000, list: [6000, 0, 1000, 0] });
    expect(await steps('managerb')).toEqual({ total: 6000, list: [0, 0, 0, 6000] });
    expect(await steps('papa', `?locationId=${SECOND}`)).toEqual({
      total: 6000,
      list: [0, 0, 0, 6000],
    });
  });
  it('holds totals past what a 32-bit number can hold', async () => {
    await khata('customer', 2000000000, at(dayAgo(1)));
    await khata('customer2', 2000000000, at(dayAgo(1)));
    expect((await steps()).total).toBe(4000000000);
  });
});

describe('the activity log', () => {
  const audit = (input: {
    actorId?: string;
    event?: string;
    entityId?: string;
    locationId?: string;
    createdAt?: Date;
    id?: string;
  }) =>
    db.auditLog.create({
      data: {
        actorId: input.actorId ?? 'papa',
        event: input.event ?? 'ORDER_DELIVERED',
        entityId: input.entityId ?? 'x',
        details: {},
        createdAt: input.createdAt ?? at(DAY),
        ...(input.id ? { id: input.id } : {}),
        ...(input.locationId ? { locationId: input.locationId } : {}),
      },
    });
  type Row = { id: string; event: string; entityLabel: string; shopName: string };
  const rows = async (query = '', who = 'papa') =>
    (await get(who, `audit${query}`).expect(200)).body.items as Row[];
  const shopName = async (id: string) =>
    (await db.location.findUniqueOrThrow({ where: { id } })).name;

  it.each(['manager', 'cashier', 'keeper', 'tech', 'customer'])('%s is refused', async (who) => {
    await get(who, 'audit').expect(403);
    await get(who, 'audit/people').expect(403);
  });
  it('the accountant reads it, and nobody reads it without signing in', async () => {
    await get('accountant', 'audit').expect(200);
    await get('accountant', 'audit/people').expect(200);
    await request(server).get('/api/v1/admin/audit').expect(401);
  });
  it('names the person, the order, its customer and its shop', async () => {
    await db.user.update({ where: { id: 'customer' }, data: { name: 'Ramesh Yadav' } });
    const sold = await order({ shop: SECOND });
    await audit({ event: 'ORDER_DELIVERED', entityId: sold.id });
    const [row] = await rows();
    expect(row).toMatchObject({
      actorName: 'papa',
      entityLabel: sold.number,
      customerName: 'Ramesh Yadav',
      shopName: await shopName(SECOND),
    });
  });
  it('leaves the shop blank for an event about the whole firm', async () => {
    await audit({ event: 'RATES_PUBLISHED', entityId: 'rates' });
    expect((await rows())[0]).toMatchObject({ shopName: '', entityLabel: '', customerName: '' });
  });
  it('filters by person', async () => {
    await audit({ actorId: 'papa' });
    await audit({ actorId: 'cashier' });
    const found = await rows('?actorId=cashier');
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({ actorId: 'cashier' });
  });
  it.each(['', `&locationId=${MAIN}`])(
    'filters by India day, not the server day (%s)',
    async (shop) => {
      await audit({ id: 'before', locationId: MAIN, createdAt: at(DAY, '23:59') });
      await audit({ id: 'early', locationId: MAIN, createdAt: at(NEXT, '00:00') });
      await audit({ id: 'late', locationId: MAIN, createdAt: at(NEXT, '23:59') });
      await audit({ id: 'after', locationId: MAIN, createdAt: at('2026-10-07', '00:00') });
      expect((await rows(`?day=${NEXT}${shop}`)).map((row) => row.id)).toEqual(['late', 'early']);
    },
  );
  it('filters by shop, including older events that only their order can place', async () => {
    const here = await order({ shop: MAIN });
    const there = await order({ shop: SECOND });
    await audit({ id: 'tagged-here', locationId: MAIN });
    await audit({ id: 'tagged-there', locationId: SECOND });
    await audit({ id: 'order-here', entityId: here.id });
    await audit({ id: 'order-there', entityId: there.id });
    await audit({ id: 'firm', entityId: 'rates' });
    // An event's own shop wins, even when its order has since moved.
    await audit({ id: 'moved', entityId: here.id, locationId: SECOND });
    const ids = (await rows(`?locationId=${MAIN}`)).map((row) => row.id).sort();
    expect(ids).toEqual(['order-here', 'tagged-here']);
    expect((await rows()).map((row) => row.id)).toContain('firm');
  });
  it('combines person, shop and day', async () => {
    await audit({ id: 'yes', actorId: 'cashier', locationId: MAIN, createdAt: at(DAY) });
    await audit({ id: 'other-person', actorId: 'papa', locationId: MAIN, createdAt: at(DAY) });
    await audit({ id: 'other-shop', actorId: 'cashier', locationId: SECOND, createdAt: at(DAY) });
    await audit({ id: 'other-day', actorId: 'cashier', locationId: MAIN, createdAt: at(NEXT) });
    const found = await rows(`?actorId=cashier&locationId=${MAIN}&day=${DAY}`);
    expect(found.map((row) => row.id)).toEqual(['yes']);
  });
  it.each(['', `&locationId=${MAIN}`])(
    'walks every page once, even for events in the same millisecond (%s)',
    async (filter) => {
      for (let index = 0; index < 7; index++)
        await audit({ id: `same-${index}`, locationId: MAIN, createdAt: at(DAY) });
      await audit({ id: 'older', locationId: MAIN, createdAt: at('2026-10-01') });
      const seen: string[] = [];
      let cursor: string | null = null;
      do {
        const after: string = cursor ? `&cursor=${encodeURIComponent(cursor)}` : '';
        const { body } = await get('papa', `audit?limit=3${filter}${after}`).expect(200);
        seen.push(...body.items.map((row: Row) => row.id));
        cursor = body.nextCursor;
        expect(seen.length).toBeLessThan(20);
      } while (cursor);
      expect(seen).toEqual([
        'same-6',
        'same-5',
        'same-4',
        'same-3',
        'same-2',
        'same-1',
        'same-0',
        'older',
      ]);
    },
  );
  it('refuses a page cursor carried over from different filters', async () => {
    for (let index = 0; index < 3; index++) await audit({ locationId: MAIN });
    const { body } = await get('papa', `audit?limit=1&locationId=${MAIN}`).expect(200);
    const cursor = encodeURIComponent(body.nextCursor);
    await get('papa', `audit?limit=1&cursor=${cursor}`).expect(400);
    await get('papa', `audit?limit=1&locationId=${SECOND}&cursor=${cursor}`).expect(400);
    await get('papa', `audit?limit=1&locationId=${MAIN}&cursor=garbage`).expect(400);
  });
  it('refuses bad filters instead of guessing', async () => {
    for (const bad of [
      'day=2026-02-31',
      'day=yesterday',
      "day=2026-10-05'--",
      'actorId=a&actorId=b',
      `actorId=${'x'.repeat(101)}`,
      'actorId=',
    ])
      await get('papa', `audit?${bad}`).expect(400);
  });
  it('treats filter text as text, on both ways of reading the log', async () => {
    await audit({ locationId: MAIN });
    const attack = encodeURIComponent(`' OR 1=1 --`);
    expect(await rows(`?actorId=${attack}`)).toEqual([]);
    expect(await rows(`?actorId=${attack}&locationId=${MAIN}`)).toEqual([]);
    expect(await rows(`?locationId=${attack}`)).toEqual([]);
  });
  it('lists staff, former staff and acting machines for the person filter', async () => {
    await db.user.update({ where: { id: 'cashier' }, data: { deletedAt: new Date() } });
    await audit({ actorId: 'whatsapp', event: 'WA_ACCOUNT_EVENT' });
    await audit({ actorId: 'customer', event: 'ORDER_CREATED' });
    const { body } = await get('papa', 'audit/people').expect(200);
    const ids = body.staff.map((person: { id: string }) => person.id);
    expect(ids).toEqual(expect.arrayContaining(['papa', 'cashier', 'tech']));
    expect(ids).not.toContain('customer');
    expect(body.machines).toEqual(['whatsapp']);
  });
  it('writes nothing to the log by being read', async () => {
    await audit({});
    const before = await db.auditLog.count();
    await get('papa', 'audit');
    await get('papa', 'audit/people');
    await get('papa', `reports/trends?${range}`);
    await get('papa', 'reports/udhaar-age');
    expect(await db.auditLog.count()).toBe(before);
  });
});

describe('every event has plain words on the desk', () => {
  const filesIn = (folder: string): string[] =>
    readdirSync(folder, { withFileTypes: true }).flatMap((entry) =>
      entry.isDirectory()
        ? filesIn(join(folder, entry.name))
        : entry.name.endsWith('.ts')
          ? [join(folder, entry.name)]
          : [],
    );
  /** The event names written to the log: literals, either side of a choice, and made-up names. */
  const written = () => {
    const found = new Set<string>();
    for (const file of filesIn('src')) {
      const text = readFileSync(file, 'utf8');
      for (const write of text.matchAll(
        /auditLog\.create\(\{[\s\S]*?event:\s*([\s\S]*?),\s*\n?\s*entityId/g,
      )) {
        const expression = write[1]!;
        if (expression.includes('`')) continue;
        // A name on the left of a choice is what is being compared, not an event.
        for (const name of expression.matchAll(/(?<!=== )'([A-Z][A-Z0-9_]+)'/g))
          found.add(name[1]!);
      }
    }
    return found;
  };
  const built = [
    ...['PENDING_PAYMENT', 'AWAITING_CONFIRMATION', 'CONFIRMED', 'PREPARING', 'OUT_FOR_DELIVERY'],
    ...['DELIVERY_EXCEPTION', 'DELIVERED', 'CANCELLED', 'REFUND_PENDING', 'REFUNDED'],
  ]
    .map((status) => `ORDER_${status}`)
    .concat(['REPORT', 'RETRY', 'RETURN'].map((action) => `DELIVERY_${action}`))
    .concat(['ACCEPTED', 'REJECTED'].map((status) => `QUOTE_${status}`))
    .concat(
      ['SALE_ON_CREDIT', 'PAYMENT_RECEIVED', 'OPENING_BALANCE', 'ADJUSTMENT', 'REVERSAL'].map(
        (kind) => `KHATA_${kind}`,
      ),
    );
  it('finds a full list of events to check', () => {
    const names = written();
    expect(names.size).toBeGreaterThan(70);
    for (const name of ['ORDER_CONFIRMED', 'GALLA_PAID_OUT', 'APPROVAL_GRANTED', 'WA_AI_PAUSED'])
      expect(names).toContain(name);
  });
  it('has a sentence for each, in both languages, with no script the desk cannot show', () => {
    const missing = [...written(), ...built].filter(
      (name) =>
        !(`owner.activity.event.${name}` in en) || !(`owner.activity.event.${name}` in hinglish),
    );
    expect(missing).toEqual([]);
    for (const [key, words] of Object.entries(hinglish))
      if (key.startsWith('owner.activity.')) expect(words).not.toMatch(/[ऀ-ॿ]/);
  });
});
