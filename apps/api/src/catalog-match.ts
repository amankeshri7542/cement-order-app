import type { Prisma } from '@prisma/client';

/**
 * The one way a product's name, or a customer's words, becomes comparable text. Marks stay, as
 * without them Hindi words fall apart into single letters.
 */
export function normalizeAlias(value: string) {
  return value
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[०-९]/g, (digit) => String(digit.charCodeAt(0) - 0x0966))
    .replace(/neo\s*steel/g, 'neosteel')
    .replace(/(\d)\s*(mm|kg)\b/g, '$1$2')
    .replace(/[^\p{L}\p{M}\p{N}]+/gu, ' ')
    .trim();
}

export type MatchMethod = 'ALIAS' | 'EXACT' | 'CATEGORY';
export type CatalogProduct = {
  id: string;
  name: string;
  nameHi: string | null;
  brand: string;
  unit: string;
  packSize: string;
  minQuantity: number;
  quantityStep: number;
  pricePaise: number;
  priceUpdatedAt: Date;
};
type Term = { ids: Set<string>; method: MatchMethod };
export type Catalog = {
  products: Map<string, CatalogProduct>;
  terms: Map<string, Term>;
  longest: number;
  /** Words from the shop's own delivery areas. */
  places: Set<string>;
};

// Everyday words for a kind of goods. They never name one product, so they never read as sure.
const tradeWords: Record<string, string[]> = {
  cement: ['cement', 'sement', 'siment', 'सीमेंट', 'सिमेंट'],
  steel: ['saria', 'sariya', 'सरिया', 'tmt', 'rod'],
  sand: ['balu', 'baalu', 'बालू', 'sand'],
  aggregates: ['gitti', 'gitty', 'गिट्टी', 'aggregate'],
  bricks: ['eent', 'eet', 'int', 'ईंट', 'brick', 'bricks'],
};

type ProductRow = CatalogProduct & { category: { slug: string } };
export function buildCatalog(
  rows: ProductRow[],
  aliases: { normalizedAlias: string; productId: string }[],
  zones: string[] = [],
): Catalog {
  const terms = new Map<string, Term>();
  const add = (term: string, id: string, method: MatchMethod) => {
    if (!term) return;
    const known = terms.get(term);
    // A person's confirmed word beats a guess from the catalogue, and is never shared.
    if (known?.method === 'ALIAS') return;
    if (known && known.method === method) known.ids.add(id);
    else if (!known || method !== 'CATEGORY') terms.set(term, { ids: new Set([id]), method });
  };
  const products = new Map(rows.map((row) => [row.id, row]));
  for (const row of rows) {
    for (const word of tradeWords[row.category.slug] ?? [])
      add(normalizeAlias(word), row.id, 'CATEGORY');
    add(normalizeAlias(row.brand), row.id, 'EXACT');
    add(normalizeAlias(row.name), row.id, 'EXACT');
    add(normalizeAlias(`${row.brand} ${row.name}`), row.id, 'EXACT');
    if (row.nameHi) add(normalizeAlias(row.nameHi), row.id, 'EXACT');
  }
  for (const alias of aliases)
    if (products.has(alias.productId))
      terms.set(alias.normalizedAlias, { ids: new Set([alias.productId]), method: 'ALIAS' });
  const longest = Math.max(1, ...[...terms.keys()].map((term) => term.split(' ').length));
  const places = new Set(zones.flatMap((name) => normalizeAlias(name).split(' ')).filter(Boolean));
  return { products, terms, longest, places };
}

export async function loadCatalog(
  db: Pick<Prisma.TransactionClient, 'product' | 'productAlias' | 'deliveryZone'>,
) {
  const [rows, aliases, zones] = await Promise.all([
    db.product.findMany({
      where: { active: true },
      select: {
        id: true,
        name: true,
        nameHi: true,
        brand: true,
        unit: true,
        packSize: true,
        minQuantity: true,
        quantityStep: true,
        pricePaise: true,
        priceUpdatedAt: true,
        category: { select: { slug: true } },
      },
      orderBy: { id: 'asc' },
      take: 500,
    }),
    db.productAlias.findMany({ select: { normalizedAlias: true, productId: true }, take: 5000 }),
    db.deliveryZone.findMany({ select: { name: true }, take: 500 }),
  ]);
  return buildCatalog(
    rows,
    aliases,
    zones.map((zone) => zone.name),
  );
}

/** The longest catalogue term starting at this word, if any. */
export function termAt(catalog: Catalog, tokens: string[], start: number) {
  for (let size = Math.min(catalog.longest, tokens.length - start); size > 0; size--) {
    const term = catalog.terms.get(tokens.slice(start, start + size).join(' '));
    if (term) return { term, size };
  }
  return null;
}

/** How many products some words could mean. */
export function candidatesIn(catalog: Catalog, words: string) {
  const tokens = normalizeAlias(words).split(' ');
  for (let i = 0; i < tokens.length; i++) {
    const found = termAt(catalog, tokens, i);
    if (found) return found.term.ids.size;
  }
  return 0;
}

/** Which product some words name, and how surely. Used to double-check the model's answer. */
export function productNamedIn(catalog: Catalog, words: string, productId: string) {
  const tokens = normalizeAlias(words).split(' ');
  for (let i = 0; i < tokens.length; i++) {
    const found = termAt(catalog, tokens, i);
    if (found?.term.ids.has(productId))
      return found.term.ids.size === 1 && found.term.method !== 'CATEGORY'
        ? found.term.method
        : null;
  }
  return null;
}
