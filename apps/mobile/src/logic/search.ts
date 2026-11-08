import { indexProducts, normaliseText, rankProducts, type SearchIndex } from '@shiv/shared';
import type { CatalogProduct } from './types';

// Search works on the phone, at once and with no signal. The words, spellings and ranking are the
// shared ones (packages/shared/src/search-normalise.ts), so the phone and the desk agree.

export const normalize = normaliseText;

type Entry = CatalogProduct & { category: string; words: string[] };
// The shelf is indexed once per list the screen holds, not on every key press.
const indexes = new WeakMap<readonly CatalogProduct[], SearchIndex<Entry>>();
function indexOf(products: readonly CatalogProduct[]) {
  let index = indexes.get(products);
  if (!index) {
    index = indexProducts(
      products.map((product) => ({
        ...product,
        category: product.categorySlug,
        words: product.searchTerms ?? [],
      })),
    );
    indexes.set(products, index);
  }
  return index;
}

/** Every word typed must hit something; a match at the start of the name comes first. */
export function searchProducts(products: CatalogProduct[], query: string): CatalogProduct[] {
  const byId = new Map(products.map((product) => [product.id, product]));
  return rankProducts(indexOf(products), query).map((entry) => byId.get(entry.id)!);
}
