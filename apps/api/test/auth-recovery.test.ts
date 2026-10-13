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
  fetchMock.mockReset().mockResolvedValue(Response.json({ status: 'approved' }));
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
    },
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
  it('keeps a code usable after a wrong passphrase and consumes it only once', async () => {
    const { service, db, challenge } = staffFixture();
    await expect(service.verify(phone, '123456', 'wrong-staff-passphrase')).rejects.toMatchObject({
      status: 401,
      response: { code: 'INVALID_CREDENTIALS' },
    });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(challenge).toMatchObject({ attempts: 1, consumed: false });
    const result = await service.verify(phone, '123456', password);
    expect(result.user.id).toBe('staff');
    expect(result.accessToken).toHaveLength(43);
    expect(JSON.stringify(result)).not.toContain(passwordHash);
    expect(challenge).toMatchObject({ attempts: 2, consumed: true });
    await expect(service.verify(phone, '123456', password)).rejects.toMatchObject({
      response: { code: 'INVALID_OTP' },
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
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
          response: { code: 'INVALID_CREDENTIALS' },
        },
      );
    await expect(service.verify(phone, '123456', password)).rejects.toMatchObject({
      response: { code: 'INVALID_OTP' },
    });
    expect(challenge.attempts).toBe(5);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(db.session.create).not.toHaveBeenCalled();
  });

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
      response: { code: 'INVALID_CREDENTIALS' },
    });
    expect(db.session.create).not.toHaveBeenCalled();
  });
});
