import { clientConfigSchema } from '@shiv/shared';
import { createStore } from '../logic/store-core';
import type { Catalog, CatalogCategory, CatalogProduct, MyRate, Offer } from '../logic/types';
import { api, readIfChanged } from './api';
import { cacheKeys, readCache, writeCache } from './cache';
import { say } from './net';
import { currentUser, retryRestoreIfUnknown } from './session';

type CatalogState = {
  products: CatalogProduct[];
  byId: Record<string, CatalogProduct>;
  categories: CatalogCategory[];
  categoryIds: Record<string, string>;
  sampleRates: boolean;
  ratesCheckedAt: string | null;
  /** Set while the rates on screen are the copy on this phone, not what the shop just said. */
  savedAt: number | null;
  etag: string | null;
  loading: boolean;
  error: string;
  myRates: Record<string, MyRate>;
  offers: Offer[];
  askEnabled: boolean;
  awardsUrl: string | null;
};

export const catalogStore = createStore<CatalogState>({
  products: [],
  byId: {},
  categories: [],
  categoryIds: {},
  sampleRates: true,
  ratesCheckedAt: null,
  savedAt: null,
  etag: null,
  loading: true,
  error: '',
  myRates: {},
  offers: [],
  askEnabled: false,
  awardsUrl: null,
});

function fromCatalog(data: Catalog) {
  return {
    products: data.products,
    byId: Object.fromEntries(data.products.map((product) => [product.id, product])),
    categories: data.categories,
    categoryIds: Object.fromEntries(data.categories.map((item) => [item.slug, item.id])),
    sampleRates: data.sampleRates,
    ratesCheckedAt: data.ratesCheckedAt,
  };
}

let confirmed = false;
let request = 0;
/** The shop's current rates. An unchanged list costs a few bytes. */
export async function refreshCatalog() {
  const current = ++request;
  try {
    const answer = await readIfChanged<Catalog>('/public/catalog', catalogStore.get().etag);
    if (current !== request) return;
    confirmed = true;
    if (answer) {
      catalogStore.patch({
        ...fromCatalog(answer.data),
        etag: answer.etag,
        savedAt: null,
        loading: false,
        error: '',
      });
      void writeCache(cacheKeys.catalog, { catalog: answer.data, etag: answer.etag });
    } else catalogStore.patch({ savedAt: null, loading: false, error: '' });
    // The shop answers again: check the saved sign-in that could not be checked earlier.
    retryRestoreIfUnknown();
  } catch (error) {
    if (current === request) catalogStore.patch({ error: say(error), loading: false });
  }
}

/** The last saved rates show at once; the shop's current ones replace them when it answers. */
export async function loadSavedCatalog() {
  const saved = await readCache<{ catalog: Catalog; etag: string | null }>(cacheKeys.catalog);
  if (confirmed || !saved || !Array.isArray(saved.data?.catalog?.products)) return;
  catalogStore.patch({
    ...fromCatalog(saved.data.catalog),
    etag: saved.data.etag,
    savedAt: saved.savedAt,
    loading: false,
  });
}

/** Public offers. Quiet when they fail: rates stand without them. */
export async function refreshOffers() {
  try {
    const { items } = await api<{ items: Offer[] }>('/public/offers');
    catalogStore.patch({ offers: items });
  } catch {
    // Nothing to show.
  }
}

/** This customer's own rates. Only theirs, kept with their other details. */
export async function refreshMyRates() {
  const user = currentUser();
  if (!user) return;
  try {
    const rows = await api<MyRate[]>('/me/rates');
    if (currentUser()?.id !== user.id) return;
    catalogStore.patch({ myRates: Object.fromEntries(rows.map((row) => [row.productId, row])) });
    void writeCache(cacheKeys.rates(user.id), rows);
  } catch {
    // The list rate stands, and the server's review always has the last word.
  }
}
export async function loadSavedRates(userId: string) {
  const saved = await readCache<MyRate[]>(cacheKeys.rates(userId));
  if (currentUser()?.id === userId && Array.isArray(saved?.data))
    catalogStore.patch({
      myRates: Object.fromEntries(saved.data.map((row) => [row.productId, row])),
    });
}
export const forgetMyRates = () => catalogStore.patch({ myRates: {} });

const httpsOnly = (url: unknown) =>
  typeof url === 'string' && url.startsWith('https://') ? url : null;
/** The shop's switches for this app. An answer that makes no sense changes nothing. */
export async function refreshConfig() {
  const config = clientConfigSchema.safeParse(await api<unknown>('/client-config'));
  if (!config.success) return null;
  catalogStore.patch({
    askEnabled: config.data.askEnabled,
    awardsUrl: httpsOnly(config.data.awardsUrl),
  });
  void writeCache('config', {
    askEnabled: config.data.askEnabled,
    awardsUrl: httpsOnly(config.data.awardsUrl),
  });
  return config.data;
}
export async function loadSavedConfig() {
  const saved = await readCache<{ askEnabled?: unknown; awardsUrl?: unknown }>('config');
  if (!saved) return;
  catalogStore.patch({
    askEnabled: saved.data.askEnabled === true,
    awardsUrl: httpsOnly(saved.data.awardsUrl),
  });
}
