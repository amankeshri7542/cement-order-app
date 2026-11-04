import 'reflect-metadata';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { loadEnvFile } from 'node:process';
import { existsSync } from 'node:fs';
import { request as httpRequest } from 'node:http';
import type { INestApplication } from '@nestjs/common';

// Runtime behaviour on a disposable database: health, request logs, drain and shutdown.
if (existsSync('.env.test')) loadEnvFile('.env.test');
process.env.NODE_ENV = 'development'; // request logs are silenced only under NODE_ENV=test
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
process.env.OTP_PROVIDER = 'mock';
process.env.OTP_HASH_SECRET = 'runtime-test-only-secret-with-32-characters';
process.env.CORS_ORIGINS = 'http://localhost:3000';
process.env.TRUST_PROXY_HOPS = '0';
if (!process.env.DATABASE_URL || !new URL(process.env.DATABASE_URL).pathname.endsWith('_test'))
  throw new Error('Runtime tests require a dedicated TEST_DATABASE_URL ending in _test.');

let app: INestApplication;
let base = '';
beforeAll(async () => {
  const { createApp } = await import('../src/app');
  app = await createApp();
  await app.listen(0, '127.0.0.1');
  base = `http://localhost:${(app.getHttpServer().address() as { port: number }).port}/api/v1`;
});
afterAll(async () => {
  await app?.close().catch(() => {});
});

describe('health endpoints', () => {
  it('separates liveness from database readiness', async () => {
    expect(await (await fetch(`${base}/health/live`)).json()).toEqual({ status: 'ok' });
    expect(await (await fetch(`${base}/health/ready`)).json()).toEqual({ status: 'ready' });
    expect(await (await fetch(`${base}/health`)).json()).toEqual({ status: 'ok' });
  });
});

describe('mock sign-in exposure', () => {
  it('refuses proxied or foreign-host requests even when they reach loopback', async () => {
    const tunnel = await fetch(`${base}/auth/session`, {
      // Shape of a request relayed by a TLS-terminating tunnel that rewrites Host to localhost.
      headers: { 'X-Forwarded-For': '203.0.113.9', 'X-Forwarded-Proto': 'https' },
    });
    expect(tunnel.status).toBe(403);
    // fetch() cannot override Host, so send the DNS-rebinding shape with node:http.
    const rebinding = await new Promise<{ status: number; body: string }>((resolve, reject) => {
      const url = new URL(`${base}/auth/otp/request`);
      const req = httpRequest(
        {
          host: '127.0.0.1',
          port: url.port,
          path: url.pathname,
          method: 'POST',
          headers: { Host: 'shiv.tunnel.example', 'Content-Type': 'application/json' },
        },
        (res) => {
          let body = '';
          res.on('data', (chunk) => (body += chunk));
          res.on('end', () => resolve({ status: res.statusCode || 0, body }));
        },
      );
      req.on('error', reject);
      req.end(JSON.stringify({ phone: '+919999999990' }));
    });
    expect(rebinding.status).toBe(403);
    expect(rebinding.body).not.toContain('devCode');
    // A direct local request reaches normal authentication instead.
    expect((await fetch(`${base}/auth/session`)).status).toBe(401);
  });
});

describe('request logs', () => {
  it('record route pattern, status and duration without query strings or IDs', async () => {
    const lines: string[] = [];
    const spy = vi.spyOn(console, 'log').mockImplementation((line: unknown) => {
      lines.push(String(line));
    });
    try {
      await fetch(`${base}/products?q=9876543210&limit=1`);
      await fetch(`${base}/products/private-looking-id`);
      await new Promise((resolve) => setTimeout(resolve, 50));
    } finally {
      spy.mockRestore();
    }
    const events = lines.map((line) => JSON.parse(line)).filter((e) => e.event === 'HTTP_REQUEST');
    expect(events.map((e) => e.route)).toEqual(
      expect.arrayContaining(['/api/v1/products', '/api/v1/products/:id']),
    );
    for (const event of events) {
      expect(typeof event.durationMs).toBe('number');
      expect(event.requestId).toMatch(/^[0-9a-f-]{36}$/);
    }
    expect(lines.join('\n')).not.toMatch(/9876543210|private-looking-id/);
  });
});

describe('graceful shutdown', () => {
  it('ends open event streams, refuses readiness and finishes within the drain window', async () => {
    const { Lifecycle, shutdown } = await import('../src/lifecycle');
    const stream = await fetch(`${base}/events`);
    expect(stream.status).toBe(200);
    const ended = (async () => {
      const reader = stream.body!.getReader();
      for (;;) if ((await reader.read()).done) return 'ended';
    })();
    const lifecycle = app.get(Lifecycle);
    const started = Date.now();
    lifecycle.stop();
    expect((await fetch(`${base}/health/ready`)).status).toBe(503);
    await expect(ended).resolves.toBe('ended');
    await shutdown(app, 5000);
    expect(Date.now() - started).toBeLessThan(5000);
  });
});
