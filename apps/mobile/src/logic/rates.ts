import type { CatalogCategory, CatalogProduct, MyRate, Offer } from './types';

// The rate sheet as plain data. Plain logic, unit-tested under Node.

/** The order materials go in while building. Anything else follows, by name. */
const materialOrder = ['cement', 'steel', 'sand', 'aggregates', 'bricks', 'pipes', 'hardware'];
const rank = (slug: string) => {
  const at = materialOrder.indexOf(slug);
  return at < 0 ? materialOrder.length : at;
};

export type RateItem =
  | { kind: 'heading'; key: string; slug: string; name: string; unit: string }
  | { kind: 'row'; key: string; id: string };

/** Headings and rows, one flat list; cheapest first inside a material, no-rate items last. */
export function rateItems(products: CatalogProduct[], categories: CatalogCategory[]): RateItem[] {
  const names = new Map(categories.map((item) => [item.slug, item.name]));
  const groups = new Map<string, CatalogProduct[]>();
  for (const product of products) {
    const group = groups.get(product.categorySlug);
    if (group) group.push(product);
    else groups.set(product.categorySlug, [product]);
  }
  const slugs = [...groups.keys()].sort(
    (a, b) => rank(a) - rank(b) || (names.get(a) || a).localeCompare(names.get(b) || b),
  );
  const items: RateItem[] = [];
  for (const slug of slugs) {
    const rows = groups.get(slug)!;
    rows.sort(
      (a, b) =>
        (a.pricePaise ?? Number.MAX_SAFE_INTEGER) - (b.pricePaise ?? Number.MAX_SAFE_INTEGER) ||
        a.name.localeCompare(b.name),
    );
    items.push({
      kind: 'heading',
      key: `h:${slug}`,
      slug,
      name: names.get(slug) || slug,
      unit: rows[0]?.unit ?? '',
    });
    for (const row of rows) items.push({ kind: 'row', key: row.id, id: row.id });
  }
  return items;
}

/** Name and unit in one short line. Nothing is said about a pack the shop did not type. */
export function rowDetail(product: Pick<CatalogProduct, 'grade' | 'type' | 'unit' | 'packSize'>) {
  return [product.grade || product.type, product.unit].filter(Boolean).join(' · ');
}

/**
 * The rate to show. A signed-in customer sees their own rate when it is lower; nobody else's, and
 * never how the rule was set. Final rates still come from the server's review.
 */
export function rateToShow(product: CatalogProduct, mine?: MyRate) {
  if (product.pricePaise === null) return { paise: null, listPaise: null, yours: false };
  const yours = Boolean(mine && mine.yourPaise < product.pricePaise);
  return {
    paise: yours ? mine!.yourPaise : product.pricePaise,
    listPaise: product.pricePaise,
    yours,
  };
}

/** The first offer that names this product, or its material. */
export function offerFor(
  product: CatalogProduct,
  offers: Offer[],
  categoryIdOf: (slug: string) => string | undefined,
) {
  return (
    offers.find((offer) => offer.productId === product.id) ??
    offers.find(
      (offer) => !offer.productId && offer.categoryId === categoryIdOf(product.categorySlug),
    ) ??
    null
  );
}
