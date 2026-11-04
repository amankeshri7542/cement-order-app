import 'reflect-metadata';
import { afterEach, describe, expect, it, vi } from 'vitest';
import sharp from 'sharp';
import { productPhoto } from '../src/product-assets';

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});
describe('product-photo byte validation', () => {
  it('rewrites valid bytes, strips metadata and trailing payloads, and bounds dimensions', async () => {
    const input = await sharp({
      create: { width: 1800, height: 10, channels: 3, background: '#f00' },
    })
      .jpeg()
      .withMetadata()
      .toBuffer();
    const output = await productPhoto(
      Buffer.concat([input, Buffer.from('<script>payload</script>')]),
      'image/jpeg',
    );
    const info = await sharp(output).metadata();
    expect(info.format).toBe('webp');
    expect(info.width).toBe(1600);
    expect(info.exif).toBeUndefined();
    expect(info.icc).toBeUndefined();
    expect(output.includes(Buffer.from('<script>'))).toBe(false);
  });
  it('rejects SVG, MIME mismatches, truncation, excessive bytes and decompression size', async () => {
    const image = await sharp({
      create: { width: 10, height: 10, channels: 3, background: '#fff' },
    })
      .png()
      .toBuffer();
    const giant = await sharp({
      create: { width: 5000, height: 5000, channels: 3, background: '#fff' },
    })
      .png()
      .toBuffer();
    for (const [bytes, type] of [
      [Buffer.from('<svg onload="alert(1)"/>'), 'image/png'],
      [image, 'image/jpeg'],
      [image.subarray(0, 40), 'image/png'],
      [Buffer.alloc(5 * 1024 * 1024 + 1), 'image/png'],
      [giant, 'image/png'],
    ] as const)
      await expect(productPhoto(bytes, type)).rejects.toHaveProperty('status');
  });
});
describe('production configuration fails closed', () => {
  const setup = () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('DATABASE_URL', 'postgresql://unused/unused');
    vi.stubEnv('OTP_HASH_SECRET', 'test-fixture-random-looking-secret-at-least-32');
    vi.stubEnv('OTP_PROVIDER', 'twilio');
    vi.stubEnv('TWILIO_ACCOUNT_SID', 'fixture');
    vi.stubEnv('TWILIO_AUTH_TOKEN', 'fixture');
    vi.stubEnv('TWILIO_VERIFY_SERVICE_SID', 'fixture');
    vi.stubEnv('CORS_ORIGINS', 'https://admin.example.com,https://shop.example.com');
  };
  it.each([
    'https://admin.example.com/path',
    'https://admin.example.com/',
    'https://admin.example.com.evil/path',
    '*',
    'http://admin.example.com',
  ])('rejects unsafe Origin configuration %s', async (origin) => {
    setup();
    vi.stubEnv('CORS_ORIGINS', origin);
    const { getConfig } = await import('../src/config');
    expect(getConfig).toThrow();
    expect(getConfig).toThrow();
  });
  it('rejects insecure or credential-bearing production object-store endpoints', async () => {
    for (const endpoint of [
      'http://storage.example.invalid',
      'https://user:password@storage.example.invalid',
      'https://storage.example.invalid/?token=test',
    ]) {
      setup();
      vi.stubEnv('R2_ENDPOINT', endpoint);
      vi.resetModules();
      const { getConfig } = await import('../src/config');
      expect(getConfig).toThrow();
    }
  });
  it('rejects production mock OTP and same-origin public assets', async () => {
    setup();
    vi.stubEnv('OTP_PROVIDER', 'mock');
    let module = await import('../src/config');
    expect(module.getConfig).toThrow();
    vi.resetModules();
    setup();
    vi.stubEnv('R2_PUBLIC_URL', 'https://admin.example.com');
    module = await import('../src/config');
    expect(module.getConfig).toThrow();
  });
});

describe('mock authentication boundary', () => {
  it('rejects a non-loopback connection even when X-Forwarded-For claims localhost', async () => {
    const config = await import('../src/config');
    const fixture = config.configSchema.parse({
      NODE_ENV: 'test',
      DATABASE_URL: 'postgresql://unused/test',
      OTP_HASH_SECRET: 'local-test-secret-with-at-least-32-characters',
    });
    const mocked = vi.spyOn(config, 'getConfig').mockReturnValue(fixture);
    const { AuthGuard } = await import('../src/auth');
    const guard = new AuthGuard(
      {} as import('../src/db').Db,
      {} as import('@nestjs/core').Reflector,
    );
    const context = {
      switchToHttp: () => ({
        getRequest: () => ({
          socket: { remoteAddress: '203.0.113.7' },
          headers: { 'x-forwarded-for': '127.0.0.1' },
        }),
      }),
    } as unknown as import('@nestjs/common').ExecutionContext;
    try {
      await expect(guard.canActivate(context)).rejects.toMatchObject({ status: 403 });
    } finally {
      mocked.mockRestore();
    }
  });
});

describe('strict owner sessions', () => {
  it('with passphrases on, an owner stays signed in for the owner session days, and no longer', async () => {
    const config = await import('../src/config');
    const policy = config.configSchema.parse({
      NODE_ENV: 'test',
      DATABASE_URL: 'postgresql://unused/security_test',
      OTP_PROVIDER: 'mock',
      OTP_HASH_SECRET: 'strict-test-only-secret-at-least-32-characters',
      STAFF_PASSPHRASE_REQUIRED: 'true',
    });
    const mocked = vi.spyOn(config, 'getConfig').mockReturnValue(policy);
    try {
      const { assertSession, refreshLifetime } = await import('../src/security');
      const verifiedAt = new Date(Date.now() - 29 * 86400000);
      const db = {
        adminCredential: { findUnique: vi.fn(async () => ({ updatedAt: new Date(0) })) },
        staffMembership: { findFirst: vi.fn(async () => ({ id: 'owner-membership' })) },
      };
      const session = {
        userId: 'owner',
        user: { role: 'ADMIN', deletedAt: null },
        createdAt: verifiedAt,
        adminVerifiedAt: verifiedAt,
        refreshExpiresAt: new Date(Date.now() + 86400000),
      } as Parameters<typeof assertSession>[1];
      expect(refreshLifetime('ADMIN')).toBe(30 * 86400000);
      // Day 29: still signed in, with no passphrase asked for that morning.
      await expect(
        assertSession(db as unknown as Parameters<typeof assertSession>[0], session),
      ).resolves.toBeUndefined();
      // Day 30: time to sign in again.
      db.adminCredential.findUnique.mockClear();
      await expect(
        assertSession(db as unknown as Parameters<typeof assertSession>[0], {
          ...session,
          createdAt: new Date(Date.now() - 30 * 86400000 - 1000),
        }),
      ).rejects.toMatchObject({
        status: 401,
      });
      expect(db.adminCredential.findUnique).not.toHaveBeenCalled();
    } finally {
      mocked.mockRestore();
    }
  });

  it.each([
    ['a live shop refuses an owner with no passphrase', 'production', undefined, 'STEP_UP_SETUP'],
    ['a demo with fake data does not', 'production', 'true', null],
    ['nor does local development', 'test', undefined, null],
  ])('%s', async (_name, nodeEnv, demo, code) => {
    const config = await import('../src/config');
    const real = config.configSchema.parse({
      NODE_ENV: 'test',
      DATABASE_URL: 'postgresql://unused/security_test',
      OTP_PROVIDER: 'mock',
      OTP_HASH_SECRET: 'strict-test-only-secret-at-least-32-characters',
    });
    const mocked = vi.spyOn(config, 'getConfig').mockReturnValue({
      ...real,
      NODE_ENV: nodeEnv as 'production',
      DEMO_MODE: demo === 'true',
    });
    try {
      const { requireStepUp } = await import('../src/security');
      const db = { adminCredential: { findUnique: vi.fn(async () => null) } };
      const result = requireStepUp(db as never, 'owner');
      if (code) await expect(result).rejects.toMatchObject({ response: { code } });
      else await expect(result).resolves.toBeUndefined();
    } finally {
      mocked.mockRestore();
    }
  });

  it('staff who carry no passphrase are not asked for one', async () => {
    const config = await import('../src/config');
    const policy = config.configSchema.parse({
      NODE_ENV: 'production',
      DATABASE_URL: 'postgresql://unused/security_test',
      OTP_PROVIDER: 'twilio',
      TWILIO_ACCOUNT_SID: 'a',
      TWILIO_AUTH_TOKEN: 'b',
      TWILIO_VERIFY_SERVICE_SID: 'c',
      CORS_ORIGINS: 'https://desk.example.test',
      OTP_HASH_SECRET: 'strict-test-only-secret-at-least-32-characters',
      STAFF_PASSPHRASE_REQUIRED: 'true',
    });
    const mocked = vi.spyOn(config, 'getConfig').mockReturnValue(policy);
    try {
      const { assertSession } = await import('../src/security');
      const db = {
        adminCredential: { findUnique: vi.fn(async () => null) },
        staffMembership: { findFirst: vi.fn(async () => null) },
      };
      const session = {
        userId: 'cashier',
        user: { role: 'ADMIN', deletedAt: null },
        createdAt: new Date(),
        adminVerifiedAt: new Date(),
        refreshExpiresAt: new Date(Date.now() + 86400000),
      } as Parameters<typeof assertSession>[1];
      await expect(
        assertSession(db as unknown as Parameters<typeof assertSession>[0], session),
      ).resolves.toBeUndefined();
      // An owner added from the desk signs in by code, then sets their passphrase.
      db.staffMembership.findFirst.mockResolvedValue({ id: 'owner-membership' } as never);
      await expect(
        assertSession(db as unknown as Parameters<typeof assertSession>[0], session),
      ).resolves.toBeUndefined();
      // Once they have one, a session that never gave it is refused.
      db.adminCredential.findUnique.mockResolvedValue({ updatedAt: new Date(0) } as never);
      await expect(
        assertSession(db as unknown as Parameters<typeof assertSession>[0], {
          ...session,
          adminVerifiedAt: null,
        }),
      ).rejects.toMatchObject({ status: 401 });
    } finally {
      mocked.mockRestore();
    }
  });

  it('revokes strict sessions when their staff credential changes', async () => {
    const config = await import('../src/config');
    const policy = config.configSchema.parse({
      NODE_ENV: 'test',
      DATABASE_URL: 'postgresql://unused/security_test',
      OTP_PROVIDER: 'mock',
      OTP_HASH_SECRET: 'strict-test-only-secret-at-least-32-characters',
      STAFF_PASSPHRASE_REQUIRED: 'true',
    });
    const mocked = vi.spyOn(config, 'getConfig').mockReturnValue(policy);
    try {
      const { assertSession } = await import('../src/security');
      const verifiedAt = new Date(Date.now() - 60000);
      const db = {
        adminCredential: { findUnique: vi.fn(async () => ({ updatedAt: new Date() })) },
        staffMembership: { findFirst: vi.fn(async () => ({ id: 'owner-membership' })) },
      };
      const session = {
        userId: 'owner',
        user: { role: 'ADMIN', deletedAt: null },
        createdAt: verifiedAt,
        adminVerifiedAt: verifiedAt,
        refreshExpiresAt: new Date(Date.now() + 3600000),
      } as Parameters<typeof assertSession>[1];
      await expect(
        assertSession(db as unknown as Parameters<typeof assertSession>[0], session),
      ).rejects.toMatchObject({
        status: 401,
      });
    } finally {
      mocked.mockRestore();
    }
  });
});
