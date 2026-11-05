import 'reflect-metadata';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import type { Server } from 'node:http';
import { loadEnvFile } from 'node:process';
import type { INestApplication } from '@nestjs/common';
import { istToday } from '@shiv/shared';
import request from 'supertest';
import sharp from 'sharp';
import { Db } from '../src/db';
import { RateStorage } from '../src/rate-studio/storage';
import { Attendance } from '../src/staff/attendance';
import { Evidence } from '../src/staff/evidence';
import { addPerson, clearShopWork, tokenFor } from './staff-helper';
import { linkPhone, makePhone } from './staff-helper-app';

if (existsSync('.env.test')) loadEnvFile('.env.test');
process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
process.env.OTP_PROVIDER = 'mock';
process.env.OTP_HASH_SECRET = 'staff-jobs-test-only-secret-not-for-production';
process.env.CORS_ORIGINS = 'http://localhost:3000';
if (!process.env.DATABASE_URL || !new URL(process.env.DATABASE_URL).pathname.endsWith('_test'))
  throw new Error('These tests require a dedicated TEST_DATABASE_URL ending in _test.');

const MAIN = 'loc_main';
const SECOND = 'loc_jobs_b';
let app: INestApplication;
let server: Server;
let db: Db;
const desk = (id: string) => ({ Authorization: `Bearer ${tokenFor(id)}` });
const adminGet = (who: string, path: string) =>
  request(server).get(`/api/v1/admin/${path}`).set(desk(who));
const adminPost = (who: string, path: string, body: object = {}) =>
  request(server).post(`/api/v1/admin/${path}`).set(desk(who)).send(body);
const numbers: Record<string, string> = {
  papa: '+919000006001',
  chacha: '+919000006002',
  manager: '+919000006003',
  keeper: '+919000006004',
  cashier: '+919000006005',
  driver: '+919000006006',
  driverb: '+919000006007',
  managerb: '+919000006008',
  keeperb: '+919000006009',
  helper: '+919000006010',
  cashierb: '+919000006011',
  accountant: '+919000006012',
};
const phones: Record<string, string> = {};
/** A linked phone's token. Staff routes are reached from the app, not the desk. */
async function phoneOf(id: string) {
  if (phones[id]) return phones[id]!;
  const phone = makePhone();
  const { body } = await linkPhone(server, numbers[id]!, phone).expect(201);
  const asked = await db.deviceLinkRequest.findFirstOrThrow({
    where: { userId: id, status: 'PENDING' },
  });
  await adminPost(id === 'papa' ? 'chacha' : 'papa', `device-requests/${asked.id}/decide`, {
    decision: 'APPROVE',
  }).expect(201);
  phones[id] = body.accessToken as string;
  return phones[id]!;
}
const appGet = async (who: string, path: string) =>
  request(server)
    .get(`/api/v1/${path}`)
    .set('Authorization', `Bearer ${await phoneOf(who)}`);
const appPost = async (who: string, path: string, body: object = {}) =>
  request(server)
    .post(`/api/v1/${path}`)
    .set('Authorization', `Bearer ${await phoneOf(who)}`)
    .send(body);
const levelAt = async (locationId: string, productId = 'cement') =>
  (
    await db.stockLevel.findUnique({
      where: { productId_locationId: { productId, locationId } },
    })
  )?.quantity ?? 0;

let orderSeq = 0;
/** A confirmed order at a shop, as the desk leaves one. */
async function order(
  opts: {
    locationId?: string;
    method?: 'COD' | 'CREDIT' | 'ONLINE';
    captured?: boolean;
    status?: 'CONFIRMED' | 'PREPARING';
    quantity?: number;
  } = {},
) {
  orderSeq++;
  const quantity = opts.quantity ?? 2;
  return db.order.create({
    data: {
      number: `SC-TEST-${orderSeq}-${randomUUID().slice(0, 6)}`,
      locationId: opts.locationId ?? MAIN,
      userId: 'customer',
      source: 'PHONE',
      createdById: 'manager',
      idempotencyKey: randomUUID(),
      status: opts.status ?? 'CONFIRMED',
      confirmedAt: new Date(),
      confirmedById: 'manager',
      address: {
        name: 'Ramesh',
        phone: '+919000006100',
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
    },
    include: { items: true, payment: true },
  });
}
const loaded = async (orderId: string, who = 'keeper') =>
  appPost(who, `staff/stock/loads/${orderId}`, {
    vehicle: 'BR01AB1234',
    idempotencyKey: randomUUID(),
  });
const trip = (orderIds: string[], who = 'manager', extra: object = {}) =>
  adminPost(who, 'trips', {
    locationId: MAIN,
    driverId: 'driver',
    vehicle: 'BR01AB1234',
    orderIds,
    idempotencyKey: randomUUID(),
    ...extra,
  });
async function outOnTrip(opts: Parameters<typeof order>[0] = {}) {
  const row = await order(opts);
  expect((await loaded(row.id)).status).toBe(201);
  const made = await trip([row.id]).expect(201);
  const start = await appPost('driver', `staff/trips/${made.body.id}/start`, {
    idempotencyKey: randomUUID(),
  });
  expect(start.status).toBe(201);
  const stop = await db.tripStop.findFirstOrThrow({ where: { orderId: row.id } });
  return { order: row, tripId: made.body.id as string, stopId: stop.id };
}
const delivered = (who: string, stopId: string, extra: object = {}) =>
  appPost(who, `staff/stops/${stopId}/delivered`, {
    idempotencyKey: randomUUID(),
    skipReason: 'Andhera tha',
    ...extra,
  });

beforeAll(async () => {
  const { createApp } = await import('../src/app');
  app = await createApp();
  await app.listen(0, '127.0.0.1');
  server = app.getHttpServer();
  db = app.get(Db);
}, 30000);
beforeEach(async () => {
  for (const key of Object.keys(phones)) delete phones[key];
  await clearShopWork(db);
  await db.$executeRawUnsafe(
    'TRUNCATE TABLE "FinancialMovement", "User", "Category", "Product", "Order", "AuditLog", "AuthRateLimit", "OtpChallenge", "Notification", "DeliveryZone", "StoreSettings" RESTART IDENTITY CASCADE',
  );
  await db.location.upsert({
    where: { id: SECOND },
    update: { active: true },
    create: { id: SECOND, firmId: 'firm_main', slug: 'jobs-b', name: 'Second shop' },
  });
  for (const [id, role, shops] of [
    ['papa', 'OWNER', undefined],
    ['chacha', 'OWNER', undefined],
    ['manager', 'MANAGER', [MAIN]],
    ['managerb', 'MANAGER', [SECOND]],
    ['keeper', 'STOCK_KEEPER', [MAIN]],
    ['keeperb', 'STOCK_KEEPER', [SECOND]],
    ['cashier', 'CASHIER', [MAIN]],
    ['cashierb', 'CASHIER', [SECOND]],
    ['driver', 'DRIVER', [MAIN]],
    ['driverb', 'DRIVER', [SECOND]],
    ['helper', 'HELPER', [MAIN]],
    ['accountant', 'ACCOUNTANT', undefined],
  ] as const)
    await addPerson(db, {
      id,
      role,
      phone: numbers[id]!,
      ...(shops ? { shops: [...shops] } : {}),
    });
  await addPerson(db, { id: 'customer', phone: '+919000006100' });
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
      stock: 100,
      minQuantity: 1,
      description: 'Test',
      recommendedUse: 'Test',
      images: [],
    },
  });
  await db.storeSettings.create({ data: { id: 'store', phone: '+919999999000' } });
});
afterAll(async () => {
  await app?.close();
});

describe('loading', () => {
  it('the list shows material and count, and nothing about money', async () => {
    const row = await order({ quantity: 5 });
    const { body, status } = await appGet('keeper', 'staff/stock/loads');
    expect(status).toBe(200);
    expect(body.items[0]).toMatchObject({
      id: row.id,
      items: [expect.objectContaining({ name: 'Cement', quantity: 5 })],
      loaded: null,
    });
    const text = JSON.stringify(body);
    expect(text).not.toMatch(/paise|khata|credit|price/i);
    expect(text).not.toContain('private lane');
  });
  it('marking loaded records the vehicle and starts it being prepared', async () => {
    const row = await order();
    const res = await loaded(row.id);
    expect(res.status).toBe(201);
    expect(await db.orderLoad.count({ where: { orderId: row.id, vehicle: 'BR01AB1234' } })).toBe(1);
    expect((await db.order.findUniqueOrThrow({ where: { id: row.id } })).status).toBe('PREPARING');
    const { body } = await appGet('keeper', 'staff/stock/loads');
    expect(body.items[0].loaded).toMatchObject({ vehicle: 'BR01AB1234' });
  });
  it('the same tap twice loads once', async () => {
    const row = await order();
    const idempotencyKey = randomUUID();
    const send = () => appPost('keeper', `staff/stock/loads/${row.id}`, { idempotencyKey });
    expect((await send()).status).toBe(201);
    expect((await send()).status).toBe(201);
    expect(await db.orderLoad.count({ where: { orderId: row.id } })).toBe(1);
  });
  it('a key cannot be used for another order', async () => {
    const one = await order();
    const two = await order();
    const idempotencyKey = randomUUID();
    await appPost('keeper', `staff/stock/loads/${one.id}`, { idempotencyKey });
    const again = await appPost('keeper', `staff/stock/loads/${two.id}`, { idempotencyKey });
    expect(again.status).toBe(409);
  });
  it('another shop’s order, and those who do not load, are refused', async () => {
    const other = await order({ locationId: SECOND });
    expect((await loaded(other.id)).status).toBe(403);
    const mine = await order();
    expect((await loaded(mine.id, 'cashier')).status).toBe(403);
    expect((await loaded(mine.id, 'driver')).status).toBe(403);
    expect(
      (await appGet('keeper', 'staff/stock/loads')).body.items.map((r: { id: string }) => r.id),
    ).toEqual([mine.id]);
  });
  it('an order that has moved on cannot be loaded', async () => {
    const { order: row } = await outOnTrip();
    const res = await loaded(row.id);
    expect(res.status).toBe(409);
  });
});

describe('a truck received', () => {
  const receipt = (who: string, extra: object = {}) =>
    appPost(who, 'staff/stock/receipts', {
      locationId: MAIN,
      productId: 'cement',
      quantity: 50,
      supplierName: 'Ambuja depot',
      vehicle: 'BR01TR9999',
      idempotencyKey: randomUUID(),
      ...extra,
    });
  it('goes straight into stock, on the record, and tonight’s summary lists it', async () => {
    const before = await levelAt(MAIN);
    expect((await receipt('keeper')).status).toBe(201);
    expect(await levelAt(MAIN)).toBe(before + 50);
    const [row] = await db.stockReceipt.findMany();
    expect(row).toMatchObject({ supplierName: 'Ambuja depot', actorId: 'keeper', quantity: 50 });
    const movement = await db.inventoryMovement.findUniqueOrThrow({
      where: { id: row!.movementId },
    });
    expect(movement.kind).toBe('PURCHASE_IN');
    await db.location.update({ where: { id: MAIN }, data: { attendanceOn: true } });
    const summary = await adminGet('papa', 'attendance/summary').expect(200);
    expect(summary.body.receipts).toEqual([
      expect.objectContaining({ supplierName: 'Ambuja depot', by: 'keeper', quantity: 50 }),
    ]);
  });
  it('the same tap twice adds once, and a key cannot change its figure', async () => {
    const idempotencyKey = randomUUID();
    const before = await levelAt(MAIN);
    expect((await receipt('keeper', { idempotencyKey })).status).toBe(201);
    expect((await receipt('keeper', { idempotencyKey })).status).toBe(201);
    expect(await levelAt(MAIN)).toBe(before + 50);
    expect((await receipt('keeper', { idempotencyKey, quantity: 500 })).status).toBe(409);
  });
  it('another shop, and those who do not receive, are refused', async () => {
    expect((await receipt('keeper', { locationId: SECOND })).status).toBe(403);
    expect((await receipt('driver')).status).toBe(403);
    expect((await receipt('cashier')).status).toBe(403);
  });
  it('nonsense is refused', async () => {
    for (const change of [{ quantity: 0 }, { quantity: -5 }, { supplierName: '' }, { price: 1 }])
      expect((await receipt('keeper', change)).status).toBe(400);
    expect((await receipt('keeper', { productId: 'nothing' })).status).toBe(404);
  });
});

describe('making a trip', () => {
  it('a manager assigns a driver and orders at their own shop', async () => {
    const row = await order();
    const made = await trip([row.id]).expect(201);
    const { body } = await adminGet('manager', 'trips').expect(200);
    expect(body.items[0]).toMatchObject({
      id: made.body.id,
      status: 'PLANNED',
      driverName: 'driver',
      stops: [expect.objectContaining({ number: row.number })],
    });
    expect(
      (await adminGet('manager', `trips/drivers?locationId=${MAIN}`).expect(200)).body.items,
    ).toEqual(expect.arrayContaining([expect.objectContaining({ id: 'driver', role: 'DRIVER' })]));
    expect(
      (await adminGet('manager', `trips/ready?locationId=${MAIN}`).expect(200)).body.items,
    ).toEqual([]);
  });
  it('someone paused is not offered as a driver', async () => {
    await db.user.update({ where: { id: 'driver' }, data: { staffPausedAt: new Date() } });
    const { body } = await adminGet('manager', `trips/drivers?locationId=${MAIN}`).expect(200);
    expect(body.items.map((row: { id: string }) => row.id)).not.toContain('driver');
    await db.user.update({ where: { id: 'driver' }, data: { staffPausedAt: null } });
  });
  it('the same tap twice makes one trip', async () => {
    const row = await order();
    const idempotencyKey = randomUUID();
    await trip([row.id], 'manager', { idempotencyKey }).expect(201);
    await trip([row.id], 'manager', { idempotencyKey }).expect(201);
    expect(await db.trip.count()).toBe(1);
  });
  it('an order cannot be on two trips', async () => {
    const row = await order();
    await trip([row.id]).expect(201);
    expect((await trip([row.id]).expect(409)).body.error.code).toBe('ORDER_BUSY');
  });
  it('another shop’s order or driver is refused', async () => {
    const other = await order({ locationId: SECOND });
    await trip([other.id]).expect(409);
    const mine = await order();
    await trip([mine.id], 'manager', { driverId: 'driverb' }).expect(409);
    await trip([mine.id], 'manager', { driverId: 'helper' }).expect(409);
    await trip([mine.id], 'manager', { locationId: SECOND }).expect(403);
  });
  it('those who do not assign are refused', async () => {
    const row = await order();
    for (const who of ['cashier', 'keeper', 'driver', 'accountant'])
      await trip([row.id], who).expect(403);
    await adminGet('cashier', 'trips').expect(403);
  });
  it('a trip not started can be cancelled, and its orders go back', async () => {
    const row = await order();
    const made = await trip([row.id]).expect(201);
    await adminPost('manager', `trips/${made.body.id}/cancel`).expect(201);
    expect(
      (await adminGet('manager', `trips/ready?locationId=${MAIN}`).expect(200)).body.items.map(
        (item: { id: string }) => item.id,
      ),
    ).toEqual([row.id]);
    await adminPost('managerb', `trips/${made.body.id}/cancel`).expect(403);
  });
  it('an order not yet confirmed cannot go', async () => {
    const row = await order();
    await db.order.update({ where: { id: row.id }, data: { status: 'AWAITING_CONFIRMATION' } });
    await trip([row.id]).expect(409);
  });
});

describe('on the road', () => {
  it('the driver sees their own trip: what to take, and never anyone’s balance', async () => {
    await db.user.update({ where: { id: 'customer' }, data: { khataBalancePaise: 987654 } });
    const cod = await order({ quantity: 3 });
    const credit = await order({ method: 'CREDIT' });
    const paid = await order({ method: 'ONLINE', captured: true });
    await trip([cod.id, credit.id, paid.id]).expect(201);
    const { body } = await appGet('driver', 'staff/trips/mine');
    const stops = body.items[0].stops;
    expect(stops[0]).toMatchObject({ collectPaise: 240000, onCredit: false, area: 'Kankarbagh' });
    expect(stops[1]).toMatchObject({ collectPaise: 0, onCredit: true });
    expect(stops[2]).toMatchObject({ collectPaise: 0, onCredit: false });
    const text = JSON.stringify(body);
    expect(text).not.toContain('987654');
    expect(text).not.toMatch(/khata|creditLimit/i);
    expect((await appGet('driverb', 'staff/trips/mine')).body.items).toEqual([]);
  });
  it('those who do not drive have no trips', async () => {
    expect((await appGet('keeper', 'staff/trips/mine')).status).toBe(403);
    expect((await appGet('helper', 'staff/trips/mine')).status).toBe(403);
  });
  it('goods must be loaded before leaving', async () => {
    const row = await order();
    const made = await trip([row.id]).expect(201);
    const res = await appPost('driver', `staff/trips/${made.body.id}/start`, {
      idempotencyKey: randomUUID(),
    });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('NOT_LOADED');
    expect((await db.order.findUniqueOrThrow({ where: { id: row.id } })).status).toBe('CONFIRMED');
  });
  it('leaving tells the customer once, even when the tap is repeated', async () => {
    const row = await order();
    await loaded(row.id);
    const made = await trip([row.id]).expect(201);
    const send = () =>
      appPost('driver', `staff/trips/${made.body.id}/start`, { idempotencyKey: randomUUID() });
    expect((await send()).status).toBe(201);
    expect((await send()).status).toBe(201);
    expect((await db.order.findUniqueOrThrow({ where: { id: row.id } })).status).toBe(
      'OUT_FOR_DELIVERY',
    );
    const told = await db.notification.count({
      where: { userId: 'customer', dedupeKey: { contains: 'OUT_FOR_DELIVERY' } },
    });
    expect(told).toBeLessThanOrEqual(1);
    const history = await db.orderStatusHistory.count({
      where: { orderId: row.id, status: 'OUT_FOR_DELIVERY' },
    });
    expect(history).toBe(1);
  });
  it('someone else’s trip is refused at every step', async () => {
    const { tripId, stopId } = await outOnTrip();
    expect(
      (await appPost('driverb', `staff/trips/${tripId}/start`, { idempotencyKey: randomUUID() }))
        .status,
    ).toBe(403);
    expect(
      (await delivered('driverb', stopId, { collected: { amountPaise: 1, channel: 'CASH' } }))
        .status,
    ).toBe(403);
    expect(
      (
        await appPost('driverb', `staff/stops/${stopId}/problem`, {
          idempotencyKey: randomUUID(),
          problem: 'OTHER',
        })
      ).status,
    ).toBe(403);
  });
  it('delivered with cash: the money is with the driver, not yet in the drawer', async () => {
    const { order: row, stopId, tripId } = await outOnTrip();
    const res = await delivered('driver', stopId, {
      collected: { amountPaise: 160000, channel: 'CASH' },
      lat: 25.6,
      lng: 85.1,
      accuracyM: 12,
    });
    expect(res.status).toBe(201);
    const after = await db.order.findUniqueOrThrow({
      where: { id: row.id },
      include: { payment: true },
    });
    expect(after.status).toBe('DELIVERED');
    expect(after.payment?.status).toBe('CAPTURED');
    expect(await db.financialMovement.count({ where: { kind: 'COLLECTION' } })).toBe(0);
    expect((await appGet('driver', 'staff/cash')).body.holdingPaise).toBe(160000);
    expect((await db.trip.findUniqueOrThrow({ where: { id: tripId } })).status).toBe('DONE');
    const [proof] = await db.deliveryProof.findMany({ where: { kind: 'DELIVERED' } });
    expect(proof!.geoEnc).not.toContain('25.6');
  });
  it('delivered by UPI to the shop’s code goes straight on the record', async () => {
    const { stopId } = await outOnTrip();
    await delivered('driver', stopId, { collected: { amountPaise: 160000, channel: 'UPI' } });
    const [row] = await db.financialMovement.findMany({ where: { kind: 'COLLECTION' } });
    expect(row).toMatchObject({ channel: 'UPI', amountPaise: 160000, counterParty: 'driver' });
    expect((await appGet('driver', 'staff/cash')).body.holdingPaise).toBe(0);
  });
  it('udhaar needs no money, and asking for some is refused', async () => {
    const { order: row, stopId } = await outOnTrip({ method: 'CREDIT' });
    await db.user.update({
      where: { id: 'customer' },
      data: { creditAllowed: true, creditLimitPaise: 9000000 },
    });
    const wrong = await delivered('driver', stopId, {
      collected: { amountPaise: 100, channel: 'CASH' },
    });
    expect(wrong.status).toBe(400);
    expect((await delivered('driver', stopId)).status).toBe(201);
    expect((await db.order.findUniqueOrThrow({ where: { id: row.id } })).status).toBe('DELIVERED');
    expect(
      await db.customerLedgerEntry.count({ where: { orderId: row.id, kind: 'SALE_ON_CREDIT' } }),
    ).toBe(1);
  });
  it('cash due must be stated, and a photo or a reason given', async () => {
    const { stopId } = await outOnTrip();
    const none = await delivered('driver', stopId);
    expect(none.status).toBe(400);
    expect(none.body.error.code).toBe('COLLECTION_NEEDED');
    const noPhoto = await appPost('driver', `staff/stops/${stopId}/delivered`, {
      idempotencyKey: randomUUID(),
      collected: { amountPaise: 160000, channel: 'CASH' },
    });
    expect(noPhoto.status).toBe(400);
  });
  it('a lost reply and a retry deliver once, take money once and tell once', async () => {
    const { order: row, stopId } = await outOnTrip();
    const idempotencyKey = randomUUID();
    const body = { idempotencyKey, collected: { amountPaise: 160000, channel: 'CASH' } };
    expect((await delivered('driver', stopId, body)).status).toBe(201);
    expect((await delivered('driver', stopId, body)).status).toBe(201);
    expect(await db.driverCollection.count()).toBe(1);
    expect(
      await db.orderStatusHistory.count({ where: { orderId: row.id, status: 'DELIVERED' } }),
    ).toBe(1);
    expect((await appGet('driver', 'staff/cash')).body.holdingPaise).toBe(160000);
  });
  it('a different key on a delivered stop cannot take money again', async () => {
    const { stopId } = await outOnTrip();
    await delivered('driver', stopId, { collected: { amountPaise: 160000, channel: 'CASH' } });
    const again = await delivered('driver', stopId, {
      collected: { amountPaise: 160000, channel: 'CASH' },
    });
    expect(again.status).toBe(409);
    expect(await db.driverCollection.count()).toBe(1);
  });
  it('a problem goes to the manager as an exception, and is told once', async () => {
    const { order: row, stopId, tripId } = await outOnTrip();
    const idempotencyKey = randomUUID();
    const send = () =>
      appPost('driver', `staff/stops/${stopId}/problem`, {
        idempotencyKey,
        problem: 'CUSTOMER_ABSENT',
        note: 'Phone nahi uthaya',
      });
    expect((await send()).status).toBe(201);
    expect((await send()).status).toBe(201);
    expect((await db.order.findUniqueOrThrow({ where: { id: row.id } })).status).toBe(
      'DELIVERY_EXCEPTION',
    );
    expect((await db.tripStop.findUniqueOrThrow({ where: { id: stopId } })).status).toBe('PROBLEM');
    expect((await db.trip.findUniqueOrThrow({ where: { id: tripId } })).status).toBe('DONE');
    expect(await db.deliveryProof.count({ where: { kind: 'PROBLEM' } })).toBe(1);
  });
  it('a repeated start must not send a stop with a problem back out', async () => {
    const one = await order();
    const two = await order();
    await loaded(one.id);
    await loaded(two.id);
    const made = await trip([one.id, two.id]).expect(201);
    const start = () =>
      appPost('driver', `staff/trips/${made.body.id}/start`, { idempotencyKey: randomUUID() });
    await start();
    const stops = await db.tripStop.findMany({ where: { tripId: made.body.id } });
    await appPost('driver', `staff/stops/${stops[0]!.id}/problem`, {
      idempotencyKey: randomUUID(),
      problem: 'NO_ACCESS',
    });
    await start();
    expect((await db.order.findUniqueOrThrow({ where: { id: stops[0]!.orderId } })).status).toBe(
      'DELIVERY_EXCEPTION',
    );
  });
  it('an order with a problem can go on a new trip', async () => {
    const { order: row, stopId } = await outOnTrip();
    await appPost('driver', `staff/stops/${stopId}/problem`, {
      idempotencyKey: randomUUID(),
      problem: 'CUSTOMER_ABSENT',
    });
    const again = await trip([row.id]).expect(201);
    await appPost('driver', `staff/trips/${again.body.id}/start`, { idempotencyKey: randomUUID() });
    expect((await db.order.findUniqueOrThrow({ where: { id: row.id } })).status).toBe(
      'OUT_FOR_DELIVERY',
    );
  });
  describe('less money than was due at the door', () => {
    const payment = (orderId: string) => db.payment.findUniqueOrThrow({ where: { orderId } });
    // The door's share holds the payment's one collection, so the rest is found by who took it.
    const moved = (orderId: string) =>
      db.financialMovement.findMany({
        where: { kind: 'COLLECTION', OR: [{ payment: { orderId } }, { actorId: 'papa' }] },
      });
    it('the goods are delivered, and the rest stays owed, not called paid', async () => {
      const { stopId, order: row } = await outOnTrip();
      expect(
        (
          await delivered('driver', stopId, {
            collected: { amountPaise: 100000, channel: 'CASH' },
          })
        ).status,
      ).toBe(201);
      const seen = await db.order.findUniqueOrThrow({ where: { id: row.id } });
      expect(seen.status).toBe('DELIVERED');
      expect((await payment(row.id)).status).toBe('PENDING');
      const page = (await adminGet('papa', `orders/${row.id}`).expect(200)).body;
      expect(page.driverCollectedPaise).toBe(100000);
    });
    it('whoever takes the rest records only the rest, once', async () => {
      const { stopId, order: row } = await outOnTrip();
      expect(
        (
          await delivered('driver', stopId, {
            collected: { amountPaise: 100000, channel: 'UPI' },
          })
        ).status,
      ).toBe(201);
      await adminPost('papa', `orders/${row.id}/cod-received`, { channel: 'CASH' }).expect(201);
      expect((await payment(row.id)).status).toBe('CAPTURED');
      const rows = await moved(row.id);
      expect(rows.map((one) => one.amountPaise).sort((a, b) => a - b)).toEqual([60000, 100000]);
      await adminPost('papa', `orders/${row.id}/cod-received`, { channel: 'CASH' });
      expect(await moved(row.id)).toHaveLength(2);
    });
    it('nothing at all at the door is still a delivery, with the whole amount owed', async () => {
      const { stopId, order: row } = await outOnTrip();
      expect(
        (
          await delivered('driver', stopId, {
            collected: { amountPaise: 0, channel: 'CASH' },
          })
        ).status,
      ).toBe(201);
      expect((await db.order.findUniqueOrThrow({ where: { id: row.id } })).status).toBe(
        'DELIVERED',
      );
      expect((await payment(row.id)).status).toBe('PENDING');
      expect(
        (await adminGet('papa', `orders/${row.id}`).expect(200)).body.driverCollectedPaise,
      ).toBe(0);
    });
    it('the whole amount, or more, is paid', async () => {
      const { stopId, order: row } = await outOnTrip();
      expect(
        (
          await delivered('driver', stopId, {
            collected: { amountPaise: 160000, channel: 'CASH' },
          })
        ).status,
      ).toBe(201);
      expect((await payment(row.id)).status).toBe('CAPTURED');
    });
    it('a delivered order with no driver’s word still cannot be cash-received twice over', async () => {
      const row = await order();
      await db.order.update({ where: { id: row.id }, data: { status: 'DELIVERED' } });
      expect(
        (await adminPost('papa', `orders/${row.id}/cod-received`, { channel: 'CASH' }).expect(409))
          .body.error.code,
      ).toBe('INVALID_PAYMENT_STATE');
    });
  });
  it('less money than was due is delivered, and shows in tonight’s summary', async () => {
    const { stopId } = await outOnTrip();
    await delivered('driver', stopId, { collected: { amountPaise: 100000, channel: 'CASH' } });
    await db.location.update({ where: { id: MAIN }, data: { attendanceOn: true } });
    const { body } = await adminGet('papa', 'attendance/summary').expect(200);
    expect(body.collectionDifferences).toEqual([
      expect.objectContaining({ driver: 'driver', duePaise: 160000, amountPaise: 100000 }),
    ]);
  });
  it('a photo that does not exist cannot be named as proof', async () => {
    const { stopId } = await outOnTrip();
    const res = await delivered('driver', stopId, {
      evidenceId: 'made-up',
      skipReason: undefined,
      collected: { amountPaise: 160000, channel: 'CASH' },
    });
    expect(res.status).toBe(400);
  });
  it('a helper from another shop cannot be put on a trip', async () => {
    const row = await order();
    await trip([row.id], 'manager', { helperId: 'keeperb' }).expect(409);
    await trip([row.id], 'manager', { helperId: 'helper' }).expect(201);
  });
  it('a trip stays open until each stop is settled', async () => {
    const one = await order();
    const two = await order();
    await loaded(one.id);
    await loaded(two.id);
    const made = await trip([one.id, two.id]).expect(201);
    await appPost('driver', `staff/trips/${made.body.id}/start`, { idempotencyKey: randomUUID() });
    const stops = await db.tripStop.findMany({ where: { tripId: made.body.id } });
    await delivered('driver', stops[0]!.id, {
      collected: { amountPaise: 160000, channel: 'CASH' },
    });
    expect((await db.trip.findUniqueOrThrow({ where: { id: made.body.id } })).status).toBe('OUT');
    await delivered('driver', stops[1]!.id, {
      collected: { amountPaise: 160000, channel: 'CASH' },
    });
    expect((await db.trip.findUniqueOrThrow({ where: { id: made.body.id } })).status).toBe('DONE');
  });
  it('the database refuses changing a proof', async () => {
    const { stopId } = await outOnTrip();
    await delivered('driver', stopId, { collected: { amountPaise: 160000, channel: 'CASH' } });
    const proof = await db.deliveryProof.findFirstOrThrow();
    await expect(
      db.deliveryProof.update({ where: { id: proof.id }, data: { skipReason: 'changed' } }),
    ).rejects.toThrow();
  });
});

describe('handing over cash', () => {
  async function holding(amountPaise = 160000) {
    const { stopId } = await outOnTrip();
    await delivered('driver', stopId, { collected: { amountPaise, channel: 'CASH' } });
  }
  const offer = (amountPaise = 160000, handoverKey = randomUUID(), who = 'driver') =>
    appPost(who, 'staff/cash/handover', { amountPaise, handoverKey }).then((res) => ({
      res,
      key: handoverKey,
    }));
  const count = (who: string, key: string, countedPaise = 160000, note?: string) =>
    adminPost(who, `galla/handovers/${key}/count`, { countedPaise, ...(note ? { note } : {}) });
  it('equal: both named, and the cash joins today’s drawer only now', async () => {
    await holding();
    const { key } = await offer();
    const sheet = () => adminGet('cashier', `galla?locationId=${MAIN}`).expect(200);
    expect((await sheet()).body.sales).toBe(0);
    await count('cashier', key).expect(201);
    expect((await sheet()).body.sales).toBe(160000);
    const list = await adminGet('cashier', 'galla/handovers').expect(200);
    expect(list.body.items[0]).toMatchObject({
      status: 'DONE',
      driverName: 'driver',
      countedByName: 'cashier',
    });
    expect((await appGet('driver', 'staff/cash')).body).toMatchObject({
      holdingPaise: 0,
      handovers: [expect.objectContaining({ status: 'DONE' })],
    });
  });
  it('different: both figures stay, nobody is accused, and only an owner settles', async () => {
    await holding();
    const { key } = await offer();
    await count('cashier', key, 150000, 'Ginti mein 10 note kam').expect(201);
    const list = await adminGet('cashier', 'galla/handovers').expect(200);
    expect(list.body.items[0]).toMatchObject({
      status: 'DIFFERENT',
      offeredPaise: 160000,
      countedPaise: 150000,
    });
    // The drawer holds what was really counted.
    expect((await adminGet('cashier', `galla?locationId=${MAIN}`).expect(200)).body.sales).toBe(
      150000,
    );
    await adminPost('cashier', `galla/handovers/${key}/settle`, { note: 'Theek' }).expect(403);
    await adminPost('manager', `galla/handovers/${key}/settle`, { note: 'Theek' }).expect(403);
    await adminPost('papa', `galla/handovers/${key}/settle`, { note: 'Baat ho gayi' }).expect(201);
    expect((await adminGet('cashier', 'galla/handovers').expect(200)).body.items[0]).toMatchObject({
      status: 'DONE',
      settledNote: 'Baat ho gayi',
    });
    await adminPost('chacha', `galla/handovers/${key}/settle`, { note: 'Phir' }).expect(409);
    // A difference never becomes anything else by itself.
    expect(await db.approvalRequest.count()).toBe(0);
  });
  it('part at the door and the rest at the desk both reach the drawer, once each', async () => {
    const { stopId, order: row } = await outOnTrip();
    expect(
      (await delivered('driver', stopId, { collected: { amountPaise: 100000, channel: 'CASH' } }))
        .status,
    ).toBe(201);
    const sales = async () =>
      (await adminGet('cashier', `galla?locationId=${MAIN}`).expect(200)).body.sales;
    await adminPost('papa', `orders/${row.id}/cod-received`, { channel: 'CASH' }).expect(201);
    expect(await sales()).toBe(60000);
    const { key } = await offer(100000);
    await count('cashier', key, 100000).expect(201);
    expect(await sales()).toBe(160000);
    await adminPost('papa', `orders/${row.id}/cod-received`, { channel: 'CASH' }).expect(201);
    expect(await sales()).toBe(160000);
  });
  it('offering less than was collected cannot quietly come out "equal"', async () => {
    await holding(160000);
    const { key } = await offer(100000);
    await count('cashier', key, 100000).expect(201);
    const row = (await adminGet('cashier', 'galla/handovers').expect(200)).body.items[0];
    expect(row).toMatchObject({
      status: 'DIFFERENT',
      offeredPaise: 100000,
      collectedPaise: 160000,
      countedPaise: 100000,
    });
    expect((await appGet('driver', 'staff/cash')).body.handovers[0].status).toBe('DIFFERENT');
    expect((await adminGet('cashier', `galla?locationId=${MAIN}`).expect(200)).body.sales).toBe(
      100000,
    );
    await db.location.update({ where: { id: MAIN }, data: { attendanceOn: true } });
    const summary = await adminGet('papa', 'attendance/summary').expect(200);
    expect(summary.body.cashDifferences[0]).toMatchObject({
      collectedPaise: 160000,
      countedPaise: 100000,
    });
  });
  it('more than was collected is recorded as over, and the drawer holds what was counted', async () => {
    await holding(160000);
    const { key } = await offer(170000);
    await count('cashier', key, 170000).expect(201);
    expect((await adminGet('cashier', `galla?locationId=${MAIN}`).expect(200)).body.sales).toBe(
      170000,
    );
    expect(await db.financialMovement.count({ where: { kind: 'HANDOVER_OVER' } })).toBe(1);
  });
  it('asking for another shop’s handovers or trips is refused', async () => {
    await adminGet('cashierb', `galla/handovers?locationId=${MAIN}`).expect(403);
    await adminGet('managerb', `trips?locationId=${MAIN}`).expect(403);
  });
  it('a driver cannot count their own, even in the database', async () => {
    await holding();
    const { key } = await offer();
    await expect(
      db.cashHandover.create({
        data: {
          handoverKey: key,
          step: 'COUNTED',
          locationId: MAIN,
          driverId: 'driver',
          amountPaise: 1,
          actorId: 'driver',
        },
      }),
    ).rejects.toThrow();
  });
  it('another shop’s cashier, and those without the right, cannot count', async () => {
    await holding();
    const { key } = await offer();
    await count('cashierb', key).expect(403);
    await count('keeper', key).expect(403);
    await count('accountant', key).expect(403);
    expect((await adminGet('cashierb', 'galla/handovers').expect(200)).body.items).toEqual([]);
  });
  it('the same offer twice is one handover, and a key cannot change its figure', async () => {
    await holding();
    const key = randomUUID();
    expect((await offer(160000, key)).res.status).toBe(201);
    expect((await offer(160000, key)).res.status).toBe(201);
    expect(await db.cashHandover.count()).toBe(1);
    expect((await offer(1, key)).res.status).toBe(409);
  });
  it('counted twice: the same figure is fine and adds nothing, another is refused', async () => {
    await holding();
    const { key } = await offer();
    await count('cashier', key).expect(201);
    await count('manager', key).expect(201);
    await count('manager', key, 1).expect(409);
    expect(await db.financialMovement.count({ where: { kind: 'COLLECTION' } })).toBe(1);
  });
  it('with nothing in hand there is nothing to hand over', async () => {
    const { res } = await offer();
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('NOTHING_TO_HAND_OVER');
  });
  it('cash taken after an offer waits for the next handover', async () => {
    await holding();
    await offer();
    await holding(160000);
    expect((await appGet('driver', 'staff/cash')).body.holdingPaise).toBe(160000);
  });
  it('a driver’s cash record is theirs alone', async () => {
    await holding();
    expect((await appGet('driverb', 'staff/cash')).body.holdingPaise).toBe(0);
    expect((await appGet('keeper', 'staff/cash')).status).toBe(403);
  });
  it('the database refuses changing a step', async () => {
    await holding();
    await offer();
    const row = await db.cashHandover.findFirstOrThrow();
    await expect(
      db.cashHandover.update({ where: { id: row.id }, data: { amountPaise: 1 } }),
    ).rejects.toThrow();
  });
});

describe('private photos', () => {
  const photo = async () =>
    sharp({ create: { width: 8, height: 8, channels: 3, background: '#808080' } })
      .jpeg()
      .toBuffer();
  const upload = async (
    who: string,
    bytes: Buffer,
    query = 'kind=DELIVERY_PHOTO',
    type = 'image/jpeg',
  ) =>
    request(server)
      .post(`/api/v1/staff/evidence?${query}`)
      .set('Authorization', `Bearer ${await phoneOf(who)}`)
      .set('Content-Type', type)
      .send(bytes);
  it('is cleaned of location data, kept private, and read only on the record', async () => {
    const { status, body } = await upload(
      'driver',
      await photo(),
      `kind=DELIVERY_PHOTO&locationId=${MAIN}`,
    );
    expect(status).toBe(201);
    const row = await db.evidenceObject.findUniqueOrThrow({ where: { id: body.id } });
    expect(row).toMatchObject({
      contentType: 'image/webp',
      createdById: 'driver',
      kind: 'DELIVERY_PHOTO',
    });
    expect(row.retainUntil).toBeTruthy();
    const read = await adminGet('manager', `evidence/${body.id}`).expect(200);
    expect(read.headers['cache-control']).toContain('no-store');
    expect(await db.auditLog.count({ where: { event: 'EVIDENCE_READ', actorId: 'manager' } })).toBe(
      1,
    );
  });
  describe('past its keeping date', () => {
    const storedAt = (key: string) => resolve(process.cwd(), '.local/rate-sources', key);
    const expire = (id: string) =>
      db.evidenceObject.update({
        where: { id },
        data: { retainUntil: new Date(Date.now() - 1000) },
      });
    it('the file goes for good, the row stays, and nobody can read it', async () => {
      const { body } = await upload(
        'driver',
        await photo(),
        `kind=DELIVERY_PHOTO&locationId=${MAIN}`,
      );
      const row = await db.evidenceObject.findUniqueOrThrow({ where: { id: body.id } });
      expect(existsSync(storedAt(row.storageKey))).toBe(true);
      await expire(body.id);
      await app.get(Attendance).housekeeping();
      expect(existsSync(storedAt(row.storageKey))).toBe(false);
      const after = await db.evidenceObject.findUniqueOrThrow({ where: { id: body.id } });
      expect(after.erasedAt).toBeInstanceOf(Date);
      await adminGet('manager', `evidence/${body.id}`).expect(404);
    });
    it('a photo still inside its date is left alone', async () => {
      const { body } = await upload(
        'driver',
        await photo(),
        `kind=DELIVERY_PHOTO&locationId=${MAIN}`,
      );
      const row = await db.evidenceObject.findUniqueOrThrow({ where: { id: body.id } });
      await app.get(Attendance).housekeeping();
      expect(existsSync(storedAt(row.storageKey))).toBe(true);
      await adminGet('manager', `evidence/${body.id}`).expect(200);
    });
    it('sending the same picture again brings it back with a fresh date', async () => {
      const bytes = await photo();
      const { body } = await upload('driver', bytes, `kind=DELIVERY_PHOTO&locationId=${MAIN}`);
      await expire(body.id);
      await app.get(Evidence).sweep();
      const again = await upload('driver', bytes, `kind=DELIVERY_PHOTO&locationId=${MAIN}`);
      expect(again.body.id).toBe(body.id);
      const row = await db.evidenceObject.findUniqueOrThrow({ where: { id: body.id } });
      expect(row.erasedAt).toBeNull();
      expect(row.retainUntil!.getTime()).toBeGreaterThan(Date.now());
      await adminGet('manager', `evidence/${body.id}`).expect(200);
    });
    it('a store that refuses leaves it on the list, so the next run tries again', async () => {
      const { body } = await upload(
        'driver',
        await photo(),
        `kind=DELIVERY_PHOTO&locationId=${MAIN}`,
      );
      await expire(body.id);
      const storage = app.get(RateStorage);
      const refused = vi.spyOn(storage, 'remove').mockRejectedValueOnce(new Error('store down'));
      expect(await app.get(Evidence).sweep()).toBe(0);
      expect(refused).toHaveBeenCalledTimes(1);
      const row = await db.evidenceObject.findUniqueOrThrow({ where: { id: body.id } });
      expect(row.erasedAt).toBeNull();
      expect(await app.get(Evidence).sweep()).toBe(1);
      refused.mockRestore();
    });
    it('a rate sheet holding the same file keeps it', async () => {
      const { body } = await upload(
        'driver',
        await photo(),
        `kind=DELIVERY_PHOTO&locationId=${MAIN}`,
      );
      const row = await db.evidenceObject.findUniqueOrThrow({ where: { id: body.id } });
      const sheet = await db.rateSource.create({
        data: {
          sha256: row.sha256,
          storageKey: row.storageKey,
          contentType: row.contentType,
          size: row.size,
          fileName: 'sample sheet',
          createdBy: 'papa',
        },
      });
      await expire(body.id);
      expect(await app.get(Evidence).sweep()).toBe(1);
      expect(existsSync(storedAt(row.storageKey))).toBe(true);
      await db.rateSource.delete({ where: { id: sheet.id } });
    });
  });
  it('someone else’s photo cannot be named as your proof', async () => {
    const { body } = await upload(
      'keeper',
      await photo(),
      `kind=DELIVERY_PHOTO&locationId=${MAIN}`,
    );
    const { stopId } = await outOnTrip();
    const res = await delivered('driver', stopId, {
      evidenceId: body.id,
      skipReason: undefined,
      collected: { amountPaise: 160000, channel: 'CASH' },
    });
    expect(res.status).toBe(400);
    expect(await db.deliveryProof.count({ where: { tripStopId: stopId } })).toBe(0);
  });
  it('naming another shop on a photo is refused', async () => {
    expect(
      (await upload('driver', await photo(), `kind=DELIVERY_PHOTO&locationId=${SECOND}`)).status,
    ).toBe(403);
  });
  it('another shop’s manager, and those without the right, cannot read it', async () => {
    const { body } = await upload(
      'driver',
      await photo(),
      `kind=DELIVERY_PHOTO&locationId=${MAIN}`,
    );
    await adminGet('managerb', `evidence/${body.id}`).expect(403);
    await adminGet('cashier', `evidence/${body.id}`).expect(403);
    await request(server).get(`/api/v1/admin/evidence/${body.id}`).expect(401);
  });
  it('something that is not a photo, or an unknown kind, is refused', async () => {
    expect(
      (await upload('driver', Buffer.from('<script>alert(1)</script>'))).status,
    ).toBeGreaterThanOrEqual(400);
    expect((await upload('driver', await photo(), 'kind=SOMETHING')).status).toBe(400);
  });
  it('without a linked phone or a session, nothing', async () => {
    await request(server).post('/api/v1/staff/evidence?kind=DELIVERY_PHOTO').expect(401);
    const { body } = await linkPhone(server, numbers.keeper!, makePhone()).expect(201);
    await request(server)
      .post('/api/v1/staff/evidence?kind=DELIVERY_PHOTO')
      .set('Authorization', `Bearer ${body.accessToken}`)
      .set('Content-Type', 'image/jpeg')
      .send(await photo())
      .expect(403);
  });
  it('a damage report can carry its photo, for the owner to see', async () => {
    const { body } = await upload('keeper', await photo(), `kind=DAMAGE_PHOTO&locationId=${MAIN}`);
    const damage = await appPost('keeper', 'admin/stock/damage', {
      locationId: MAIN,
      productId: 'cement',
      quantity: 2,
      note: 'Bheeg gaya',
      evidenceId: body.id,
      idempotencyKey: randomUUID(),
    });
    expect(damage.status).toBe(201);
    const list = await adminGet('papa', 'approvals').expect(200);
    expect(list.body.items[0].detail).toMatchObject({ evidenceId: body.id });
    await adminGet('papa', `evidence/${body.id}`).expect(200);
  });
});

void vi;
