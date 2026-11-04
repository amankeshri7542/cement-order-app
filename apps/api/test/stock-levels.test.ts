import 'reflect-metadata';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import type { Server } from 'node:http';
import { loadEnvFile } from 'node:process';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { availabilityOf } from '@shiv/shared';
import { Db } from '../src/db';
import { moveStock } from '../src/inventory';
import { addPerson, tokenFor } from './staff-helper';

if (existsSync('.env.test')) loadEnvFile('.env.test');
process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
process.env.OTP_PROVIDER = 'mock';
process.env.OTP_HASH_SECRET = 'stock-test-only-secret-not-for-production';
process.env.CORS_ORIGINS = 'http://localhost:3000';
if (!process.env.DATABASE_URL || !new URL(process.env.DATABASE_URL).pathname.endsWith('_test'))
  throw new Error('Stock tests require a dedicated TEST_DATABASE_URL ending in _test.');

const MAIN = 'loc_main';
const SECOND = 'loc_stock_b';
let app: INestApplication;
let server: Server;
let db: Db;
const owner = { Authorization: `Bearer ${tokenFor('owner')}` };

const level = async (locationId: string) =>
  (
    await db.stockLevel.findUnique({
      where: { productId_locationId: { productId: 'cement', locationId } },
    })
  )?.quantity;
const total = async () => (await db.product.findUniqueOrThrow({ where: { id: 'cement' } })).stock;
const move = (
  quantity: number,
  locationId?: string,
  kind = quantity > 0 ? 'PURCHASE_IN' : 'DAMAGE',
) =>
  db.atomic((tx) =>
    moveStock(tx, {
      productId: 'cement',
      kind: kind as 'PURCHASE_IN',
      quantity,
      reference: 'Test',
      note: 'Test',
      actorId: 'owner',
      idempotencyKey: randomUUID(),
      ...(locationId ? { locationId } : {}),
    }),
  );

beforeAll(async () => {
  const { createApp } = await import('../src/app');
  app = await createApp();
  await app.listen(0, '127.0.0.1');
  server = app.getHttpServer();
  db = app.get(Db);
}, 30000);
beforeEach(async () => {
  await db.$executeRawUnsafe(
    'TRUNCATE TABLE "PriceUpdateBatch", "RateSource", "FinancialMovement", "User", "Category", "Product", "Order", "Quote", "AuditLog", "OtpChallenge", "AuthRateLimit", "DeliveryZone", "StoreSettings" RESTART IDENTITY CASCADE',
  );
  await db.location.upsert({
    where: { id: SECOND },
    update: { active: true },
    create: { id: SECOND, firmId: 'firm_main', slug: 'stock-b', name: 'stock-b' },
  });
  await addPerson(db, { id: 'owner', role: 'OWNER', phone: '+919000000601' });
  await addPerson(db, { id: 'customer', phone: '+919000000602' });
  await db.category.create({ data: { id: 'category', name: 'Cement', slug: 'cement' } });
  await db.product.create({
    data: {
      id: 'cement',
      name: 'Test cement',
      brand: 'Test',
      categoryId: 'category',
      type: 'PPC',
      grade: 'PPC',
      unit: 'bag',
      pricePaise: 40000,
      stock: 100,
      minQuantity: 1,
      description: 'Test product',
      recommendedUse: 'Test',
      images: [],
    },
  });
  await db.storeSettings.create({ data: { id: 'store', phone: '+919999999000' } });
});
afterAll(async () => {
  await app?.close();
});

describe('stock kept per shop', () => {
  it('existing stock sits at the main shop', async () => {
    expect(await level(MAIN)).toBe(100);
    expect(await total()).toBe(100);
  });
  it('a movement changes that shop and the total, and no other shop', async () => {
    await move(40, SECOND);
    expect(await level(SECOND)).toBe(40);
    expect(await level(MAIN)).toBe(100);
    expect(await total()).toBe(140);
    const row = await move(-15, SECOND);
    expect(row).toMatchObject({ locationId: SECOND, balanceAfter: 25 });
    expect(await level(MAIN)).toBe(100);
    expect(await total()).toBe(125);
  });
  it('with no shop named, it is the main shop', async () => {
    const row = await move(5);
    expect(row).toMatchObject({ locationId: MAIN, balanceAfter: 105 });
  });
  it('a shop cannot sell what only another shop holds', async () => {
    await move(5, SECOND);
    await expect(move(-6, SECOND)).rejects.toMatchObject({ response: { code: 'STOCK_CONFLICT' } });
    expect(await level(SECOND)).toBe(5);
    expect(await total()).toBe(105);
  });
  it('a shop with no stock row cannot go below nothing', async () => {
    await expect(move(-1, SECOND)).rejects.toMatchObject({ response: { code: 'STOCK_CONFLICT' } });
    expect(await level(SECOND)).toBeUndefined();
  });
  it('stays inside the highest supported balance', async () => {
    await move(999_000, SECOND);
    await expect(move(1_001, SECOND)).rejects.toMatchObject({
      response: { code: 'STOCK_CONFLICT' },
    });
  });
  it('a closed or made-up shop is refused and nothing moves', async () => {
    await db.location.update({ where: { id: SECOND }, data: { active: false } });
    await expect(move(5, SECOND)).rejects.toMatchObject({ response: { code: 'INVALID_SHOP' } });
    await expect(move(5, 'no-such-shop')).rejects.toMatchObject({
      response: { code: 'INVALID_SHOP' },
    });
    expect(await total()).toBe(100);
  });
  it('replaying a request at another shop is refused, at the same shop changes nothing', async () => {
    const key = randomUUID();
    const send = (locationId: string) =>
      db.atomic((tx) =>
        moveStock(tx, {
          productId: 'cement',
          kind: 'PURCHASE_IN',
          quantity: 5,
          reference: 'Test',
          note: 'Test',
          actorId: 'owner',
          idempotencyKey: key,
          locationId,
        }),
      );
    await send(SECOND);
    await send(SECOND);
    expect(await level(SECOND)).toBe(5);
    await expect(send(MAIN)).rejects.toMatchObject({ response: { code: 'IDEMPOTENCY_CONFLICT' } });
    expect(await level(MAIN)).toBe(100);
  });
  it('sales racing each other never take a shop below nothing', async () => {
    await move(10, SECOND);
    const results = await Promise.allSettled(
      Array.from({ length: 16 }, () => move(-1, SECOND).then(() => 1)),
    );
    const sold = results.filter((result) => result.status === 'fulfilled').length;
    expect(sold).toBeLessThanOrEqual(10);
    expect(await level(SECOND)).toBe(10 - sold);
    expect(await total()).toBe(110 - sold);
  });
  it('the total always equals what the shops hold', async () => {
    await move(40, SECOND);
    await move(-7, SECOND);
    await move(-3);
    const levels = await db.stockLevel.aggregate({
      where: { productId: 'cement' },
      _sum: { quantity: true },
    });
    expect(levels._sum.quantity).toBe(await total());
  });
});

describe('a phone order checks the shop it is for', () => {
  const address = {
    label: 'Site',
    name: 'Customer',
    phone: '+919000000602',
    line1: 'Plot 12',
    area: 'Danapur',
    city: 'Patna',
    state: 'Bihar',
    pincode: '800021',
    landmark: '',
  };
  it('the whole firm having it is not enough', async () => {
    await db.deliveryZone.create({
      data: {
        id: 'zone-shop-check',
        name: 'Danapur',
        deliveryFeePaise: 0,
        minimumOrderPaise: 0,
        estimate: 'Today',
        locationId: SECOND,
        pincodes: { create: { pincode: '800021' } },
      },
    });
    await move(2, SECOND);
    const { body } = await request(server)
      .post('/api/v1/admin/orders/phone')
      .set(owner)
      .send({
        locationId: SECOND,
        customerPhone: address.phone,
        customerName: 'Customer',
        address,
        items: [{ productId: 'cement', quantity: 3 }],
        deliveryDate: 'today',
        paymentMethod: 'COD',
        idempotencyKey: randomUUID(),
      })
      .expect(409);
    expect(body.error.code).toBe('OUT_OF_STOCK');
    expect(await level(SECOND)).toBe(2);
  });
});

describe('older writers that only know the total', () => {
  it('a direct change lands on the main shop', async () => {
    await db.product.update({ where: { id: 'cement' }, data: { stock: 80 } });
    expect(await level(MAIN)).toBe(80);
  });
  it('and leaves the other shops’ stock counted', async () => {
    await move(30, SECOND);
    await db.product.update({ where: { id: 'cement' }, data: { stock: 90 } });
    expect(await level(SECOND)).toBe(30);
    expect(await level(MAIN)).toBe(60);
  });
  it('a low-stock mark follows to the main shop', async () => {
    await db.product.update({ where: { id: 'cement' }, data: { lowStockAt: 9 } });
    expect(
      (
        await db.stockLevel.findUniqueOrThrow({
          where: { productId_locationId: { productId: 'cement', locationId: MAIN } },
        })
      ).lowStockAt,
    ).toBe(9);
  });
  it('a new product starts at the main shop', async () => {
    await db.product.create({
      data: {
        id: 'sand',
        name: 'Balu',
        brand: 'Test',
        categoryId: 'category',
        type: 'x',
        grade: 'x',
        unit: 'cft',
        pricePaise: 100,
        stock: 7,
        description: 'x',
        recommendedUse: 'x',
        images: [],
      },
    });
    expect(
      await db.stockLevel.count({ where: { productId: 'sand', locationId: MAIN, quantity: 7 } }),
    ).toBe(1);
  });
  it('moveStock does not count twice through that bridge', async () => {
    await move(5);
    expect(await level(MAIN)).toBe(105);
  });
  it('the database refuses a negative level', async () => {
    await expect(
      db.$executeRawUnsafe(`UPDATE "StockLevel" SET "quantity" = -1 WHERE "productId" = 'cement'`),
    ).rejects.toThrow();
  });
});

describe('orders follow their delivery area’s shop', () => {
  const address = {
    label: 'Site',
    name: 'Customer',
    phone: '+919000000602',
    line1: 'Plot 12',
    area: 'Danapur',
    city: 'Patna',
    state: 'Bihar',
    pincode: '800021',
    landmark: '',
  };
  it('a phone order takes stock from the shop chosen, and cancelling gives it back there', async () => {
    await move(20, SECOND);
    await db.deliveryZone.create({
      data: {
        id: 'zone-danapur',
        name: 'Danapur',
        deliveryFeePaise: 0,
        minimumOrderPaise: 0,
        estimate: 'Today',
        locationId: SECOND,
        pincodes: { create: { pincode: '800021' } },
      },
    });
    const { body } = await request(server)
      .post('/api/v1/admin/orders/phone')
      .set(owner)
      .send({
        locationId: SECOND,
        customerPhone: address.phone,
        customerName: 'Customer',
        address,
        items: [{ productId: 'cement', quantity: 4 }],
        deliveryDate: 'today',
        paymentMethod: 'COD',
        idempotencyKey: randomUUID(),
      })
      .expect(201);
    expect(await level(SECOND)).toBe(16);
    expect(await level(MAIN)).toBe(100);
    await request(server)
      .patch(`/api/v1/admin/orders/${body.id}/status`)
      .set(owner)
      .send({ status: 'CANCELLED', note: 'Customer changed their mind' })
      .expect(200);
    expect(await level(SECOND)).toBe(20);
    expect(await level(MAIN)).toBe(100);
  });
  it('the checkout order’s shop comes from the delivery area', async () => {
    await move(20, SECOND);
    await db.deliveryZone.create({
      data: {
        id: 'zone-b',
        name: 'Danapur',
        deliveryFeePaise: 0,
        minimumOrderPaise: 0,
        estimate: 'Today',
        locationId: SECOND,
        pincodes: { create: { pincode: '800021' } },
      },
    });
    const zone = await db.deliveryZone.findUniqueOrThrow({ where: { id: 'zone-b' } });
    expect(zone.locationId).toBe(SECOND);
  });
});

describe('what customers are told', () => {
  it('a word, never a count or a shop', async () => {
    const list = await request(server).get('/api/v1/products').expect(200);
    const one = await request(server).get('/api/v1/products/cement').expect(200);
    for (const product of [list.body.items[0], one.body]) {
      expect(product.availability).toBe('IN_STOCK');
      expect(product).not.toHaveProperty('stockLevels');
      expect(JSON.stringify(product)).not.toContain('loc_');
    }
  });
  it.each([
    ['in stock', { stock: 5 }, 'IN_STOCK'],
    ['out of stock', { stock: 0 }, 'ASK_SHOP'],
    ['brought on request', { stock: 0, sourcing: 'ON_REQUEST' }, 'ON_REQUEST'],
    ['on request even with some in', { stock: 5, sourcing: 'ON_REQUEST' }, 'ON_REQUEST'],
    [
      'switched on, not counted',
      { stock: 0, stockMode: 'AVAILABILITY', stockLevels: [{ isOn: true }] },
      'IN_STOCK',
    ],
    [
      'switched off, not counted',
      { stock: 9, stockMode: 'AVAILABILITY', stockLevels: [{ isOn: false }] },
      'ASK_SHOP',
    ],
    ['no shop has it', { stock: 0, stockMode: 'AVAILABILITY', stockLevels: [] }, 'ASK_SHOP'],
  ])('%s', (_name, product, expected) => {
    expect(availabilityOf(product)).toBe(expected);
  });
  it('a closed shop’s switch does not count', async () => {
    await db.product.update({ where: { id: 'cement' }, data: { stockMode: 'AVAILABILITY' } });
    await db.stockLevel.updateMany({ where: { productId: 'cement' }, data: { isOn: false } });
    await db.stockLevel.create({
      data: { productId: 'cement', locationId: SECOND, quantity: 0, isOn: true },
    });
    await db.location.update({ where: { id: SECOND }, data: { active: false } });
    const { body } = await request(server).get('/api/v1/products/cement').expect(200);
    expect(body.availability).toBe('ASK_SHOP');
  });
  it('staff lists show levels, customers do not', async () => {
    const { body } = await request(server).get('/api/v1/admin/products').set(owner).expect(200);
    expect(body.items[0].stockLevels).toEqual([
      expect.objectContaining({ locationId: MAIN, quantity: 100 }),
    ]);
  });
});
