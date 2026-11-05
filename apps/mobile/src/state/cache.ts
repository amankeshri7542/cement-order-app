import AsyncStorage from '@react-native-async-storage/async-storage';
import { isFresh } from '../logic/age';

// What the phone remembers of the store between visits, so a dead connection shows the last
// prices instead of an empty screen. Plain JSON in AsyncStorage (SecureStore holds only a couple of
// kilobytes). Nothing here is a secret: the rate list and the signed-in customer's own recent
// orders, sites and rates, which sign-out and account deletion remove (clearCache). The version in the
// prefix lets a shape change start clean: v2 holds the public catalogue.
const prefix = 'shiv_cache_v2:';

export type Saved<T> = { savedAt: number; data: T };

export const cacheKeys = {
  /** The whole public catalogue, its time and its ETag. */
  catalog: 'catalog',
  /** Everything below belongs to one signed-in customer and goes when they sign out. */
  orders: (userId: string) => `mine:${userId}:orders`,
  sites: (userId: string) => `mine:${userId}:sites`,
  rates: (userId: string) => `mine:${userId}:rates`,
  /** Guide articles the customer has opened, so they read offline. */
  guide: (slug: string) => `guide:${slug}`,
} as const;

/** True of a key holding one customer's own details. */
export const isPrivateKey = (key: string) => key.startsWith('mine:');

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
