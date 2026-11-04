import 'reflect-metadata';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import type { Server } from 'node:http';
import { loadEnvFile } from 'node:process';
import type { INestApplication } from '@nestjs/common';
import { istToday } from '@shiv/shared';
import request from 'supertest';
import { Events, stockDuringCount } from '../src/catalog';
import { Db } from '../src/db';
import { addPerson, tokenFor } from './staff-helper';

if (existsSync('.env.test')) loadEnvFile('.env.test');
process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
process.env.OTP_PROVIDER = 'mock';
process.env.OTP_HASH_SECRET = 'shop-operations-test-only-secret-not-for-production';
process.env.CORS_ORIGINS = 'http://localhost:3000';
if (!process.env.DATABASE_URL || !new URL(process.env.DATABASE_URL).pathname.endsWith('_test'))
  throw new Error('These tests require a dedicated TEST_DATABASE_URL ending in _test.');

const MAIN = 'loc_main';
const SECOND = 'loc_ops_b';
let app: INestApplication;
let server: Server;
let db: Db;
const as = (id: string) => ({ Authorization: `Bearer ${tokenFor(id)}` });
const get = (who: string, path: string) =>
  request(server).get(`/api/v1/admin/${path}`).set(as(who));
const post = (who: string, path: string, body: object = {}) =>
  request(server).post(`/api/v1/admin/${path}`).set(as(who)).send(body);
const put = (who: string, path: string, body: object) =>
  request(server).put(`/api/v1/admin/${path}`).set(as(who)).send(body);
const levelAt = async (locationId: string, productId = 'cement') =>
  (
    await db.stockLevel.findUnique({
      where: { productId_locationId: { productId, locationId } },
    })
  )?.quantity ?? 0;
const total = async (productId = 'cement') =>
  (await db.product.findUniqueOrThrow({ where: { id: productId } })).stock;

beforeAll(async () => {
  const { createApp } = await import('../src/app');
  app = await createApp();
  await app.listen(0, '127.0.0.1');
  server = app.getHttpServer();
  db = app.get(Db);
}, 30000);
beforeEach(async () => {
  await db.$executeRawUnsafe(
    'TRUNCATE TABLE "ApprovalRequest", "StockCountLine", "StockCount", "StockTransferLine", "StockTransfer", "FinancialMovement", "User", "Category", "Product", "DeliveryZone", "StoreSettings", "AuditLog", "AuthRateLimit" RESTART IDENTITY CASCADE',
  );
  await db.$executeRawUnsafe('ALTER TABLE "DayClose" DISABLE TRIGGER day_close_append_only');
  await db.$executeRawUnsafe('ALTER TABLE "GallaEntry" DISABLE TRIGGER galla_entry_append_only');
  await db.$executeRawUnsafe('TRUNCATE TABLE "DayClose", "GallaEntry" CASCADE');
  await db.$executeRawUnsafe('ALTER TABLE "DayClose" ENABLE TRIGGER day_close_append_only');
  await db.$executeRawUnsafe('ALTER TABLE "GallaEntry" ENABLE TRIGGER galla_entry_append_only');
  await db.location.upsert({
    where: { id: SECOND },
    update: { active: true, stockStartedAt: null },
    create: { id: SECOND, firmId: 'firm_main', slug: 'ops-b', name: 'Second shop' },
  });
  await db.location.update({ where: { id: MAIN }, data: { managerRateCapPercent: 5 } });
  for (const [id, role, shops] of [
    ['papa', 'OWNER', undefined],
    ['chacha', 'OWNER', undefined],
    ['manager', 'MANAGER', [MAIN]],
    ['managerb', 'MANAGER', [SECOND]],
    ['keeper', 'STOCK_KEEPER', [MAIN]],
    ['keeperb', 'STOCK_KEEPER', [SECOND]],
    ['cashier', 'CASHIER', [MAIN]],
    ['cashierb', 'CASHIER', [SECOND]],
    ['accountant', 'ACCOUNTANT', undefined],
    ['tech', 'TECH_OPERATOR', undefined],
  ] as const) {
    const n = String(Math.abs(hashOf(id)))
      .padStart(6, '0')
      .slice(0, 6);
    await addPerson(db, {
      id,
      role,
      phone: `+9190${n}11`,
      ...(shops ? { shops: [...shops] } : {}),
    });
  }
  await addPerson(db, { id: 'customer', phone: '+919000000701' });
  await db.category.create({ data: { id: 'cat', name: 'Cement', slug: 'cement' } });
  for (const [id, stockMode] of [
    ['cement', 'COUNTED'],
    ['acc', 'COUNTED'],
    ['sand', 'AVAILABILITY'],
  ] as const)
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
        stockMode,
        minQuantity: 1,
        description: 'Test',
        recommendedUse: 'Test',
        images: [],
      },
    });
  await db.deliveryZone.create({
    data: {
      id: 'zone',
      name: 'Patna',
      deliveryFeePaise: 50000,
      minimumOrderPaise: 0,
      estimate: 'Today',
      pincodes: { create: { pincode: '800020' } },
    },
  });
  await db.storeSettings.create({ data: { id: 'store', phone: '+919999999000' } });
});
afterAll(async () => {
  await app?.close();
});
function hashOf(value: string) {
  return [...value].reduce((sum, char) => sum * 31 + char.charCodeAt(0), 7) % 1000000;
}

const send = (who = 'keeper', quantity = 50, key = randomUUID(), rest: object = {}) =>
  post(who, 'stock/transfers', {
    fromLocationId: MAIN,
    toLocationId: SECOND,
    lines: [{ productId: 'cement', quantity }],
    vehicle: 'BR01',
    idempotencyKey: key,
    ...rest,
  });
const startCount = async (locationId = MAIN, who = 'keeper', rest: object = {}) =>
  (await post(who, 'stock/counts', { locationId, ...rest }).expect(201)).body.id as string;
const fill = async (id: string, values: Record<string, number>, who = 'keeper') => {
  for (const [productId, countedQty] of Object.entries(values))
    await put(who, `stock/counts/${id}/lines`, { productId, countedQty }).expect(200);
};
const pending = async (kind?: string) =>
  db.approvalRequest.findMany({ where: { status: 'PENDING', ...(kind ? { kind } : {}) } });
const decide = (id: string, decision: 'APPROVE' | 'REJECT', who = 'papa') =>
  post(who, `approvals/${id}/decide`, { decision });

async function waitingOrder() {
  await db.address.create({
    data: {
      id: 'site',
      userId: 'customer',
      label: 'Site',
      name: 'Ramesh',
      phone: '+919000000701',
      line1: 'Plot 12',
      area: 'Kankarbagh',
      city: 'Patna',
      state: 'Bihar',
      pincode: '800020',
      landmark: '',
    },
  });
  const day = new Date(Date.now() + 2 * 86400000).toISOString().slice(0, 10);
  const headers = as('customer');
  await request(server)
    .put('/api/v1/cart/items')
    .set(headers)
    .send({ productId: 'cement', quantity: 10 })
    .expect(200);
  const review = await request(server)
    .post('/api/v1/checkout/review')
    .set(headers)
    .send({ addressId: 'site', deliveryDate: day, paymentMethod: 'COD', notes: '' })
    .expect(201);
  const placed = await request(server)
    .post('/api/v1/orders')
    .set(headers)
    .send({ reviewId: review.body.id, idempotencyKey: randomUUID() })
    .expect(201);
  const row = await db.order.findUniqueOrThrow({ where: { id: placed.body.id } });
  return row;
}

describe('sending goods to another shop', () => {
  it('leaves the sender at once and joins the other shop only when counted in', async () => {
    const { body } = await send().expect(201);
    expect(await levelAt(MAIN)).toBe(50);
    expect(await levelAt(SECOND)).toBe(0);
    expect(await total()).toBe(50);
    expect(body.status).toBe('SENT');
    const table = (await get('papa', 'stock').expect(200)).body;
    expect(table.items.find((row: { id: string }) => row.id === 'cement').onTheRoad).toBe(50);
    await post('keeperb', `stock/transfers/${body.id}/receive`, {
      lines: [{ productId: 'cement', receivedQty: 50 }],
    }).expect(201);
    expect(await levelAt(SECOND)).toBe(50);
    expect(await total()).toBe(100);
    expect(await pending()).toEqual([]);
    const after = await db.stockTransfer.findUniqueOrThrow({ where: { id: body.id } });
    expect(after).toMatchObject({ status: 'RECEIVED', receivedById: 'keeperb' });
  });
  it('a short delivery stays visible, goes to an owner, and is never settled by itself', async () => {
    const { body } = await send().expect(201);
    await post('keeperb', `stock/transfers/${body.id}/receive`, {
      lines: [{ productId: 'cement', receivedQty: 48 }],
    }).expect(201);
    expect(await levelAt(SECOND)).toBe(48);
    expect((await db.stockTransfer.findUniqueOrThrow({ where: { id: body.id } })).status).toBe(
      'DIFFERENT',
    );
    const [ask] = await pending('TRANSFER_SHORTAGE');
    expect(ask).toMatchObject({ amountPaise: 80000, locationId: SECOND });
    const { body: list } = await get('papa', 'approvals').expect(200);
    expect(list.items[0].detail.lines[0]).toMatchObject({ sent: 50, received: 48 });
    await decide(ask!.id, 'APPROVE').expect(201);
    expect((await db.stockTransfer.findUniqueOrThrow({ where: { id: body.id } })).status).toBe(
      'SETTLED',
    );
    expect(await levelAt(SECOND)).toBe(48);
  });
  it('more than was sent is also a difference', async () => {
    const { body } = await send('keeper', 10).expect(201);
    await post('keeperb', `stock/transfers/${body.id}/receive`, {
      lines: [{ productId: 'cement', receivedQty: 12 }],
    }).expect(201);
    expect((await db.stockTransfer.findUniqueOrThrow({ where: { id: body.id } })).status).toBe(
      'DIFFERENT',
    );
    // What was sent is usable at once. The extra waits for an owner.
    expect(await levelAt(SECOND)).toBe(10);
    const [asked] = await pending('TRANSFER_SHORTAGE');
    expect(asked!.amountPaise).toBe(80000);
    await decide(asked!.id, 'APPROVE').expect(201);
    expect(await levelAt(SECOND)).toBe(12);
    expect(await total()).toBe(102);
  });
  it('a huge figure typed on arrival adds nothing to what can be sold', async () => {
    const { body } = await send('keeper', 10).expect(201);
    await post('keeperb', `stock/transfers/${body.id}/receive`, {
      lines: [{ productId: 'cement', receivedQty: 900000 }],
    }).expect(201);
    expect(await levelAt(SECOND)).toBe(10);
    const [asked] = await pending('TRANSFER_SHORTAGE');
    await decide(asked!.id, 'REJECT').expect(201);
    expect(await levelAt(SECOND)).toBe(10);
    expect(await total()).toBe(100);
  });
  it('the same tap twice sends once, and the key cannot be used for something else', async () => {
    const key = randomUUID();
    const first = await send('keeper', 10, key).expect(201);
    const second = await send('keeper', 10, key).expect(201);
    expect(second.body.id).toBe(first.body.id);
    expect(await levelAt(MAIN)).toBe(90);
    await send('keeper', 20, key).expect(409);
    await send('manager', 10, key).expect(409);
    expect(await levelAt(MAIN)).toBe(90);
  });
  it('the person who sent cannot be the one who counts it in', async () => {
    const { body } = await send('papa', 10).expect(201);
    const { status, body: refused } = await post('papa', `stock/transfers/${body.id}/receive`, {
      lines: [{ productId: 'cement', receivedQty: 10 }],
    });
    expect(status).toBe(403);
    expect(refused.error.code).toBe('SAME_PERSON');
    expect(await levelAt(SECOND)).toBe(0);
    await expect(
      db.stockTransfer.update({ where: { id: body.id }, data: { receivedById: 'papa' } }),
    ).rejects.toThrow();
  });
  it('another shop’s people cannot send from here or receive for there', async () => {
    await send('managerb').expect(403);
    await send('keeperb').expect(403);
    await send('cashier').expect(403);
    await send('accountant').expect(403);
    await send('tech').expect(403);
    await send('customer').expect(403);
    const { body } = await send().expect(201);
    await post('manager', `stock/transfers/${body.id}/receive`, {
      lines: [{ productId: 'cement', receivedQty: 50 }],
    }).expect(403);
    expect(await levelAt(SECOND)).toBe(0);
  });
  it('cannot send what is not there, leaving nothing half done', async () => {
    const before = await db.inventoryMovement.count();
    const { status, body } = await send('keeper', 101);
    expect(status).toBe(409);
    expect(body.error.code).toBe('STOCK_CONFLICT');
    expect(await db.stockTransfer.count()).toBe(0);
    expect(await db.inventoryMovement.count()).toBe(before);
    expect(await levelAt(MAIN)).toBe(100);
  });
  it('refuses a shop to itself, a closed shop and bad lines', async () => {
    await send('keeper', 5, randomUUID(), { toLocationId: MAIN }).expect(400);
    await db.location.update({ where: { id: SECOND }, data: { active: false } });
    await send('keeper').expect(400);
    await db.location.update({ where: { id: SECOND }, data: { active: true } });
    await send('keeper', 0).expect(400);
    await send('keeper', -5).expect(400);
    await send('keeper', 5, randomUUID(), {
      lines: [
        { productId: 'cement', quantity: 1 },
        { productId: 'cement', quantity: 1 },
      ],
    }).expect(400);
    await send('keeper', 5, randomUUID(), { status: 'RECEIVED' }).expect(400);
  });
  it('can be received once, even by two people at the same moment', async () => {
    const { body } = await send('keeper', 10).expect(201);
    const lines = { lines: [{ productId: 'cement', receivedQty: 10 }] };
    const results = await Promise.all([
      post('keeperb', `stock/transfers/${body.id}/receive`, lines),
      post('managerb', `stock/transfers/${body.id}/receive`, lines),
    ]);
    expect(results.map((result) => result.status).sort()).toEqual([201, 409]);
    expect(await levelAt(SECOND)).toBe(10);
  });
  it('every item on it must be counted in', async () => {
    const { body } = await send('keeper', 10).expect(201);
    await post('keeperb', `stock/transfers/${body.id}/receive`, {
      lines: [{ productId: 'acc', receivedQty: 10 }],
    }).expect(400);
    await post('keeperb', 'stock/transfers/nope/receive', {
      lines: [{ productId: 'cement', receivedQty: 10 }],
    }).expect(404);
  });
  it('a manager sees only transfers touching their shop', async () => {
    await send().expect(201);
    await db.location.upsert({
      where: { id: 'loc_c' },
      update: { active: true },
      create: { id: 'loc_c', firmId: 'firm_main', slug: 'ops-c', name: 'C' },
    });
    await addPerson(db, {
      id: 'managerc',
      role: 'MANAGER',
      shops: ['loc_c'],
      phone: '+919000000721',
    });
    expect((await get('managerb', 'stock/transfers').expect(200)).body.items).toHaveLength(1);
    expect((await get('managerc', 'stock/transfers').expect(200)).body.items).toEqual([]);
    await db.location.update({ where: { id: 'loc_c' }, data: { active: false } });
  });
});

describe('a blind count', () => {
  it('shows the person counting names and boxes, never the book figure', async () => {
    const id = await startCount();
    const open = (await get('keeper', `stock/counts/${id}`).expect(200)).body;
    expect(open.lines[0]).not.toHaveProperty('systemQty');
    await fill(id, { cement: 90, acc: 100 });
    await post('keeper', `stock/counts/${id}/submit`).expect(201);
    const sent = (await get('keeper', `stock/counts/${id}`).expect(200)).body;
    expect(JSON.stringify(sent)).not.toMatch(/systemQty|differenceQty|heldQty/);
    const owner = (await get('papa', `stock/counts/${id}`).expect(200)).body;
    expect(
      owner.lines.find((line: { productId: string }) => line.productId === 'cement'),
    ).toMatchObject({
      systemQty: 100,
      countedQty: 90,
      differenceQty: -10,
    });
  });
  it('hides the shop’s figures from those counting while the count is open', async () => {
    const id = await startCount();
    const row = (who: string) =>
      get(who, 'stock').then(
        (r) =>
          r.body.items
            .find((item: { id: string }) => item.id === 'cement')
            .shops.find((shop: { locationId: string }) => shop.locationId === MAIN).quantity,
      );
    expect(await row('keeper')).toBeNull();
    expect(await row('manager')).toBeNull();
    expect(await row('papa')).toBe(100);
    const history = await get('keeper', 'products/cement/movements').expect(200);
    expect(history.body.items).toEqual([]);
    await fill(id, { cement: 100, acc: 100 });
    await post('keeper', `stock/counts/${id}/submit`).expect(201);
    expect(await row('keeper')).toBe(100);
  });
  it('one count at a time at a shop, even if two start together', async () => {
    const results = await Promise.all([
      post('keeper', 'stock/counts', { locationId: MAIN }),
      post('manager', 'stock/counts', { locationId: MAIN }),
    ]);
    expect(results.map((result) => result.status).sort()).toEqual([201, 409]);
    await post('keeperb', 'stock/counts', { locationId: SECOND }).expect(201);
  });
  it('leaves out goods that are switched on and off rather than counted', async () => {
    const id = await startCount();
    const { body } = await get('keeper', `stock/counts/${id}`);
    expect(body.lines.map((line: { productId: string }) => line.productId).sort()).toEqual([
      'acc',
      'cement',
    ]);
    await post('manager', 'stock/counts', {
      locationId: SECOND,
      productIds: ['sand'],
    }).expect(403);
    await post('managerb', 'stock/counts', { locationId: SECOND, productIds: ['sand'] }).expect(
      400,
    );
  });
  it('can be for a chosen few', async () => {
    const id = await startCount(MAIN, 'keeper', { productIds: ['cement'] });
    await fill(id, { cement: 100 });
    await put('keeper', `stock/counts/${id}/lines`, { productId: 'acc', countedQty: 5 }).expect(
      404,
    );
    expect((await post('keeper', `stock/counts/${id}/submit`).expect(201)).body.status).toBe(
      'APPROVED',
    );
  });
  it('another shop’s people, and those who do not count, are refused', async () => {
    const id = await startCount();
    await put('keeperb', `stock/counts/${id}/lines`, { productId: 'cement', countedQty: 1 }).expect(
      403,
    );
    await put('cashier', `stock/counts/${id}/lines`, { productId: 'cement', countedQty: 1 }).expect(
      403,
    );
    await post('keeperb', `stock/counts/${id}/submit`).expect(403);
    await get('keeperb', `stock/counts/${id}`).expect(403);
    await post('cashier', 'stock/counts', { locationId: SECOND }).expect(403);
    await put('keeper', `stock/counts/${id}/lines`, { productId: 'cement', countedQty: -1 }).expect(
      400,
    );
  });
  it('must be finished before it is sent', async () => {
    const id = await startCount();
    await fill(id, { cement: 100 });
    const { status, body } = await post('keeper', `stock/counts/${id}/submit`);
    expect(status).toBe(409);
    expect(body.error.code).toBe('COUNT_NOT_FINISHED');
  });
  it('with no difference closes itself and marks the shelf counted', async () => {
    const id = await startCount();
    await fill(id, { cement: 100, acc: 100 });
    expect((await post('keeper', `stock/counts/${id}/submit`).expect(201)).body.status).toBe(
      'APPROVED',
    );
    expect(await pending()).toEqual([]);
    expect(await db.inventoryMovement.count()).toBe(0);
    const level = await db.stockLevel.findUniqueOrThrow({
      where: { productId_locationId: { productId: 'cement', locationId: MAIN } },
    });
    expect(level.countedAt).not.toBeNull();
    await put('keeper', `stock/counts/${id}/lines`, { productId: 'cement', countedQty: 1 }).expect(
      409,
    );
  });
  it('only an owner’s approval writes a correction', async () => {
    const id = await startCount();
    await fill(id, { cement: 95, acc: 102 });
    expect((await post('keeper', `stock/counts/${id}/submit`).expect(201)).body.status).toBe(
      'SUBMITTED',
    );
    expect(await levelAt(MAIN)).toBe(100);
    const [ask] = await pending('COUNT_CORRECTION');
    expect(ask!.amountPaise).toBe(7 * 40000);
    await decide(ask!.id, 'APPROVE', 'manager').expect(403);
    await decide(ask!.id, 'APPROVE').expect(201);
    expect(await levelAt(MAIN)).toBe(95);
    expect(await levelAt(MAIN, 'acc')).toBe(102);
    const moves = await db.inventoryMovement.findMany({ where: { reference: id } });
    expect(moves.map((move) => [move.kind, move.quantity]).sort()).toEqual([
      ['MANUAL_ADJUSTMENT', -5],
      ['MANUAL_ADJUSTMENT', 2],
    ]);
    expect((await db.stockCount.findUniqueOrThrow({ where: { id } })).status).toBe('APPROVED');
  });
  it('an owner can ask for it to be counted again, changing nothing', async () => {
    const id = await startCount();
    await fill(id, { cement: 95, acc: 100 });
    await post('keeper', `stock/counts/${id}/submit`).expect(201);
    const [ask] = await pending('COUNT_CORRECTION');
    await decide(ask!.id, 'REJECT').expect(201);
    expect(await levelAt(MAIN)).toBe(100);
    expect((await db.stockCount.findUniqueOrThrow({ where: { id } })).status).toBe('RECOUNT');
    await startCount(MAIN, 'manager');
  });
  it('someone who counted cannot approve their own count, even an owner', async () => {
    const id = await startCount(MAIN, 'papa');
    await fill(id, { cement: 95, acc: 100 }, 'papa');
    await post('papa', `stock/counts/${id}/submit`).expect(201);
    const [ask] = await pending('COUNT_CORRECTION');
    const { status, body } = await decide(ask!.id, 'APPROVE', 'papa');
    expect(status).toBe(403);
    expect(body.error.code).toBe('OWN_REQUEST');
    await decide(ask!.id, 'APPROVE', 'chacha').expect(201);
    expect(await levelAt(MAIN)).toBe(95);
  });
  it('compares against goods promised to orders that are still in the yard', async () => {
    await db.order.create({
      data: {
        id: 'held',
        number: 'SC-HELD',
        userId: 'customer',
        reviewId: await sampleReview(),
        idempotencyKey: randomUUID(),
        status: 'CONFIRMED',
        address: {},
        deliveryDate: istToday(),
        notes: '',
        subtotalPaise: 400000,
        deliveryFeePaise: 0,
        totalPaise: 400000,
        locationId: MAIN,
        items: {
          create: {
            productId: 'cement',
            name: 'cement',
            unit: 'bag',
            quantity: 10,
            pricePaise: 40000,
            listPricePaise: 40000,
            priceVersion: 1,
            lineTotalPaise: 400000,
          },
        },
      },
    });
    await db.stockLevel.update({
      where: { productId_locationId: { productId: 'cement', locationId: MAIN } },
      data: { quantity: 90 },
    });
    const id = await startCount();
    await fill(id, { cement: 100, acc: 100 });
    // 90 available and 10 promised: the heap of 100 is right, and no difference appears.
    expect((await post('keeper', `stock/counts/${id}/submit`).expect(201)).body.status).toBe(
      'APPROVED',
    );
  });
  it('a correction that can no longer be applied stays waiting, with nothing half done', async () => {
    const id = await startCount();
    await fill(id, { cement: 10, acc: 90 });
    await post('keeper', `stock/counts/${id}/submit`).expect(201);
    const [ask] = await pending('COUNT_CORRECTION');
    // Goods sold since leave less on the shelf than the correction would take away.
    await db.stockLevel.update({
      where: { productId_locationId: { productId: 'cement', locationId: MAIN } },
      data: { quantity: 20 },
    });
    await decide(ask!.id, 'APPROVE').expect(409);
    expect((await db.approvalRequest.findUniqueOrThrow({ where: { id: ask!.id } })).status).toBe(
      'PENDING',
    );
    expect(await levelAt(MAIN, 'acc')).toBe(100);
  });
});

async function sampleReview() {
  const review = await db.checkoutReview.create({
    data: { userId: 'customer', snapshot: {}, expiresAt: new Date(Date.now() + 60000) },
  });
  return review.id;
}

describe('the opening count', () => {
  it('always needs an owner, starts the shop’s stock, and starts its clean days', async () => {
    const before = (await get('papa', 'stock').expect(200)).body.shops.find(
      (shop: { id: string }) => shop.id === SECOND,
    );
    expect(before.cleanDays).toBeNull();
    const id = await startCount(SECOND, 'keeperb', { opening: true });
    await fill(id, { cement: 0, acc: 0 }, 'keeperb');
    await post('keeperb', `stock/counts/${id}/submit`).expect(201);
    expect(
      (await db.location.findUniqueOrThrow({ where: { id: SECOND } })).stockStartedAt,
    ).toBeNull();
    const [ask] = await pending('COUNT_CORRECTION');
    await decide(ask!.id, 'APPROVE').expect(201);
    const shop = await db.location.findUniqueOrThrow({ where: { id: SECOND } });
    expect(shop.stockStartedAt).not.toBeNull();
    const after = (await get('papa', 'stock').expect(200)).body.shops.find(
      (row: { id: string }) => row.id === SECOND,
    );
    expect(after.cleanDays).toBe(0);
  });
  it('records its differences as an opening count', async () => {
    const id = await startCount(SECOND, 'keeperb', { opening: true });
    await fill(id, { cement: 40, acc: 0 }, 'keeperb');
    await post('keeperb', `stock/counts/${id}/submit`).expect(201);
    const [ask] = await pending('COUNT_CORRECTION');
    await decide(ask!.id, 'APPROVE').expect(201);
    expect(await levelAt(SECOND)).toBe(40);
    expect(await db.inventoryMovement.count({ where: { kind: 'OPENING_COUNT' } })).toBe(1);
  });
  it('counts clean days from the last correction, in shop days', async () => {
    const shop = await db.location.update({
      where: { id: SECOND },
      data: { stockStartedAt: new Date(Date.now() - 9 * 86400000) },
    });
    const clean = async () =>
      (await get('papa', 'stock').expect(200)).body.shops.find(
        (row: { id: string }) => row.id === shop.id,
      ).cleanDays;
    expect(await clean()).toBe(9);
    const id = await startCount(SECOND, 'keeperb');
    await fill(id, { cement: 1, acc: 0 }, 'keeperb');
    await post('keeperb', `stock/counts/${id}/submit`).expect(201);
    const [ask] = await pending('COUNT_CORRECTION');
    await decide(ask!.id, 'APPROVE').expect(201);
    expect(await clean()).toBe(0);
  });
});

describe('Manzoori', () => {
  const damage = (who = 'keeper', rest: object = {}) =>
    post(who, 'stock/damage', {
      locationId: MAIN,
      productId: 'cement',
      quantity: 3,
      note: 'Bheeg gaya, private words',
      idempotencyKey: randomUUID(),
      ...rest,
    });
  it('damage is only reported until an owner agrees', async () => {
    const { body } = await damage().expect(201);
    expect(await levelAt(MAIN)).toBe(100);
    expect(body).toMatchObject({ kind: 'STOCK_DAMAGE', status: 'PENDING' });
    expect(body).not.toHaveProperty('amountPaise');
    expect(
      (await db.approvalRequest.findUniqueOrThrow({ where: { id: body.id } })).amountPaise,
    ).toBe(120000);
    await decide(body.id, 'APPROVE').expect(201);
    expect(await levelAt(MAIN)).toBe(97);
    const [move] = await db.inventoryMovement.findMany({ where: { kind: 'DAMAGE' } });
    expect(move).toMatchObject({ quantity: -3, actorId: 'papa', reference: body.id });
  });
  it('refusing changes nothing', async () => {
    const { body } = await damage().expect(201);
    await decide(body.id, 'REJECT').expect(201);
    expect(await levelAt(MAIN)).toBe(100);
    expect((await db.approvalRequest.findUniqueOrThrow({ where: { id: body.id } })).status).toBe(
      'REJECTED',
    );
  });
  it('tells the owners on their phones, in plain words and none of what was typed', async () => {
    await damage('papa').expect(201);
    const notes = await db.notification.findMany();
    expect(notes.map((note) => note.userId)).toEqual(['chacha']);
    expect(JSON.stringify(notes)).not.toContain('private words');
    expect(notes[0]!.dedupeKey).toMatch(/^approval:/);
  });
  it('only an owner decides, once', async () => {
    const { body } = await damage().expect(201);
    for (const who of ['manager', 'cashier', 'keeper', 'accountant', 'tech', 'customer'])
      await decide(body.id, 'APPROVE', who).expect(403);
    await post('papa', `approvals/${body.id}/decide`, { decision: 'MAYBE' }).expect(400);
    await post('papa', `approvals/${body.id}/decide`, {
      decision: 'APPROVE',
      amountPaise: 1,
    }).expect(400);
    await decide('nope', 'APPROVE').expect(404);
    await decide(body.id, 'APPROVE').expect(201);
    const again = await decide(body.id, 'APPROVE', 'chacha');
    expect(again.status).toBe(409);
    expect(again.body.error.code).toBe('ALREADY_DECIDED');
    expect(await levelAt(MAIN)).toBe(97);
  });
  it('two owners deciding at once: one wins, and it applies once', async () => {
    const { body } = await damage().expect(201);
    const results = await Promise.all([
      decide(body.id, 'APPROVE', 'papa'),
      decide(body.id, 'APPROVE', 'chacha'),
    ]);
    expect(results.map((result) => result.status).sort()).toEqual([201, 409]);
    expect(await levelAt(MAIN)).toBe(97);
  });
  it('the database itself refuses someone approving their own request', async () => {
    const { body } = await damage('papa').expect(201);
    await expect(
      db.approvalRequest.update({ where: { id: body.id }, data: { decidedById: 'papa' } }),
    ).rejects.toThrow();
  });
  it('those who ask see their own, and owners see all', async () => {
    await damage('keeper').expect(201);
    await damage('manager').expect(201);
    const list = (who: string) => get(who, 'approvals').then((r) => r.body.items);
    expect(await list('keeper')).toHaveLength(1);
    expect(await list('manager')).toHaveLength(1);
    const all = await list('papa');
    expect(all).toHaveLength(2);
    expect(all[0].canDecide).toBe(true);
    expect((await list('keeper'))[0].canDecide).toBe(false);
    await get('accountant', 'approvals').expect(403);
    await get('tech', 'approvals').expect(403);
  });
  it('a report’s key cannot be used for something else', async () => {
    const key = randomUUID();
    const first = await damage('keeper', { idempotencyKey: key }).expect(201);
    const again = await damage('keeper', { idempotencyKey: key }).expect(201);
    expect(again.body.id).toBe(first.body.id);
    await damage('manager', { idempotencyKey: key }).expect(409);
    expect(await db.approvalRequest.count()).toBe(1);
  });
  it('someone at another shop cannot report here, and nonsense is refused', async () => {
    await damage('keeperb').expect(403);
    await damage('cashier').expect(403);
    await damage('keeper', { productId: 'nope' }).expect(404);
    await damage('keeper', { quantity: 0 }).expect(400);
    await damage('keeper', { note: '' }).expect(400);
  });
});

describe('an order beyond someone’s limit', () => {
  const below = { lines: [{ productId: 'cement', quantity: 10, pricePaise: 30000 }] };
  const ask = (id: string, version: number, who = 'manager') =>
    post(who, `orders/${id}/ask-owner`, {
      expectedVersion: version,
      changes: below,
      idempotencyKey: randomUUID(),
    });
  it('asks an owner, and the order keeps waiting', async () => {
    const order = await waitingOrder();
    const refused = await post('manager', `orders/${order.id}/confirm`, {
      expectedVersion: order.version,
      decisionKey: randomUUID(),
      changes: below,
    });
    expect(refused.body.error.code).toBe('RATE_CAP');
    const { body } = await ask(order.id, order.version).expect(201);
    expect(body).toMatchObject({ kind: 'ORDER_CONFIRM', status: 'PENDING' });
    expect((await db.order.findUniqueOrThrow({ where: { id: order.id } })).status).toBe(
      'AWAITING_CONFIRMATION',
    );
  });
  it('an owner’s yes confirms it with those changes, in the owner’s name', async () => {
    const order = await waitingOrder();
    const { body } = await ask(order.id, order.version).expect(201);
    await decide(body.id, 'APPROVE').expect(201);
    const after = await db.order.findUniqueOrThrow({
      where: { id: order.id },
      include: { items: true },
    });
    expect(after).toMatchObject({ status: 'CONFIRMED', confirmedById: 'papa' });
    expect(after.items[0]).toMatchObject({ pricePaise: 30000, listPricePaise: 40000 });
  });
  it('an owner’s no leaves it waiting, as it was', async () => {
    const order = await waitingOrder();
    const { body } = await ask(order.id, order.version).expect(201);
    await decide(body.id, 'REJECT').expect(201);
    const after = await db.order.findUniqueOrThrow({
      where: { id: order.id },
      include: { items: true },
    });
    expect(after.status).toBe('AWAITING_CONFIRMATION');
    expect(after.items[0]!.pricePaise).toBe(40000);
  });
  it('a yes on an order that has since changed is refused, and stays to be looked at', async () => {
    const order = await waitingOrder();
    const { body } = await ask(order.id, order.version).expect(201);
    await db.order.update({ where: { id: order.id }, data: { version: { increment: 1 } } });
    await decide(body.id, 'APPROVE').expect(409);
    expect((await db.approvalRequest.findUniqueOrThrow({ where: { id: body.id } })).status).toBe(
      'PENDING',
    );
  });
  it('cannot be asked on an order already moved on, or by someone at another shop', async () => {
    const order = await waitingOrder();
    await ask(order.id, order.version + 5).expect(409);
    await ask(order.id, order.version, 'managerb').expect(403);
    await ask(order.id, order.version, 'keeper').expect(403);
    await ask(order.id, order.version, 'customer').expect(403);
    await ask('nope', 1, 'papa').expect(404);
  });
});

describe('Galla', () => {
  const today = () => istToday();
  const dayBefore = (days: number) => istToday(new Date(Date.now() - days * 86400000));
  const sheet = (who = 'cashier', locationId = MAIN, day = today()) =>
    get(who, `galla?locationId=${locationId}&day=${day}`);
  const money = (
    kind: string,
    amountPaise: number,
    channel = 'CASH',
    occurredAt = new Date(),
    locationId = MAIN,
  ) =>
    db.financialMovement.create({
      data: { kind, amountPaise, channel, occurredAt, locationId, actorId: 'cashier' },
    });
  const paid = (kind: 'PAID_IN' | 'PAID_OUT', amountPaise: number, who = 'cashier') =>
    post(who, 'galla/entries', {
      locationId: MAIN,
      kind,
      amountPaise,
      reason: 'Chai',
      idempotencyKey: randomUUID(),
    });
  const close = (countedPaise: number, rest: object = {}, who = 'cashier') =>
    post(who, 'galla/close', { locationId: MAIN, day: today(), countedPaise, ...rest });

  it('works out what should be in the drawer from what is on record', async () => {
    await money('COUNTER_SALE', 500000);
    await money('COLLECTION', 200000);
    await money('COLLECTION', 900000, 'UPI');
    await money('KHATA_PAYMENT', 100000);
    await money('KHATA_PAYMENT', 300000, 'UPI');
    await money('KHATA_PAYMENT_REVERSAL', 20000);
    await money('REFUND', 50000);
    await money('REFUND', 10000, 'UPI');
    await paid('PAID_OUT', 30000).expect(201);
    await paid('PAID_IN', 10000).expect(201);
    const { body } = await sheet().expect(200);
    expect(body).toMatchObject({
      opening: 0,
      sales: 700000,
      udhaar: 80000,
      refunds: 50000,
      paidIn: 10000,
      paidOut: 30000,
      expectedPaise: 710000,
      close: null,
    });
    expect(body.entries).toHaveLength(2);
  });
  it('counts only this shop, and only this day in India', async () => {
    const dayStart = new Date(`${today()}T00:00:00+05:30`);
    await money('COUNTER_SALE', 100, 'CASH', new Date(dayStart.getTime() - 1000));
    await money('COUNTER_SALE', 200, 'CASH', new Date(dayStart.getTime() + 1000));
    await money('COUNTER_SALE', 400, 'CASH', new Date(dayStart.getTime() + 1000), SECOND);
    expect((await sheet().expect(200)).body.sales).toBe(200);
  });
  it('a matching close needs no reason, and a difference needs one', async () => {
    await money('COUNTER_SALE', 500000);
    const short = await close(470000);
    expect(short.status).toBe(400);
    expect(short.body.error.code).toBe('REASON_NEEDED');
    const { body } = await close(470000, { reason: 'Note fat gaya' }).expect(201);
    expect(body).toMatchObject({ expectedPaise: 500000, differencePaise: -30000 });
    const after = (await sheet().expect(200)).body;
    expect(after.close).toMatchObject({ differencePaise: -30000, reason: 'Note fat gaya' });
  });
  it('the expected figure is the server’s, never what is sent', async () => {
    await close(0, { expectedPaise: 0 }).expect(400);
    await close(0, { differencePaise: 0 }).expect(400);
    await close(-5, {}).expect(400);
  });
  it('a closed day stays closed: corrections are a new row, and the old one stays', async () => {
    await money('COUNTER_SALE', 500000);
    const first = await close(500000).expect(201);
    await close(500000).expect(409);
    await paid('PAID_OUT', 100).expect(409);
    await close(490000, { supersedesId: first.body.id }, 'manager').expect(400);
    const fixed = await close(
      490000,
      { supersedesId: first.body.id, reason: 'Galat gina' },
      'manager',
    ).expect(201);
    expect((await sheet().expect(200)).body.close.id).toBe(fixed.body.id);
    expect(await db.dayClose.count()).toBe(2);
    await close(1, { supersedesId: first.body.id, reason: 'Phir se' }, 'manager').expect(409);
  });
  it('tomorrow starts from what was really counted', async () => {
    const yesterday = new Date(Date.now() - 86400000 + 19800000).toISOString().slice(0, 10);
    const first = await post('cashier', 'galla/close', {
      locationId: MAIN,
      day: yesterday,
      countedPaise: 0,
    });
    expect(first.status).toBe(201);
    await post('manager', 'galla/close', {
      locationId: MAIN,
      day: yesterday,
      countedPaise: 250000,
      supersedesId: first.body.id,
      reason: 'Phir se gina',
    }).expect(201);
    expect((await sheet().expect(200)).body.opening).toBe(250000);
  });
  it('a receipt dated to a closed day still reaches a drawer', async () => {
    const yesterday = dayBefore(1);
    await post('cashier', 'galla/close', {
      locationId: MAIN,
      day: yesterday,
      countedPaise: 0,
    }).expect(201);
    await post('cashier', 'customers/customer/khata/payment', {
      amountPaise: 70000,
      occurredAt: yesterday,
      channel: 'CASH',
      note: 'Purana hisab',
      idempotencyKey: randomUUID(),
    }).expect(201);
    expect((await sheet().expect(200)).body.udhaar).toBe(70000);
    // The customer's ledger still says when it was really paid.
    const [entry] = await db.customerLedgerEntry.findMany({ where: { customerId: 'customer' } });
    expect(entry!.occurredAt.toISOString()).toBe(
      new Date(`${yesterday}T00:00:00+05:30`).toISOString(),
    );
  });
  it('a UPI receipt is not cash in any drawer', async () => {
    await post('cashier', 'customers/customer/khata/payment', {
      amountPaise: 70000,
      channel: 'UPI',
      note: 'UPI se',
      idempotencyKey: randomUUID(),
    }).expect(201);
    expect((await sheet().expect(200)).body.udhaar).toBe(0);
  });
  it('cash taken after an early close is in the next sheet, not lost', async () => {
    const yesterday = dayBefore(1);
    const endedAt = new Date(`${yesterday}T17:00:00+05:30`);
    await db.dayClose.create({
      data: {
        locationId: MAIN,
        day: yesterday,
        expectedPaise: 100000,
        countedPaise: 100000,
        differencePaise: 0,
        reason: '',
        closedById: 'cashier',
        createdAt: endedAt,
      },
    });
    await money('COUNTER_SALE', 11000, 'CASH', new Date(`${yesterday}T16:59:00+05:30`));
    await money('COUNTER_SALE', 22000, 'CASH', new Date(`${yesterday}T18:00:00+05:30`));
    const { body } = await sheet().expect(200);
    expect(body).toMatchObject({ opening: 100000, sales: 22000, expectedPaise: 122000 });
    // Before the close counts where it was, and what came after does not reopen it.
    expect((await sheet('cashier', MAIN, yesterday).expect(200)).body.sales).toBe(11000);
  });
  it('cash on a day nobody closed reaches the next close', async () => {
    const twoAgo = dayBefore(2);
    const yesterday = dayBefore(1);
    await post('cashier', 'galla/close', { locationId: MAIN, day: twoAgo, countedPaise: 0 }).expect(
      201,
    );
    await money('COUNTER_SALE', 33000, 'CASH', new Date(`${yesterday}T11:00:00+05:30`));
    await money('COUNTER_SALE', 44000, 'CASH');
    const { body } = await sheet().expect(200);
    expect(body).toMatchObject({ sales: 77000, expectedPaise: 77000, carried: true });
  });
  it('an earlier day cannot be closed behind a later one', async () => {
    await post('cashier', 'galla/close', {
      locationId: MAIN,
      day: today(),
      countedPaise: 0,
    }).expect(201);
    const late = await post('cashier', 'galla/close', {
      locationId: MAIN,
      day: dayBefore(1),
      countedPaise: 0,
    }).expect(409);
    expect(late.body.error.code).toBe('DAY_ORDER');
  });
  it('nobody fixes their own shortage, and what was replaced stays in view', async () => {
    await money('COUNTER_SALE', 500000);
    const first = await close(450000, { reason: 'Kam nikla' }).expect(201);
    const own = await close(500000, { supersedesId: first.body.id, reason: 'Sahi kiya' });
    expect(own.status).toBe(403);
    expect(own.body.error.code).toBe('SAME_PERSON');
    expect((await sheet('cashier').expect(200)).body.close.canCorrect).toBe(false);
    expect((await sheet('manager').expect(200)).body.close.canCorrect).toBe(true);
    await close(500000, { supersedesId: first.body.id, reason: 'Dobara gina' }, 'manager').expect(
      201,
    );
    const { body } = await sheet('cashier').expect(200);
    expect(body.close.differencePaise).toBe(0);
    expect(body.history).toEqual([
      expect.objectContaining({
        countedPaise: 450000,
        differencePaise: -50000,
        reason: 'Kam nikla',
        closedByName: 'cashier',
      }),
    ]);
  });
  it('the record cannot be changed or removed, even in the database', async () => {
    const { body } = await close(0).expect(201);
    await expect(
      db.dayClose.update({ where: { id: body.id }, data: { reason: 'x' } }),
    ).rejects.toThrow();
    await expect(db.dayClose.delete({ where: { id: body.id } })).rejects.toThrow();
    const entry = await paid('PAID_OUT', 100, 'manager');
    expect(entry.status).toBe(409);
  });
  it('who may see and do what', async () => {
    await sheet('cashier', SECOND).expect(403);
    await sheet('keeper').expect(403);
    await sheet('tech').expect(403);
    await sheet('customer').expect(403);
    await sheet('accountant').expect(200);
    await close(0, {}, 'accountant').expect(403);
    await close(0, {}, 'cashierb').expect(403);
    await paid('PAID_OUT', 100, 'accountant').expect(403);
    await paid('PAID_OUT', 100, 'keeper').expect(403);
  });
  it('refuses a future day and nonsense', async () => {
    const next = new Date(Date.now() + 3 * 86400000).toISOString().slice(0, 10);
    await sheet('cashier', MAIN, next).expect(400);
    await sheet('cashier', MAIN, 'yesterday').expect(400);
    await close(0, { day: next }).expect(400);
    await paid('PAID_OUT', 0).expect(400);
    await post('cashier', 'galla/entries', {
      locationId: MAIN,
      kind: 'STOLEN',
      amountPaise: 100,
      reason: 'x',
      idempotencyKey: randomUUID(),
    }).expect(400);
  });
  it('the same tap twice pays out once', async () => {
    const key = randomUUID();
    const entry = {
      locationId: MAIN,
      kind: 'PAID_OUT',
      amountPaise: 100,
      reason: 'Chai',
      idempotencyKey: key,
    };
    await post('cashier', 'galla/entries', entry).expect(201);
    await post('cashier', 'galla/entries', entry).expect(201);
    expect((await sheet().expect(200)).body.paidOut).toBe(100);
    await post('cashier', 'galla/entries', { ...entry, amountPaise: 999 }).expect(409);
    await post('manager', 'galla/entries', entry).expect(409);
  });
});

describe('the book figure stays out of sight during a count', () => {
  const low = () =>
    db.stockLevel.updateMany({ where: { productId: 'cement' }, data: { lowStockAt: 100000 } });
  const productOf = async (who: string) =>
    (await get(who, 'products').expect(200)).body.items.find(
      (item: { id: string }) => item.id === 'cement',
    );
  it('the public catalogue, one product and the cart all stop showing it, then show it again', async () => {
    const id = await startCount();
    const list = await request(server).get('/api/v1/products').expect(200);
    const row = list.body.items.find((item: { id: string }) => item.id === 'cement');
    expect(row.stock).toBe(stockDuringCount);
    expect(row.availability).toBe('IN_STOCK');
    expect((await request(server).get('/api/v1/products/cement').expect(200)).body.stock).toBe(
      stockDuringCount,
    );
    const headers = as('customer');
    await request(server)
      .put('/api/v1/cart/items')
      .set(headers)
      .send({ productId: 'cement', quantity: 2 })
      .expect(200);
    const cart = await request(server).get('/api/v1/cart').set(headers).expect(200);
    expect(cart.body[0].product.stock).toBe(stockDuringCount);
    // Goods that have run out still say so, and buying still checks the real figure.
    await request(server)
      .put('/api/v1/cart/items')
      .set(headers)
      .send({ productId: 'cement', quantity: 101 })
      .expect(409);
    await fill(id, { cement: 100, acc: 100 });
    await post('keeper', `stock/counts/${id}/submit`).expect(201);
    expect((await request(server).get('/api/v1/products/cement').expect(200)).body.stock).toBe(100);
  });
  it('the staff product list hides it from those counting, and not from owners', async () => {
    await startCount();
    const blind = await productOf('keeper');
    expect(blind.stock).toBeNull();
    expect(blind.stockHidden).toBe(true);
    expect(blind.stockLevels[0].quantity).toBeNull();
    expect((await productOf('manager')).stock).toBeNull();
    // Someone across all shops still sees the shops not being counted, here none hold any.
    expect((await productOf('accountant')).stock).toBeNull();
    expect((await productOf('papa')).stock).toBe(100);
    // The other shop's people lose nothing: the count is not theirs.
    await send('keeper', 0).expect(400);
    expect((await productOf('keeperb')).stockHidden).toBe(false);
  });
  it('the running-low list shows each person their own shop, and nothing while counted', async () => {
    const { body } = await send('keeper', 30).expect(201);
    await post('keeperb', `stock/transfers/${body.id}/receive`, {
      lines: [{ productId: 'cement', receivedQty: 30 }],
    }).expect(201);
    await low();
    const lowAt = async (who: string) => (await get(who, 'dashboard').expect(200)).body.lowStock;
    const before = await lowAt('managerb');
    expect(before).toEqual([expect.objectContaining({ id: 'cement', stock: 30 })]);
    await startCount();
    expect(await lowAt('manager')).toEqual([]);
    expect(await lowAt('managerb')).toEqual([expect.objectContaining({ stock: 30 })]);
  });
  it('an order card, a preview and a refusal keep it back from a manager, not from an owner', async () => {
    const order = await waitingOrder();
    await startCount(MAIN, 'manager');
    const stockHere = async (who: string) =>
      (await get(who, 'inbox').expect(200)).body.items[0].lines[0].stockHere;
    expect(await stockHere('manager')).toBeNull();
    expect(await stockHere('papa')).toBe(90);
    const changes = { lines: [{ productId: 'cement', quantity: 200 }] };
    const preview = (who: string) =>
      post(who, `orders/${order.id}/preview`, { decision: 'CONFIRM', changes }).expect(201);
    expect((await preview('manager')).body.short[0]).toMatchObject({ have: null, need: 190 });
    expect((await preview('papa')).body.short[0]).toMatchObject({ have: 90, need: 190 });
    const refused = await post('manager', `orders/${order.id}/confirm`, {
      expectedVersion: order.version,
      decisionKey: randomUUID(),
      changes,
    }).expect(409);
    expect(refused.body.error.code).toBe('STOCK_SHORT');
    expect(refused.body.error.details).not.toHaveProperty('have');
  });
  it('goods can come in during a count, without the answer saying what the book now reads', async () => {
    const receive = (who: string) =>
      post(who, 'products/cement/movements', {
        kind: 'PURCHASE_IN',
        quantity: 5,
        note: 'Truck',
        reference: 'T1',
        locationId: MAIN,
        idempotencyKey: randomUUID(),
      }).expect(201);
    expect((await receive('keeper')).body.balanceAfter).toBe(105);
    await startCount();
    expect((await receive('keeper')).body).not.toHaveProperty('balanceAfter');
    expect((await receive('papa')).body.balanceAfter).toBe(115);
  });
});

describe('a count cannot be beaten by counting again', () => {
  const figure = async (who: string) =>
    (await get(who, 'stock').expect(200)).body.items
      .find((item: { id: string }) => item.id === 'cement')
      .shops.find((shop: { locationId: string }) => shop.locationId === MAIN).quantity;
  async function sentBack() {
    const id = await startCount();
    await fill(id, { cement: 0, acc: 0 });
    await post('keeper', `stock/counts/${id}/submit`).expect(201);
    const [asked] = await pending('COUNT_CORRECTION');
    return { id, asked: asked! };
  }
  it('sending zeros teaches the counter nothing, while it waits or after', async () => {
    const { asked } = await sentBack();
    const mine = await get('keeper', 'approvals').expect(200);
    const row = mine.body.items.find((item: { id: string }) => item.id === asked.id);
    expect(row.detail).toBeNull();
    expect(row.amountPaise).toBeNull();
    expect(JSON.stringify(mine.body)).not.toContain('"system"');
    expect(await figure('keeper')).toBeNull();
    const manager = await get('manager', 'approvals').expect(200);
    expect(JSON.stringify(manager.body)).not.toContain(asked.id);
    await decide(asked.id, 'REJECT').expect(201);
    expect(await figure('keeper')).toBeNull();
    expect(await figure('manager')).toBeNull();
    expect(await figure('papa')).toBe(100);
  });
  it('the owner still sees everything to decide with', async () => {
    const { asked } = await sentBack();
    const { body } = await get('papa', 'approvals').expect(200);
    const row = body.items.find((item: { id: string }) => item.id === asked.id);
    expect(row.amountPaise).toBe(8000000);
    expect(row.detail.lines).toContainEqual(
      expect.objectContaining({ name: 'cement', system: 100, counted: 0, difference: -100 }),
    );
  });
  it('the same person cannot be the one to count again, in any step', async () => {
    const { asked } = await sentBack();
    await decide(asked.id, 'REJECT').expect(201);
    const started = await post('keeper', 'stock/counts', { locationId: MAIN }).expect(403);
    expect(started.body.error.code).toBe('RECOUNT_SOMEONE_ELSE');
    const again = await startCount(MAIN, 'manager');
    const typed = await put('keeper', `stock/counts/${again}/lines`, {
      productId: 'cement',
      countedQty: 100,
    }).expect(403);
    expect(typed.body.error.code).toBe('RECOUNT_SOMEONE_ELSE');
    await fill(again, { cement: 100, acc: 100 }, 'manager');
    await post('keeper', `stock/counts/${again}/submit`).expect(403);
    await post('manager', `stock/counts/${again}/submit`).expect(201);
    // A second person's clean count settles it, and the figure comes back.
    expect(await figure('keeper')).toBe(100);
  });
  it('after that, the first person can count again another day', async () => {
    const { asked } = await sentBack();
    await decide(asked.id, 'REJECT').expect(201);
    const again = await startCount(MAIN, 'manager');
    await fill(again, { cement: 100, acc: 100 }, 'manager');
    await post('manager', `stock/counts/${again}/submit`).expect(201);
    await startCount();
  });
});

describe('a count taken while the shop keeps selling', () => {
  const sell = (quantity: number) =>
    post('cashier', 'products/cement/movements', {
      kind: 'WALK_IN_SALE',
      quantity,
      note: 'Counter',
      reference: '',
      locationId: MAIN,
      channel: 'CASH',
      idempotencyKey: randomUUID(),
    }).expect(201);
  it('a sale after a line was counted is not a surplus', async () => {
    const id = await startCount();
    await fill(id, { cement: 100, acc: 100 });
    await sell(10);
    expect(await levelAt(MAIN)).toBe(90);
    const { body } = await post('keeper', `stock/counts/${id}/submit`).expect(201);
    expect(body.status).toBe('APPROVED');
    expect(await levelAt(MAIN)).toBe(90);
    expect(await pending('COUNT_CORRECTION')).toEqual([]);
  });
  it('a sale before a line was counted is in the book it is compared with', async () => {
    const id = await startCount();
    await sell(10);
    await fill(id, { cement: 90, acc: 100 });
    expect((await post('keeper', `stock/counts/${id}/submit`).expect(201)).body.status).toBe(
      'APPROVED',
    );
  });
  it('a real difference found is still the difference when an owner approves it later', async () => {
    const id = await startCount();
    await fill(id, { cement: 95, acc: 100 });
    await sell(10);
    await post('keeper', `stock/counts/${id}/submit`).expect(201);
    const [asked] = await pending('COUNT_CORRECTION');
    await decide(asked!.id, 'APPROVE').expect(201);
    expect(await levelAt(MAIN)).toBe(85);
  });
  it('goods a walk-in carried away are not counted as still in the yard', async () => {
    await post('manager', 'orders/phone', {
      source: 'WALK_IN',
      customerPhone: '+919000000701',
      customerName: 'Ramesh',
      items: [{ productId: 'cement', quantity: 10 }],
      deliveryDate: 'today',
      paymentMethod: 'COD',
      idempotencyKey: randomUUID(),
    }).expect(201);
    const id = await startCount();
    await fill(id, { cement: 90, acc: 100 });
    expect((await post('keeper', `stock/counts/${id}/submit`).expect(201)).body.status).toBe(
      'APPROVED',
    );
  });
});

describe('what an owner is told before a yes', () => {
  const askFor = async (order: { id: string; version: number }, changes: object, who = 'manager') =>
    (
      await post(who, `orders/${order.id}/ask-owner`, {
        expectedVersion: order.version,
        changes,
        idempotencyKey: randomUUID(),
      }).expect(201)
    ).body.id as string;
  const card = async (id: string) =>
    (await get('papa', 'approvals').expect(200)).body.items.find(
      (item: { id: string }) => item.id === id,
    ).detail;
  it('every change a yes would make is on the card', async () => {
    const order = await waitingOrder();
    await db.user.update({
      where: { id: 'customer' },
      data: { creditAllowed: true, creditLimitPaise: 100000 },
    });
    const id = await askFor(order, {
      lines: [{ productId: 'cement', quantity: 150, pricePaise: 30000 }],
      stockFixes: ['cement'],
      paymentMethod: 'CREDIT',
      deliveryFeePaise: 0,
      locationId: SECOND,
      reason: 'BIG_ORDER',
    });
    const detail = await card(id);
    expect(detail).toMatchObject({
      number: order.number,
      stillWaiting: true,
      toTotalPaise: 4500000,
      deliveryFee: { from: 50000, to: 0 },
      paymentMethod: { from: 'COD', to: 'CREDIT' },
      shop: { to: 'Second shop' },
      reason: 'BIG_ORDER',
      overLimit: { creditLimitPaise: 100000, exposurePaise: 4500000 },
      creditNotAllowed: false,
    });
    expect(detail.lines[0]).toMatchObject({
      name: 'cement',
      fromQuantity: 10,
      toQuantity: 150,
      fromPricePaise: 40000,
      toPricePaise: 30000,
      listPricePaise: 40000,
      byHand: true,
    });
    expect(detail.stock).toEqual([{ name: 'cement', have: 0, need: 150, fix: true }]);
    // Reading the card changed nothing.
    expect(await levelAt(SECOND)).toBe(0);
  });
  it('a limit passes only when the yes says so, because the card said so', async () => {
    const order = await waitingOrder();
    await db.user.update({
      where: { id: 'customer' },
      data: { creditAllowed: true, creditLimitPaise: 100000 },
    });
    const id = await askFor(order, {
      lines: [{ productId: 'cement', quantity: 10 }],
      paymentMethod: 'CREDIT',
    });
    const plain = await decide(id, 'APPROVE').expect(409);
    expect(plain.body.error.code).toBe('CREDIT_LIMIT_EXCEEDED');
    expect((await db.order.findUniqueOrThrow({ where: { id: order.id } })).status).toBe(
      'AWAITING_CONFIRMATION',
    );
    await post('papa', `approvals/${id}/decide`, {
      decision: 'APPROVE',
      overrideLimit: true,
    }).expect(201);
    expect((await db.order.findUniqueOrThrow({ where: { id: order.id } })).status).toBe(
      'CONFIRMED',
    );
  });
  it('someone who may not have udhaar is said plainly', async () => {
    const order = await waitingOrder();
    const id = await askFor(order, {
      lines: [{ productId: 'cement', quantity: 10 }],
      paymentMethod: 'CREDIT',
    });
    expect((await card(id)).creditNotAllowed).toBe(true);
  });
  it('a short item with no fix asked for is shown as short, and a yes is refused', async () => {
    const order = await waitingOrder();
    const id = await askFor(order, { lines: [{ productId: 'cement', quantity: 500 }] });
    expect((await card(id)).stock).toEqual([{ name: 'cement', have: 90, need: 490, fix: false }]);
    expect((await decide(id, 'APPROVE').expect(409)).body.error.code).toBe('STOCK_SHORT');
    expect(await total()).toBe(90);
  });
  it('those who asked see that it waits, not what the card says', async () => {
    const order = await waitingOrder();
    const id = await askFor(order, { lines: [{ productId: 'cement', quantity: 10 }] });
    const { body } = await get('manager', 'approvals').expect(200);
    expect(body.items.find((item: { id: string }) => item.id === id).detail).toBeNull();
  });
  it('a removed order shows as no longer waiting, rather than breaking the whole list', async () => {
    const order = await waitingOrder();
    const id = await askFor(order, { lines: [{ productId: 'cement', quantity: 10 }] });
    await post('papa', `orders/${order.id}/confirm`, {
      expectedVersion: order.version,
      decisionKey: randomUUID(),
    }).expect(201);
    expect((await card(id)).stillWaiting).toBe(false);
  });
  it('a stock keeper is not given rupees, and a manager is', async () => {
    const { body } = await post('keeper', 'stock/damage', {
      locationId: MAIN,
      productId: 'cement',
      quantity: 3,
      note: 'Bheeg gaya',
      idempotencyKey: randomUUID(),
    }).expect(201);
    const amountFor = async (who: string) =>
      (
        await get(who === 'keeper' ? 'keeper' : who, 'approvals?status=all').expect(200)
      ).body.items.find((item: { id: string }) => item.id === body.id)?.amountPaise;
    expect(await amountFor('keeper')).toBeNull();
    expect(await amountFor('papa')).toBe(120000);
  });
  it('a very valuable difference still reaches an owner', async () => {
    await db.product.update({ where: { id: 'cement' }, data: { pricePaise: 100_000_000 } });
    const { body } = await post('keeper', 'stock/damage', {
      locationId: MAIN,
      productId: 'cement',
      quantity: 100,
      note: 'Sab bheeg gaya',
      idempotencyKey: randomUUID(),
    }).expect(201);
    expect(
      (await db.approvalRequest.findUniqueOrThrow({ where: { id: body.id } })).amountPaise,
    ).toBe(2_147_483_647);
  });
  it('open screens hear about a decision at once', async () => {
    const seen = vi.spyOn(app.get(Events), 'publish');
    const { body } = await post('keeper', 'stock/damage', {
      locationId: MAIN,
      productId: 'cement',
      quantity: 1,
      note: 'Phat gaya',
      idempotencyKey: randomUUID(),
    }).expect(201);
    seen.mockClear();
    await decide(body.id, 'APPROVE').expect(201);
    expect(seen).toHaveBeenCalledWith(expect.objectContaining({ type: 'CATALOG_UPDATED' }));
    seen.mockRestore();
  });
});

describe('a shop cannot be closed with work still open', () => {
  const THIRD = 'loc_ops_c';
  const closeShop = () =>
    request(server)
      .patch(`/api/v1/admin/locations/${THIRD}`)
      .set(as('papa'))
      .send({ active: false });
  beforeEach(async () => {
    await db.location.upsert({
      where: { id: THIRD },
      update: { active: true },
      create: { id: THIRD, firmId: 'firm_main', slug: 'ops-third-shop', name: 'Third shop' },
    });
  });
  it('goods on the road would have nowhere to arrive', async () => {
    const { body } = await post('papa', 'stock/transfers', {
      fromLocationId: MAIN,
      toLocationId: THIRD,
      lines: [{ productId: 'cement', quantity: 5 }],
      idempotencyKey: randomUUID(),
    }).expect(201);
    expect((await closeShop().expect(409)).body.error.code).toBe('SHOP_IN_USE');
    await post('chacha', `stock/transfers/${body.id}/receive`, {
      lines: [{ productId: 'cement', receivedQty: 5 }],
    }).expect(201);
    await closeShop().expect(200);
  });
  it('nor can it close while being counted', async () => {
    await post('papa', 'stock/counts', { locationId: THIRD }).expect(201);
    expect((await closeShop().expect(409)).body.error.code).toBe('SHOP_IN_USE');
  });
});

describe('who sees money, and which drawer cash lands in', () => {
  const alsoAt = (userId: string, role: 'MANAGER' | 'STOCK_KEEPER', locationId: string) =>
    db.staffMembership.create({ data: { userId, role, locationId, grantedById: 'papa' } });
  const payment = (who: string, rest: object = {}) =>
    post(who, 'customers/customer/khata/payment', {
      amountPaise: 10000,
      channel: 'CASH',
      note: 'Jama',
      idempotencyKey: randomUUID(),
      ...rest,
    });
  it('a manager at one shop and a loader at another reads money only at the first', async () => {
    await alsoAt('manager', 'STOCK_KEEPER', SECOND);
    const order = await waitingOrder();
    expect((await get('manager', `orders/${order.id}`).expect(200)).body.totalPaise).toBe(
      order.totalPaise,
    );
    await db.order.update({ where: { id: order.id }, data: { locationId: SECOND } });
    const other = await get('manager', `orders/${order.id}`).expect(200);
    expect(other.body).not.toHaveProperty('totalPaise');
    const list = await get('manager', 'orders').expect(200);
    expect(list.body.items.find((row: { id: string }) => row.id === order.id)).not.toHaveProperty(
      'totalPaise',
    );
  });
  it('an order never carries the customer’s balance or limit', async () => {
    await db.user.update({
      where: { id: 'customer' },
      data: { creditAllowed: true, creditLimitPaise: 500000 },
    });
    const order = await waitingOrder();
    for (const who of ['cashier', 'manager', 'papa']) {
      for (const path of [`orders/${order.id}`, 'orders']) {
        const text = JSON.stringify((await get(who, path).expect(200)).body);
        expect(text).not.toContain('khataBalancePaise');
        expect(text).not.toContain('creditLimitPaise');
      }
    }
    expect((await get('cashier', `orders/${order.id}`).expect(200)).body.user).toEqual({
      id: 'customer',
      name: 'customer',
      phone: '+919000000701',
    });
    const dashboard = JSON.stringify((await get('manager', 'dashboard').expect(200)).body);
    expect(dashboard).not.toContain('creditLimitPaise');
  });
  it('someone at one shop is not asked which drawer', async () => {
    await payment('cashier').expect(201);
    const [row] = await db.financialMovement.findMany({ where: { kind: 'KHATA_PAYMENT' } });
    expect(row!.locationId).toBe(MAIN);
  });
  it('someone at two shops must say, and it lands in that one', async () => {
    await alsoAt('manager', 'MANAGER', SECOND);
    const unsaid = await payment('manager').expect(400);
    expect(unsaid.body.error.code).toBe('SHOP_REQUIRED');
    await payment('manager', { locationId: SECOND }).expect(201);
    const [row] = await db.financialMovement.findMany({ where: { kind: 'KHATA_PAYMENT' } });
    expect(row!.locationId).toBe(SECOND);
  });
  it('nobody books cash into a shop that is not theirs', async () => {
    await payment('cashier', { locationId: SECOND }).expect(403);
    expect(await db.financialMovement.count()).toBe(0);
  });
  it('an owner’s cash goes to the shop they name', async () => {
    await payment('papa', { locationId: SECOND }).expect(201);
    const [row] = await db.financialMovement.findMany({ where: { kind: 'KHATA_PAYMENT' } });
    expect(row!.locationId).toBe(SECOND);
  });
});

describe('udhaar is an udhaar decision everywhere', () => {
  const phone = (who: string, paymentMethod: string, rest: object = {}) =>
    post(who, 'orders/phone', {
      source: 'WALK_IN',
      customerPhone: '+919000000701',
      customerName: 'Ramesh',
      items: [{ productId: 'cement', quantity: 1 }],
      deliveryDate: 'today',
      paymentMethod,
      idempotencyKey: randomUUID(),
      ...rest,
    });
  beforeEach(async () => {
    await db.user.update({
      where: { id: 'customer' },
      data: { creditAllowed: true, creditLimitPaise: 5000000 },
    });
  });
  it('a cashier cannot start an udhaar order', async () => {
    await phone('cashier', 'CREDIT').expect(403);
    expect(await db.order.count()).toBe(0);
    expect(await total()).toBe(100);
  });
  it('a cashier can still take a cash order', async () => {
    await phone('cashier', 'COD').expect(201);
  });
  it('a manager and an owner can, within the limit', async () => {
    await phone('manager', 'CREDIT').expect(201);
    await phone('papa', 'CREDIT').expect(201);
  });
  it('a customer’s name is one line, so it cannot break a spreadsheet row', async () => {
    await phone('papa', 'COD', { customerName: 'Ramesh\r=HYPERLINK("x")' }).expect(400);
  });
});
