import { createHash, createHmac, randomBytes } from 'node:crypto';
import { getConfig } from '../config';
import { fail, hash, safeEqual, cookie, type AuthRequest } from '../http';
import type { Db } from '../db';
import { advisorDeviceHeader } from '@shiv/shared';

/**
 * A random token held on the phone. Its hash is the only key to a conversation: no name, no number
 * and no account are stored with it. The server signs each token it hands out, so one cannot be made
 * up or guessed, and getting a new one is limited per network address, so swapping tokens does not
 * buy more questions.
 */
const signature = (id: string) =>
  createHmac('sha256', getConfig().OTP_HASH_SECRET)
    .update(`advisor-device:${id}`)
    .digest('base64url')
    .slice(0, 22);

export function mintDeviceToken() {
  const id = randomBytes(32).toString('base64url');
  return `adv1.${id}.${signature(id)}`;
}

/** The hash to look conversations up by, or null if this is not a token we made. */
export function deviceHash(token: unknown): string | null {
  if (typeof token !== 'string' || token.length > 100) return null;
  const match = /^adv1\.([A-Za-z0-9_-]{43})\.([A-Za-z0-9_-]{22})$/.exec(token);
  if (!match || !safeEqual(signature(match[1]!), match[2]!)) return null;
  return createHash('sha256').update(token).digest('hex');
}

export function requireDevice(req: Pick<AuthRequest, 'headers'>): string {
  const header = req.headers[advisorDeviceHeader];
  const tokenHash = deviceHash(Array.isArray(header) ? header[0] : header);
  if (!tokenHash)
    fail('ADVISOR_DEVICE_REQUIRED', 'Please get a new device token and try again.', 401);
  return tokenHash;
}

/**
 * Who is signed in, used only to allow them more questions a day (decision 54). It is never stored
 * with the question: the id goes through an HMAC into a budget row and nowhere else. A bad or expired
 * token simply means a guest, because Ask never asks anyone to sign in.
 */
export async function signedInUser(
  db: Pick<Db, 'session'>,
  req: AuthRequest,
): Promise<string | null> {
  const token =
    req.headers.authorization?.match(/^Bearer ([A-Za-z0-9_-]{43})$/)?.[1] ||
    cookie(req, 'shiv_access');
  if (!token) return null;
  const session = await db.session.findUnique({
    where: { accessHash: hash(token) },
    select: { expiresAt: true, user: { select: { id: true, deletedAt: true } } },
  });
  if (!session || session.expiresAt <= new Date() || session.user.deletedAt) return null;
  return session.user.id;
}
