import { distanceMeters, weakFixAccuracyM } from '@shiv/shared';

export type Fix = { lat: number; lng: number; accuracyM: number };
export type Pin = {
  lat: number;
  lng: number;
  count: number;
  /** The widest margin the phone admitted to, across the fixes that counted. */
  worstAccuracyM: number;
  /** How far the fixes stray from their middle: a wide spread means take it again outside. */
  spreadM: number;
};
export const fixesWanted = 10;
/** Fewer than this is one guess repeated, not a position. */
export const fixesNeeded = 3;
const rounded = (value: number) => Math.round(value * 1e6) / 1e6;

/** One point out of many. A fix the phone itself calls hopeless does not get a vote. */
export function averageFixes(fixes: readonly Fix[]): Pin | null {
  const usable = fixes.filter((fix) => fix.accuracyM <= weakFixAccuracyM);
  if (usable.length < fixesNeeded) return null;
  const lat = rounded(usable.reduce((sum, fix) => sum + fix.lat, 0) / usable.length);
  const lng = rounded(usable.reduce((sum, fix) => sum + fix.lng, 0) / usable.length);
  return {
    lat,
    lng,
    count: usable.length,
    worstAccuracyM: Math.round(Math.max(...usable.map((fix) => fix.accuracyM))),
    spreadM: Math.max(...usable.map((fix) => distanceMeters({ lat, lng }, fix))),
  };
}

export class LocationRefused extends Error {}

/**
 * Takes fixes one after another until there are enough or time runs out. A refused permission ends
 * it at once, because asking again will not help; a phone that is only slow keeps being given time.
 */
export async function collectFixes(
  getFix: () => Promise<Fix>,
  options: {
    wanted?: number;
    gapMs?: number;
    maxMs?: number;
    onFix?: (count: number) => void;
    stopped?: () => boolean;
    sleep?: (ms: number) => Promise<void>;
    now?: () => number;
  } = {},
) {
  const {
    wanted = fixesWanted,
    gapMs = 1000,
    maxMs = 45000,
    onFix,
    stopped = () => false,
    sleep = (ms) => new Promise((done) => setTimeout(done, ms)),
    now = () => Date.now(),
  } = options;
  const fixes: Fix[] = [];
  const started = now();
  while (fixes.length < wanted && now() - started < maxMs && !stopped()) {
    try {
      fixes.push(await getFix());
      onFix?.(fixes.length);
    } catch (error) {
      if (error instanceof LocationRefused) throw error;
    }
    if (fixes.length < wanted) await sleep(gapMs);
  }
  return fixes;
}

/** The browser's location, as one fix. No cached position: each must be a fresh reading. */
export function browserFix(geolocation: Geolocation): Promise<Fix> {
  return new Promise((resolve, reject) => {
    geolocation.getCurrentPosition(
      ({ coords }) =>
        resolve({ lat: coords.latitude, lng: coords.longitude, accuracyM: coords.accuracy }),
      (error) =>
        reject(
          error.code === error.PERMISSION_DENIED
            ? new LocationRefused(error.message)
            : new Error(error.message),
        ),
      { enableHighAccuracy: true, maximumAge: 0, timeout: 15000 },
    );
  });
}

/** Figures typed by hand, when the browser cannot be asked. */
export function typedPin(latText: string, lngText: string) {
  const lat = Number(latText.trim());
  const lng = Number(lngText.trim());
  if (!latText.trim() || !lngText.trim() || !Number.isFinite(lat) || !Number.isFinite(lng))
    return null;
  if (Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
  return { lat: rounded(lat), lng: rounded(lng) };
}
export const mapLink = (lat: number, lng: number) =>
  `https://www.google.com/maps/search/?api=1&query=${lat},${lng}`;
