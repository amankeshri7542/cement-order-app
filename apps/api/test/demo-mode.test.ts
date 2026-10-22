import 'reflect-metadata';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loadEnvFile } from 'node:process';
import { existsSync } from 'node:fs';
import type { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

// Hosted fake-data demo: mock OTP served through a proxy, with staff codes kept off screen.
if (existsSync('.env.test')) loadEnvFile('.env.test');
process.env.NODE_ENV = 'development';
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
process.env.OTP_PROVIDER = 'mock';
process.env.DEMO_MODE = 'true';
process.env.DEMO_STAFF_CODE = '482913';
process.env.OTP_HASH_SECRET = 'demo-mode-test-only-secret-with-32-characters';
process.env.CORS_ORIGINS = 'http://localhost:3000';
process.env.TRUST_PROXY_HOPS = '1';
if (!process.env.DATABASE_URL || !new URL(process.env.DATABASE_URL).pathname.endsWith('_test'))
  throw new Error('Demo mode tests require a dedicated TEST_DATABASE_URL ending in _test.');

const staff = '+919000000071';
const customer = '+919000000072';
let app: INestApplication;
let base = '';
const db = new PrismaClient();
const proxied = { 'Content-Type': 'application/json', 'X-Forwarded-For': '203.0.113.9' };
beforeAll(async () => {
  await db.user.upsert({
    where: { phone: staff },
    create: { phone: staff, name: 'Demo Owner', role: 'ADMIN' },
    update: { role: 'ADMIN' },
  });
  const { createApp } = await import('../src/app');
  app = await createApp();
  await app.listen(0, '127.0.0.1');
  base = `http://localhost:${(app.getHttpServer().address() as { port: number }).port}/api/v1`;
});
afterAll(async () => {
  await app?.close().catch(() => {});
  await db.$disconnect();
});
const send = (phone: string) =>
  fetch(`${base}/auth/otp/request`, {
    method: 'POST',
    headers: proxied,
    body: JSON.stringify({ phone }),
  });

describe('DEMO_MODE sign-in', () => {
  it('serves proxied requests that plain mock OTP refuses', async () => {
    expect((await fetch(`${base}/auth/session`, { headers: proxied })).status).toBe(401);
  });
  it('shows customers their code but never shows a staff code', async () => {
    const shown = await send(customer);
    expect(shown.status).toBe(201);
    expect((await shown.json()).devCode).toMatch(/^\d{6}$/);
    const hidden = await send(staff);
    expect(hidden.status).toBe(201);
    expect(await hidden.text()).not.toContain('devCode');
  });
  it('signs staff in with the operator-held demo code', async () => {
    const verified = await fetch(`${base}/auth/otp/verify`, {
      method: 'POST',
      headers: proxied,
      body: JSON.stringify({ phone: staff, code: '482913' }),
    });
    expect(verified.status).toBe(201);
    expect((await verified.json()).user.role).toBe('ADMIN');
  });
});
