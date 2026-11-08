import 'reflect-metadata';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { existsSync } from 'node:fs';
import type { Server } from 'node:http';
import { loadEnvFile } from 'node:process';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { Db } from '../src/db';
import { readPreferences } from '../src/preferences';
import { addPerson, tokenFor } from './staff-helper';

// Plan v4 B1: a person's own theme and text size, saved on the server so they follow the person.
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
