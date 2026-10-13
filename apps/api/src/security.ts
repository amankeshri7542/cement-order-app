import { budget } from './abuse';
import { createHmac, randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import type { Prisma, Session, User } from '@prisma/client';
import { Db } from './db';
import { getConfig } from './config';
import { fail } from './http';

const derive = (password: string, salt: string) =>
  new Promise<Buffer>((resolve, reject) => {
    scrypt(password, salt, 64, { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 }, (error, key) =>
      error ? reject(error) : resolve(key),
    );
  });

export async function hashPassword(password: string) {
  if (password.length < 12 || password.length > 200)
    throw new Error('Admin passphrases must contain 12–200 characters.');
  const salt = randomBytes(16).toString('hex');
  return `scrypt-v1$${salt}$${(await derive(password, salt)).toString('hex')}`;
}

export async function verifyPassword(password: string, encoded: string) {
  const match = /^scrypt-v1\$([a-f0-9]{32})\$([a-f0-9]{128})$/.exec(encoded);
  if (!match || password.length < 12 || password.length > 200) return false;
  return timingSafeEqual(await derive(password, match[1]!), Buffer.from(match[2]!, 'hex'));
}

export const refreshLifetime = (role: string) => (role === 'ADMIN' ? 8 * 3600000 : 30 * 86400000);

export async function assertSession(
  db: Pick<Prisma.TransactionClient, 'adminCredential'>,
  session: Session & { user: User },
) {
  if (session.user.deletedAt || session.refreshExpiresAt <= new Date())
    fail('UNAUTHORIZED', 'Please sign in again.', 401);
  if (session.user.role !== 'ADMIN') {
    if (session.adminVerifiedAt) fail('UNAUTHORIZED', 'Staff access changed. Sign in again.', 401);
    return;
  }
  if (session.createdAt.getTime() + refreshLifetime('ADMIN') <= Date.now())
    fail('UNAUTHORIZED', 'Your staff session expired. Sign in again.', 401);
  const credential = await db.adminCredential.findUnique({ where: { userId: session.userId } });
  // Local fixtures may omit credentials; production always requires verified staff authentication.
  if (!credential && getConfig().NODE_ENV !== 'production') return;
  if (
    !credential ||
    !session.adminVerifiedAt ||
    session.adminVerifiedAt.getTime() + refreshLifetime('ADMIN') <= Date.now() ||
    credential.updatedAt > session.adminVerifiedAt
  )
    fail('UNAUTHORIZED', 'Verify your staff passphrase to continue.', 401);
}

export async function limitOtp(db: Db, ip: string, action: 'send' | 'verify') {
  const c = getConfig();
  if (c.OTP_PAUSED)
    fail('OTP_UNAVAILABLE', 'Sign-in is temporarily paused. Contact the store.', 503);
  const now = new Date();
  const ipHash = createHmac('sha256', getConfig().OTP_HASH_SECRET)
    .update(`otp-ip:${ip}`)
    .digest('hex');
  const budgets =
    action === 'send'
      ? [
          [600000, 10],
          [3600000, 30],
        ]
      : [[600000, 30]];
  const expired = await db.authRateLimit.findMany({
    where: { expiresAt: { lte: now } },
    select: { key: true },
    take: 200,
  });
  if (expired.length)
    await db.authRateLimit.deleteMany({
      where: { key: { in: expired.map((row) => row.key) }, expiresAt: { lte: now } },
    });
  const allowed = await db.atomic(async (tx) => {
    await budget(
      tx,
      `otp:${action}:global`,
      'store',
      action === 'send' ? c.OTP_SENDS_PER_DAY : c.OTP_CHECKS_PER_DAY,
      86400000,
    );
    let allowed = true;
    for (const [duration, limit] of budgets) {
      const key = `${action}:${duration}:${ipHash}`;
      const old = await tx.authRateLimit.findUnique({ where: { key } });
      const fresh = !old || old.expiresAt <= now;
      const count = fresh ? 1 : Math.min(old.count + 1, limit! + 1);
      const expiresAt = fresh ? new Date(now.getTime() + duration!) : old.expiresAt;
      await tx.authRateLimit.upsert({
        where: { key },
        create: { key, count, expiresAt },
        update: { count, expiresAt },
      });
      if (count > limit!) allowed = false;
    }
    return allowed;
  });
  if (!allowed) fail('RATE_LIMITED', 'Too many sign-in attempts. Please try again later.', 429);
}
