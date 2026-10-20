import 'reflect-metadata';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Prisma } from '@prisma/client';
import { AuthService } from '../src/auth';
import type { Db } from '../src/db';
import * as config from '../src/config';
import { hashPassword } from '../src/security';

const phone = '+919999999993';
const password = 'correct-staff-passphrase';
const fetchMock = vi.fn<typeof fetch>();
let passwordHash: string;

beforeAll(async () => {
  passwordHash = await hashPassword(password);
});
beforeEach(() => {
  vi.spyOn(config, 'getConfig').mockReturnValue(
    config.configSchema.parse({
      NODE_ENV: 'test',
      OTP_PROVIDER: 'twilio',
      STAFF_PASSPHRASE_REQUIRED: 'true',
      OTP_HASH_SECRET: 'provider-contract-test-secret-only',
      DATABASE_URL: 'postgresql://unused/unused_test',
      PORT: 4000,
      TRUST_PROXY_HOPS: 0,
      CORS_ORIGINS: 'http://localhost:3000',
      TWILIO_ACCOUNT_SID: 'test-account',
      TWILIO_AUTH_TOKEN: 'test-token',
      TWILIO_VERIFY_SERVICE_SID: 'test-service',
    }),
  );
  vi.stubGlobal('fetch', fetchMock);
  fetchMock.mockReset().mockImplementation(async () => Response.json({ status: 'approved' }));
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

// Provider-contract simulation; PostgreSQL/session integration is exercised separately.
function staffFixture() {
  const challenge = {
    phone,
    codeHash: 'challenge-generation',
    expiresAt: new Date(Date.now() + 300000),
    consumed: false,
    attempts: 0,
  };
  const user = { id: 'staff', phone, role: 'ADMIN', deletedAt: null };
  const credential = { passwordHash };
  const limits = new Map<string, { key: string; count: number; expiresAt: Date }>();
  const db = {
    otpChallenge: {
      findUnique: vi.fn(async () => ({ ...challenge })),
      updateMany: vi.fn(async ({ data }: Prisma.OtpChallengeUpdateManyArgs) => {
        if (challenge.consumed || challenge.expiresAt <= new Date()) return { count: 0 };
        if (data.attempts) {
          if (challenge.attempts >= 5) return { count: 0 };
          challenge.attempts++;
        }
        if (data.consumed === true) challenge.consumed = true;
        return { count: 1 };
      }),
    },
    user: {
      findUnique: vi.fn(async () => user),
      upsert: vi.fn(async () => user),
    },
    adminCredential: { findUnique: vi.fn(async () => credential) },
    authRateLimit: {
      count: vi.fn(async () => 0),
      create: vi.fn(async () => ({})),
      deleteMany: vi.fn(async () => ({ count: 1 })),
      // Budget rows (store-wide OTP checks, staff passphrase failures).
      findUnique: vi.fn(async ({ where }: { where: { key: string } }) => limits.get(where.key)),
      upsert: vi.fn(
        async ({
          where,
          create,
          update,
        }: {
          where: { key: string };
          create: { key: string; count: number; expiresAt: Date };
          update: { count: number; expiresAt?: Date };
        }) => {
          const old = limits.get(where.key);
          limits.set(where.key, old ? { ...old, ...update } : create);
        },
      ),
    },
    auditLog: { create: vi.fn(async () => ({})) },
    session: { create: vi.fn(async () => ({})) },
    atomic: async (run: (tx: unknown) => Promise<unknown>) => {
      const consumed = challenge.consumed;
      try {
        return await run(db);
      } catch (error) {
        challenge.consumed = consumed;
        throw error;
      }
    },
  };
  return { service: new AuthService(db as unknown as Db), db, challenge, credential };
}

describe('Twilio staff OTP recovery (provider-contract simulation)', () => {
  it('checks OTP before the passphrase and needs a fresh code after provider approval', async () => {
    const { service, db, challenge } = staffFixture();
    const approvedCodes = new Set<string>();
    fetchMock.mockImplementation(async (_url, init) => {
      const code = new URLSearchParams(String(init?.body)).get('Code')!;
      if (approvedCodes.has(code)) return Response.json({ code: 20404 }, { status: 404 });
      approvedCodes.add(code);
      return Response.json({ status: 'approved' });
    });
    await expect(service.verify(phone, '123456', 'wrong-staff-passphrase')).rejects.toMatchObject({
      status: 401,
      response: { code: 'INVALID_OTP' },
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(db.adminCredential.findUnique).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.invocationCallOrder[0]).toBeLessThan(
      db.adminCredential.findUnique.mock.invocationCallOrder[0]!,
    );
    expect(challenge).toMatchObject({ attempts: 1, consumed: false });
    await expect(service.verify(phone, '123456', password)).rejects.toMatchObject({
      response: { code: 'INVALID_OTP' },
    });
    expect(db.adminCredential.findUnique).toHaveBeenCalledTimes(1);
    expect(db.session.create).not.toHaveBeenCalled();
    // A new SMS challenge replaces the generation consumed by the provider.
    challenge.codeHash = 'replacement-generation';
    challenge.attempts = 0;
    const result = await service.verify(phone, '654321', password);
    expect(result.user.id).toBe('staff');
    expect(result.accessToken).toHaveLength(43);
    expect(JSON.stringify(result)).not.toContain(passwordHash);
    expect(challenge).toMatchObject({ attempts: 1, consumed: true });
    await expect(service.verify(phone, '654321', password)).rejects.toMatchObject({
      response: { code: 'INVALID_OTP' },
    });
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(db.session.create).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]![0]).toBe(
      'https://verify.twilio.com/v2/Services/test-service/VerificationCheck',
    );
    expect(String(fetchMock.mock.calls[0]![1]?.body)).toBe('To=%2B919999999993&Code=123456');
  });

  it('retains the five-attempt limit for passphrase mistakes', async () => {
    const { service, challenge, db } = staffFixture();
    for (let attempt = 0; attempt < 5; attempt++)
      await expect(service.verify(phone, '123456', 'wrong-staff-passphrase')).rejects.toMatchObject(
        {
          response: { code: 'INVALID_OTP' },
        },
      );
    await expect(service.verify(phone, '123456', password)).rejects.toMatchObject({
      response: { code: 'INVALID_OTP' },
    });
    expect(challenge.attempts).toBe(5);
    expect(fetchMock).toHaveBeenCalledTimes(5);
    expect(db.adminCredential.findUnique).toHaveBeenCalledTimes(5);
    expect(db.session.create).not.toHaveBeenCalled();
  });

  it.each([password, 'wrong-staff-passphrase', undefined])(
    'does not inspect staff credentials before OTP approval (%s)',
    async (passphrase) => {
      const { service, db } = staffFixture();
      fetchMock.mockResolvedValueOnce(Response.json({ status: 'pending' }));
      await expect(service.verify(phone, '000000', passphrase)).rejects.toMatchObject({
        status: 401,
        response: { code: 'INVALID_OTP' },
      });
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(db.adminCredential.findUnique).not.toHaveBeenCalled();
      expect(db.session.create).not.toHaveBeenCalled();
    },
  );

  // Staff get one answer for a wrong or expired code and a wrong passphrase (no passphrase oracle).
  it.each([
    [404, { code: 20404 }, 'INVALID_OTP', 401],
    [503, { message: 'Temporarily unavailable' }, 'OTP_UNAVAILABLE', 503],
    [200, {}, 'OTP_UNAVAILABLE', 503],
    [200, { status: 'pending' }, 'INVALID_OTP', 401],
  ])('maps provider HTTP %s honestly', async (status, body, code, expectedStatus) => {
    const { service, db } = staffFixture();
    fetchMock.mockResolvedValueOnce(Response.json(body, { status }));
    await expect(service.verify(phone, '123456', password)).rejects.toMatchObject({
      status: expectedStatus,
      response: { code },
    });
    expect(db.session.create).not.toHaveBeenCalled();
  });

  it('reports network failure as provider unavailability', async () => {
    const { service, db } = staffFixture();
    fetchMock.mockRejectedValueOnce(new Error('Network unavailable'));
    await expect(service.verify(phone, '123456', password)).rejects.toMatchObject({
      status: 503,
      response: { code: 'OTP_UNAVAILABLE' },
    });
    expect(db.session.create).not.toHaveBeenCalled();
  });

  it('does not grant a session when staff credentials change during provider verification', async () => {
    const { service, credential, db } = staffFixture();
    const replacement = await hashPassword('replacement-staff-passphrase');
    fetchMock.mockImplementationOnce(async () => {
      credential.passwordHash = replacement;
      return Response.json({ status: 'approved' });
    });
    await expect(service.verify(phone, '123456', password)).rejects.toMatchObject({
      response: { code: 'INVALID_OTP' },
    });
    expect(db.session.create).not.toHaveBeenCalled();
  });
});
