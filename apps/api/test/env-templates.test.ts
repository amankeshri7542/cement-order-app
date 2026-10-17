import { afterEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { configSchema } from '../src/config';

// Committed environment templates must stay complete, placeholder-only and deployable once filled.
function parse(path: string) {
  const values: Record<string, string> = {};
  const documented = new Set<string>();
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    const match = line.match(/^\s*(#\s*)?([A-Z][A-Z0-9_]*)=(.*)$/);
    if (!match) continue;
    documented.add(match[2]!);
    if (!match[1]) values[match[2]!] = match[3]!;
  }
  return { values, documented };
}
const secretKeys = /SECRET|TOKEN|PASSWORD|PRIVATE_KEY|API_KEY|AUTH|ACCESS_KEY|_SID$/;
const placeholder = /REPLACE|example|change-me|local-development-only|^$/i;

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe('environment templates', () => {
  it('document every API configuration variable', () => {
    const local = parse('.env.example').documented;
    const missing = Object.keys(configSchema.shape).filter(
      (key) => !local.has(key) && !['NODE_ENV'].includes(key),
    );
    // Abuse-budget knobs are documented in docs/SECURITY.md rather than the local template.
    const tuning =
      /^(PENDING_|ORDERS_PER|QUOTES_PER|DEMAND_|OTP_SENDS|OTP_CHECKS|EXTRACTIONS|.*_PAUSED$)/;
    expect(missing.filter((key) => !tuning.test(key))).toEqual([]);
  });

  it('contain placeholders, never real-looking secrets', () => {
    for (const path of ['.env.example', 'staging.env.example']) {
      const { values } = parse(path);
      for (const [key, value] of Object.entries(values)) {
        if (secretKeys.test(key)) expect(value, `${path}: ${key}`).toMatch(placeholder);
        expect(value, `${path}: ${key}`).not.toMatch(/sk-[A-Za-z0-9]{10,}|AC[0-9a-f]{32}|rzp_live/);
      }
      const url = values.DATABASE_URL ? new URL(values.DATABASE_URL) : null;
      if (url && path.includes('staging')) expect(url.password).toMatch(/REPLACE/);
    }
  });

  it('staging template passes every production startup guard once placeholders are filled', async () => {
    const { values } = parse('staging.env.example');
    const filled = Object.fromEntries(
      Object.entries(values).map(([key, value]) => [
        key,
        key === 'OTP_HASH_SECRET'
          ? 'f'.repeat(48)
          : value.replace(/REPLACE_[A-Z_]+/g, (token) => token.toLowerCase().replace(/_/g, '-')),
      ]),
    );
    for (const [key, value] of Object.entries(filled)) vi.stubEnv(key, value);
    const { getConfig } = await import('../src/config');
    const config = getConfig();
    expect(config.NODE_ENV).toBe('production');
    expect(config.OTP_PROVIDER).toBe('twilio');
    expect(config.CORS_ORIGINS.split(',').every((origin) => origin.startsWith('https://'))).toBe(
      true,
    );
    expect(new URL(config.DATABASE_URL).searchParams.get('sslmode')).toBe('require');
    expect(config.RAZORPAY_KEY_ID).toBeUndefined();
  });

  it('staging template is refused while its secret is still a placeholder', async () => {
    const { values } = parse('staging.env.example');
    for (const [key, value] of Object.entries(values)) vi.stubEnv(key, value);
    const { getConfig } = await import('../src/config');
    expect(() => getConfig()).toThrow(/unique OTP hash secret/);
  });

  it('render.yaml deploys main and sets only API variables the template documents', () => {
    const blueprint = readFileSync('../../render.yaml', 'utf8');
    const branches = [...blueprint.matchAll(/^\s+branch:\s*(\S+)/gm)].map((m) => m[1]);
    expect(branches).toEqual(['main', 'main', 'main']);
    const api = blueprint.split(/^\s+- type: web/m)[1]!;
    const keys = [...api.matchAll(/^\s+- key:\s*([A-Z0-9_]+)/gm)].map((m) => m[1]!);
    const staging = parse('staging.env.example').documented;
    const known = new Set([...Object.keys(configSchema.shape), 'RELEASE_SHA']);
    expect(keys.filter((key) => !known.has(key))).toEqual([]);
    expect(keys.filter((key) => !staging.has(key))).toEqual([]);
  });

  it('production refuses mock OTP and plain-HTTP origins', async () => {
    const { values } = parse('staging.env.example');
    for (const [key, value] of Object.entries({
      ...values,
      OTP_HASH_SECRET: 'f'.repeat(48),
      OTP_PROVIDER: 'mock',
      TRUST_PROXY_HOPS: '0',
    }))
      vi.stubEnv(key, value);
    const { getConfig } = await import('../src/config');
    expect(() => getConfig()).toThrow(/Production requires real OTP/);
  });
});
