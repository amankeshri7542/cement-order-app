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
// Shared with the Android app: Patna-time dates and the rate board.
export { dateLabel, dayLabel, momentLabel, ratesFrom, timeLabel, type Rate } from '@shiv/shared';
