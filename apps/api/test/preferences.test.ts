import 'reflect-metadata';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import type { Server } from 'node:http';
import { loadEnvFile } from 'node:process';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { Db } from '../src/db';
import { readPreferences } from '../src/preferences';
import { tellOtherOwners } from '../src/users';
import { addPerson, tokenFor } from './staff-helper';

// Plan v4 B1 and B2: a person's own theme, text size and language, saved on the server so they
// follow the person, and the language the shop's messages to them use.
if (existsSync('.env.test')) loadEnvFile('.env.test');
process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
process.env.OTP_PROVIDER = 'mock';
process.env.OTP_HASH_SECRET = 'preferences-test-only-secret-not-for-production';
process.env.CORS_ORIGINS = 'http://localhost:3000';
if (!process.env.DATABASE_URL || !new URL(process.env.DATABASE_URL).pathname.endsWith('_test'))
  throw new Error('Preference tests require a dedicated TEST_DATABASE_URL ending in _test.');

let app: INestApplication;
let server: Server;
let db: Db;
const as = (id: string) => ({ Authorization: `Bearer ${tokenFor(id)}` });

beforeAll(async () => {
  const { createApp } = await import('../src/app');
  app = await createApp();
  await app.listen(0, '127.0.0.1');
  server = app.getHttpServer();
  db = app.get(Db);
  await db.$executeRawUnsafe('TRUNCATE TABLE "User", "AuthRateLimit" RESTART IDENTITY CASCADE');
  await addPerson(db, { id: 'prefowner', role: 'OWNER', phone: '+919100000601' });
  await addPerson(db, { id: 'prefother', role: 'OWNER', phone: '+919100000602' });
  await addPerson(db, { id: 'prefcustomer', phone: '+919100000603' });
  await addPerson(db, { id: 'prefhindi', role: 'OWNER', phone: '+919100000604' });
  await addPerson(db, { id: 'prefnever', role: 'OWNER', phone: '+919100000605' });
}, 30000);
afterAll(() => app.close());

describe('saving my own look', () => {
  it('saves a theme, then a text size, and keeps both', async () => {
    await request(server)
      .put('/api/v1/me/preferences')
      .set(as('prefowner'))
      .send({ theme: 'dark' })
      .expect(200);
    const res = await request(server)
      .put('/api/v1/me/preferences')
      .set(as('prefowner'))
      .send({ textSize: 'larger' })
      .expect(200);
    expect(res.body).toEqual({ theme: 'dark', textSize: 'larger' });
    const row = await db.user.findUniqueOrThrow({ where: { id: 'prefowner' } });
    expect(row.preferences).toEqual({ theme: 'dark', textSize: 'larger' });
  });

  it('sends it back with the desk session, so another device takes it', async () => {
    const res = await request(server).get('/api/v1/auth/session').set(as('prefowner')).expect(200);
    expect(res.body.preferences).toEqual({ theme: 'dark', textSize: 'larger' });
  });

  it('changes only my own row, never someone else’s', async () => {
    await request(server)
      .put('/api/v1/me/preferences')
      .set(as('prefother'))
      .send({ theme: 'light' })
      .expect(200);
    const mine = await db.user.findUniqueOrThrow({ where: { id: 'prefowner' } });
    expect(mine.preferences).toEqual({ theme: 'dark', textSize: 'larger' });
  });

  it('a customer may set their own too', async () => {
    await request(server)
      .put('/api/v1/me/preferences')
      .set(as('prefcustomer'))
      .send({ theme: 'auto' })
      .expect(200);
  });

  it('refuses nothing to save, unknown values and extra fields', async () => {
    for (const body of [
      {},
      { theme: 'purple' },
      { textSize: 'huge' },
      { theme: 'dark', userId: 'prefother' },
      { language: 'fr' },
      { language: 'HI' },
      { language: 'hindi' },
      { language: '' },
      { language: null },
      { language: ['hi'] },
    ])
      await request(server)
        .put('/api/v1/me/preferences')
        .set(as('prefowner'))
        .send(body)
        .expect(400);
  });

  it('needs a sign-in', async () => {
    await request(server).put('/api/v1/me/preferences').send({ theme: 'dark' }).expect(401);
  });

  it('never passes on keys it does not know from a stored row', () => {
    expect(readPreferences({ theme: 'dark', textSize: 'large', html: '<b>' })).toEqual({
      theme: 'dark',
      textSize: 'large',
    });
    expect(readPreferences({ theme: 'neon' })).toEqual({});
    expect(readPreferences(null)).toEqual({});
  });
});

describe('my language', () => {
  it('saves it as my choice and as the language the shop writes to me in', async () => {
    const res = await request(server)
      .put('/api/v1/me/preferences')
      .set(as('prefhindi'))
      .send({ language: 'hi' })
      .expect(200);
    expect(res.body).toEqual({ language: 'hi' });
    const row = await db.user.findUniqueOrThrow({ where: { id: 'prefhindi' } });
    expect(row.language).toBe('hi');
    expect(row.preferences).toEqual({ language: 'hi' });
  });

  it('keeps the look when only the language changes, and the language when only the look does', async () => {
    await request(server)
      .put('/api/v1/me/preferences')
      .set(as('prefowner'))
      .send({ language: 'en' })
      .expect(200);
    const res = await request(server)
      .put('/api/v1/me/preferences')
      .set(as('prefowner'))
      .send({ theme: 'light' })
      .expect(200);
    expect(res.body).toEqual({ theme: 'light', textSize: 'larger', language: 'en' });
    expect((await db.user.findUniqueOrThrow({ where: { id: 'prefowner' } })).language).toBe('en');
  });

  it('comes back with the desk session, so a new phone opens in it', async () => {
    const res = await request(server).get('/api/v1/auth/session').set(as('prefhindi')).expect(200);
    expect(res.body.preferences).toEqual({ language: 'hi' });
  });

  it('is not sent for someone who never chose, so their browser keeps its own', async () => {
    const res = await request(server).get('/api/v1/auth/session').set(as('prefnever')).expect(200);
    expect(res.body.preferences).toEqual({});
  });

  it('every owner hears of an access change in their own language', async () => {
    await db.user.update({ where: { id: 'prefnever' }, data: { language: 'hinglish' } });
    await db.notification.deleteMany({});
    await db.$transaction((tx) =>
      tellOtherOwners(tx, 'prefother', 'owner.alert.ownerAdded', 'Raju'),
    );
    const notes = await db.notification.findMany();
    const to = (userId: string) => notes.find((note) => note.userId === userId)!;
    expect(to('prefowner')).toMatchObject({
      title: 'Access changed on the desk',
      body: 'Raju is now an owner. If you did not expect this, check People and access now.',
    });
    expect(to('prefhindi')).toMatchObject({
      title: 'डेस्क पर एक्सेस बदला',
      body: expect.stringMatching(/^Raju अब मालिक हैं।/),
    });
    expect(to('prefnever').title).toBe('Desk par access badla');
    // The one who made the change is not told about it.
    expect(notes.some((note) => note.userId === 'prefother')).toBe(false);
  });

  it('saves at the same moment from two screens keep both choices', async () => {
    await db.user.update({ where: { id: 'prefnever' }, data: { preferences: {} } });
    const put = (body: object) =>
      request(server).put('/api/v1/me/preferences').set(as('prefnever')).send(body);
    const results = await Promise.all([
      put({ language: 'en' }),
      put({ theme: 'dark' }),
      put({ textSize: 'large' }),
      put({ language: 'en' }),
    ]);
    for (const res of results) expect(res.status).toBe(200);
    const row = await db.user.findUniqueOrThrow({ where: { id: 'prefnever' } });
    expect(row.preferences).toEqual({ language: 'en', theme: 'dark', textSize: 'large' });
    expect(row.language).toBe('en');
  });

  it('a stored value from before plan v4 or a tampered one never reaches a screen', () => {
    expect(readPreferences({ language: 'hi' })).toEqual({ language: 'hi' });
    expect(readPreferences({ language: 'fr' })).toEqual({});
    expect(readPreferences({ language: '<script>' })).toEqual({});
    expect(readPreferences({ language: ['en'] })).toEqual({});
  });
});

describe('the three-language migration', () => {
  it('moves staff to Hinglish and leaves customers as they were', async () => {
    const rows = [
      { id: 'migstaffhi', role: 'ADMIN', language: 'hi' },
      { id: 'migstaffen', role: 'ADMIN', language: 'en' },
      { id: 'migcusthi', role: 'CUSTOMER', language: 'hi' },
      { id: 'migcusten', role: 'CUSTOMER', language: 'en' },
      { id: 'migcontractor', role: 'CONTRACTOR', language: 'hi' },
    ] as const;
    await db.user.createMany({
      data: rows.map((row, i) => ({ ...row, phone: `+91910000070${i}` })),
    });
    const sql = readFileSync(
      'prisma/migrations/20261108170000_three_languages/migration.sql',
      'utf8',
    );
    await db.$executeRawUnsafe(sql.replace(/--.*$/gm, ''));
    const after = await db.user.findMany({
      where: { id: { in: rows.map((row) => row.id) } },
      select: { id: true, language: true },
    });
    expect(Object.fromEntries(after.map((row) => [row.id, row.language]))).toEqual({
      migstaffhi: 'hinglish',
      migstaffen: 'hinglish',
      migcusthi: 'hi',
      migcusten: 'en',
      migcontractor: 'hi',
    });
  });
});
