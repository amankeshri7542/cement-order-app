import type { Product } from './index';

export type Rate = { slug: string; name: string; product: Product };
// A shop's rate board lists the cheapest in-stock item per material, each with its own selling
// unit. Prices are compared only within a category, never converted across units.
export const rateOrder = [
  'cement',
  'steel',
  'bricks',
  'sand',
  'aggregates',
  'tiles',
  'pipes',
  'hardware',
];
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
