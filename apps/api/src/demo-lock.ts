import type { PrismaClient } from '@prisma/client';
import type { Config } from './config';

/**
 * The sink lock. The demo seed (`npm run seed:demo`) fills a database with made-up customers whose
 * phone numbers are valid Indian mobile numbers, so any of them could belong to a real person.
 * While a DemoBatch row exists, nothing may reach a phone:
 *
 * - at startup the API refuses to run unless every channel is a fake or switched off;
 * - each real send path checks again before it sends, for a seed loaded while the API was running.
 *
 * DemoBatch rows cannot be deleted (a database trigger), so the only way out is dropping the database.
 */
const CACHE_MS = 30_000;
let cache: { at: number; loaded: boolean } | null = null;

export async function demoDataLoaded(db: Pick<PrismaClient, 'demoBatch'>, now = Date.now()) {
  if (cache && now - cache.at < CACHE_MS) return cache.loaded;
  const loaded = (await db.demoBatch.count()) > 0;
  cache = { at: now, loaded };
  return loaded;
}

/** For tests: forget the last answer. */
export function forgetDemoLock() {
  cache = null;
}

/** The channels this configuration would use to send real messages. */
export function realSenders(c: Config): string[] {
  const real: string[] = [];
  if (c.OTP_PROVIDER === 'twilio') real.push('SMS codes (OTP_PROVIDER=twilio)');
  if (c.WHATSAPP_PROVIDER === 'meta') real.push('WhatsApp alerts (WHATSAPP_PROVIDER=meta)');
  if (['meta', 'd360', 'ycloud'].includes(c.WA_REPLY_PROVIDER))
    real.push(`WhatsApp replies (WA_REPLY_PROVIDER=${c.WA_REPLY_PROVIDER})`);
  if (c.FIREBASE_PROJECT_ID || c.FIREBASE_CLIENT_EMAIL || c.FIREBASE_PRIVATE_KEY)
    real.push('app push (FIREBASE_*)');
  if (c.WEB_PUSH_PUBLIC_KEY || c.WEB_PUSH_PRIVATE_KEY) real.push('web push (WEB_PUSH_*)');
  return real;
}

/** Startup: refuse to run on demo data with any real sender configured. */
export async function assertDemoSinks(db: Pick<PrismaClient, 'demoBatch'>, c: Config) {
  forgetDemoLock();
  if (!(await demoDataLoaded(db))) return;
  const real = realSenders(c);
  if (real.length)
    throw new Error(
      `Demo data is loaded in this database, and its phone numbers may be real people's. Refusing to start while these would send real messages: ${real.join('; ')}. Switch them to their fake or off settings, or use a database without demo data.`,
    );
}

/** A send path's check: true means do not send for real. */
export async function sendBlocked(db: Pick<PrismaClient, 'demoBatch'>) {
  return demoDataLoaded(db);
}
