import type { CatalogProduct } from './types';

// Search works on the phone, at once and with no signal. Plain logic, unit-tested under Node.

/** Everyday words for each material, because people search the way they speak. */
const materialWords: Record<string, string[]> = {
  cement: ['cement', 'bori', 'bag', 'siment'],
  steel: ['sariya', 'saria', 'sarya', 'rod', 'steel', 'tmt', 'chhad', 'loha'],
  sand: ['balu', 'baalu', 'sand', 'ret'],
  aggregates: ['gitti', 'giti', 'stone', 'aggregate', 'chips'],
  bricks: ['eent', 'int', 'brick', 'bricks', 'block'],
};

export const normalize = (text: string) =>
  text
    .toLowerCase()
    .normalize('NFKC')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();

function terms(product: CatalogProduct) {
  return [
    product.name,
    product.brand,
    product.grade,
    product.type,
    ...(product.searchTerms ?? []),
    ...(materialWords[product.categorySlug] ?? [product.categorySlug]),
  ].map(normalize);
}

/** Every word typed must hit something; a match at the start of the name comes first. */
export function searchProducts(products: CatalogProduct[], query: string): CatalogProduct[] {
  const words = normalize(query).split(' ').filter(Boolean);
  if (!words.length) return [];
  const scored: { product: CatalogProduct; score: number }[] = [];
  for (const product of products) {
    const haystack = terms(product);
    const hit = words.every((word) =>
      haystack.some((term) => term.split(' ').some((part) => part.startsWith(word))),
    );
    if (!hit) continue;
    scored.push({
      product,
      score: normalize(product.name).startsWith(words[0]!)
        ? 0
        : normalize(product.brand).startsWith(words[0]!)
          ? 1
          : 2,
    });
  }
  return scored
    .sort((a, b) => a.score - b.score || a.product.name.localeCompare(b.product.name))
    .map((item) => item.product);
}
