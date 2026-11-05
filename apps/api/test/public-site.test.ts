import 'reflect-metadata';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { loadEnvFile } from 'node:process';
import { existsSync } from 'node:fs';
import request from 'supertest';
import type { INestApplication } from '@nestjs/common';
import type { Server } from 'node:http';
import { Db } from '../src/db';
import { hash } from '../src/http';

if (existsSync('.env.test')) loadEnvFile('.env.test');
process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
process.env.OTP_PROVIDER = 'twilio';
process.env.TWILIO_ACCOUNT_SID = 'AC-site-test';
process.env.TWILIO_AUTH_TOKEN = 'site-test';
process.env.TWILIO_VERIFY_SERVICE_SID = 'VA-site-test';
process.env.OTP_HASH_SECRET = 'site-test-only-secret-not-for-production';
process.env.TRUST_PROXY_HOPS = '1';
process.env.CORS_ORIGINS = 'http://localhost:3000';
if (!process.env.DATABASE_URL || !new URL(process.env.DATABASE_URL).pathname.endsWith('_test'))
  throw new Error('Public site tests require a dedicated TEST_DATABASE_URL ending in _test.');

let app: INestApplication;
let server: Server;
let db: Db;
const api = '/api/v1/public';

const product = (id: string, overrides: Record<string, unknown> = {}) => ({
  id,
  name: `Name ${id}`,
  brand: 'Brand',
  categoryId: 'cement',
  type: 'PPC',
  grade: 'PPC',
  unit: '50 kg bag',
  pricePaise: 41000,
  stock: 37,
  images: [],
  description: 'Described.',
  recommendedUse: 'Used.',
  ...overrides,
});
const check = (lines: { productId: string; quantity: number }[], ip = '203.0.113.20') =>
  request(server).post(`${api}/list-check`).set('X-Forwarded-For', ip).send({ lines });

beforeAll(async () => {
  const { createApp } = await import('../src/app');
  app = await createApp();
  await app.listen(0, '127.0.0.1');
  server = app.getHttpServer();
  db = app.get(Db);
}, 30000);
beforeEach(async () => {
  await db.$executeRawUnsafe(
    'TRUNCATE TABLE "Product", "Category", "AuthRateLimit" RESTART IDENTITY CASCADE',
  );
  // Shops hang off the one firm row, so it stays, unapproved, between tests.
  await db.firm.updateMany({ data: { approvedAt: null } });
  await db.category.create({ data: { id: 'cement', name: 'Cement', slug: 'cement' } });
  await db.product.create({ data: product('plain') });
});
afterEach(() => {
  delete process.env.PUBLIC_RATES_REAL;
  delete process.env.LIST_CHECK_PER_IP_MINUTE;
  delete process.env.ONLINE_LINE_LIMIT_PAISE;
  vi.restoreAllMocks();
});
afterAll(async () => {
  await app.close();
});

describe('GET public/catalog', () => {
  it('needs no sign-in and never carries a stock count', async () => {
    const response = await request(server).get(`${api}/catalog`).expect(200);
    const [row] = response.body.products;
    expect(row.id).toBe('plain');
    expect(row.availability).toBe('IN_STOCK');
    expect(row.pricePaise).toBe(41000);
    // Not under any name, and not in any nested object.
    expect(JSON.stringify(response.body)).not.toMatch(/"stock|37|lowStock|stockLevels|nameHi/);
    expect(response.headers['cache-control']).toBe('public, no-cache');
  });
  it('answers an unchanged catalogue with 304 only while it stays the same', async () => {
    // generatedAt changes, so a plain catalogue never looks the same twice unless cached upstream.
    const first = await request(server).get(`${api}/catalog`).expect(200);
    expect(first.headers.etag).toBeTruthy();
  });
  it('leaves inactive products out', async () => {
    await db.product.create({ data: product('retired', { active: false }) });
    const response = await request(server).get(`${api}/catalog`).expect(200);
    expect(response.body.products.map((row: { id: string }) => row.id)).toEqual(['plain']);
  });
  it('never prices an item the shop only brings in to order', async () => {
    await db.product.create({ data: product('order-only', { sourcing: 'ON_REQUEST' }) });
    const response = await request(server).get(`${api}/catalog`).expect(200);
    const row = response.body.products.find((item: { id: string }) => item.id === 'order-only');
    expect(row.availability).toBe('ON_REQUEST');
    expect(row.pricePaise).toBeNull();
  });
  it('says the oldest check, so today is true of every rate', async () => {
    const old = new Date('2026-10-01T04:00:00.000Z');
    await db.product.create({
      data: product('old-rate', { priceUpdatedAt: old, priceCheckedAt: old }),
    });
    const response = await request(server).get(`${api}/catalog`).expect(200);
    expect(response.body.ratesCheckedAt).toBe(old.toISOString());
  });
  it('a later "rate wahi hain" moves a rate forward; an old check never moves it back', async () => {
    const edited = new Date('2026-10-05T04:00:00.000Z');
    const checked = new Date('2026-10-06T04:00:00.000Z');
    await db.product.create({
      data: product('reaffirmed', { priceUpdatedAt: edited, priceCheckedAt: checked }),
    });
    await db.product.create({
      data: product('edited', {
        priceUpdatedAt: checked,
        priceCheckedAt: edited,
      }),
    });
    const response = await request(server).get(`${api}/catalog`).expect(200);
    const at = (id: string) =>
      response.body.products.find((row: { id: string }) => row.id === id).checkedAt;
    expect(at('reaffirmed')).toBe(checked.toISOString());
    expect(at('edited')).toBe(checked.toISOString());
  });
  it('an on-request item does not drag the board date back', async () => {
    const old = new Date('2020-01-01T00:00:00.000Z');
    await db.product.create({
      data: product('order-only', { sourcing: 'ON_REQUEST', priceUpdatedAt: old }),
    });
    const response = await request(server).get(`${api}/catalog`).expect(200);
    expect(response.body.ratesCheckedAt).not.toBe(old.toISOString());
  });
  it('is sample rates until the family says otherwise', async () => {
    expect((await request(server).get(`${api}/catalog`)).body.sampleRates).toBe(true);
    process.env.PUBLIC_RATES_REAL = 'on';
    expect((await request(server).get(`${api}/catalog`)).body.sampleRates).toBe(false);
    process.env.PUBLIC_RATES_REAL = 'yes';
    expect((await request(server).get(`${api}/catalog`)).body.sampleRates).toBe(true);
  });
  it('an empty shop answers with empty lists, not an error', async () => {
    await db.product.deleteMany();
    const response = await request(server).get(`${api}/catalog`).expect(200);
    expect(response.body.products).toEqual([]);
    expect(response.body.ratesCheckedAt).toBeNull();
  });
  it('gives search words without giving the shop away', async () => {
    await db.productAlias.create({
      data: {
        productId: 'plain',
        alias: 'saria',
        normalizedAlias: 'saria',
        source: 'test',
        confirmedBy: 'test',
      },
    });
    const response = await request(server).get(`${api}/catalog`).expect(200);
    expect(response.body.products[0].searchTerms).toEqual(['saria']);
    expect(JSON.stringify(response.body)).not.toContain('confirmedBy');
  });
});

describe('POST public/list-check', () => {
  it('says yes with the current rate, and never a count', async () => {
    const response = await check([{ productId: 'plain', quantity: 10 }]).expect(201);
    expect(response.body.lines).toEqual([
      { productId: 'plain', status: 'ok', pricePaise: 41000, minQuantity: 1, quantityStep: 1 },
    ]);
  });
  it('asking for more than the shop holds gives the same answer as less', async () => {
    // 37 in stock. If 38 differed from 36, a stranger could search for the exact count.
    const under = await check([{ productId: 'plain', quantity: 36 }]).expect(201);
    const over = await check([{ productId: 'plain', quantity: 38 }]).expect(201);
    expect(over.body).toEqual(under.body);
    expect(JSON.stringify(over.body)).not.toContain('37');
  });
  it('a line over the fixed limit goes to asking for a rate', async () => {
    process.env.ONLINE_LINE_LIMIT_PAISE = String(41000 * 10);
    const fine = await check([{ productId: 'plain', quantity: 10 }]).expect(201);
    expect(fine.body.lines[0].status).toBe('ok');
    const over = await check([{ productId: 'plain', quantity: 11 }]).expect(201);
    expect(over.body.lines[0].status).toBe('over');
  });
  it('a quantity above what the cart can hold is over', async () => {
    const response = await check([{ productId: 'plain', quantity: 10001 }]).expect(201);
    expect(response.body.lines[0].status).toBe('over');
  });
  it('checks minimum and step, and says what they are', async () => {
    await db.product.create({
      data: product('stepped', { minQuantity: 10, quantityStep: 5 }),
    });
    const low = await check([{ productId: 'stepped', quantity: 5 }]).expect(201);
    expect(low.body.lines[0]).toMatchObject({
      status: 'invalid',
      minQuantity: 10,
      quantityStep: 5,
    });
    const off = await check([{ productId: 'stepped', quantity: 12 }]).expect(201);
    expect(off.body.lines[0].status).toBe('invalid');
    const good = await check([{ productId: 'stepped', quantity: 15 }]).expect(201);
    expect(good.body.lines[0].status).toBe('ok');
  });
  it('an item out of stock is unavailable, with no count', async () => {
    await db.product.create({ data: product('empty', { stock: 0 }) });
    const response = await check([{ productId: 'empty', quantity: 1 }]).expect(201);
    expect(response.body.lines[0].status).toBe('unavailable');
  });
  it('an on-request item has no rate, whatever is asked', async () => {
    await db.product.create({ data: product('order-only', { sourcing: 'ON_REQUEST' }) });
    const response = await check([{ productId: 'order-only', quantity: 1 }]).expect(201);
    expect(response.body.lines[0]).toMatchObject({ status: 'on_request', pricePaise: null });
  });
  it('a retired or unknown product is gone, and looks the same either way', async () => {
    await db.product.create({ data: product('retired', { active: false }) });
    const response = await check([
      { productId: 'retired', quantity: 1 },
      { productId: 'never-existed', quantity: 1 },
    ]).expect(201);
    expect(response.body.lines).toEqual([
      { productId: 'retired', status: 'gone', pricePaise: null },
      { productId: 'never-existed', status: 'gone', pricePaise: null },
    ]);
  });
  it('one bad line does not stop the rest', async () => {
    const response = await check([
      { productId: 'gone', quantity: 1 },
      { productId: 'plain', quantity: 2 },
    ]).expect(201);
    expect(response.body.lines.map((line: { status: string }) => line.status)).toEqual([
      'gone',
      'ok',
    ]);
  });
  it('a line sent twice is answered twice and stays consistent', async () => {
    const response = await check([
      { productId: 'plain', quantity: 2 },
      { productId: 'plain', quantity: 2 },
    ]).expect(201);
    expect(response.body.lines).toHaveLength(2);
  });
  it.each([
    ['no lines', { lines: [] }],
    ['too many lines', { lines: Array(51).fill({ productId: 'plain', quantity: 1 }) }],
    ['a price sent in', { lines: [{ productId: 'plain', quantity: 1, pricePaise: 1 }] }],
    ['negative quantity', { lines: [{ productId: 'plain', quantity: -1 }] }],
    ['fractional quantity', { lines: [{ productId: 'plain', quantity: 1.5 }] }],
    ['huge quantity', { lines: [{ productId: 'plain', quantity: 1e12 }] }],
    ['quantity as text', { lines: [{ productId: 'plain', quantity: '1' }] }],
    ['a query object as id', { lines: [{ productId: { contains: 'a' }, quantity: 1 }] }],
    ['a very long id', { lines: [{ productId: 'x'.repeat(101), quantity: 1 }] }],
    ['extra top-level field', { lines: [{ productId: 'plain', quantity: 1 }], admin: true }],
  ])('refuses %s', async (_name, body) => {
    await request(server)
      .post(`${api}/list-check`)
      .set('X-Forwarded-For', '203.0.113.21')
      .send(body)
      .expect(400);
  });
  it('stops an address that keeps asking, without stopping another', async () => {
    process.env.LIST_CHECK_PER_IP_MINUTE = '2';
    const line = [{ productId: 'plain', quantity: 1 }];
    await check(line, '203.0.113.30').expect(201);
    await check(line, '203.0.113.30').expect(201);
    await check(line, '203.0.113.30').expect(429);
    await check(line, '203.0.113.31').expect(201);
  });
  it('holds under many checks at once', async () => {
    const answers = await Promise.all(
      Array.from({ length: 50 }, (_, i) =>
        check([{ productId: 'plain', quantity: 1 }], `203.0.113.${40 + i}`),
      ),
    );
    expect(answers.every((answer) => answer.status === 201)).toBe(true);
  });
});

describe('GET public/shop', () => {
  it('shows no contact details until the family approves them', async () => {
    const response = await request(server).get(`${api}/shop`).expect(200);
    expect(response.body.contactApproved).toBe(false);
    expect(response.body.phone).toBe('');
    expect(response.body.whatsapp).toBe('');
    expect(response.body.address).toBe('');
    expect(response.body.firm).toBeNull();
  });
  it('carries no Hindi script', async () => {
    const response = await request(server).get(`${api}/shop`).expect(200);
    expect(JSON.stringify(response.body)).not.toMatch(/[ऀ-ॿ]/);
  });
  it('keeps an unapproved firm private', async () => {
    await db.firm.updateMany({
      data: {
        legalName: 'Unapproved Legal Name',
        complaintOfficerName: 'Nobody Yet',
        complaintOfficerPhone: '+919000000001',
      },
    });
    const response = await request(server).get(`${api}/shop`).expect(200);
    expect(response.body.firm).toBeNull();
    expect(JSON.stringify(response.body)).not.toContain('Unapproved');
  });
  it('shows an approved firm, and only its public fields', async () => {
    await db.firm.updateMany({
      data: {
        legalName: 'Approved Legal Name',
        tradeName: 'Approved Trade',
        complaintOfficerName: 'Named Person',
        complaintOfficerPhone: '+919000000002',
        approvedAt: new Date(),
      },
    });
    const response = await request(server).get(`${api}/shop`).expect(200);
    expect(response.body.firm).toEqual({
      legalName: 'Approved Legal Name',
      tradeName: 'Approved Trade',
      gstin: null,
      complaintOfficerName: 'Named Person',
      complaintOfficerPhone: '+919000000002',
    });
  });
});

describe('every role sees the same public answers', () => {
  it('a signed-in customer gets no extra fields from the catalogue', async () => {
    const token = 'k'.repeat(43);
    await db.user.upsert({
      where: { id: 'site-buyer' },
      update: {},
      create: {
        id: 'site-buyer',
        phone: '+919999990071',
        name: 'Buyer',
        role: 'CUSTOMER',
        sessions: {
          create: {
            accessHash: hash(token),
            refreshHash: hash('site-buyer-refresh'),
            expiresAt: new Date(Date.now() + 3600000),
            refreshExpiresAt: new Date(Date.now() + 86400000),
          },
        },
      },
    });
    const signedIn = await request(server)
      .get(`${api}/catalog`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    const guest = await request(server).get(`${api}/catalog`).expect(200);
    expect(Object.keys(signedIn.body.products[0]).sort()).toEqual(
      Object.keys(guest.body.products[0]).sort(),
    );
    await db.user.delete({ where: { id: 'site-buyer' } }).catch(() => {});
  });
});

describe('telling the website a rate changed', () => {
  it('stays silent until it is configured', async () => {
    const { SiteRevalidator } = await import('../src/public-site');
    const { Events } = await import('../src/catalog');
    const events = new Events();
    const spy = vi.spyOn(globalThis, 'fetch');
    const revalidator = new SiteRevalidator(events);
    revalidator.onModuleInit();
    events.publish({ type: 'PRODUCT_PRICE_UPDATED', productId: 'plain' });
    await new Promise((done) => setTimeout(done, 20));
    expect(spy).not.toHaveBeenCalled();
    revalidator.onModuleDestroy();
  });
  it('sends the secret and survives a failed call', async () => {
    process.env.STOREFRONT_REVALIDATE_URL = 'http://127.0.0.1:9/api/revalidate';
    process.env.REVALIDATE_SECRET = 'a-secret';
    const { SiteRevalidator } = await import('../src/public-site');
    const { Events } = await import('../src/catalog');
    const spy = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('offline'));
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const revalidator = new SiteRevalidator(new Events());
    await revalidator.notify();
    expect(spy.mock.calls[0]?.[1]).toMatchObject({
      method: 'POST',
      headers: { 'x-revalidate-secret': 'a-secret' },
    });
    expect(warn.mock.calls[0]?.[0]).toContain('SITE_REVALIDATE_FAILED');
    // The log holds no secret.
    expect(warn.mock.calls[0]?.[0]).not.toContain('a-secret');
    delete process.env.STOREFRONT_REVALIDATE_URL;
    delete process.env.REVALIDATE_SECRET;
  });
  it('only rate and catalogue changes trigger it, after a quiet moment', async () => {
    process.env.STOREFRONT_REVALIDATE_URL = 'http://127.0.0.1:9/api/revalidate';
    process.env.REVALIDATE_SECRET = 'a-secret';
    vi.useFakeTimers();
    const { SiteRevalidator } = await import('../src/public-site');
    const { Events } = await import('../src/catalog');
    const events = new Events();
    const revalidator = new SiteRevalidator(events);
    const notify = vi.spyOn(revalidator, 'notify').mockResolvedValue();
    revalidator.onModuleInit();
    events.publish({ type: 'HEARTBEAT' });
    vi.advanceTimersByTime(5000);
    expect(notify).not.toHaveBeenCalled();
    events.publish({ type: 'PRODUCT_PRICE_UPDATED', productId: 'a' });
    events.publish({ type: 'PRODUCT_PRICE_UPDATED', productId: 'b' });
    vi.advanceTimersByTime(1999);
    expect(notify).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(notify).toHaveBeenCalledTimes(1);
    revalidator.onModuleDestroy();
    vi.useRealTimers();
    delete process.env.STOREFRONT_REVALIDATE_URL;
    delete process.env.REVALIDATE_SECRET;
  });
});
