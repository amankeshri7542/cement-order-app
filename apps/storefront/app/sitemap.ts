import type { MetadataRoute } from 'next';
import { awardsLive } from '../lib/awards';
import { groupByMaterial, productPath } from '../lib/catalog';
import { readCatalog } from '../lib/public-data';
import { indexingOn, pageUrl } from '../lib/site';

const pages = [
  '/',
  '/rates',
  '/materials',
  '/guide',
  '/about',
  '/delivery',
  '/contact',
  '/privacy',
  '/terms',
];

/** Clean addresses only. lastModified is real: when the rate last changed. No sample rates ever. */
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  if (!indexingOn) return [];
  const entries: MetadataRoute.Sitemap = pages.map((path) => ({ url: pageUrl(path) }));
  if (awardsLive()) entries.push({ url: pageUrl('/awards') });
  const read = await readCatalog();
  if (!read.catalog || read.catalog.sampleRates) return entries;
  for (const group of groupByMaterial(read.catalog))
    entries.push({ url: pageUrl(`/materials/${group.slug}`) });
  for (const product of read.catalog.products)
    entries.push({
      url: pageUrl(productPath(product)),
      lastModified: new Date(product.priceUpdatedAt),
    });
  return entries;
}
