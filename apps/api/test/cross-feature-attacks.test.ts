import 'reflect-metadata';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { execFileSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import type { Server } from 'node:http';
import { loadEnvFile } from 'node:process';
import type { INestApplication } from '@nestjs/common';
import { istToday, bridgeProtocol } from '@shiv/shared';
import request from 'supertest';
import { resetConfigForTests, configSchema } from '../src/config';
import { Db } from '../src/db';
import { OrdersService } from '../src/orders';
import { addPerson, clearShopWork, tokenFor } from './staff-helper';
import { clearTally } from './tally-helper';

vi.mock('next/cache', () => ({ revalidateTag: vi.fn() }));
vi.mock('../../storefront/lib/public-data', () => ({ catalogTag: 'catalog' }));

if (existsSync('.env.test')) loadEnvFile('.env.test');
process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
process.env.OTP_PROVIDER = 'mock';
process.env.OTP_HASH_SECRET = 'cross-feature-test-only-secret-not-for-production';
process.env.CORS_ORIGINS = 'http://localhost:3000';
if (!process.env.DATABASE_URL || !new URL(process.env.DATABASE_URL).pathname.endsWith('_test'))
  throw new Error('These tests require a dedicated TEST_DATABASE_URL ending in _test.');

const MAIN = 'loc_main';
const SECOND = 'loc_cross_b';
let app: INestApplication;
let server: Server;
let db: Db;

const bearer = (id: string) => ({ Authorization: `Bearer ${tokenFor(id)}` });
const get = (who: string, path: string) => request(server).get(`/api/v1/${path}`).set(bearer(who));
const post = (who: string, path: string, body: object = {}) =>
  request(server).post(`/api/v1/${path}`).set(bearer(who)).send(body);

/** Each of these strings has one home. Finding one anywhere else is the point of these tests. */
const canary = {
  ledger: 'TALLYCANARYLEDGER',
  supplier: 'TALLYCANARYSUPPLIER',
  tallyPaise: '987654321',
  salaryPaise: '7654300',
  advanceNote: 'CANARYADVANCENOTE',
  payReason: 'CANARYPAYREASON',
  customerName: 'CANARYCUSTOMER',
  customerPhone: '+919812340001',
  orderSecond: 'SC-CANARY-SECOND',
  orderMain: 'SC-CANARY-MAIN',
  waWords: 'CANARYWORDS',
  draftWords: 'CANARYDRAFTWORDS',
  waPhone: '+919812340002',
};

type PersonSpec = {
  id: string;
  phone: string;
  role?:
    | 'OWNER'
    | 'MANAGER'
    | 'CASHIER'
    | 'ACCOUNTANT'
    | 'STOCK_KEEPER'
    | 'DRIVER'
    | 'HELPER'
    | 'TECH_OPERATOR';
  shops?: string[];
};
const people: PersonSpec[] = [
  { id: 'owner', phone: '+919811000001', role: 'OWNER' },
  { id: 'ownertwo', phone: '+919811000002', role: 'OWNER' },
  { id: 'managera', phone: '+919811000003', role: 'MANAGER', shops: [MAIN] },
  { id: 'managerb', phone: '+919811000004', role: 'MANAGER', shops: [SECOND] },
  { id: 'cashiera', phone: '+919811000005', role: 'CASHIER', shops: [MAIN] },
  { id: 'cashierb', phone: '+919811000006', role: 'CASHIER', shops: [SECOND] },
  { id: 'accountant', phone: '+919811000007', role: 'ACCOUNTANT' },
  { id: 'keepera', phone: '+919811000008', role: 'STOCK_KEEPER', shops: [MAIN] },
  { id: 'drivera', phone: '+919811000009', role: 'DRIVER', shops: [MAIN] },
  { id: 'driverb', phone: '+919811000010', role: 'DRIVER', shops: [SECOND] },
  { id: 'helpera', phone: '+919811000011', role: 'HELPER', shops: [MAIN] },
  { id: 'tech', phone: '+919811000012', role: 'TECH_OPERATOR' },
  { id: 'othercustomer', phone: '+919811000013' },
];

/** A linked phone for someone: an active device and a staff app session with its own token. */
async function linkDevice(userId: string, status: 'ACTIVE' | 'PENDING' = 'ACTIVE') {
  const token = tokenFor(`${userId}phone`);
  const device = await db.staffDevice.create({
    data: { userId, publicKey: `key-${userId}-${randomUUID()}`, model: 'Test', sdk: 34, status },
  });
  await db.session.create({
    data: {
      userId,
      surface: 'STAFF_APP',
      staffDeviceId: device.id,
      accessHash: createHash('sha256').update(token).digest('hex'),
      refreshHash: createHash('sha256').update(`${userId}-phone-refresh`).digest('hex'),
      expiresAt: new Date(Date.now() + 3600000),
      refreshExpiresAt: new Date(Date.now() + 86400000),
    },
  });
  return { deviceId: device.id, id: `${userId}phone` };
}

async function reset() {
  await clearShopWork(db);
  await clearTally(db);
  await db.$executeRawUnsafe(
    'TRUNCATE TABLE "WaDraft", "WaReaderRun", "WaMessage", "WaThread", "CustomerContact", "CustomerNote", "FollowUp", "KhataSignoff", "KhataOpeningDraft", "FinancialMovement", "User", "Category", "Product", "Order", "AuditLog", "AuthRateLimit", "OtpChallenge", "Notification", "DeliveryZone", "StoreSettings" RESTART IDENTITY CASCADE',
  );
  await db.location.upsert({
    where: { id: SECOND },
    update: { active: true },
    create: { id: SECOND, firmId: 'firm_main', slug: 'cross-b', name: 'Second shop' },
  });
  for (const person of people) await addPerson(db, person);
  await db.user.create({
    data: {
      id: 'customer',
      phone: canary.customerPhone,
      name: canary.customerName,
      area: 'Kankarbagh',
      creditAllowed: true,
      creditLimitPaise: 100000000,
      sessions: {
        create: {
          accessHash: createHash('sha256').update(tokenFor('customer')).digest('hex'),
          refreshHash: createHash('sha256').update('customer-refresh').digest('hex'),
          expiresAt: new Date(Date.now() + 3600000),
          refreshExpiresAt: new Date(Date.now() + 86400000),
          surface: 'CUSTOMER',
        },
      },
    },
  });
  await db.category.create({ data: { id: 'cat', name: 'Cement', slug: 'cement' } });
  await db.product.create({
    data: {
      id: 'cement',
      name: 'Cement',
      brand: 'Test',
      categoryId: 'cat',
      type: 'PPC',
      grade: 'PPC',
      unit: 'bag',
      pricePaise: 80000,
      stock: 500,
      minQuantity: 1,
      description: 'Test',
      recommendedUse: 'Test',
      images: [],
      active: true,
    },
  });
  for (const locationId of [MAIN, SECOND])
    await db.stockLevel.upsert({
      where: { productId_locationId: { productId: 'cement', locationId } },
      update: { quantity: 500 },
      create: { productId: 'cement', locationId, quantity: 500 },
    });
  await db.storeSettings.create({ data: { id: 'store', phone: '+919999999000' } });
  await db.deliveryZone.create({
    data: {
      id: 'zone',
      name: 'Patna',
      deliveryFeePaise: 0,
      minimumOrderPaise: 0,
      estimate: 'Today',
      pincodes: { create: [{ pincode: '800020', area: 'Kankarbagh' }] },
    },
  });
}

let orderSeq = 0;
type Method = 'COD' | 'CREDIT' | 'ONLINE';
/** A confirmed order at a shop, as the desk leaves one. Same shape as the jobs tests use. */
async function makeOrder(
  opts: {
    locationId?: string;
    method?: Method;
    captured?: boolean;
    status?: 'CONFIRMED' | 'PREPARING' | 'AWAITING_CONFIRMATION';
    quantity?: number;
    number?: string;
    userId?: string;
  } = {},
) {
  orderSeq++;
  const quantity = opts.quantity ?? 2;
  return db.order.create({
    data: {
      number: opts.number ?? `SC-CROSS-${orderSeq}-${randomUUID().slice(0, 6)}`,
      locationId: opts.locationId ?? MAIN,
      userId: opts.userId ?? 'customer',
      source: 'PHONE',
      createdById: 'managera',
      idempotencyKey: randomUUID(),
      status: opts.status ?? 'CONFIRMED',
      confirmedAt: new Date(),
      confirmedById: 'managera',
      address: {
        name: canary.customerName,
        phone: canary.customerPhone,
        line1: 'Plot 12, private lane',
        area: 'Kankarbagh',
        city: 'Patna',
        state: 'Bihar',
        pincode: '800020',
        landmark: 'Near the temple',
      },
      deliveryDate: istToday(),
      notes: '',
      subtotalPaise: 80000 * quantity,
      deliveryFeePaise: 0,
      totalPaise: 80000 * quantity,
      items: {
        create: {
          productId: 'cement',
          name: 'Cement',
          unit: 'bag',
          packSize: '',
          quantity,
          pricePaise: 80000,
          listPricePaise: 80000,
          priceVersion: 1,
          lineTotalPaise: 80000 * quantity,
        },
      },
      payment: {
        create: {
          method: opts.method ?? 'COD',
          status: opts.captured ? 'CAPTURED' : 'PENDING',
          amountPaise: 80000 * quantity,
        },
      },
      work: { create: {} },
    },
    include: { items: true, payment: true },
  });
}

/** Everything private, planted once, so a search can find it wherever it travels. */
async function plantWorld() {
  await makeOrder({ number: canary.orderMain, locationId: MAIN, method: 'CREDIT' });
  const second = await makeOrder({
    number: canary.orderSecond,
    locationId: SECOND,
    method: 'CREDIT',
  });
  await db.customerNote.create({
    data: { customerId: 'customer', actorId: 'owner', body: 'A note' },
  });

  const company = await db.tallyCompany.create({
    data: { guid: 'cross-co', name: 'Cross Traders', role: 'PRIMARY', phase: 'LIVE' },
  });
  for (const [guid, name, cls, closing] of [
    ['led-1', canary.ledger, 'DEBTOR', 987654321n],
    ['led-2', canary.supplier, 'CREDITOR', 987654321n],
  ] as const)
    await db.tallyLedger.create({
      data: {
        companyId: company.id,
        guid,
        alterId: 1n,
        name,
        parent: 'Sundry',
        class: cls,
        closingPaise: closing,
        closingAsOf: new Date(),
      },
    });
  await db.tallyPartyLink.create({
    data: {
      companyId: company.id,
      guid: 'led-1',
      userId: 'customer',
      status: 'LINKED',
      confirmedById: 'accountant',
    },
  });
  await db.khataRecon.create({
    data: {
      customerId: 'customer',
      firmId: 'firm_main',
      appPaise: 0,
      tallyPaise: 987654321n,
      differencePaise: 987654321n,
      unexplainedPaise: 987654321n,
      computedAt: new Date(),
      tallyAsOf: new Date(),
    },
  });

  await db.staffPayTerms.create({
    data: {
      userId: 'drivera',
      effectiveFrom: '2020-01-01',
      amountPaise: 7654300,
      createdById: 'owner',
    },
  });
  await post('owner', 'admin/salary/advances', {
    userId: 'drivera',
    amountPaise: 1234500,
    recoveryPaise: 0,
    channel: 'CASH',
    paidFrom: 'GALLA',
    locationId: MAIN,
    note: canary.advanceNote,
    idempotencyKey: randomUUID(),
  }).expect(201);
  await post('owner', `admin/salary/runs/${istToday().slice(0, 7)}/adjustments`, {
    userId: 'drivera',
    kind: 'ADDITION',
    amountPaise: 1000,
    reason: canary.payReason,
    idempotencyKey: randomUUID(),
  }).expect(201);

  const thread = await db.waThread.create({
    data: { contactKey: canary.waPhone, phone: canary.waPhone, profileName: 'Wa Person' },
  });
  const message = await db.waMessage.create({
    data: {
      wamid: 'wamid-cross',
      threadId: thread.id,
      direction: 'IN',
      type: 'text',
      text: canary.waWords,
      sentAt: new Date(),
    },
  });
  await db.waReaderRun.create({
    data: {
      threadId: thread.id,
      messageIds: [message.id],
      reader: 'fake',
      errorCode: 'READER_FAILED',
    } as never,
  });
  const draft = await db.waDraft.create({
    data: {
      threadId: thread.id,
      source: 'WHATSAPP',
      locationId: SECOND,
      originalText: canary.draftWords,
      orderedByPhone: canary.waPhone,
      lines: [],
    },
  });
  await db.followUp.create({
    data: {
      customerId: 'customer',
      locationId: SECOND,
      dueOn: istToday(),
      kind: 'PAYMENT',
      createdById: 'managerb',
      idempotencyKey: randomUUID(),
      requestHash: 'x',
    },
  });
  return { second, draft, company };
}

beforeAll(async () => {
  const { createApp } = await import('../src/app');
  app = await createApp();
  await app.listen(0, '127.0.0.1');
  server = app.getHttpServer();
  db = app.get(Db);
}, 30000);
afterAll(async () => {
  await app?.close();
});

// ---- Discovery ----------------------------------------------------------------------------------

const verbs: Record<number, 'post' | 'put' | 'delete' | 'patch'> = {
  1: 'post',
  2: 'put',
  3: 'delete',
  4: 'patch',
};
type Write = { path: string; verb: 'post' | 'put' | 'delete' | 'patch' };
async function getWrites(): Promise<Write[]> {
  const { AppModule } = await import('../src/app');
  const controllers: (new (...args: never[]) => object)[] =
    Reflect.getMetadata('controllers', AppModule) ?? [];
  return controllers.flatMap((controller) => {
    const base = String(Reflect.getMetadata('path', controller) ?? '');
    return Object.getOwnPropertyNames(controller.prototype).flatMap((key) => {
      const handler = (controller.prototype as Record<string, unknown>)[key];
      if (typeof handler !== 'function' || key === 'constructor') return [];
      const path = Reflect.getMetadata('path', handler) as string | undefined;
      const verb = verbs[Reflect.getMetadata('method', handler) as number];
      if (path === undefined || !verb) return [];
      return [{ path: [base, path].filter((part) => part && part !== '/').join('/'), verb }];
    });
  });
}

type Route = { path: string; name: string };
async function getRoutes(): Promise<Route[]> {
  const { AppModule } = await import('../src/app');
  const controllers: (new (...args: never[]) => object)[] =
    Reflect.getMetadata('controllers', AppModule) ?? [];
  return controllers.flatMap((controller) => {
    const base = String(Reflect.getMetadata('path', controller) ?? '');
    return Object.getOwnPropertyNames(controller.prototype).flatMap((key) => {
      const handler = (controller.prototype as Record<string, unknown>)[key];
      if (typeof handler !== 'function' || key === 'constructor') return [];
      const path = Reflect.getMetadata('path', handler) as string | string[] | undefined;
      const method = Reflect.getMetadata('method', handler) as number | undefined;
      if (path === undefined || method !== 0) return [];
      if (Reflect.getMetadata('__sse__', handler)) return [];
      const paths = Array.isArray(path) ? path : [path];
      return paths.map((one) => ({
        path: [base, one].filter((part) => part && part !== '/').join('/'),
        name: `${controller.name}.${key}`,
      }));
    });
  });
}

const today = () => istToday();
const lastMonth = () => {
  const [year, month] = today().split('-').map(Number) as [number, number];
  return month === 1 ? `${year - 1}-12` : `${year}-${String(month - 1).padStart(2, '0')}`;
};
const uuid = () => randomUUID();

describe('a planted secret stays where it belongs', () => {
  it('every GET route, for every kind of session', async () => {
    await reset();
    const { second, draft, company } = await plantWorld();
    const driverPhone = await linkDevice('drivera');
    const managerPhone = await linkDevice('managera');
    const ownerPhone = await linkDevice('owner');
    // A question put to the owner about someone's pay, and a quote with the customer's number.
    await db.approvalRequest.create({
      data: {
        kind: 'ADVANCE',
        locationId: MAIN,
        amountPaise: 1111100,
        payload: { userId: 'drivera', amountPaise: 1111100, recoveryPaise: 0 },
        requestedById: 'managera',
        idempotencyKey: `advance:${uuid()}`,
        note: canary.advanceNote,
      },
    });
    const sessions: Record<string, string> = {
      owner: tokenFor('owner'),
      accountant: tokenFor('accountant'),
      managera: tokenFor('managera'),
      managerb: tokenFor('managerb'),
      cashiera: tokenFor('cashiera'),
      keepera: tokenFor('keepera'),
      drivera_desk: tokenFor('drivera'),
      helpera: tokenFor('helpera'),
      tech: tokenFor('tech'),
      customer: tokenFor('customer'),
      othercustomer: tokenFor('othercustomer'),
      drivera_app: tokenFor(driverPhone.id),
      managera_app: tokenFor(managerPhone.id),
      owner_app: tokenFor(ownerPhone.id),
      anonymous: '',
    };
    const month = today().slice(0, 7);
    const substitute = (path: string): string[] => {
      const ids = (() => {
        if (/customers\/:id|pricing\/customers/.test(path)) return ['customer'];
        if (/orders\/:id|inbox\/:id/.test(path)) return [second.id];
        if (/drafts\/:id/.test(path)) return [draft.id];
        if (/salary\/people|attendance\/person|staff\/:id/.test(path)) return ['drivera'];
        if (/products\/:id/.test(path)) return ['cement'];
        return ['customer', second.id, 'drivera', company.id];
      })();
      return ids.map((id) =>
        path
          .replace(':id', id)
          .replace(':day', today())
          .replace(':month', month)
          .replace(':locationId', SECOND)
          .replace(':pincode', '800020')
          .replace(':period', 'before')
          .replace(':slug', 'x')
          .replace(':key', 'x')
          .replace(':version', '1.0.0')
          .replace(':page', '1')
          .replace(':format', 'png'),
      );
    };
    const hits: Record<string, Record<string, Set<string>>> = {};
    const statuses: Record<string, Record<string, Set<number>>> = {};
    const routes = await getRoutes();
    const seen = new Set<string>();
    for (const route of routes)
      for (const path of substitute(route.path)) {
        if (seen.has(path)) continue;
        seen.add(path);
        for (const [who, token] of Object.entries(sessions))
          for (const query of [
            '',
            `?from=${today()}&to=${today()}`,
            `?locationId=${SECOND}&day=${today()}&month=${month}&from=${today()}&to=${today()}`,
            `?filter=all`,
          ]) {
            const req = request(server).get(`/api/v1/${path}${query}`);
            const res = await (token ? req.set('Authorization', `Bearer ${token}`) : req);
            ((statuses[path] ??= {})[who] ??= new Set()).add(res.status);
            const text = res.text || JSON.stringify(res.body ?? '');
            for (const [name, value] of Object.entries(canary))
              if (text.includes(value))
                ((hits[name] ??= {})[who] ??= new Set()).add(path.split('?')[0]!);
          }
      }
    const seenBy = (name: keyof typeof canary) => Object.keys(hits[name] ?? {}).sort();
    const where = (name: keyof typeof canary, who: string) => [...(hits[name]?.[who] ?? [])].sort();

    expect(routes.length).toBeGreaterThan(100);
    // Nothing on the server fell over answering any of this.
    const broken = Object.entries(statuses).flatMap(([path, row]) =>
      Object.entries(row).flatMap(([who, codes]) =>
        [...codes].filter((code) => code >= 500).map((code) => `${who} ${path} ${code}`),
      ),
    );
    expect(broken).toEqual([]);
    // Tally numbers and ledger names: owners and the accountant, on no other path at all.
    expect(seenBy('ledger')).toEqual(['accountant', 'owner']);
    expect(seenBy('supplier')).toEqual(['accountant', 'owner']);
    expect(seenBy('tallyPaise')).toEqual(['accountant', 'owner']);
    // Salary: owners, the accountant, and the person themselves.
    expect(seenBy('salaryPaise')).toEqual(['accountant', 'drivera_app', 'drivera_desk', 'owner']);
    expect(where('salaryPaise', 'drivera_app')).toEqual(['staff/me/pay']);
    expect(seenBy('payReason')).toEqual(['accountant', 'owner']);
    // An advance's note reaches the person who asked it, and those who hold the money.
    expect(seenBy('advanceNote').filter((who) => !['accountant', 'owner'].includes(who))).toEqual([
      'managera',
      'managera_app',
    ]);
    expect(where('advanceNote', 'managera')).toEqual(['admin/approvals']);
    // The accountant's lists carry no customer's number, on any path.
    expect(where('customerPhone', 'accountant')).toEqual([]);
    for (const who of ['tech', 'keepera', 'helpera', 'drivera_desk', 'othercustomer', 'anonymous'])
      expect(where('customerPhone', who)).toEqual([]);
    for (const who of ['managera_app', 'owner_app', 'drivera_app'])
      expect(where('customerPhone', who)).toEqual([]);
    // Another shop's orders stay with that shop.
    for (const who of ['managera', 'cashiera', 'keepera', 'managera_app'])
      expect(where('orderSecond', who)).toEqual([]);
    expect(where('orderMain', 'managerb')).toEqual([]);
    // WhatsApp words: owners read them, and a shop's people see only that shop's cards.
    expect(seenBy('waWords')).toEqual(['owner']);
    expect(seenBy('draftWords')).toEqual(['managerb', 'owner']);
    expect(seenBy('waPhone')).toEqual(['managerb', 'owner']);
    // Customers, strangers, drivers and helpers open no desk route at all.
    for (const [path, row] of Object.entries(statuses))
      if (path.startsWith('admin/'))
        for (const who of ['customer', 'othercustomer', 'anonymous', 'helpera', 'drivera_desk'])
          expect([
            path,
            who,
            [...row[who]!].every((code) => [401, 403, 404].includes(code)),
          ]).toEqual([path, who, true]);
    // The technical login reads health numbers, and nothing about a customer or a rupee.
    const techOpen = Object.entries(statuses)
      .filter(([path, row]) => path.startsWith('admin/') && row.tech!.has(200))
      .map(([path]) => path)
      .sort();
    expect(techOpen).toEqual([
      'admin/advisor/health',
      'admin/alerts/messages',
      'admin/push/key',
      'admin/security-status',
      'admin/tally/health',
      'admin/wa/health',
    ]);
    // A phone holding the staff app reaches stock and its own questions, whoever is holding it.
    const phoneOpen = Object.entries(statuses)
      .filter(([path, row]) => path.startsWith('admin/') && row.owner_app!.has(200))
      .map(([path]) => path)
      .sort();
    expect(phoneOpen).toEqual([
      'admin/approvals',
      'admin/products',
      'admin/products/cement/movements',
      'admin/stock',
      'admin/stock/transfers',
    ]);
  }, 300000);

  it('every desk write, for those who should reach none or a few', async () => {
    await reset();
    const driverPhone = await linkDevice('drivera');
    const managerPhone = await linkDevice('managera');
    await db.user.update({ where: { id: 'keepera' }, data: { staffPausedAt: new Date() } });
    const writes = (await getWrites()).filter((row) => row.path.startsWith('admin/'));
    expect(writes.length).toBeGreaterThan(80);
    const reachedBy = async (token: string | null) => {
      const reached: string[] = [];
      for (const { path, verb } of writes) {
        const concrete = path.replace(/:[a-zA-Z]+/g, 'nothing-here');
        const req = request(server)[verb](`/api/v1/${concrete}`);
        const res = await (token ? req.set('Authorization', `Bearer ${token}`) : req).send({});
        if (![401, 403].includes(res.status)) reached.push(path);
      }
      return reached.sort();
    };
    expect(await reachedBy(null)).toEqual(['admin/push/action', 'admin/push/ack'].sort());
    const publicOnly = ['admin/push/ack', 'admin/push/action'];
    expect(await reachedBy(tokenFor('customer'))).toEqual(publicOnly);
    expect(await reachedBy(tokenFor('keepera'))).toEqual(publicOnly);
    expect(await reachedBy(tokenFor('drivera'))).toEqual(publicOnly);
    expect(await reachedBy(tokenFor('helpera'))).toEqual(publicOnly);
    expect(await reachedBy(tokenFor(driverPhone.id))).toEqual(publicOnly);
    const phone = (await reachedBy(tokenFor(managerPhone.id))).filter(
      (path) => !publicOnly.includes(path),
    );
    expect(phone).toEqual(
      [
        'admin/products/:id/movements',
        // Reaches the check on its body. Asking for money is refused after: see the tests below.
        'admin/salary/advances/ask',
        'admin/stock/counts',
        'admin/stock/counts/:id/lines',
        'admin/stock/counts/:id/submit',
        'admin/stock/damage',
        'admin/stock/transfers',
        'admin/stock/transfers/:id/receive',
      ].sort(),
    );
    const tech = (await reachedBy(tokenFor('tech'))).filter((path) => !publicOnly.includes(path));
    expect(tech).toEqual(
      [
        'admin/advisor/settings',
        'admin/alerts/messages/:id/retry',
        'admin/alerts/test',
        'admin/push/subscriptions',
        'admin/push/subscriptions',
        'admin/tally/companies/:id',
        'admin/tally/devices/:id/release',
        'admin/tally/devices/:id/revoke',
        'admin/tally/devices/pair',
        'admin/tally/pause',
        'admin/tally/releases',
      ].sort(),
    );
  }, 120000);

  it('searching orders cannot be used to discover a number the accountant may not see', async () => {
    await reset();
    await makeOrder({ number: canary.orderMain });
    const found = await get('accountant', 'admin/orders?q=98123400').expect(200);
    expect(found.body.items).toEqual([]);
    expect((await get('owner', 'admin/orders?q=98123400').expect(200)).body.items.length).toBe(1);
  });

  it('quotes carry no customer number to the accountant either', async () => {
    await reset();
    await db.quote.create({
      data: {
        number: 'Q-CROSS-1',
        userId: 'customer',
        locationId: MAIN,
        status: 'REQUESTED',
        address: { name: 'R', phone: canary.customerPhone, area: 'x' },
        deliveryDate: today(),
        company: '',
        gstin: '',
        notes: '',
      },
    });
    const asAccountant = await get('accountant', 'admin/quotes').expect(200);
    expect(JSON.stringify(asAccountant.body)).not.toContain(canary.customerPhone);
    const asOwner = await get('owner', 'admin/quotes').expect(200);
    expect(JSON.stringify(asOwner.body)).toContain(canary.customerPhone);
  });
});

describe('who a session may act as', () => {
  beforeEach(reset);

  const signInByCode = async (phone: string) => {
    const sent = await request(server).post('/api/v1/auth/otp/request').send({ phone }).expect(201);
    const signed = await request(server)
      .post('/api/v1/auth/otp/verify')
      .send({ phone, code: sent.body.devCode })
      .expect(201);
    return { Authorization: `Bearer ${signed.body.accessToken}` };
  };

  it('a driver cut off from the app does not carry on from a code-only sign-in', async () => {
    const { deviceId } = await linkDevice('drivera');
    const { stopId } = await outOnTrip();
    await post('managera', 'admin/staff/drivera/device/revoke').expect(201);
    expect((await db.staffDevice.findUniqueOrThrow({ where: { id: deviceId } })).status).toBe(
      'LOST',
    );
    // The phone itself is told, and stops.
    await get('driveraphone', 'staff/cash').expect(401);
    // The same person, or whoever holds the SIM, gets a desk session from a text message alone.
    const desk = await signInByCode('+919811000009');
    for (const [method, path, body] of [
      ['get', 'staff/trips/mine', undefined],
      ['get', 'staff/cash', undefined],
      [
        'post',
        `staff/stops/${stopId}/delivered`,
        {
          idempotencyKey: uuid(),
          skipReason: 'none',
          collected: { amountPaise: 160000, channel: 'UPI' },
        },
      ],
      ['post', 'staff/cash/handover', { amountPaise: 100, handoverKey: uuid() }],
      ['post', `staff/stops/${stopId}/problem`, { idempotencyKey: uuid(), problem: 'OTHER' }],
    ] as const) {
      const req =
        method === 'get'
          ? request(server).get(`/api/v1/${path}`).set(desk)
          : request(server).post(`/api/v1/${path}`).set(desk).send(body);
      expect([path, (await req).status]).toEqual([path, 403]);
    }
    expect(await db.driverCollection.count()).toBe(0);
  });

  it('a customer cannot raise a hazri card or add to anyone’s attendance record', async () => {
    const asked = await post('customer', 'staff/me/query', { day: today(), note: 'Spam spam' });
    expect(asked.status).toBe(403);
    expect(await db.attendanceReview.count()).toBe(0);
    expect(await db.attendanceEvent.count()).toBe(0);
  });

  it('someone paused or gone cannot raise one either', async () => {
    await linkDevice('drivera');
    await db.user.update({ where: { id: 'drivera' }, data: { staffPausedAt: new Date() } });
    expect(
      (await post('driveraphone', 'staff/me/query', { day: today(), note: 'Hello' })).status,
    ).toBe(403);
    await db.staffMembership.updateMany({
      where: { userId: 'helpera' },
      data: { endedAt: new Date(), endedById: 'owner' },
    });
    expect((await post('helpera', 'staff/me/query', { day: today(), note: 'Hello' })).status).toBe(
      403,
    );
    expect(await db.attendanceReview.count()).toBe(0);
  });

  it('staff can still raise their own', async () => {
    await linkDevice('drivera');
    await post('driveraphone', 'staff/me/query', { day: today(), note: 'Galat hai' }).expect(201);
    await post('managera', 'staff/me/query', { day: today(), note: 'Galat hai' }).expect(201);
    expect(await db.attendanceReview.count()).toBe(2);
  });

  it('staff place no order on their own account through the old cart', async () => {
    await db.address.create({
      data: {
        id: 'addr-staff',
        userId: 'managera',
        label: 'Home',
        name: 'M',
        phone: '+919811000003',
        line1: 'x',
        area: 'y',
        city: 'Patna',
        state: 'Bihar',
        pincode: '800020',
        landmark: '',
      } as never,
    });
    await request(server)
      .put('/api/v1/cart/items')
      .set(bearer('managera'))
      .send({ productId: 'cement', quantity: 1 });
    const review = await post('managera', 'checkout/review', {
      addressId: 'addr-staff',
      deliveryDate: today(),
      paymentMethod: 'COD',
    });
    expect(review.status).toBe(403);
    expect(review.body.error.code).toBe('STAFF_ACCOUNT');
  });

  it('staff ask for no quote on their own account either', async () => {
    await db.address.create({
      data: {
        id: 'addr-quote',
        userId: 'managera',
        label: 'Site',
        name: 'M',
        phone: '+919811000003',
        line1: 'x',
        area: 'y',
        city: 'Patna',
        state: 'Bihar',
        pincode: '800020',
        landmark: '',
      } as never,
    });
    const asked = await post('managera', 'quotes', {
      items: [{ productId: 'cement', quantity: 10 }],
      addressId: 'addr-quote',
      deliveryDate: today(),
    });
    expect(asked.status).toBe(403);
    expect(asked.body.error.code).toBe('STAFF_ACCOUNT');
  });

  it('a paused driver’s phone does nothing, and neither does a removed one', async () => {
    await linkDevice('drivera');
    await linkDevice('driverb');
    await db.user.update({ where: { id: 'drivera' }, data: { staffPausedAt: new Date() } });
    await get('driveraphone', 'staff/trips/mine').expect(403);
    await post('driveraphone', 'staff/cash/handover', {
      amountPaise: 100,
      handoverKey: uuid(),
    }).expect(403);
    await post('owner', 'admin/users/driverb/remove', {}).expect(201);
    await get('driverbphone', 'staff/trips/mine').expect(401);
    // Their rights are gone, and their old sign-in with them, even with the phone still linked.
    await post('driverb', 'staff/me/query', { day: today(), note: 'Hello' }).expect(401);
  });

  it('a phone waiting for its yes does nothing, and a refused one is told so', async () => {
    const waiting = await linkDevice('drivera', 'PENDING');
    await get(waiting.id, 'staff/trips/mine').expect(403);
    await post(waiting.id, 'staff/cash/handover', {
      amountPaise: 100,
      handoverKey: uuid(),
    }).expect(403);
    await db.staffDevice.update({ where: { id: waiting.deviceId }, data: { status: 'REVOKED' } });
    await get(waiting.id, 'staff/me/pay').expect(401);
  });

  it('a phone sees goods and counts, and no rupee, whoever holds it', async () => {
    await linkDevice('owner');
    await linkDevice('managera');
    for (const who of ['ownerphone', 'manageraphone'])
      for (const path of [
        'admin/products',
        'admin/stock',
        'admin/stock/transfers',
        'admin/approvals',
      ])
        expect([who, path, JSON.stringify((await get(who, path).expect(200)).body)]).not.toEqual(
          expect.arrayContaining([expect.stringContaining('80000')]),
        );
    await get('ownerphone', 'admin/customers').expect(403);
    await get('ownerphone', 'admin/orders').expect(403);
    await get('ownerphone', 'admin/galla').expect(403);
    await get('ownerphone', 'admin/salary/terms').expect(403);
    await post('ownerphone', 'auth/passphrase', { next: 'a-passphrase-long-enough' }).expect(403);
    await post('ownerphone', 'admin/users', {}).expect(403);
  });

  it('one driver cannot read or spend another’s cash', async () => {
    await linkDevice('drivera');
    await linkDevice('driverb');
    const { stopId } = await outOnTrip();
    await post('driveraphone', `staff/stops/${stopId}/delivered`, {
      idempotencyKey: uuid(),
      skipReason: 'none',
      collected: { amountPaise: 160000, channel: 'CASH' },
    }).expect(201);
    expect((await get('driverbphone', 'staff/cash').expect(200)).body.holdingPaise).toBe(0);
    await post('driverbphone', 'staff/cash/handover', {
      amountPaise: 160000,
      handoverKey: uuid(),
    }).expect(409);
    await get('driverbphone', 'admin/galla/handovers').expect(403);
    await get('drivera', 'admin/galla/handovers').expect(403);
    // Another driver's key does not reach this one's handover.
    const key = uuid();
    await post('driveraphone', 'staff/cash/handover', {
      amountPaise: 160000,
      handoverKey: key,
    }).expect(201);
    await post('driverbphone', 'staff/cash/handover', {
      amountPaise: 160000,
      handoverKey: key,
    }).expect(409);
  });
});

describe('another shop is another shop', () => {
  beforeEach(reset);
  const ask = (who: string, body: object) =>
    post(who, 'admin/salary/advances/ask', {
      userId: 'drivera',
      amountPaise: 100000,
      recoveryPaise: 0,
      idempotencyKey: uuid(),
      ...body,
    });

  it('an advance cannot be asked out of another shop’s drawer', async () => {
    const asked = await ask('managera', { paidFrom: 'GALLA', channel: 'CASH', locationId: SECOND });
    expect(asked.status).toBe(403);
    expect(await db.approvalRequest.count()).toBe(0);
  });

  it('a phone cannot ask for money, even a manager’s', async () => {
    await linkDevice('managera');
    const asked = await post('managera' + 'phone', 'admin/salary/advances/ask', {
      userId: 'drivera',
      amountPaise: 100000,
      recoveryPaise: 0,
      idempotencyKey: uuid(),
    });
    expect(asked.status).toBe(403);
  });

  it('what an owner approves comes out of the drawer they were shown', async () => {
    const asked = await ask('managera', { paidFrom: 'GALLA', channel: 'CASH' }).expect(201);
    const listed = await get('owner', 'admin/approvals').expect(200);
    const card = listed.body.items.find((row: { id: string }) => row.id === asked.body.id);
    expect(card.shopName).not.toBe('');
    await post('owner', `admin/approvals/${asked.body.id}/decide`, { decision: 'APPROVE' }).expect(
      201,
    );
    const money = await db.financialMovement.findMany({ where: { kind: 'STAFF_ADVANCE' } });
    expect(money.map((row) => [row.locationId, row.amountPaise])).toEqual([[MAIN, 100000]]);
  });

  it('a card at another shop can be neither read, changed, confirmed nor refused', async () => {
    const draft = await makeDraft(SECOND);
    await get('managera', `admin/wa/drafts/${draft.id}`).expect(403);
    await request(server)
      .patch(`/api/v1/admin/wa/drafts/${draft.id}`)
      .set(bearer('managera'))
      .send({ expectedVersion: 1, placeText: 'x' })
      .expect(403);
    await post('managera', `admin/wa/drafts/${draft.id}/confirm`, {
      expectedVersion: 1,
      priceVersions: { cement: 1 },
    }).expect(403);
    await post('managera', `admin/wa/drafts/${draft.id}/refuse`, {
      expectedVersion: 1,
      reason: 'OUT_OF_STOCK',
    }).expect(403);
    await post('managera', 'admin/wa/paste', {
      text: '2 bag cement',
      locationId: SECOND,
      idempotencyKey: uuid(),
    }).expect(403);
    expect((await get('managera', 'admin/wa/drafts').expect(200)).body.items).toEqual([]);
  });

  it('money cannot be taken into, or read from, another shop’s drawer', async () => {
    await post('cashiera', 'admin/customers/customer/khata/payment', {
      amountPaise: 1000,
      note: 'x',
      idempotencyKey: uuid(),
      locationId: SECOND,
    }).expect(403);
    await get('managera', `admin/galla?locationId=${SECOND}`).expect(403);
    await post('managera', 'admin/galla/entries', {
      locationId: SECOND,
      kind: 'PAID_OUT',
      amountPaise: 100,
      reason: 'x',
      idempotencyKey: uuid(),
    }).expect(403);
    await post('managera', 'admin/galla/close', {
      locationId: SECOND,
      day: today(),
      countedPaise: 0,
    }).expect(403);
    await get('managera', `admin/reports/money?from=${today()}&to=${today()}&locationId=${SECOND}`);
    await get('managera', `admin/reports/vasooli?locationId=${SECOND}`).expect(403);
    await get('managera', `admin/reports/shaam?locationId=${SECOND}`).expect(403);
  });

  it('a sale taken back at another shop does not name its order here', async () => {
    const order = await makeOrder({
      locationId: SECOND,
      method: 'CREDIT',
      number: canary.orderSecond,
    });
    await post('managerb', `staff/stock/loads/${order.id}`, { idempotencyKey: uuid() }).expect(201);
    await request(server)
      .patch(`/api/v1/admin/orders/${order.id}/status`)
      .set(bearer('managerb'))
      .send({ status: 'CANCELLED', note: 'x' })
      .expect(200);
    expect(await balance()).toBe(0);
    for (const path of ['admin/customers/customer/khata', 'admin/customers/customer/timeline']) {
      const here = await get('managera', path).expect(200);
      expect([path, JSON.stringify(here.body).includes(canary.orderSecond)]).toEqual([path, false]);
      const there = await get('managerb', path).expect(200);
      expect([path, JSON.stringify(there.body).includes(canary.orderSecond)]).toEqual([path, true]);
    }
  });

  it('another shop’s promise is not on this shop’s vasooli list', async () => {
    await post('accountant', 'admin/khata/opening-sheet', {
      customerId: 'customer',
      asOf: today(),
      paperPaise: 500000,
    }).expect(201);
    await post('owner', 'admin/khata/opening-sheet/approve', {
      rows: [{ customerId: 'customer', draftVersion: 1, chosenPaise: 500000 }],
    }).expect(201);
    await post('managerb', 'admin/followups', {
      customerId: 'customer',
      locationId: SECOND,
      dueOn: today(),
      kind: 'PAYMENT',
      promisedPaise: 555500,
      idempotencyKey: uuid(),
    }).expect(201);
    const list = await get('managera', 'admin/reports/vasooli').expect(200);
    expect(list.body.items.length).toBe(1);
    expect(list.body.items[0].promise).toBeNull();
    expect(JSON.stringify(list.body)).not.toContain('555500');
    const firm = await get('owner', 'admin/reports/vasooli').expect(200);
    expect(firm.body.items[0].promise.promisedPaise).toBe(555500);
  });

  it('what a customer spends at another shop is not in this shop’s quiet list', async () => {
    const ago = (days: number) => new Date(Date.now() - days * 86400000);
    for (const [days, locationId] of [
      [200, SECOND],
      [170, SECOND],
      [140, MAIN],
    ] as const) {
      const row = await makeOrder({ locationId, quantity: locationId === SECOND ? 100 : 1 });
      await db.$executeRaw`UPDATE "Order" SET "createdAt" = ${ago(days)} WHERE id = ${row.id}`;
    }
    await db.user.update({ where: { id: 'customer' }, data: { lastOrderAt: ago(140) } });
    const list = await get('managera', 'admin/crm/dormant').expect(200);
    expect(list.body.items.length).toBe(1);
    expect(list.body.items[0].yearPaise).toBe(80000);
    const firm = await get('owner', 'admin/crm/dormant').expect(200);
    expect(firm.body.items[0].yearPaise).toBe(80000 + 2 * 8000000);
  });

  it('calls and reminders at another shop are out of reach', async () => {
    const theirs = await post('managerb', 'admin/followups', {
      customerId: 'customer',
      locationId: SECOND,
      dueOn: today(),
      kind: 'PAYMENT',
      idempotencyKey: uuid(),
    }).expect(201);
    await post('managera', 'admin/followups', {
      customerId: 'customer',
      locationId: SECOND,
      dueOn: today(),
      kind: 'PAYMENT',
      idempotencyKey: uuid(),
    }).expect(403);
    await request(server)
      .patch(`/api/v1/admin/followups/${theirs.body.id}`)
      .set(bearer('managera'))
      .send({ action: 'DONE', idempotencyKey: uuid() })
      .expect(403);
    await get('managera', `admin/followups?locationId=${SECOND}`).expect(403);
    await post('cashiera', 'admin/customers/customer/reminder', {
      purpose: 'PAYMENT',
      followUpId: theirs.body.id,
      idempotencyKey: uuid(),
    }).expect(403);
  });

  it('a person’s record cannot be reached through a shop they are not at', async () => {
    await get('managerb', `admin/attendance/person/drivera/${today()}`).expect(403);
    await get('managerb', `admin/attendance/day?locationId=${MAIN}`).expect(403);
    await post('managerb', 'admin/attendance/manual', {
      userId: 'drivera',
      locationId: MAIN,
      kind: 'MANUAL_IN',
      idempotencyKey: uuid(),
    }).expect(403);
    await post('managerb', 'admin/staff/drivera/device/revoke').expect(403);
    await get('managerb', `admin/screens/here/${MAIN}`).expect(403);
  });
});

// ---- Money --------------------------------------------------------------------------------------

async function makeDraft(locationId = MAIN, extra: object = {}) {
  return db.waDraft.create({
    data: {
      source: 'PASTE',
      createdById: 'owner',
      locationId,
      originalText: 'do bag cement',
      orderedByPhone: '+919812340003',
      orderedByName: 'Ramu',
      payWhen: 'AT_DELIVERY',
      fulfilment: 'PICKUP',
      dayKind: 'DATE',
      deliveryDate: today(),
      lines: [
        {
          rawText: 'do bag',
          productId: 'cement',
          productName: 'Cement',
          quantity: 2,
          unitWord: 'bag',
          candidates: 1,
        },
      ],
      ...extra,
    },
  });
}

/** Loaded, on a trip and gone: the order as a driver's phone sees it. */
async function outOnTrip(opts: Parameters<typeof makeOrder>[0] = {}) {
  if (!(await db.staffDevice.findFirst({ where: { userId: 'keepera' } })))
    await linkDevice('keepera');
  if (!(await db.staffDevice.findFirst({ where: { userId: 'drivera' } })))
    await linkDevice('drivera');
  const order = await makeOrder(opts);
  await post('keeperaphone', `staff/stock/loads/${order.id}`, {
    vehicle: 'BR01',
    idempotencyKey: uuid(),
  }).expect(201);
  const trip = await post('managera', 'admin/trips', {
    locationId: MAIN,
    driverId: 'drivera',
    vehicle: 'BR01',
    orderIds: [order.id],
    idempotencyKey: uuid(),
  }).expect(201);
  await post('driveraphone', `staff/trips/${trip.body.id}/start`, {
    idempotencyKey: uuid(),
  }).expect(201);
  const stop = await db.tripStop.findFirstOrThrow({ where: { orderId: order.id } });
  return { order, tripId: trip.body.id as string, stopId: stop.id };
}
const delivered = (stopId: string, extra: object = {}, who = 'driveraphone') =>
  post(who, `staff/stops/${stopId}/delivered`, {
    idempotencyKey: uuid(),
    skipReason: 'Andhera tha',
    ...extra,
  });
const sheet = async (who = 'owner', locationId = MAIN, day = today()) =>
  (await get(who, `admin/galla?locationId=${locationId}&day=${day}`).expect(200)).body;
const balance = async (id = 'customer') =>
  (await db.user.findUniqueOrThrow({ where: { id } })).khataBalancePaise;
const ledgerSum = async (id = 'customer') =>
  (
    await db.customerLedgerEntry.aggregate({
      where: { customerId: id },
      _sum: { amountPaise: true },
    })
  )._sum.amountPaise ?? 0;
const handover = async (amountPaise = 160000, key = uuid()) => {
  await post('driveraphone', 'staff/cash/handover', { amountPaise, handoverKey: key }).expect(201);
  return key;
};

describe('a driver’s money, from door to drawer', () => {
  beforeEach(reset);

  it('a delivery whose reply was lost is not paid a second time on another tap', async () => {
    const { stopId, order } = await outOnTrip();
    const orders = app.get(OrdersService);
    const spy = vi.spyOn(orders, 'changeStatus').mockRejectedValueOnce(new Error('lost'));
    const first = await delivered(stopId, { collected: { amountPaise: 60000, channel: 'CASH' } });
    expect(first.status).toBe(500);
    spy.mockRestore();
    // The driver saw an error, so taps again: the app makes a new key for a new tap.
    await delivered(stopId, { collected: { amountPaise: 60000, channel: 'CASH' } });
    const taken = await db.driverCollection.findMany({ where: { orderId: order.id } });
    expect(taken.map((row) => row.amountPaise)).toEqual([60000]);
    // And the order still finishes.
    expect((await db.order.findUniqueOrThrow({ where: { id: order.id } })).status).toBe(
      'DELIVERED',
    );
  });

  it('two taps at once take the money once', async () => {
    const { stopId, order } = await outOnTrip();
    const answers = await Promise.all([
      delivered(stopId, { collected: { amountPaise: 60000, channel: 'CASH' } }),
      delivered(stopId, { collected: { amountPaise: 60000, channel: 'CASH' } }),
      delivered(stopId, { collected: { amountPaise: 60000, channel: 'CASH' } }),
    ]);
    expect(answers.some((res) => res.status === 201)).toBe(true);
    const taken = await db.driverCollection.findMany({ where: { orderId: order.id } });
    expect(taken.length).toBe(1);
  });

  it('a delivered stop cannot be turned into a problem afterwards', async () => {
    const { stopId, order } = await outOnTrip();
    await delivered(stopId, { collected: { amountPaise: 160000, channel: 'CASH' } }).expect(201);
    const after = await post('driveraphone', `staff/stops/${stopId}/problem`, {
      idempotencyKey: uuid(),
      problem: 'CUSTOMER_ABSENT',
    });
    expect(after.status).toBe(409);
    expect((await db.tripStop.findUniqueOrThrow({ where: { id: stopId } })).status).toBe(
      'DELIVERED',
    );
    expect(await db.deliveryProof.count({ where: { orderId: order.id, kind: 'PROBLEM' } })).toBe(0);
  });

  it('a stop with a problem cannot be marked delivered on the old trip', async () => {
    const { stopId, order } = await outOnTrip();
    await post('driveraphone', `staff/stops/${stopId}/problem`, {
      idempotencyKey: uuid(),
      problem: 'CUSTOMER_ABSENT',
    }).expect(201);
    // The desk sends it out again by hand: the order is out, but this stop is finished.
    await post('managera', `admin/orders/${order.id}/delivery`, {
      action: 'RETRY',
      retryDate: today(),
      note: 'Again',
      idempotencyKey: uuid(),
    }).expect(201);
    const late = await delivered(stopId, { collected: { amountPaise: 160000, channel: 'CASH' } });
    expect(late.status).toBe(409);
    expect(await db.driverCollection.count()).toBe(0);
  });

  it('a trip called off delivers nothing, even if the desk sends the order out', async () => {
    await linkDevice('drivera');
    await linkDevice('keepera');
    const order = await makeOrder();
    await post('keeperaphone', `staff/stock/loads/${order.id}`, { idempotencyKey: uuid() }).expect(
      201,
    );
    const trip = await post('managera', 'admin/trips', {
      locationId: MAIN,
      driverId: 'drivera',
      orderIds: [order.id],
      idempotencyKey: uuid(),
    }).expect(201);
    await post('managera', `admin/trips/${trip.body.id}/cancel`).expect(201);
    await request(server)
      .patch(`/api/v1/admin/orders/${order.id}/status`)
      .set(bearer('managera'))
      .send({ status: 'OUT_FOR_DELIVERY', note: 'Own vehicle' })
      .expect(200);
    const stop = await db.tripStop.findFirstOrThrow({ where: { orderId: order.id } });
    const late = await delivered(stop.id, { collected: { amountPaise: 160000, channel: 'CASH' } });
    expect(late.status).toBe(409);
    expect(await db.driverCollection.count()).toBe(0);
  });

  it('money taken at the door keeps the order from being turned back behind it', async () => {
    const { stopId, order } = await outOnTrip();
    const orders = app.get(OrdersService);
    const spy = vi.spyOn(orders, 'changeStatus').mockRejectedValueOnce(new Error('lost'));
    await delivered(stopId, { collected: { amountPaise: 60000, channel: 'CASH' } }).expect(500);
    spy.mockRestore();
    // The order still says it is out, and the desk has not heard from the driver.
    const back = await post('managera', `admin/orders/${order.id}/delivery`, {
      action: 'REPORT',
      reason: 'UNAVAILABLE',
      note: 'No word',
      idempotencyKey: uuid(),
    });
    expect(back.status).toBe(409);
    // The way out is to finish it, which is what happened.
    await request(server)
      .patch(`/api/v1/admin/orders/${order.id}/status`)
      .set(bearer('managera'))
      .send({ status: 'DELIVERED', note: 'Driver said' })
      .expect(200);
  });

  it('a customer cancelling an order on a trip does not strand the driver or the trip', async () => {
    await linkDevice('drivera');
    await linkDevice('keepera');
    const [cancels, stays] = await Promise.all([makeOrder(), makeOrder()]);
    await post('keeperaphone', `staff/stock/loads/${stays.id}`, { idempotencyKey: uuid() }).expect(
      201,
    );
    const trip = await post('managera', 'admin/trips', {
      locationId: MAIN,
      driverId: 'drivera',
      orderIds: [cancels.id, stays.id],
      idempotencyKey: uuid(),
    }).expect(201);
    await post('customer', `orders/${cancels.id}/cancel`).expect(201);
    await post('driveraphone', `staff/trips/${trip.body.id}/start`, {
      idempotencyKey: uuid(),
    }).expect(201);
    const stop = await db.tripStop.findFirstOrThrow({ where: { orderId: stays.id } });
    await delivered(stop.id, { collected: { amountPaise: 160000, channel: 'CASH' } }).expect(201);
    expect((await db.trip.findUniqueOrThrow({ where: { id: trip.body.id } })).status).toBe('DONE');
  });

  it('a key used on one stop is not good on another', async () => {
    const one = await outOnTrip();
    const two = await outOnTrip();
    const key = uuid();
    await delivered(one.stopId, {
      idempotencyKey: key,
      collected: { amountPaise: 160000, channel: 'CASH' },
    }).expect(201);
    const reused = await post('driveraphone', `staff/stops/${two.stopId}/problem`, {
      idempotencyKey: key,
      problem: 'OTHER',
    });
    expect(reused.status).toBe(409);
    expect((await db.order.findUniqueOrThrow({ where: { id: two.order.id } })).status).toBe(
      'OUT_FOR_DELIVERY',
    );
  });

  it('a UPI figure above what was due does not go on the money report', async () => {
    const { stopId } = await outOnTrip();
    const claimed = await delivered(stopId, {
      collected: { amountPaise: 1_000_000_000, channel: 'UPI' },
    });
    expect(claimed.status).toBe(400);
    expect(await db.financialMovement.count({ where: { channel: 'UPI' } })).toBe(0);
    const report = await get('owner', `admin/reports/money?from=${today()}&to=${today()}`).expect(
      200,
    );
    expect(report.body.collections.upiPaise).toBe(0);
  });

  it('a cash handover counted after the day closed lands in the next sheet, once', async () => {
    const { stopId } = await outOnTrip();
    await delivered(stopId, { collected: { amountPaise: 160000, channel: 'CASH' } }).expect(201);
    const key = await handover();
    const before = await sheet('cashiera');
    await post('cashiera', 'admin/galla/close', {
      locationId: MAIN,
      day: today(),
      countedPaise: before.expectedPaise,
      reason: 'ok',
    }).expect(201);
    await post('managera', `admin/galla/handovers/${key}/count`, { countedPaise: 160000 }).expect(
      201,
    );
    // Today's sheet stopped at the close, and is not disturbed.
    const closed = await sheet('owner');
    expect(closed.sales).toBe(0);
    expect(closed.expectedPaise).toBe(before.expectedPaise);
    // Tomorrow's carries it. Asked of the service, as the date cannot be moved from here.
    const { GallaService } = await import('../src/galla');
    const tomorrow = new Date(Date.now() + 86400000).toISOString().slice(0, 10);
    const next = await db.$transaction((tx) => app.get(GallaService).sheet(tx, MAIN, tomorrow));
    expect(next.sales).toBe(160000);
    expect(next.expectedPaise).toBe(before.expectedPaise + 160000);
  });

  it('salary paid from a closed drawer, and taken back, comes through the next sheet', async () => {
    await db.staffPayTerms.create({
      data: {
        userId: 'drivera',
        effectiveFrom: '2020-01-01',
        amountPaise: 1000000,
        createdById: 'owner',
      },
    });
    const given = await post('owner', 'admin/salary/advances', {
      userId: 'drivera',
      amountPaise: 50000,
      recoveryPaise: 0,
      channel: 'CASH',
      paidFrom: 'GALLA',
      locationId: MAIN,
      idempotencyKey: uuid(),
    }).expect(201);
    expect((await sheet()).staffPaid).toBe(50000);
    await post('cashiera', 'admin/galla/close', {
      locationId: MAIN,
      day: today(),
      countedPaise: 0,
      reason: 'Took out for an advance',
    });
    const day = await sheet();
    const given2 = await post('owner', 'admin/salary/advances', {
      userId: 'drivera',
      amountPaise: 20000,
      recoveryPaise: 0,
      channel: 'CASH',
      paidFrom: 'GALLA',
      locationId: MAIN,
      idempotencyKey: uuid(),
    }).expect(201);
    await post('owner', `admin/salary/ledger/${given.body.id}/reverse`, {
      reason: 'Galti se',
      idempotencyKey: uuid(),
    }).expect(201);
    expect((await sheet()).staffPaid).toBe(day.staffPaid);
    const { GallaService } = await import('../src/galla');
    const tomorrow = new Date(Date.now() + 86400000).toISOString().slice(0, 10);
    const next = await db.$transaction((tx) => app.get(GallaService).sheet(tx, MAIN, tomorrow));
    expect(next.staffPaid).toBe(20000 - 50000);
    expect(given2.status).toBe(201);
  });

  it('a short handover shows the same money on the report as in the drawer', async () => {
    const { stopId } = await outOnTrip();
    await delivered(stopId, { collected: { amountPaise: 160000, channel: 'CASH' } }).expect(201);
    const key = await handover();
    await post('managera', `admin/galla/handovers/${key}/count`, { countedPaise: 150000 }).expect(
      201,
    );
    expect((await sheet()).sales).toBe(150000);
    const report = await get('owner', `admin/reports/money?from=${today()}&to=${today()}`).expect(
      200,
    );
    expect(report.body.netPaise).toBe(150000);
    const evening = await get('owner', 'admin/reports/shaam').expect(200);
    expect(evening.body.moneyIn.cashPaise).toBe(150000);
    const trends = await get('owner', `admin/reports/trends?from=${today()}&to=${today()}`).expect(
      200,
    );
    const main = trends.body.shops.find((shop: { id: string }) => shop.id === MAIN);
    expect(main.totalPaise).toBe(150000);
  });

  it('an over-count shows the same money on the report as in the drawer', async () => {
    const { stopId } = await outOnTrip();
    await delivered(stopId, { collected: { amountPaise: 160000, channel: 'CASH' } }).expect(201);
    const key = await handover();
    await post('managera', `admin/galla/handovers/${key}/count`, { countedPaise: 170000 }).expect(
      201,
    );
    expect((await sheet()).sales).toBe(170000);
    const report = await get('owner', `admin/reports/money?from=${today()}&to=${today()}`).expect(
      200,
    );
    expect(report.body.netPaise).toBe(170000);
  });

  it('the rest still owed after a short payment shows as still to collect, at the rest', async () => {
    const { stopId } = await outOnTrip();
    await delivered(stopId, { collected: { amountPaise: 60000, channel: 'CASH' } }).expect(201);
    const report = await get('owner', `admin/reports/money?from=${today()}&to=${today()}`).expect(
      200,
    );
    expect(report.body.pendingCash).toEqual({ orders: 1, amountPaise: 100000 });
  });

  it('what a driver writes about a customer stays with the shop', async () => {
    const { stopId, order } = await outOnTrip();
    await post('driveraphone', `staff/stops/${stopId}/problem`, {
      idempotencyKey: uuid(),
      problem: 'OTHER',
      note: 'CANARYDRIVERNOTE',
    }).expect(201);
    const asCustomer = await get('customer', `orders/${order.id}`).expect(200);
    expect(JSON.stringify(asCustomer.body)).not.toContain('CANARYDRIVERNOTE');
    expect(asCustomer.body.status).toBe('DELIVERY_EXCEPTION');
    expect(JSON.stringify((await get('customer', 'orders').expect(200)).body)).not.toContain(
      'CANARYDRIVERNOTE',
    );
    expect(asCustomer.body.deliveryAttempts[0].action).toBe('REPORT');
    expect(asCustomer.body.deliveryAttempts[0]).not.toHaveProperty('actorId');
    // The desk still reads it.
    const asDesk = await get('managera', `admin/orders/${order.id}`).expect(200);
    expect(JSON.stringify(asDesk.body)).toContain('CANARYDRIVERNOTE');
  });

  it('paid in two parts and delivered, nothing can be refunded or cancelled behind it', async () => {
    const { stopId, order } = await outOnTrip();
    await delivered(stopId, { collected: { amountPaise: 60000, channel: 'CASH' } }).expect(201);
    await post('cashiera', `admin/orders/${order.id}/cod-received`, { channel: 'UPI' }).expect(201);
    const key = await handover(60000);
    await post('managera', `admin/galla/handovers/${key}/count`, { countedPaise: 60000 }).expect(
      201,
    );
    const collected = await db.financialMovement.findMany({ where: { kind: 'COLLECTION' } });
    expect(collected.reduce((sum, row) => sum + row.amountPaise, 0)).toBe(160000);
    await post('managera', `admin/orders/${order.id}/cash-refunded`).expect(409);
    await request(server)
      .patch(`/api/v1/admin/orders/${order.id}/status`)
      .set(bearer('managera'))
      .send({ status: 'CANCELLED', note: 'x' })
      .expect(409);
    expect((await sheet()).sales).toBe(60000);
  });

  it('cash taken ahead of a cancellation goes back once, and the sheet ends where it began', async () => {
    const order = await makeOrder();
    await post('cashiera', `admin/orders/${order.id}/cod-received`, { channel: 'CASH' }).expect(
      201,
    );
    await post('customer', `orders/${order.id}/cancel`).expect(201);
    const [one, two] = await Promise.all([
      post('managera', `admin/orders/${order.id}/cash-refunded`),
      post('managera', `admin/orders/${order.id}/cash-refunded`),
    ]);
    expect([one.status, two.status].filter((code) => code === 201).length).toBeGreaterThan(0);
    expect(await db.financialMovement.count({ where: { kind: 'REFUND' } })).toBe(1);
    const day = await sheet();
    expect(day.sales - day.refunds).toBe(0);
    expect(day.expectedPaise).toBe(0);
  });

  it('two people counting one handover at once put it in the drawer once', async () => {
    const { stopId } = await outOnTrip();
    await delivered(stopId, { collected: { amountPaise: 160000, channel: 'CASH' } }).expect(201);
    const key = await handover();
    await Promise.all([
      post('managera', `admin/galla/handovers/${key}/count`, { countedPaise: 160000 }),
      post('cashiera', `admin/galla/handovers/${key}/count`, { countedPaise: 160000 }),
    ]);
    expect(await db.financialMovement.count({ where: { kind: 'COLLECTION' } })).toBe(1);
    expect((await sheet()).sales).toBe(160000);
  });

  it('two handovers at once take the same collections once', async () => {
    const { stopId } = await outOnTrip();
    await delivered(stopId, { collected: { amountPaise: 160000, channel: 'CASH' } }).expect(201);
    const [one, two] = [uuid(), uuid()];
    const answers = await Promise.all([
      post('driveraphone', 'staff/cash/handover', { amountPaise: 160000, handoverKey: one }),
      post('driveraphone', 'staff/cash/handover', { amountPaise: 160000, handoverKey: two }),
    ]);
    expect(answers.filter((res) => res.status === 201).length).toBe(1);
    expect(await db.cashHandover.count({ where: { step: 'OFFERED' } })).toBe(1);
  });
});

describe('udhaar across a delivery', () => {
  beforeEach(reset);

  it('goods turned away come off the khata once, whatever is tapped twice', async () => {
    const { stopId, order } = await outOnTrip({ method: 'CREDIT' });
    expect(await balance()).toBe(160000);
    await post('driveraphone', `staff/stops/${stopId}/problem`, {
      idempotencyKey: uuid(),
      problem: 'SHORT_TAKEN',
    }).expect(201);
    const back = {
      action: 'RETURN',
      note: 'Wapas',
      items: [{ productId: 'cement', sellableQuantity: 2, damagedQuantity: 0 }],
    };
    const answers = await Promise.all([
      post('managera', `admin/orders/${order.id}/delivery`, { ...back, idempotencyKey: uuid() }),
      post('managera', `admin/orders/${order.id}/delivery`, { ...back, idempotencyKey: uuid() }),
    ]);
    expect(answers.filter((res) => res.status === 201).length).toBe(1);
    expect(await balance()).toBe(0);
    expect(await ledgerSum()).toBe(0);
    expect(
      (
        await db.stockLevel.findUniqueOrThrow({
          where: { productId_locationId: { productId: 'cement', locationId: MAIN } },
        })
      ).quantity,
    ).toBe(502);
  });

  it('an opening signed while orders post adds up afterwards', async () => {
    await post('accountant', 'admin/khata/opening-sheet', {
      customerId: 'customer',
      asOf: today(),
      paperPaise: 500000,
    }).expect(201);
    const orders = await Promise.all([
      makeOrder({ method: 'CREDIT' }),
      makeOrder({ method: 'CREDIT' }),
    ]);
    await linkDevice('keepera');
    const [, signed] = await Promise.all([
      post('keeperaphone', `staff/stock/loads/${orders[0].id}`, { idempotencyKey: uuid() }),
      post('owner', 'admin/khata/opening-sheet/approve', {
        rows: [{ customerId: 'customer', draftVersion: 1, chosenPaise: 500000 }],
      }),
      post('keeperaphone', `staff/stock/loads/${orders[1].id}`, { idempotencyKey: uuid() }),
    ]);
    expect(signed.status).toBe(201);
    expect(await balance()).toBe(await ledgerSum());
    expect(await balance()).toBe(500000 + 160000 + 160000);
    const entries = await db.customerLedgerEntry.findMany({ orderBy: { createdAt: 'asc' } });
    // Each row's running balance is what the rows before it say, in the order they were written.
    let running = 0;
    for (const row of entries) {
      running += row.amountPaise;
      expect(row.balanceAfterPaise).toBe(running);
    }
  });

  it('a signed opening stays: it cannot be reversed behind the signature', async () => {
    await post('accountant', 'admin/khata/opening-sheet', {
      customerId: 'customer',
      asOf: today(),
      paperPaise: 500000,
    }).expect(201);
    await post('owner', 'admin/khata/opening-sheet/approve', {
      rows: [{ customerId: 'customer', draftVersion: 1, chosenPaise: 500000 }],
    }).expect(201);
    const signed = await db.customerLedgerEntry.findFirstOrThrow({
      where: { customerId: 'customer', kind: 'OPENING_BALANCE' },
    });
    const back = await post('owner', `admin/customers/customer/khata/reverse/${signed.id}`, {
      note: 'Galti',
      idempotencyKey: uuid(),
    });
    expect(back.status).toBe(409);
    expect(await balance()).toBe(500000);
    expect(await ledgerSum()).toBe(500000);
  });

  it('the opening cannot be signed twice, even at once', async () => {
    await post('accountant', 'admin/khata/opening-sheet', {
      customerId: 'customer',
      asOf: today(),
      paperPaise: 500000,
    }).expect(201);
    const row = { customerId: 'customer', draftVersion: 1, chosenPaise: 500000 };
    await Promise.all([
      post('owner', 'admin/khata/opening-sheet/approve', { rows: [row] }),
      post('ownertwo', 'admin/khata/opening-sheet/approve', { rows: [row] }),
    ]);
    expect(await balance()).toBe(500000);
    expect(await ledgerSum()).toBe(500000);
  });
});

describe('one order, however many people tap', () => {
  beforeEach(reset);
  const confirm = (who: string, id: string) =>
    post(who, `admin/wa/drafts/${id}/confirm`, {
      expectedVersion: 1,
      priceVersions: { cement: 1 },
    });

  it('a WhatsApp card tapped twice at once makes one order and moves stock once', async () => {
    const draft = await makeDraft();
    const answers = await Promise.all([
      confirm('managera', draft.id),
      confirm('cashiera', draft.id),
    ]);
    expect(answers.map((res) => res.status).filter((code) => code === 200).length).toBeGreaterThan(
      0,
    );
    expect(await db.order.count({ where: { source: 'WHATSAPP' } })).toBe(1);
    const level = await db.stockLevel.findUniqueOrThrow({
      where: { productId_locationId: { productId: 'cement', locationId: MAIN } },
    });
    expect(level.quantity).toBe(498);
    const after = await db.waDraft.findUniqueOrThrow({ where: { id: draft.id } });
    expect(after.status).toBe('CONFIRMED');
  });

  it('confirmed and refused at once: one wins, and no order is left behind a refusal', async () => {
    const draft = await makeDraft();
    await Promise.all([
      confirm('managera', draft.id),
      post('cashiera', `admin/wa/drafts/${draft.id}/refuse`, {
        expectedVersion: 1,
        reason: 'OUT_OF_STOCK',
      }),
    ]);
    const after = await db.waDraft.findUniqueOrThrow({ where: { id: draft.id } });
    const orders = await db.order.count({ where: { source: 'WHATSAPP' } });
    expect(orders).toBe(after.status === 'CONFIRMED' ? 1 : 0);
    expect(['CONFIRMED', 'REFUSED']).toContain(after.status);
  });

  it('udhaar on a card waits for someone who may give it, and for a named customer', async () => {
    const draft = await makeDraft(MAIN, { payWhen: 'UDHAAR' });
    await confirm('cashiera', draft.id).expect(409);
    const named = await makeDraft(MAIN, { payWhen: 'UDHAAR', payerUserId: 'customer' });
    await confirm('cashiera', named.id).expect(403);
    await confirm('managera', named.id).expect(200);
  });

  it('a rate moved since the card was drawn stops the tap', async () => {
    const draft = await makeDraft();
    await db.product.update({
      where: { id: 'cement' },
      data: { priceVersion: 2, pricePaise: 90000 },
    });
    await confirm('managera', draft.id).expect(409);
    expect(await db.order.count({ where: { source: 'WHATSAPP' } })).toBe(0);
  });

  it('a card’s price cannot be set by anyone tapping it', async () => {
    const draft = await makeDraft();
    await request(server)
      .patch(`/api/v1/admin/wa/drafts/${draft.id}`)
      .set(bearer('managera'))
      .send({
        expectedVersion: 1,
        lines: [{ productId: 'cement', quantity: 2, pricePaise: 1 }],
      })
      .expect(400);
    await confirm('managera', draft.id).expect(200);
    const order = await db.order.findFirstOrThrow({ where: { source: 'WHATSAPP' } });
    expect(order.totalPaise).toBe(160000);
  });

  it('the owner’s yes and the desk’s tap on one order: stock moves once', async () => {
    const order = await makeOrder({ status: 'AWAITING_CONFIRMATION' });
    const asked = await post('managera', `admin/orders/${order.id}/ask-owner`, {
      expectedVersion: 1,
      changes: { lines: [{ productId: 'cement', quantity: 2, pricePaise: 70000 }] },
      idempotencyKey: uuid(),
    }).expect(201);
    const answers = await Promise.all([
      post('owner', `admin/approvals/${asked.body.id}/decide`, { decision: 'APPROVE' }),
      post('ownertwo', `admin/orders/${order.id}/confirm`, {
        expectedVersion: 1,
        decisionKey: uuid(),
      }),
    ]);
    expect(answers.filter((res) => res.status === 201).length).toBe(1);
    const after = await db.order.findUniqueOrThrow({
      where: { id: order.id },
      include: { payment: true },
    });
    expect(after.status).toBe('CONFIRMED');
    expect(after.payment!.amountPaise).toBe(after.totalPaise);
  });
});

describe('what a customer can tamper with on the way to an order', () => {
  beforeEach(async () => {
    await reset();
    await db.address.create({
      data: {
        id: 'addr',
        userId: 'customer',
        label: 'Site',
        name: 'R',
        phone: canary.customerPhone,
        line1: 'x',
        area: 'y',
        city: 'Patna',
        state: 'Bihar',
        pincode: '800020',
        landmark: '',
      } as never,
    });
    await db.address.create({
      data: {
        id: 'addr2',
        userId: 'othercustomer',
        label: 'Site',
        name: 'R',
        phone: '+919811000013',
        line1: 'x',
        area: 'y',
        city: 'Patna',
        state: 'Bihar',
        pincode: '800020',
        landmark: '',
      } as never,
    });
  });
  const base = { addressId: 'addr', deliveryDate: today(), paymentMethod: 'COD' as const };

  it('a false price on a line changes only the words, and never the total', async () => {
    const review = await post('customer', 'checkout/review', {
      ...base,
      lines: [{ productId: 'cement', quantity: 2, seenPricePaise: 1 }],
    }).expect(201);
    expect(review.body.items[0].pricePaise).toBe(80000);
    expect(review.body.subtotalPaise).toBe(160000);
    const placed = await post('customer', 'orders', {
      reviewId: review.body.id,
      idempotencyKey: uuid(),
    }).expect(201);
    expect(placed.body.totalPaise).toBe(review.body.totalPaise);
  });

  it('nonsense quantities, prices and fields are refused', async () => {
    for (const lines of [
      [{ productId: 'cement', quantity: -5 }],
      [{ productId: 'cement', quantity: 0 }],
      [{ productId: 'cement', quantity: 1.5 }],
      [{ productId: 'cement', quantity: 1e9 }],
      [{ productId: 'cement', quantity: 2, pricePaise: 1 }],
      [
        { productId: 'cement', quantity: 2 },
        { productId: 'cement', quantity: 3 },
      ],
    ])
      await post('customer', 'checkout/review', { ...base, lines }).expect(400);
    await post('customer', 'checkout/review', { ...base, repeatOfOrderId: 'x' }).expect(400);
  });

  it('another customer’s order, address or review cannot be used', async () => {
    const order = await makeOrder();
    const lines = [{ productId: 'cement', quantity: 1 }];
    await post('othercustomer', 'checkout/review', {
      ...base,
      addressId: 'addr2',
      lines,
      repeatOfOrderId: order.id,
    }).expect(404);
    await post('othercustomer', 'checkout/review', { ...base, lines }).expect(400);
    const review = await post('customer', 'checkout/review', { ...base, lines }).expect(201);
    await post('othercustomer', 'orders', {
      reviewId: review.body.id,
      idempotencyKey: uuid(),
    }).expect(409);
  });

  it('the same key from two customers makes two orders, each their own', async () => {
    const key = uuid();
    const lines = [{ productId: 'cement', quantity: 1 }];
    const mine = await post('customer', 'checkout/review', { ...base, lines }).expect(201);
    const theirs = await post('othercustomer', 'checkout/review', {
      ...base,
      addressId: 'addr2',
      lines,
    }).expect(201);
    const a = await post('customer', 'orders', {
      reviewId: mine.body.id,
      idempotencyKey: key,
    }).expect(201);
    const b = await post('othercustomer', 'orders', {
      reviewId: theirs.body.id,
      idempotencyKey: key,
    }).expect(201);
    expect(a.body.id).not.toBe(b.body.id);
  });

  it('an order too big for the books is a clear answer, not a crash', async () => {
    await db.product.update({
      where: { id: 'cement' },
      data: { pricePaise: 2_000_000, stock: 100000 },
    });
    const huge = await post('customer', 'checkout/review', {
      ...base,
      lines: [{ productId: 'cement', quantity: 10000 }],
    });
    expect(huge.status).toBe(409);
    expect(huge.body.error.code).toBe('ORDER_TOO_LARGE');
  });

  it('an item with no public rate is not priced by the cart, and its rate is not shown', async () => {
    await db.product.update({ where: { id: 'cement' }, data: { sourcing: 'ON_REQUEST' } });
    const put = await request(server)
      .put('/api/v1/cart/items')
      .set(bearer('customer'))
      .send({ productId: 'cement', quantity: 1 });
    expect(put.status).toBe(409);
    const merged = await post('customer', 'cart/merge', {
      idempotencyKey: uuid(),
      items: [{ productId: 'cement', quantity: 1 }],
    });
    expect(merged.status).toBe(409);
    await db.cartItem.create({
      data: {
        userId: 'customer',
        productId: 'cement',
        quantity: 1,
        seenPricePaise: 1,
        seenPriceVersion: 1,
      },
    });
    const review = await post('customer', 'checkout/review', base);
    expect(review.status).toBe(409);
    const cart = await get('customer', 'cart').expect(200);
    expect(JSON.stringify(cart.body)).not.toContain('80000');
    const rates = await get('customer', 'me/rates').expect(200);
    expect(rates.body).toEqual([]);
  });
});

describe('what a stranger can read', () => {
  beforeEach(reset);

  it('the exact stock is not on any public route', async () => {
    await db.stockLevel.updateMany({ where: { productId: 'cement' }, data: { quantity: 137 } });
    await db.product.update({ where: { id: 'cement' }, data: { stock: 137 } });
    const list = await request(server).get('/api/v1/products').expect(200);
    const one = await request(server).get('/api/v1/products/cement').expect(200);
    const catalog = await request(server).get('/api/v1/public/catalog').expect(200);
    for (const body of [list.body.items[0], one.body, catalog.body.products[0]])
      expect(JSON.stringify(body)).not.toMatch(/"stock":137/);
    expect(list.body.items[0].availability).toBe('IN_STOCK');
  });

  it('an item with no public rate shows no rate', async () => {
    await db.product.update({ where: { id: 'cement' }, data: { sourcing: 'ON_REQUEST' } });
    const list = await request(server).get('/api/v1/products').expect(200);
    const one = await request(server).get('/api/v1/products/cement').expect(200);
    const catalog = await request(server).get('/api/v1/public/catalog').expect(200);
    for (const body of [list.body.items[0], one.body, catalog.body.products[0]])
      expect(body.pricePaise).toBeNull();
  });

  it('sorting cannot be used to rank a hidden rate', async () => {
    await db.product.update({ where: { id: 'cement' }, data: { sourcing: 'ON_REQUEST' } });
    const asc = await request(server).get('/api/v1/products?sort=price_asc').expect(200);
    expect(JSON.stringify(asc.body)).not.toContain('80000');
  });
});

describe('salary across a month', () => {
  beforeEach(reset);
  const month = lastMonth;

  const terms = (userId = 'drivera', amountPaise = 1000000) =>
    db.staffPayTerms.create({
      data: { userId, effectiveFrom: '2020-01-01', amountPaise, createdById: 'owner' },
    });
  const adjust = (kind: 'ADDITION' | 'DEDUCTION', amountPaise: number) =>
    post('owner', `admin/salary/runs/${month()}/adjustments`, {
      userId: 'drivera',
      kind,
      amountPaise,
      reason: 'because',
      idempotencyKey: uuid(),
    });

  it('taking back an addition cannot leave more than half the pay deducted', async () => {
    await terms();
    const added = await adjust('ADDITION', 1000000).expect(201);
    await adjust('DEDUCTION', 1000000).expect(201);
    const back = await post('owner', `admin/salary/adjustments/${added.body.id}/reverse`, {
      reason: 'Galti',
    });
    expect(back.status).toBe(400);
    expect(back.body.error.code).toBe('DEDUCTIONS_OVER_LIMIT');
  });

  it('a month whose deductions no longer fit the pay is not locked into a minus', async () => {
    await terms();
    await adjust('DEDUCTION', 400000).expect(201);
    // The rate dropped afterwards, for a date inside the month.
    await db.staffPayTerms.create({
      data: {
        userId: 'drivera',
        effectiveFrom: `${month()}-20`,
        amountPaise: 100000,
        createdById: 'owner',
      },
    });
    const locked = await post('owner', `admin/salary/runs/${month()}/lock`, { confirm: true });
    expect(locked.status).toBe(409);
    expect(locked.body.error.code).toBe('DEDUCTIONS_OVER_LIMIT');
    expect(await db.staffLedgerEntry.count({ where: { kind: 'EARNED' } })).toBe(0);
  });

  it('an advance already recovered from wages cannot be taken back into a minus', async () => {
    await terms();
    const given = await post('owner', 'admin/salary/advances', {
      userId: 'drivera',
      amountPaise: 100000,
      recoveryPaise: 100000,
      channel: 'CASH',
      paidFrom: 'GALLA',
      locationId: MAIN,
      idempotencyKey: uuid(),
    }).expect(201);
    await post('owner', `admin/salary/runs/${month()}/lock`, { confirm: true }).expect(201);
    const back = await post('owner', `admin/salary/ledger/${given.body.id}/reverse`, {
      reason: 'Galti',
      idempotencyKey: uuid(),
    });
    expect(back.status).toBe(409);
    const person = await get('owner', 'admin/salary/people/drivera').expect(200);
    expect(person.body.advancePaise).toBe(0);
  });

  it('nobody takes back their own pay entry, even an owner', async () => {
    await terms('owner');
    await post('ownertwo', `admin/salary/runs/${month()}/lock`, { confirm: true }).expect(201);
    const paid = await post('ownertwo', `admin/salary/runs/${month()}/pay`, {
      userId: 'owner',
      amountPaise: 100000,
      channel: 'UPI',
      paidFrom: 'OWNER',
      idempotencyKey: uuid(),
    }).expect(201);
    const back = await post('owner', `admin/salary/ledger/${paid.body.id}/reverse`, {
      reason: 'Nahi mila',
      idempotencyKey: uuid(),
    });
    expect(back.status).toBe(403);
  });

  it('two payments at once cannot pay more than is owed', async () => {
    await terms();
    await post('owner', `admin/salary/runs/${month()}/lock`, { confirm: true }).expect(201);
    const pay = (who: string) =>
      post(who, `admin/salary/runs/${month()}/pay`, {
        userId: 'drivera',
        amountPaise: 700000,
        channel: 'CASH',
        paidFrom: 'GALLA',
        locationId: MAIN,
        idempotencyKey: uuid(),
      });
    const answers = await Promise.all([pay('owner'), pay('ownertwo')]);
    expect(answers.filter((res) => res.status === 201).length).toBe(1);
    const person = await get('owner', 'admin/salary/people/drivera').expect(200);
    expect(person.body.wagesDuePaise).toBe(300000);
    expect(person.body.chainOk).toBe(true);
    expect(await db.financialMovement.count({ where: { kind: 'STAFF_PAY' } })).toBe(1);
  });

  it('a payment taken back twice at once gives the drawer back once', async () => {
    await terms();
    await post('owner', `admin/salary/runs/${month()}/lock`, { confirm: true }).expect(201);
    const paid = await post('owner', `admin/salary/runs/${month()}/pay`, {
      userId: 'drivera',
      amountPaise: 700000,
      channel: 'CASH',
      paidFrom: 'GALLA',
      locationId: MAIN,
      idempotencyKey: uuid(),
    }).expect(201);
    const back = (who: string) =>
      post(who, `admin/salary/ledger/${paid.body.id}/reverse`, {
        reason: 'Galti',
        idempotencyKey: uuid(),
      });
    const answers = await Promise.all([back('owner'), back('ownertwo')]);
    expect(answers.filter((res) => res.status === 201).length).toBe(1);
    expect(await db.financialMovement.count({ where: { kind: 'STAFF_PAY_REVERSAL' } })).toBe(1);
    const day = await sheet();
    expect(day.staffPaid).toBe(0);
  });

  it('an owner’s yes twice at once gives one advance', async () => {
    await terms();
    const asked = await post('managera', 'admin/salary/advances/ask', {
      userId: 'drivera',
      amountPaise: 100000,
      recoveryPaise: 0,
      paidFrom: 'GALLA',
      channel: 'CASH',
      idempotencyKey: uuid(),
    }).expect(201);
    const answers = await Promise.all([
      post('owner', `admin/approvals/${asked.body.id}/decide`, { decision: 'APPROVE' }),
      post('ownertwo', `admin/approvals/${asked.body.id}/decide`, { decision: 'APPROVE' }),
    ]);
    expect(answers.filter((res) => res.status === 201).length).toBe(1);
    expect(await db.staffLedgerEntry.count({ where: { kind: 'ADVANCE_GIVEN' } })).toBe(1);
    expect((await sheet()).staffPaid).toBe(100000);
  });

  it('a month with new lines in it sets no header on the spreadsheet', async () => {
    const res = await get('owner', 'admin/salary/runs/2026-01%0d%0aX-Evil:%201/export.csv');
    expect(res.status).toBe(400);
    expect(res.headers).not.toHaveProperty('x-evil');
    expect(res.headers['content-disposition']).toBeUndefined();
  });

  it('a pay key is not good for an advance', async () => {
    await terms();
    await post('owner', `admin/salary/runs/${month()}/lock`, { confirm: true }).expect(201);
    const key = uuid();
    await post('owner', `admin/salary/runs/${month()}/pay`, {
      userId: 'drivera',
      amountPaise: 100000,
      channel: 'UPI',
      paidFrom: 'OWNER',
      idempotencyKey: key,
    }).expect(201);
    await post('owner', 'admin/salary/advances', {
      userId: 'drivera',
      amountPaise: 100000,
      recoveryPaise: 0,
      channel: 'UPI',
      paidFrom: 'OWNER',
      idempotencyKey: key,
    }).expect(409);
  });
});

describe('the books stay with those who keep them', () => {
  beforeEach(reset);

  it('what a ledger is called does not become what a customer reads about themselves', async () => {
    const company = await db.tallyCompany.create({
      data: { guid: 'name-co', name: 'Name Co', role: 'PRIMARY', phase: 'LIVE' },
    });
    const ledger = await db.tallyLedger.create({
      data: {
        companyId: company.id,
        guid: 'name-led',
        alterId: 1n,
        name: canary.ledger,
        parent: 'Sundry',
        class: 'DEBTOR',
      },
    });
    await post('accountant', `admin/tally/parties/${ledger.id}/link`, {
      phone: '+919812340009',
      method: 'TYPED',
    }).expect(201);
    const made = await db.user.findUniqueOrThrow({ where: { phone: '+919812340009' } });
    expect(made.name).not.toContain(canary.ledger);
    const asManager = await get('managera', `admin/customers/${made.id}`).expect(200);
    expect(JSON.stringify(asManager.body)).not.toContain(canary.ledger);
  });

  it('a shop’s people get no Tally route, and no customer can name one', async () => {
    for (const who of ['managera', 'cashiera', 'keepera', 'customer', 'drivera'])
      for (const path of [
        'admin/tally/status',
        'admin/tally/parties',
        'admin/tally/differences',
        'admin/tally/suppliers',
        'admin/tally/customers/customer/numbers',
      ])
        expect([who, path, (await get(who, path)).status]).toEqual([who, path, 403]);
    // The technical login sees the health of the bridge and no party.
    await get('tech', 'admin/tally/parties').expect(403);
    await get('tech', 'admin/tally/customers/customer/numbers').expect(403);
    await get('tech', 'admin/tally/status').expect(403);
  });
});

describe('keys, replays and forgeries', () => {
  beforeEach(reset);

  it('a drawer entry’s key is not good at another shop', async () => {
    const key = uuid();
    const entry = { kind: 'PAID_OUT', amountPaise: 1000, reason: 'chai', idempotencyKey: key };
    await post('owner', 'admin/galla/entries', { ...entry, locationId: MAIN }).expect(201);
    await post('owner', 'admin/galla/entries', { ...entry, locationId: SECOND }).expect(409);
  });

  it('webhooks and the bridge refuse what is not signed', async () => {
    // WhatsApp is off by default, so the webhook is not even there.
    await request(server).post('/api/v1/whatsapp/webhook').send({ entry: [] }).expect(404);
    await request(server).get('/api/v1/whatsapp/webhook?hub.mode=subscribe').expect(404);
    const unsigned = await request(server).post('/api/v1/bridge/heartbeat').send({ state: 'OK' });
    expect(unsigned.status).toBe(401);
    const forged = await request(server)
      .post('/api/v1/bridge/heartbeat')
      .set({
        'X-Bridge-Protocol': String(bridgeProtocol),
        'X-Bridge-Device': 'nobody-here',
        'X-Bridge-Time': String(Date.now()),
        'X-Bridge-Seq': '1',
        'X-Bridge-Body-Sha256': 'a'.repeat(64),
        'X-Bridge-Signature': 'A'.repeat(88),
      })
      .send(Buffer.from('{}'));
    expect(forged.status).toBe(401);
    await request(server)
      .post('/api/v1/payments/webhook')
      .set('x-razorpay-signature', 'a'.repeat(64))
      .set('x-razorpay-event-id', 'x')
      .send({})
      .expect(401);
  });

  it('a shop screen’s token opens only the screen, and a staff token does not open it', async () => {
    await request(server).get('/api/v1/screen/today').expect(401);
    await request(server).get('/api/v1/screen/today').set('x-shop-screen', 'nonsense').expect(401);
    await request(server)
      .get('/api/v1/screen/today')
      .set('x-shop-screen', tokenFor('managera'))
      .expect(401);
  });

  it('guessing a screen’s pairing code stops, across every address', async () => {
    const answers = [];
    for (let i = 0; i < 60; i++) {
      const code = String(100000 + i);
      answers.push((await request(server).post('/api/v1/screen/pair').send({ code })).status);
    }
    expect(answers).toContain(429);
    expect(answers.at(-1)).toBe(429);
    expect(answers.filter((code) => code === 400).length).toBeLessThanOrEqual(50);
  });

  it('a cookie session from another site can change nothing', async () => {
    const cookie = `shiv_access=${tokenFor('managera')}`;
    await request(server)
      .post('/api/v1/admin/galla/entries')
      .set('Cookie', cookie)
      .set('Origin', 'https://evil.example')
      .send({})
      .expect(403);
    await request(server).post('/api/v1/admin/trips').set('Cookie', cookie).send({}).expect(403);
    await request(server)
      .post('/api/v1/staff/cash/handover')
      .set('Cookie', cookie)
      .send({})
      .expect(403);
  });

  it('a yes or no from list-check says nothing about how much there is', async () => {
    const answer = async (quantity: number) =>
      (
        await request(server)
          .post('/api/v1/public/list-check')
          .send({ lines: [{ productId: 'cement', quantity }] })
          .expect(201)
      ).body.lines[0].status;
    await db.product.update({ where: { id: 'cement' }, data: { stock: 5 } });
    const small = await answer(100);
    await db.product.update({ where: { id: 'cement' }, data: { stock: 500 } });
    expect(await answer(100)).toBe(small);
  });

  it('list-check stops at its limit for one address, and writes nothing', async () => {
    const before = await db.auditLog.count();
    process.env.LIST_CHECK_PER_IP_MINUTE = '3';
    try {
      const statuses = [];
      for (let i = 0; i < 6; i++)
        statuses.push(
          (
            await request(server)
              .post('/api/v1/public/list-check')
              .send({ lines: [{ productId: 'cement', quantity: 1 }] })
          ).status,
        );
      expect(statuses).toContain(429);
    } finally {
      delete process.env.LIST_CHECK_PER_IP_MINUTE;
    }
    expect(await db.auditLog.count()).toBe(before);
  });
});

/** By a worked-out path, as the API's own type check should not read into the website's types. */
const websiteRoute = (name: string) =>
  import(
    new URL(`../../storefront/app/api/${name}/route.ts`, `file://${__dirname}/`).href
  ) as Promise<{
    POST: (request: Request) => Promise<Response>;
  }>;

describe('the website’s own routes', () => {
  it('the revalidator needs the secret, and does nothing without one set', async () => {
    const { revalidateTag } = await import('next/cache');
    const { POST } = await websiteRoute('revalidate');
    const call = (headers: Record<string, string>) =>
      POST(new Request('http://site.test/api/revalidate', { method: 'POST', headers }));
    delete process.env.REVALIDATE_SECRET;
    expect((await call({})).status).toBe(403);
    expect((await call({ 'x-revalidate-secret': 'undefined' })).status).toBe(403);
    process.env.REVALIDATE_SECRET = 'a-long-secret-for-this-test-only';
    expect((await call({})).status).toBe(403);
    expect((await call({ 'x-revalidate-secret': 'wrong' })).status).toBe(403);
    expect(revalidateTag).not.toHaveBeenCalled();
    expect((await call({ 'x-revalidate-secret': process.env.REVALIDATE_SECRET })).status).toBe(204);
    expect(revalidateTag).toHaveBeenCalledTimes(1);
    delete process.env.REVALIDATE_SECRET;
  });

  it('the analytics route logs only known names, keeps no address or query, and stops at its limit', async () => {
    const { POST } = await websiteRoute('e');
    const info = vi.spyOn(console, 'info').mockImplementation(() => undefined);
    const send = (text: string, extra: Record<string, string> = {}) =>
      POST(
        new Request('http://site.test/api/e', {
          method: 'POST',
          headers: { 'content-length': String(text.length), ...extra },
          body: text,
        }),
      );
    expect((await send('{"name":"unknown"}')).status).toBe(204);
    expect((await send('not json')).status).toBe(204);
    expect((await send(`{"name":"added","path":"${'x'.repeat(600)}"}`)).status).toBe(204);
    expect(info).not.toHaveBeenCalled();
    await send('{"name":"added","path":"/list?phone=9812340001","value":"x","ip":"1.2.3.4"}');
    expect(info).toHaveBeenCalledTimes(1);
    expect(String(info.mock.calls[0]![0])).not.toMatch(/9812340001|1\.2\.3\.4|phone/);
    for (let i = 0; i < 700; i++) await send('{"name":"added"}');
    expect(info.mock.calls.length).toBeLessThanOrEqual(601);
    info.mockRestore();
  });
});

describe('what git would add to a public repository', () => {
  it('holds no build output, with this computer’s paths in it', () => {
    const added = execFileSync('git', ['ls-files', '--others', '--exclude-standard'], {
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
    }).split('\n');
    expect(added.filter((file) => /\/android\/build\/|\/\.gradle\//.test(file))).toEqual([]);
  });
});

describe('a fresh shop on default settings', () => {
  beforeEach(reset);
  const minimal = {
    NODE_ENV: 'development',
    DATABASE_URL: 'postgresql://x@localhost/x',
    OTP_HASH_SECRET: 'x'.repeat(40),
  };

  it('nothing sends, nothing calls a model, and Ask is hidden', () => {
    const c = configSchema.parse(minimal);
    expect(c.WA_MODE).toBe('off');
    expect(c.WA_REPLY_PROVIDER).toBe('off');
    expect(c.WA_READER_PROVIDER).toBe('off');
    expect(c.WHATSAPP_PROVIDER).toBe('fake');
    expect(c.WHATSAPP_CUSTOMER_UPDATES).toBe(false);
    expect(c.ADVISOR_PROVIDER).toBe('fallback');
    expect(c.ASK_ENABLED).toBe(false);
    expect(c.OTP_PROVIDER).toBe('mock');
  });

  it('with everything left as it is, the workers call nobody and Ask calls no model', async () => {
    const calls = vi.spyOn(globalThis, 'fetch');
    const { WaSender } = await import('../src/whatsapp/sender');
    const { WaService } = await import('../src/whatsapp/service');
    const { AlertsService } = await import('../src/alerts');
    const { WaDrafts } = await import('../src/whatsapp/drafts');
    try {
      const thread = await db.waThread.create({
        data: { contactKey: canary.waPhone, phone: canary.waPhone },
      });
      const replied = await db.waReply.create({
        data: {
          threadId: thread.id,
          class: 'AI_REPLY',
          kind: 'WAITING',
          status: 'QUEUED',
          body: 'Hello',
          dedupeKey: 'cross-default',
        },
      });
      await db.outboundMessage.create({
        data: {
          channel: 'WHATSAPP',
          recipient: '919812340002',
          template: 'shiv_test_alert',
          params: [],
          dedupeKey: 'cross-default',
        },
      });
      await app.get(WaSender).sendDue();
      await app.get(WaService).runDue();
      await app.get(AlertsService).deliver();
      await app.get(WaDrafts).timers();
      const device = await request(server).post('/api/v1/advisor/device').expect(201);
      const turn = await request(server)
        .post('/api/v1/advisor/turns')
        .set('x-advisor-device', device.body.deviceToken)
        .send({
          clientTurnId: uuid(),
          text: 'How much cement for a slab?',
          channel: 'WEB',
        });
      expect([200, 201]).toContain(turn.status);
      expect(turn.body.modelAnswer ?? null).toBeNull();
      expect(calls).not.toHaveBeenCalled();
      expect((await db.waReply.findUniqueOrThrow({ where: { id: replied.id } })).sentAt).toBeNull();
    } finally {
      calls.mockRestore();
    }
  });

  it('hazri is off at a new shop, and the reply stage is off', async () => {
    const shop = await db.location.findUniqueOrThrow({ where: { id: SECOND } });
    expect(shop.attendanceOn).toBe(false);
    const fresh = await db.location.create({
      data: { id: 'loc_fresh', firmId: 'firm_main', slug: 'fresh', name: 'Fresh' },
    });
    expect(fresh.attendanceOn).toBe(false);
    await db.location.delete({ where: { id: 'loc_fresh' } });
    const view = await get('owner', 'admin/wa/reply').expect(200);
    expect(view.body.stage).toBe('OFF');
    expect(view.body.mode).toBe('off');
  });

  it('a draft guide, and one past its review date, stay hidden', async () => {
    const article = (slug: string, extra: object) => ({
      slug,
      kind: 'GUIDE',
      titleEn: slug,
      titleHinglish: slug,
      summary: 'x',
      bodyEn: 'x',
      sha256: 'x',
      ...extra,
    });
    await db.knowledgeArticle.deleteMany();
    await db.knowledgeArticle.createMany({
      data: [
        article('draft-one', { status: 'DRAFT' }),
        article('old-one', {
          status: 'PUBLISHED',
          reviewerKey: 'eng',
          reviewedAt: new Date(Date.now() - 400 * 86400000),
          reviewDueAt: new Date(Date.now() - 86400000),
        }),
      ] as never,
    });
    // The database itself will not hold a published guide nobody signed.
    await expect(
      db.knowledgeArticle.create({
        data: article('unsigned-one', {
          status: 'PUBLISHED',
          reviewDueAt: new Date(Date.now() + 86400000),
        }) as never,
      }),
    ).rejects.toThrow();
    expect((await request(server).get('/api/v1/guide').expect(200)).body.items).toEqual([]);
    for (const slug of ['draft-one', 'unsigned-one', 'old-one'])
      await request(server).get(`/api/v1/guide/${slug}`).expect(404);
    await db.knowledgeArticle.deleteMany();
  });

  it('the website says its rates are samples until the family says otherwise', async () => {
    const catalog = await request(server).get('/api/v1/public/catalog').expect(200);
    expect(catalog.body.sampleRates).toBe(true);
  });

  it('production refuses to start without real secrets', () => {
    const base = {
      NODE_ENV: 'production',
      DATABASE_URL: 'postgresql://x@db.internal/x',
      OTP_HASH_SECRET: 'a-very-long-unique-secret-for-this-test-only-0001',
      OTP_PROVIDER: 'twilio',
      TWILIO_ACCOUNT_SID: 'ACx',
      TWILIO_AUTH_TOKEN: 'x',
      TWILIO_VERIFY_SERVICE_SID: 'VAx',
      CORS_ORIGINS: 'https://shop.test',
    };
    const saved = { ...process.env };
    const attempt = (env: Record<string, string | undefined>) => {
      for (const key of Object.keys(process.env)) delete process.env[key];
      for (const [key, value] of Object.entries(env))
        if (value !== undefined) process.env[key] = value;
      resetConfigForTests();
      return import('../src/config').then(({ getConfig }) => getConfig());
    };
    return (async () => {
      try {
        await expect(attempt(base)).resolves.toBeTruthy();
        await expect(attempt({ ...base, OTP_PROVIDER: 'mock' })).rejects.toThrow();
        await expect(attempt({ ...base, OTP_HASH_SECRET: undefined })).rejects.toThrow();
        await expect(
          attempt({ ...base, OTP_HASH_SECRET: 'change-me-'.repeat(5) }),
        ).rejects.toThrow();
        await expect(attempt({ ...base, CORS_ORIGINS: 'http://shop.test' })).rejects.toThrow();
        await expect(attempt({ ...base, TWILIO_AUTH_TOKEN: undefined })).rejects.toThrow();
        await expect(attempt({ ...base, WA_REPLY_PROVIDER: 'fake' })).rejects.toThrow();
        await expect(attempt({ ...base, WA_READER_PROVIDER: 'fake' })).rejects.toThrow();
        await expect(attempt({ ...base, ADVISOR_PROVIDER: 'simulation' })).rejects.toThrow();
        await expect(attempt({ ...base, ADVISOR_PROVIDER: 'anthropic' })).rejects.toThrow();
        await expect(attempt({ ...base, WA_MODE: 'shadow' })).rejects.toThrow();
      } finally {
        for (const key of Object.keys(process.env)) delete process.env[key];
        Object.assign(process.env, saved);
        resetConfigForTests();
      }
    })();
  });

  it('no document, test or debug route answers in production', async () => {
    // Outside production they are there, so what follows is really the production switch.
    await request(server).get('/api/docs-json').expect(200);
    const saved = { ...process.env };
    const check = vi.spyOn(Db.prototype, 'assertRuntimeRole').mockResolvedValue(undefined);
    Object.assign(process.env, {
      NODE_ENV: 'production',
      OTP_PROVIDER: 'twilio',
      OTP_HASH_SECRET: 'a-very-long-unique-secret-for-this-test-only-0002',
      TWILIO_ACCOUNT_SID: 'ACx',
      TWILIO_AUTH_TOKEN: 'x',
      TWILIO_VERIFY_SERVICE_SID: 'VAx',
      CORS_ORIGINS: 'https://shop.test',
    });
    resetConfigForTests();
    const { createApp } = await import('../src/app');
    const live = await createApp();
    try {
      await live.listen(0, '127.0.0.1');
      const prod = live.getHttpServer();
      for (const path of ['/api/docs', '/api/docs-json', '/api/docs/swagger-ui.css'])
        expect([path, (await request(prod).get(path)).status]).toEqual([path, 404]);
      for (const path of ['/api/v1/debug', '/api/v1/test', '/api/v1/admin/debug'])
        expect((await request(prod).get(path)).status).toBeGreaterThanOrEqual(400);
    } finally {
      await live.close();
      check.mockRestore();
      for (const key of Object.keys(process.env)) delete process.env[key];
      Object.assign(process.env, saved);
      resetConfigForTests();
    }
  }, 30000);
});
