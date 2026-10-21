import AsyncStorage from '@react-native-async-storage/async-storage';
import { isFresh } from './age';

// What the phone remembers of the store between visits, so a dead connection shows the last
// prices instead of an empty screen. Plain JSON in AsyncStorage (SecureStore holds only a couple of
// kilobytes). Nothing here is a secret: the rate list and the signed-in customer's own recent
// orders, which sign-out and account deletion remove (clearCache). The v1 prefix lets a future
// shape change start clean.
const prefix = 'shiv_cache_v1:';

export type Saved<T> = { savedAt: number; data: T };

export const cacheKeys = {
  /** Rate board, categories and store settings. */
  catalog: 'catalog',
  /** First pages of the Materials list, one entry per category/stock/sort combination. */
  catalogue: 'catalogue',
  /** A customer's recent orders; removed when they sign out. */
  orders: (userId: string) => `orders:${userId}`,
} as const;

/**
 * The saved value, or null when there is none, it is too old, or storage is unavailable. A value
 * that is too old (or unreadable) is erased here, so personal details never outlive their use.
 */
export async function readCache<T>(key: string): Promise<Saved<T> | null> {
  try {
    const raw = await AsyncStorage.getItem(prefix + key);
    if (!raw) return null;
    const saved = JSON.parse(raw) as Saved<T> | null;
    if (!saved || !isFresh(saved.savedAt, Date.now()) || saved.data == null) {
      void AsyncStorage.removeItem(prefix + key).catch(() => {});
      return null;
    }
    return saved;
  } catch {
    return null;
  }
}

/** Remembers a value. A full or blocked store only means the list is not remembered. */
export async function writeCache<T>(key: string, data: T): Promise<number | null> {
  const savedAt = Date.now();
  try {
    await AsyncStorage.setItem(prefix + key, JSON.stringify({ savedAt, data } satisfies Saved<T>));
    return savedAt;
  } catch {
    return null;
  }
}

/** Forgets saved values whose key matches (all of them by default). */
export async function clearCache(match: (key: string) => boolean = () => true) {
  try {
    const keys = (await AsyncStorage.getAllKeys()).filter(
      (key) => key.startsWith(prefix) && match(key.slice(prefix.length)),
    );
    if (keys.length) await AsyncStorage.multiRemove(keys);
  } catch {
    // Nothing to forget if storage is unavailable.
  }
}

type SavedPage = { savedAt: number; items: unknown[]; nextCursor: string | null };
/** How many Materials views (category, stock and sort combinations) are remembered. */
const keptPages = 12;

/** The saved first page of a Materials view. Searches are never saved. */
export async function readCataloguePage<T>(key: string) {
  const saved = await readCache<Record<string, SavedPage>>(cacheKeys.catalogue);
  const page = saved?.data?.[key];
  if (!page || !Array.isArray(page.items) || !isFresh(page.savedAt, Date.now())) return null;
  return { savedAt: page.savedAt, items: page.items as T[], nextCursor: page.nextCursor ?? null };
}

/** Remembers the first page of a Materials view; the least recent views make room. */
export async function writeCataloguePage(key: string, items: unknown[], nextCursor: string | null) {
  const saved = await readCache<Record<string, SavedPage>>(cacheKeys.catalogue);
  const pages = { ...saved?.data, [key]: { savedAt: Date.now(), items, nextCursor } };
  const newest = Object.entries(pages)
    .sort(([, a], [, b]) => b.savedAt - a.savedAt)
    .slice(0, keptPages);
  await writeCache(cacheKeys.catalogue, Object.fromEntries(newest));
}
