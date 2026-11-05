/**
 * When the server says this phone is no longer linked, everything it holds goes: tokens first, so
 * nothing more can be read, then every cached trip, list and saved photo. One step failing must
 * not stop the rest. The device key stays. It is useless alone, and it can never leave the phone.
 */
export type WipeDeps = {
  deleteTokens(): Promise<void>;
  /** Every stored item except the language and the note that this phone was cut off. */
  deleteCaches(): Promise<void>;
  deleteQueue(): Promise<void>;
  deletePhotos(): Promise<void>;
  /** Stops anything still running from writing back or sending. */
  stopQueue(): void;
  /** Kept across restarts, so a cut-off phone stays on the cut-off screen. */
  markCutOff(kind: 'CUT_OFF' | 'REFUSED'): Promise<void>;
};
export async function wipeEverything(deps: WipeDeps, kind: 'CUT_OFF' | 'REFUSED') {
  const failed: string[] = [];
  const step = async (name: string, run: () => Promise<void> | void) => {
    try {
      await run();
    } catch {
      failed.push(name);
    }
  };
  await step('queue', () => deps.stopQueue());
  await step('tokens', deps.deleteTokens);
  await step('caches', deps.deleteCaches);
  await step('queueStore', deps.deleteQueue);
  await step('photos', deps.deletePhotos);
  await step('mark', () => deps.markCutOff(kind));
  return failed;
}
/** All local storage keys holding someone's work carry this, so a wipe cannot miss one. */
export const cachePrefix = 'staff:cache:';
export const queueKey = 'staff:queue';
export const languageKey = 'staff:language';
export const cutOffKey = 'staff:cutoff';
export const clockKey = 'staff:clock';
/** The browser test build's stand-in for the Keystore key, which a wipe leaves alone on a phone. */
export const webKeyKey = 'staff:webkey';
/** Stored data that must not survive a wipe: everything except the language and the cut-off note. */
export const survivesWipe = (key: string) =>
  key === languageKey || key === cutOffKey || key === webKeyKey;
