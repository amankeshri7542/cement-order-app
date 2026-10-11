import { money, type Product } from '@shiv/shared';

export const PAGE_SIZE = 12;
export const MAX_PAGES = 50;
export const sorts = ['name', 'price_asc', 'price_desc', 'newest'] as const;
export type CatalogQuery = {
  q: string;
  category: string;
  brand: string;
  availability: 'all' | 'in' | 'out';
  sort: (typeof sorts)[number];
  pages: number;
};
export function readQuery(params: Pick<URLSearchParams, 'get'>): CatalogQuery {
  const availability = params.get('availability');
  const sort = params.get('sort');
  const pages = Number(params.get('pages') || '1');
  return {
    q: (params.get('q') || '').trim().slice(0, 100),
    category: (params.get('category') || '').slice(0, 60),
    brand: (params.get('brand') || '').slice(0, 80),
    availability: availability === 'in' || availability === 'out' ? availability : 'all',
    sort: sorts.includes(sort as CatalogQuery['sort']) ? (sort as CatalogQuery['sort']) : 'name',
    pages: Number.isInteger(pages) && pages > 0 ? Math.min(pages, MAX_PAGES) : 1,
  };
}
export function queryString(query: CatalogQuery): string {
  const params = new URLSearchParams();
  if (query.q.trim()) params.set('q', query.q.trim());
  if (query.category) params.set('category', query.category);
  if (query.brand) params.set('brand', query.brand);
  if (query.availability !== 'all') params.set('availability', query.availability);
  if (query.sort !== 'name') params.set('sort', query.sort);
  if (query.pages > 1) params.set('pages', String(query.pages));
  return params.toString();
}
export function uniqueProducts(items: Product[]): Product[] {
  return [...new Map(items.map((item) => [item.id, item])).values()];
}
export function price(value: number): string {
  if (!Number.isSafeInteger(value) || value < 0)
    throw new Error('Prices must be nonnegative integer paise');
  return money(value);
}
export function dateLabel(value: string, language: 'en' | 'hi'): string {
  return new Intl.DateTimeFormat(language === 'hi' ? 'hi-IN' : 'en-IN', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'Asia/Kolkata',
  }).format(new Date(value));
}

export function timeLabel(value: string): string {
  // A fixed 24-hour format avoids server/WebKit day-period differences during hydration.
  return new Intl.DateTimeFormat('en-GB', {
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
    timeZone: 'Asia/Kolkata',
  }).format(new Date(value));
}

export type Rate = { slug: string; name: string; product: Product };
// A shop's rate board lists the cheapest in-stock item per material, each with its own selling
// unit. Prices are compared only within a category, never converted across units.
const rateOrder = ['cement', 'steel', 'bricks', 'sand', 'aggregates', 'tiles', 'pipes', 'hardware'];
export function ratesFrom(items: Product[], limit = 5): Rate[] {
  const cheapest = new Map<string, Product>();
  for (const product of items) {
    if (product.stock <= 0 || !product.active) continue;
    const current = cheapest.get(product.category.slug);
    if (!current || product.pricePaise < current.pricePaise)
      cheapest.set(product.category.slug, product);
  }
  const rank = (slug: string) =>
    rateOrder.includes(slug) ? rateOrder.indexOf(slug) : rateOrder.length;
  return [...cheapest.entries()]
    .map(([slug, product]) => ({ slug, name: product.category.name, product }))
    .sort((a, b) => rank(a.slug) - rank(b.slug) || a.name.localeCompare(b.name))
    .slice(0, limit);
}

// Delivery dates are calendar days (YYYY-MM-DD); show them in the reader's language without
// shifting the day across time zones. Anything unexpected is shown exactly as received.
export function dayLabel(value: string, language: 'en' | 'hi'): string {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) ? dateLabel(`${value}T00:00:00+05:30`, language) : value;
}
export function momentLabel(value: string, language: 'en' | 'hi'): string {
  return `${dateLabel(value, language)} · ${timeLabel(value)}`;
}
