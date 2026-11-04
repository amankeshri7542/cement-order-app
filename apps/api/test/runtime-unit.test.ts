import { afterEach, describe, expect, it, vi } from 'vitest';
import { directLoopback } from '../src/auth';
import { requestId, safeMessage } from '../src/lifecycle';

const request = (remoteAddress: string, headers: Record<string, string>) =>
  ({ socket: { remoteAddress }, headers }) as unknown as Parameters<typeof directLoopback>[0];

describe('mock sign-in stays on this computer', () => {
  it('accepts direct loopback requests addressed to a loopback host', () => {
    for (const host of ['localhost:4000', '127.0.0.1:4000', '[::1]:4000', 'api.localhost'])
      expect(directLoopback(request('127.0.0.1', { host }))).toBe(true);
    expect(directLoopback(request('::1', { host: 'localhost' }))).toBe(true);
  });
  it('refuses tunnels and proxies that connect from loopback', () => {
    for (const header of [
      'x-forwarded-proto',
      'forwarded',
      'x-forwarded-host',
      'x-real-ip',
      'cf-connecting-ip',
      'cf-ray',
    ])
      expect(
        directLoopback(request('127.0.0.1', { host: 'localhost', [header]: '203.0.113.9' })),
      ).toBe(false);
  });
  it('refuses non-loopback hosts (tunnel names, DNS rebinding) and remote sockets', () => {
    expect(directLoopback(request('127.0.0.1', { host: 'shiv.ngrok.example' }))).toBe(false);
    expect(directLoopback(request('127.0.0.1', { host: 'localhost.evil.example' }))).toBe(false);
    expect(directLoopback(request('127.0.0.1', {}))).toBe(false);
    expect(directLoopback(request('192.168.1.20', { host: 'localhost' }))).toBe(false);
  });
});

describe('operator diagnostics never echo secrets', () => {
  it('strips credentials from connection strings and key=value pairs', () => {
    const message = safeMessage(
      new Error(
        "Can't reach postgresql://runtime:S3cret-pass@db.internal:5432/shiv?sslmode=require&password=abc token=xyz",
      ),
    );
    expect(message).toContain('postgresql://db.internal:5432/shiv');
    expect(message).not.toMatch(/S3cret|runtime:|abc|xyz/);
    expect(message).toContain('token=[redacted]');
  });
  it('keeps configuration errors readable and bounded', () => {
    expect(safeMessage(new Error('Invalid configuration: DATABASE_URL, OTP_HASH_SECRET'))).toBe(
      'Invalid configuration: DATABASE_URL, OTP_HASH_SECRET',
    );
    expect(safeMessage('x'.repeat(1000))).toHaveLength(300);
  });
  it('reuses only opaque correlation IDs', () => {
    const fresh = () => 'generated';
    expect(requestId('abcd-1234-efgh', fresh)).toBe('abcd-1234-efgh');
    for (const bad of ['short', 'has space in it', '<script>alert(1)</script>', 'x'.repeat(65), 7])
      expect(requestId(bad, fresh)).toBe('generated');
  });
});

describe('startup configuration', () => {
  const base = {
    NODE_ENV: 'development',
    DATABASE_URL: 'postgresql://user:pass@localhost:5432/db',
    OTP_HASH_SECRET: 'unit-test-secret-with-at-least-32-characters',
  };
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });
  async function load(env: Record<string, string>) {
    for (const [key, value] of Object.entries({ ...base, ...env })) vi.stubEnv(key, value);
    const { getConfig } = await import('../src/config');
    return getConfig;
  }
  it('refuses mock OTP behind a trusted proxy', async () => {
    const getConfig = await load({ OTP_PROVIDER: 'mock', TRUST_PROXY_HOPS: '1' });
    expect(() => getConfig()).toThrow(/Mock OTP cannot run behind a trusted proxy/);
  });
  it('still allows mock OTP for direct local development', async () => {
    const getConfig = await load({ OTP_PROVIDER: 'mock', TRUST_PROXY_HOPS: '0' });
    expect(getConfig().OTP_PROVIDER).toBe('mock');
  });
});
