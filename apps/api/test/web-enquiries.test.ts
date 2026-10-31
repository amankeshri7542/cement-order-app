import 'reflect-metadata';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { loadEnvFile } from 'node:process';
import { existsSync } from 'node:fs';
import request from 'supertest';
import type { INestApplication } from '@nestjs/common';
import type { Server } from 'node:http';
import { Db } from '../src/db';
import { hash } from '../src/http';
import { purgeEnquiries } from '../src/web-enquiries';

if (existsSync('.env.test')) loadEnvFile('.env.test');
process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
// Mock OTP refuses to run behind a proxy, so these tests name a provider they never call.
process.env.OTP_PROVIDER = 'twilio';
process.env.TWILIO_ACCOUNT_SID = 'AC-enquiry-test';
process.env.TWILIO_AUTH_TOKEN = 'enquiry-test';
process.env.TWILIO_VERIFY_SERVICE_SID = 'VA-enquiry-test';
process.env.OTP_HASH_SECRET = 'enquiry-test-only-secret-not-for-production';
// Each test chooses the visitor's address through X-Forwarded-For.
process.env.TRUST_PROXY_HOPS = '1';
process.env.CORS_ORIGINS = 'http://localhost:3000,http://localhost:8081';
if (!process.env.DATABASE_URL || !new URL(process.env.DATABASE_URL).pathname.endsWith('_test'))
  throw new Error('Enquiry tests require a dedicated TEST_DATABASE_URL ending in _test.');

let app: INestApplication;
let server: Server;
let db: Db;
const tokens = { papa: 'p'.repeat(43), customer: 'c'.repeat(43) };
const auth = (who: keyof typeof tokens = 'papa') => ({ Authorization: `Bearer ${tokens[who]}` });
const enquiry = (overrides: Record<string, unknown> = {}) => ({
  name: 'Ramesh Kumar',
  phone: '+919876543210',
  pincode: '800020',
  interest: 'PPC cement',
  message: 'Need 200 bags for a roof slab next week.\nPlease call after 5.',
  language: 'hi',
  website: '',
  ...overrides,
});
const send = (body: Record<string, unknown> = enquiry(), ip = '203.0.113.10') =>
  request(server).post('/api/v1/web/enquiries').set('X-Forwarded-For', ip).send(body);

beforeAll(async () => {
  const { createApp } = await import('../src/app');
  app = await createApp();
  await app.listen(0, '127.0.0.1');
  server = app.getHttpServer();
  db = app.get(Db);
}, 30000);
beforeEach(async () => {
  await db.$executeRawUnsafe(
    'TRUNCATE TABLE "WebEnquiry", "User", "AuditLog", "AuthRateLimit" RESTART IDENTITY CASCADE',
  );
  for (const [index, id] of (Object.keys(tokens) as (keyof typeof tokens)[]).entries())
    await db.user.create({
      data: {
        id,
        phone: `+91999999997${index + 1}`,
        name: id,
        role: id === 'customer' ? 'CUSTOMER' : 'ADMIN',
        sessions: {
          create: {
            accessHash: hash(tokens[id]),
            refreshHash: hash(`${id}-refresh`),
            expiresAt: new Date(Date.now() + 3600000),
            refreshExpiresAt: new Date(Date.now() + 86400000),
          },
        },
      },
    });
});
afterAll(async () => {
  await app?.close();
});

describe('website enquiries', () => {
  it('stores a visitor question for the owner without an account and leaves no PII in audit', async () => {
    const response = await send();
    expect(response.status, JSON.stringify(response.body)).toBe(201);
    expect(response.body).toEqual({ received: true });
    const rows = await db.webEnquiry.findMany();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ name: 'Ramesh Kumar', status: 'NEW', pincode: '800020' });
    const audit = await db.auditLog.findMany({ where: { event: 'WEB_ENQUIRY_RECEIVED' } });
    expect(JSON.stringify(audit)).not.toContain('9876543210');
    expect(JSON.stringify(audit)).not.toContain('Ramesh');
  });

  it('answers a robot that fills the hidden field exactly like a person, and stores nothing', async () => {
    const response = await send(enquiry({ website: 'http://spam.example' }));
    expect(response.status).toBe(201);
    expect(response.body).toEqual({ received: true });
    expect(await db.webEnquiry.count()).toBe(0);
  });

  it.each([
    ['an unknown field', { isAdmin: true }],
    ['a landline', { phone: '+910612345678' }],
    ['a number without +91', { phone: '9876543210' }],
    ['a short pincode', { pincode: '8000' }],
    ['a pincode starting with 0', { pincode: '012345' }],
    ['an empty name', { name: '   ' }],
    ['a long name', { name: 'x'.repeat(81) }],
    ['a long message', { message: 'x'.repeat(1001) }],
    ['a direction override in the name', { name: 'Ram\u202Eesh' }],
    ['a zero-width space hiding a number', { name: 'Call 98\u200B76543210' }],
    ['a byte-order mark inside the name', { name: 'Ram\uFEFFesh' }],
    ['a control character in the message', { message: 'hello\u0007' }],
    ['a non-string message', { message: { $ne: '' } }],
    ['an unknown language', { language: 'fr' }],
  ])('refuses %s with 400', async (_label, override) => {
    const response = await send(enquiry(override));
    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('INVALID_INPUT');
    expect(await db.webEnquiry.count()).toBe(0);
  });

  it('accepts the half-letter joiners Hindi keyboards type, and tabs in the message', async () => {
    await send(enquiry({ name: 'क्\u200Dया राम', message: 'क्\u200Cष\tपूछना है' })).expect(201);
    expect((await db.webEnquiry.findFirstOrThrow()).name).toBe('क्\u200Dया राम');
  });

  it('keeps Hindi text, line breaks and markup as plain text', async () => {
    const message = 'छत की ढलाई के लिए 200 बोरी चाहिए।\n<script>alert(1)</script>';
    await send(enquiry({ name: 'रमेश कुमार', message })).expect(201);
    const row = await db.webEnquiry.findFirstOrThrow();
    expect(row.name).toBe('रमेश कुमार');
    expect(row.message).toBe(message);
  });

  it('limits one address to twenty enquiries an hour, robots included', async () => {
    for (let i = 0; i < 19; i++)
      await send(
        enquiry({ phone: `+9198765432${String(i).padStart(2, '0')}` }),
        '198.51.100.7',
      ).expect(201);
    await send(enquiry({ website: 'bot' }), '198.51.100.7').expect(201);
    const refused = await send(enquiry({ phone: '+919876543299' }), '198.51.100.7');
    expect(refused.status).toBe(429);
    expect(refused.body.error.code).toBe('RESOURCE_LIMIT');
    // Another visitor is not affected.
    await send(enquiry({ phone: '+919876543298' }), '198.51.100.8').expect(201);
    expect(await db.webEnquiry.count()).toBe(20);
  });

  it('limits one phone number to five enquiries a day from any address', async () => {
    for (let i = 0; i < 5; i++) await send(enquiry(), `192.0.2.${i + 1}`).expect(201);
    expect((await send(enquiry(), '192.0.2.99')).status).toBe(429);
  });

  it('lets only the owner read and handle enquiries', async () => {
    await send().expect(201);
    await request(server).get('/api/v1/admin/enquiries').expect(401);
    await request(server).get('/api/v1/admin/enquiries').set(auth('customer')).expect(403);
    const id = (await db.webEnquiry.findFirstOrThrow()).id;
    await request(server).post(`/api/v1/admin/enquiries/${id}/handle`).expect(401);
    await request(server)
      .post(`/api/v1/admin/enquiries/${id}/handle`)
      .set(auth('customer'))
      .expect(403);
    expect((await db.webEnquiry.findUniqueOrThrow({ where: { id } })).status).toBe('NEW');
  });

  it('lists new enquiries oldest first, pages them and moves handled ones out', async () => {
    for (let i = 0; i < 3; i++)
      await send(
        enquiry({ phone: `+91987654321${i}`, name: `Visitor ${i}` }),
        `10.0.0.${i}`,
      ).expect(201);
    const first = await request(server)
      .get('/api/v1/admin/enquiries?status=NEW&limit=2')
      .set(auth())
      .expect(200);
    expect(first.body.items.map((row: { name: string }) => row.name)).toEqual([
      'Visitor 0',
      'Visitor 1',
    ]);
    const second = await request(server)
      .get(`/api/v1/admin/enquiries?status=NEW&limit=2&cursor=${first.body.nextCursor}`)
      .set(auth())
      .expect(200);
    expect(second.body.items.map((row: { name: string }) => row.name)).toEqual(['Visitor 2']);
    expect(second.body.nextCursor).toBeNull();

    const id = first.body.items[0].id;
    const done = await request(server)
      .post(`/api/v1/admin/enquiries/${id}/handle`)
      .set(auth())
      .expect(201);
    expect(done.body).toMatchObject({ id, status: 'HANDLED' });
    // A second tap (or the other owner) is harmless and records nothing new.
    await request(server).post(`/api/v1/admin/enquiries/${id}/handle`).set(auth()).expect(201);
    expect(await db.auditLog.count({ where: { event: 'WEB_ENQUIRY_HANDLED' } })).toBe(1);
    const left = await request(server).get('/api/v1/admin/enquiries').set(auth()).expect(200);
    expect(left.body.items).toHaveLength(2);
    const handled = await request(server)
      .get('/api/v1/admin/enquiries?status=HANDLED')
      .set(auth())
      .expect(200);
    expect(handled.body.items.map((row: { id: string }) => row.id)).toEqual([id]);
  });

  it('refuses bad list filters, cursors and unknown ids', async () => {
    await request(server).get('/api/v1/admin/enquiries?status=ALL').set(auth()).expect(400);
    await request(server).get('/api/v1/admin/enquiries?limit=1000').set(auth()).expect(400);
    await request(server).get('/api/v1/admin/enquiries?cursor=garbage').set(auth()).expect(400);
    await request(server).post('/api/v1/admin/enquiries/missing/handle').set(auth()).expect(404);
    await request(server)
      .post(`/api/v1/admin/enquiries/${'x'.repeat(200)}/handle`)
      .set(auth())
      .expect(404);
  });

  it('forgets handled enquiries after 180 days and unanswered ones after a year', async () => {
    const day = 86400000;
    const now = Date.now();
    const base = { name: 'A', phone: '+919876543210', message: 'm', language: 'hi' };
    await db.webEnquiry.createMany({
      data: [
        { ...base, id: 'old-handled', status: 'HANDLED', handledAt: new Date(now - 181 * day) },
        { ...base, id: 'recent-handled', status: 'HANDLED', handledAt: new Date(now - 179 * day) },
        { ...base, id: 'old-new', createdAt: new Date(now - 366 * day) },
        { ...base, id: 'recent-new', createdAt: new Date(now - 300 * day) },
      ],
    });
    expect((await purgeEnquiries(db, now)).count).toBe(2);
    expect((await db.webEnquiry.findMany({ orderBy: { id: 'asc' } })).map((r) => r.id)).toEqual([
      'recent-handled',
      'recent-new',
    ]);
  });

  it('has a database check that refuses rows the API would refuse', async () => {
    await expect(
      db.webEnquiry.create({ data: { name: 'A', phone: '12345', message: 'm' } }),
    ).rejects.toThrow();
    await expect(
      db.webEnquiry.create({
        data: { name: 'A', phone: '+919876543210', message: 'm', status: 'HANDLED' },
      }),
    ).rejects.toThrow();
  });
});
