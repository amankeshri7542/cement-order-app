import { budget, budgetUsed } from './abuse';
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

/**
 * Owners stay signed in on their own phone. The passphrase guards the sign-in and changes of
 * access (requireStepUp), and does not make anyone sign in again every morning.
 */
export const refreshLifetime = (role: string) =>
  role === 'ADMIN' ? getConfig().OWNER_SESSION_DAYS * 86400000 : 30 * 86400000;

export async function assertSession(
  db: Pick<Prisma.TransactionClient, 'adminCredential' | 'staffMembership'>,
  session: Session & { user: User },
) {
  if (session.user.deletedAt || session.refreshExpiresAt <= new Date())
    fail('UNAUTHORIZED', 'Please sign in again.', 401);
  if (session.user.role !== 'ADMIN') {
    if (session.adminVerifiedAt) fail('UNAUTHORIZED', 'Staff access changed. Sign in again.', 401);
    return;
  }
  if (!getConfig().STAFF_PASSPHRASE_REQUIRED) return;
  if (session.createdAt.getTime() + refreshLifetime('ADMIN') <= Date.now())
    fail('UNAUTHORIZED', 'Your staff session expired. Sign in again.', 401);
  // Only roles that can reach everything carry a passphrase. Other staff use OTP alone.
  const needsPassphrase = await db.staffMembership.findFirst({
    where: { userId: session.userId, endedAt: null, role: { in: ['OWNER', 'ACCOUNTANT'] } },
    select: { id: true },
  });
  if (!needsPassphrase) return;
  const credential = await db.adminCredential.findUnique({ where: { userId: session.userId } });
  // Someone added from the desk signs in by code first, then sets their passphrase.
  if (!credential) return;
  if (
    !session.adminVerifiedAt ||
    session.adminVerifiedAt.getTime() + refreshLifetime('ADMIN') <= Date.now() ||
    credential.updatedAt > session.adminVerifiedAt
  )
    fail('UNAUTHORIZED', 'Verify your staff passphrase to continue.', 401);
}

/** Whose number a code is for: an owner, a customer with an account, or a number never seen. */
export type OtpTier = 'owner' | 'known' | 'new';
export async function otpTier(db: Pick<Prisma.TransactionClient, 'user'>, phone: string) {
  const user = await db.user.findUnique({ where: { phone }, select: { role: true } });
  return !user ? 'new' : user.role === 'ADMIN' ? 'owner' : 'known';
}

/**
 * Store-wide daily OTP budget. Callers charge it only after the per-IP limit (limitOtp) and the
 * per-phone checks pass, so one client's rejected requests cannot switch sign-in off for everyone.
 * Numbers never seen before share one budget and existing customers have their own, so a flood of
 * codes to made-up numbers cannot lock out the shop's customers. Owners' numbers are not counted
 * at all (each is still held to five codes an hour), so the shop can always sign in. The worst-case
 * SMS spend is therefore about twice the configured daily figure.
 */
export async function otpBudget(
  tx: Prisma.TransactionClient,
  action: 'send' | 'verify',
  tier: OtpTier,
) {
  if (tier === 'owner') return;
  const c = getConfig();
  await budget(
    tx,
    tier === 'known' ? `otp:${action}:known` : `otp:${action}:global`,
    'store',
    action === 'send' ? c.OTP_SENDS_PER_DAY : c.OTP_CHECKS_PER_DAY,
    86400000,
  );
}

// Wrong staff passphrases per account and network address per hour. After that, that address
// cannot start staff sign-in for the account, even with the right passphrase, until the hour
// ends; existing staff sessions are unaffected. Keyed by address as well, so someone who only
// knows an owner's number cannot lock the owner out from elsewhere. Every guess also needs a live
// SMS challenge (5 checks per code, 5 codes an hour per phone), which bounds guessing overall.
export const staffPassphraseFailures = 10;
const passphraseScope = 'staff:passphrase';
const staffSubject = (userId: string, ip: string) =>
  `${userId}:${createHmac('sha256', getConfig().OTP_HASH_SECRET).update(`staff-ip:${ip}`).digest('hex').slice(0, 32)}`;
export async function assertStaffAttempts(db: Db, userId: string, ip: string) {
  if ((await budgetUsed(db, passphraseScope, staffSubject(userId, ip))) >= staffPassphraseFailures)
    fail('RATE_LIMITED', 'Too many sign-in attempts. Please try again later.', 429);
}
export async function recordStaffFailure(db: Db, userId: string, ip: string) {
  const subject = staffSubject(userId, ip);
  await db.atomic(async (tx) => {
    await budget(tx, passphraseScope, subject, staffPassphraseFailures);
    if ((await budgetUsed(tx, passphraseScope, subject)) < staffPassphraseFailures) return;
    console.warn(JSON.stringify({ event: 'STAFF_PASSPHRASE_LOCKED', userId }));
    await tx.auditLog.create({
      data: {
        actorId: 'system',
        event: 'STAFF_PASSPHRASE_LOCKED',
        entityId: userId,
        details: { failures: staffPassphraseFailures, durationMs: 3600000 },
      },
    });
  });
}

/**
 * Changing who can do what asks again for the passphrase of anyone who has one, so a stolen
 * signed-in phone cannot quietly give itself a second way in.
 */
export async function requireStepUp(db: Db, userId: string, passphrase?: string) {
  const credential = await db.adminCredential.findUnique({ where: { userId } });
  if (!credential) {
    const c = getConfig();
    // A live shop never lets a phone change access on its session alone.
    if (c.NODE_ENV === 'production' && !c.DEMO_MODE)
      fail('STEP_UP_SETUP', 'Set your own passphrase before changing access.', 403);
    return;
  }
  await checkPassphrase(db, userId, passphrase, credential.passwordHash);
}
/** A session is already signed in, so guesses count per person, whichever address they come from. */
export async function checkPassphrase(
  db: Db,
  userId: string,
  passphrase: string | undefined,
  passwordHash: string,
) {
  const subject = 'step-up';
  await assertStaffAttempts(db, userId, subject);
  if (!passphrase) fail('STEP_UP_REQUIRED', 'Enter your passphrase to change access.', 403);
  if (!(await verifyPassword(passphrase, passwordHash))) {
    await recordStaffFailure(db, userId, subject);
    fail('STEP_UP_FAILED', 'That passphrase is not right.', 403);
  }
}

/** Per-IP OTP limits. The store-wide budget is charged separately (otpBudget). */
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
