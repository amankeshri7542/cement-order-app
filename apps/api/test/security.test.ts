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
