import { afterEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';

// Startup guards from the 15 October 2026 audit (F25 NODE_ENV, F19 Android version policy).
const base = {
  NODE_ENV: 'development',
  DATABASE_URL: 'postgresql://user:pass@localhost:5432/shiv_cement',
  OTP_HASH_SECRET: 'unit-test-secret-with-at-least-32-characters',
};
afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});
async function load(env: Record<string, string | undefined>) {
  for (const [key, value] of Object.entries({ ...base, ...env })) vi.stubEnv(key, value);
  const { getConfig } = await import('../src/config');
  return getConfig;
}

describe('NODE_ENV', () => {
  it('is required, so a deploy that forgets it cannot run as development', async () => {
    const getConfig = await load({ NODE_ENV: undefined });
    expect(() => getConfig()).toThrow(/Invalid configuration: NODE_ENV/);
  });
  it('refuses test mode against a database whose name does not end in _test', async () => {
    for (const url of [base.DATABASE_URL, 'postgresql://user:pass@localhost:5432/shiv_testing']) {
      vi.resetModules();
      const getConfig = await load({ NODE_ENV: 'test', DATABASE_URL: url });
      expect(() => getConfig()).toThrow(/NODE_ENV=test requires/);
    }
  });
  it('allows test mode on a disposable _test database and development on any database', async () => {
    let getConfig = await load({
      NODE_ENV: 'test',
      DATABASE_URL: 'postgresql://user:pass@localhost:5432/shiv_cement_test',
    });
    expect(getConfig().NODE_ENV).toBe('test');
    vi.resetModules();
    getConfig = await load({});
    expect(getConfig().NODE_ENV).toBe('development');
  });
  it('is set by every committed API environment template', () => {
    for (const path of ['.env.example', 'staging.env.example'])
      expect(readFileSync(path, 'utf8'), path).toMatch(/^NODE_ENV=(development|production)$/m);
  });
});

describe('Android version policy', () => {
  it('refuses a minimum version above the latest version', async () => {
    const getConfig = await load({
      ANDROID_MINIMUM_VERSION: '1.0.2',
      ANDROID_LATEST_VERSION: '1.0.1',
    });
    expect(() => getConfig()).toThrow(/ANDROID_MINIMUM_VERSION cannot be above/);
  });
  it.each([
    ['1.0.1', '1.0.1'],
    ['1.0.9', '1.0.10'],
    ['1.2.0', '2.0.0'],
  ])('accepts minimum %s with latest %s', async (minimum, latest) => {
    const getConfig = await load({
      ANDROID_MINIMUM_VERSION: minimum,
      ANDROID_LATEST_VERSION: latest,
    });
    expect(getConfig().ANDROID_MINIMUM_VERSION).toBe(minimum);
  });
});
