import { punchMessage } from '@shiv/shared';

/** Same shape the server reads, so a code that is plainly not ours is refused at once, even offline. */
const shopQr = /^SHV1\.[A-Z0-9]{4,12}\.\d{1,12}\.[A-Z2-7]{16}$/;
export const isShopQr = (text: string) => shopQr.test(text);

export type Fix = { lat: number; lng: number; accuracyM: number | null; mocked: boolean };
export type LocationStatus = 'OK' | 'NO_FIX' | 'DENIED' | 'GPS_OFF' | 'APPROXIMATE';
export type FixState = { status: LocationStatus; fix: Fix | null };

/** Past this the phone is guessing, and the server treats it as no position at all. */
const weakAccuracyM = 500;
const usable = (fix: Fix) =>
  Number.isFinite(fix.lat) &&
  Number.isFinite(fix.lng) &&
  Math.abs(fix.lat) <= 90 &&
  Math.abs(fix.lng) <= 180;

export type LocationFields = {
  location: LocationStatus;
  mocked: boolean;
  lat?: number;
  lng?: number;
  accuracyM?: number;
};
/**
 * What a scan says about where the phone is. A weak fix is reported as no fix rather than as a
 * position, but a fake-location mark is never lost along with it.
 */
export function locationFields(state: FixState): LocationFields {
  const mocked = state.fix?.mocked === true;
  if (state.status === 'DENIED' || state.status === 'GPS_OFF')
    return { location: state.status, mocked };
  const fix = state.fix;
  const good =
    fix &&
    usable(fix) &&
    typeof fix.accuracyM === 'number' &&
    Number.isFinite(fix.accuracyM) &&
    fix.accuracyM >= 0 &&
    fix.accuracyM <= weakAccuracyM;
  if (state.status === 'APPROXIMATE')
    return good
      ? {
          location: 'APPROXIMATE',
          mocked,
          lat: fix.lat,
          lng: fix.lng,
          accuracyM: fix.accuracyM as number,
        }
      : { location: 'APPROXIMATE', mocked };
  if (!good) return { location: 'NO_FIX', mocked };
  return {
    location: 'OK',
    mocked,
    lat: fix.lat,
    lng: fix.lng,
    accuracyM: fix.accuracyM as number,
  };
}

/** The screen gathers a position for 8 seconds at most, so no spinner ever holds a scan. */
export const locationCapMs = 8000;
const longestWaitAfterScanMs = 3000;
/** How long a scan may wait for a first position, given how long the screen has been looking. */
export function fixWaitMs(lookingForMs: number) {
  return Math.min(Math.max(locationCapMs - lookingForMs, 0), longestWaitAfterScanMs);
}
/** The best position so far: the most accurate one, and a newer one wins a tie. */
export function betterFix<T extends { accuracyM: number | null }>(best: T | null, next: T): T {
  if (!best) return next;
  if (next.accuracyM === null) return best;
  if (best.accuracyM === null) return next;
  return next.accuracyM <= best.accuracyM ? next : best;
}

export type PunchKind = 'IN' | 'OUT';
export type PunchCapture = LocationFields & {
  captureId: string;
  qr: string;
  kind: PunchKind;
  bootCount: number;
  appVersion: string;
};
export type PunchBody = PunchCapture & { claimedAgeMs: number };

/** The exact fields sent. The signature is made over these at sending, since the age keeps growing. */
export function punchBody(capture: PunchCapture, claimedAgeMs: number): PunchBody {
  return { ...capture, claimedAgeMs };
}
export const punchToSign = (body: PunchBody) => punchMessage(body);
export const linkVerifyToSign = (phone: string, code: string) => `link-verify|${phone}|${code}`;
export const linkProofToSign = (qr: string) => `link|${qr}`;
export const renewToSign = (nonce: string) => `renew|${nonce}`;
