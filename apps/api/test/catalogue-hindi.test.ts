import 'reflect-metadata';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { loadEnvFile } from 'node:process';
import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import request from 'supertest';
import type { INestApplication } from '@nestjs/common';
import type { Server } from 'node:http';
import { Db } from '../src/db';
import { hash } from '../src/http';

// Hindi product names and descriptions: saved from the desk, returned by the public catalogue,
// found by Hindi search, cleared with a blank field, and used on rate cards headed in Hindi.
if (existsSync('.env.test')) loadEnvFile('.env.test');
process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
process.env.OTP_PROVIDER = 'mock';
process.env.OTP_HASH_SECRET = 'hindi-test-only-secret-not-for-production';
process.env.CORS_ORIGINS = 'http://localhost:3000,http://localhost:8081';
if (!process.env.DATABASE_URL || !new URL(process.env.DATABASE_URL).pathname.endsWith('_test'))
  throw new Error('Hindi catalogue tests require a TEST_DATABASE_URL database ending in _test.');

let app: INestApplication;
let server: Server;
let db: Db;
const token = 'h'.repeat(43);
const admin = { Authorization: `Bearer ${token}` };
const material = {
  name: 'TEST Hindi PPC cement',
  nameHi: '  टेस्ट पीपीसी सीमेंट  ',
  brand: 'TEST',
  categoryId: 'cement-category',
  type: 'PPC',
  grade: '43',
  unit: 'bag',
  pricePaise: 41000,
  stock: 40,
  active: true,
  description: 'Sealed 50 kg bag for plaster and masonry.',
  descriptionHi: 'प्लास्टर और चिनाई के लिए 50 किलो की बंद बोरी।',
  recommendedUse: 'Plaster',
};
const createProduct = async (body: Record<string, unknown> = material) => {
  const created = await request(server).post('/api/v1/admin/products').set(admin).send(body);
  expect(created.status, JSON.stringify(created.body)).toBe(201);
  return created.body as { id: string; version: number; nameHi: string | null };
};
const search = async (q: string) =>
  (await request(server).get('/api/v1/products').query({ q }).expect(200)).body.items.map(
    (p: { name: string }) => p.name,
  );

beforeAll(async () => {
  const { createApp } = await import('../src/app');
  app = await createApp();
  // Listen once on 127.0.0.1; see integration.test.ts for the per-request port collision.
  await app.listen(0, '127.0.0.1');
  server = app.getHttpServer();
  db = app.get(Db);
}, 30000);
beforeEach(async () => {
  await db.$executeRawUnsafe(
    'TRUNCATE TABLE "PriceUpdateBatch", "RateSource", "User", "Category", "Product", "AuditLog", "StoreSettings" RESTART IDENTITY CASCADE',
  );
  await db.user.create({
    data: {
      id: 'admin',
      phone: '+919999999961',
      role: 'ADMIN',
      name: 'admin',
      sessions: {
        create: {
          accessHash: hash(token),
          refreshHash: hash('admin-refresh'),
          expiresAt: new Date(Date.now() + 3600000),
          refreshExpiresAt: new Date(Date.now() + 86400000),
        },
      },
    },
  });
  await db.category.create({ data: { id: 'cement-category', name: 'Cement', slug: 'cement' } });
  await db.storeSettings.create({ data: { id: 'store', deliveryFeePaise: 50000 } });
});
afterAll(async () => {
  await app?.close();
});

describe('Hindi product text', () => {
  it('saves trimmed Hindi text and returns it from the public list and detail', async () => {
    const created = await createProduct();
    expect(created.nameHi).toBe('टेस्ट पीपीसी सीमेंट');
    const list = await request(server).get('/api/v1/products').expect(200);
    expect(list.body.items).toEqual([
      expect.objectContaining({
        id: created.id,
        name: 'TEST Hindi PPC cement',
        nameHi: 'टेस्ट पीपीसी सीमेंट',
        descriptionHi: 'प्लास्टर और चिनाई के लिए 50 किलो की बंद बोरी।',
      }),
    ]);
    const detail = await request(server).get(`/api/v1/products/${created.id}`).expect(200);
    expect(detail.body).toMatchObject({
      nameHi: 'टेस्ट पीपीसी सीमेंट',
      descriptionHi: 'प्लास्टर और चिनाई के लिए 50 किलो की बंद बोरी।',
    });
    // Products saved without Hindi text read back as null, never as an empty string.
    const { nameHi: _n, descriptionHi: _d, ...english } = material;
    const plain = await createProduct({ ...english, name: 'TEST English only' });
    expect(plain.nameHi).toBeNull();
  });

  it('finds a product by part of its Hindi name, and still by its English name', async () => {
    await createProduct();
    await createProduct({ ...material, name: 'TEST TMT bar', nameHi: 'टीएमटी सरिया', unit: 'kg' });
    expect(await search('पीपीसी')).toEqual(['TEST Hindi PPC cement']);
    expect(await search('सरिया')).toEqual(['TEST TMT bar']);
    expect(await search('hindi ppc')).toEqual(['TEST Hindi PPC cement']);
    expect(await search('ईंट')).toEqual([]);
  });

  it('keeps Hindi text when an edit leaves it out and clears it with a blank', async () => {
    const created = await createProduct();
    const { nameHi: _n, descriptionHi: _d, ...english } = material;
    const kept = await request(server)
      .patch(`/api/v1/admin/products/${created.id}`)
      .set(admin)
      .send({ ...english, pricePaise: 42000, expectedVersion: created.version });
    expect(kept.status, JSON.stringify(kept.body)).toBe(200);
    expect(kept.body).toMatchObject({ pricePaise: 42000, nameHi: 'टेस्ट पीपीसी सीमेंट' });
    const cleared = await request(server)
      .patch(`/api/v1/admin/products/${created.id}`)
      .set(admin)
      .send({ ...material, nameHi: '', descriptionHi: '   ', expectedVersion: kept.body.version });
    expect(cleared.status, JSON.stringify(cleared.body)).toBe(200);
    expect(cleared.body).toMatchObject({ nameHi: null, descriptionHi: null });
    expect(await search('पीपीसी')).toEqual([]);
    const tooLong = await request(server)
      .patch(`/api/v1/admin/products/${created.id}`)
      .set(admin)
      .send({ ...material, nameHi: 'न'.repeat(121), expectedVersion: cleared.body.version });
    expect(tooLong.status).toBe(400);
  });

  it('names materials in Hindi on a rate card headed in Hindi only', async () => {
    const created = await createProduct();
    const base = '/api/v1/admin/rate-studio';
    const batch = await request(server)
      .post(`${base}/batches`)
      .set(admin)
      .send({ title: 'Counter rates', sourceType: 'MANUAL', idempotencyKey: randomUUID() })
      .expect(201);
    const saved = await request(server)
      .patch(`${base}/batches/${batch.body.id}`)
      .set(admin)
      .send({
        expectedVersion: batch.body.version,
        title: batch.body.title,
        items: [
          {
            productId: created.id,
            label: material.name,
            brand: material.brand,
            specification: 'PPC',
            unit: material.unit,
            weight: '',
            proposedPricePaise: 42500,
            included: true,
            reviewed: true,
            acknowledged: true,
            note: 'Confirmed at counter',
            rememberAlias: false,
            refreshBaseline: false,
            expectedProductVersion: created.version,
          },
        ],
      })
      .expect(200);
    await request(server)
      .post(`${base}/batches/${batch.body.id}/publish`)
      .set(admin)
      .send({ expectedVersion: saved.body.version, confirmation: 'PUBLISH' })
      .expect(201);
    const card = (heading: string) =>
      request(server)
        .post(`${base}/batches/${batch.body.id}/cards`)
        .set(admin)
        .send({
          format: 'SQUARE',
          template: 'COUNTER',
          heading,
          deliveryMessage: '',
          contactLabel: '',
          promotionalCopy: '',
          confirmed: true,
        })
        .expect(201);
    const hindi = await card('आज के भाव');
    expect(hindi.body.snapshot.items[0]).toMatchObject({
      name: 'टेस्ट पीपीसी सीमेंट',
      unit: 'bag',
      pricePaise: 42500,
    });
    const english = await card('Current material rates');
    expect(english.body.snapshot.items[0].name).toBe('TEST Hindi PPC cement');
  });
});
