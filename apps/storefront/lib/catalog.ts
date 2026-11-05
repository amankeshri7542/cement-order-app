import { dayText, isToday, rupees, timeText } from './format';
import { apiSlugFor, materialFor, materials, siteSlug } from './materials';
import type { Catalog, CatalogProduct, Offer } from './types';
export { unitWords } from './units';

/** A rate that can be shown: never ₹0, never for something the shop only brings in to order. */
export const hasRate = (
  product: CatalogProduct,
): product is CatalogProduct & { pricePaise: number } =>
  product.pricePaise !== null && product.pricePaise > 0;

export type MaterialGroup = {
  slug: string;
  name: string;
  plain: string;
  products: CatalogProduct[];
  /** The lowest rate shown publicly, with its product. Null when none has a rate. */
  lowest: (CatalogProduct & { pricePaise: number }) | null;
  /** The word "from" belongs here: more than one product could be behind this rate. */
  from: boolean;
};

export function groupByMaterial(catalog: Catalog): MaterialGroup[] {
  const known = materials.map((item) => item.apiSlug);
  const rank = (apiSlug: string) => {
    const at = known.indexOf(apiSlug);
    return at < 0 ? known.length : at;
  };
  const byCategory = new Map<string, CatalogProduct[]>();
  for (const product of catalog.products) {
    const rows = byCategory.get(product.categorySlug) ?? [];
    rows.push(product);
    byCategory.set(product.categorySlug, rows);
  }
  const names = new Map(catalog.categories.map((category) => [category.slug, category.name]));
  return [...byCategory.entries()]
    .sort(([a], [b]) => rank(a) - rank(b) || a.localeCompare(b))
    .map(([apiSlug, products]) => {
      const slug = siteSlug(apiSlug);
      const material = materialFor(slug);
      const priced = products.filter(hasRate);
      const lowest = priced.reduce<(typeof priced)[number] | null>(
        (low, item) => (!low || item.pricePaise < low.pricePaise ? item : low),
        null,
      );
      return {
        slug,
        name: material?.name ?? names.get(apiSlug) ?? slug,
        plain: material?.plain ?? '',
        products,
        lowest,
        from: priced.length > 1,
      };
    });
}

export const findGroup = (catalog: Catalog, slug: string) =>
  groupByMaterial(catalog).find((group) => group.slug === slug) ?? null;

export function slugify(text: string) {
  return text
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
}
const cuidLike = /^c[a-z0-9]{20,}$/;
/**
 * A product's address. Product.slug does not exist yet (plan 10), so a readable id stands as the
 * slug, and a generated id becomes name plus its last 8 characters. Finding a product uses those 8
 * characters only, so renaming one keeps old links working and they redirect to the new address.
 */
export function productSlug(product: Pick<CatalogProduct, 'id' | 'name'>) {
  if (!cuidLike.test(product.id)) return product.id;
  return `${slugify(product.name) || 'item'}-${product.id.slice(-8)}`;
}
export function findProduct(catalog: Catalog, slug: string) {
  const direct = catalog.products.find((product) => product.id === slug);
  if (direct) return direct;
  const key = slug.slice(-8);
  if (key.length < 8) return null;
  return (
    catalog.products.find((product) => cuidLike.test(product.id) && product.id.endsWith(key)) ??
    null
  );
}
export const productPath = (product: Pick<CatalogProduct, 'id' | 'name' | 'categorySlug'>) =>
  `/materials/${siteSlug(product.categorySlug)}/${productSlug(product)}`;

/** Whether the word "today" is true for these products, and the phrase that says when they were checked. */
export function freshness(products: CatalogProduct[], now: Date = new Date()) {
  const dated = products.filter(hasRate).map((product) => new Date(product.checkedAt));
  if (!dated.length) return { today: false, text: '' };
  const oldest = new Date(Math.min(...dated.map((date) => date.getTime())));
  const today = isToday(oldest, now);
  return {
    today,
    text: today ? `Checked today, ${timeText(oldest)}` : `Rates as of ${dayText(oldest, now)}`,
  };
}

export const rateText = (product: CatalogProduct) =>
  hasRate(product) ? rupees(product.pricePaise) : '';

/** Plain words for one word of availability. Never a count. */
export function availabilityText(product: CatalogProduct) {
  if (product.availability === 'ON_REQUEST') return 'Brought in to order. Ask for the rate.';
  if (product.availability === 'ASK_SHOP') return 'Not available right now. Ask the shop.';
  return 'Available';
}

/**
 * On-site search over the cached catalogue: nothing here reaches the API. Words typed in any script
 * match the shop's confirmed aliases (ProductAlias) through searchTerms.
 */
export function searchCatalog(catalog: Catalog, query: string) {
  const q = query.trim().toLowerCase().slice(0, 100);
  if (!q) return [];
  const words = q.split(/\s+/).filter(Boolean).slice(0, 8);
  return catalog.products.filter((product) => {
    const material = materialFor(siteSlug(product.categorySlug));
    const hay = [
      product.name,
      product.brand,
      product.type,
      product.grade,
      material?.name,
      material?.plain,
      ...(material?.terms ?? []),
      ...product.searchTerms,
    ]
      .filter(Boolean)
      .join(' ')
      .toLowerCase();
    return words.every((word) => hay.includes(word));
  });
}

/** An offer in plain words, and the rate it comes to when that can be worked out. */
export function offerText(offer: Offer, product?: CatalogProduct | null) {
  const until = `Until ${dayText(`${offer.endsOn}T12:00:00+05:30`)}.`;
  const from = offer.minQuantity > 1 ? ` on ${offer.minQuantity} or more` : '';
  let saving = '';
  if (offer.valueType === 'PERCENT_OFF') saving = `${Number((offer.value / 100).toFixed(2))}% off`;
  else if (offer.valueType === 'AMOUNT_OFF') saving = `${rupees(offer.value)} off`;
  else if (
    offer.valueType === 'RATE' &&
    product &&
    hasRate(product) &&
    offer.value < product.pricePaise
  )
    saving = `${rupees(offer.value)}`;
  return [offer.title, saving ? `${saving}${from}.` : from ? `${from.trim()}.` : '', until]
    .filter(Boolean)
    .join(' ');
}
export function offersFor(
  offers: Offer[],
  product: CatalogProduct,
  categoryIdOf: (slug: string) => string | undefined,
) {
  const categoryId = categoryIdOf(product.categorySlug);
  return offers.filter(
    (offer) =>
      offer.productId === product.id ||
      (categoryId !== undefined && offer.categoryId === categoryId),
  );
}

export { apiSlugFor };
