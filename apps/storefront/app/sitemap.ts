import type { MetadataRoute } from 'next';
import { pageResponse, publicGet } from '../lib/api';
import { indexingOn, pageUrl } from '../lib/site';

const pages = ['/', '/products', '/about', '/delivery', '/contact', '/privacy', '/terms'];
// Rebuilt hourly, so a material added after a deploy reaches search engines without a new deploy
// (and a catalogue that could not be read during the build does not stay missing).
export const revalidate = 3600;

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  if (!indexingOn) return [];
  // Each page is listed once, with its Hindi address as the alternate (lib/language.ts).
  const languages = (path: string) => ({
    languages: { en: pageUrl(path), hi: pageUrl(`${path}?lang=hi`) },
  });
  const entries: MetadataRoute.Sitemap = pages.map((path) => ({
    url: pageUrl(path),
    changeFrequency: path === '/' || path === '/products' ? 'daily' : 'monthly',
    alternates: languages(path),
  }));
  try {
    let cursor: string | null = null;
    // Up to 2,000 materials, a hundred at a time.
    for (let round = 0; round < 20; round++) {
      const page: Awaited<ReturnType<typeof readPage>> = await readPage(cursor);
      for (const product of page.items)
        entries.push({
          url: pageUrl(`/products/${encodeURIComponent(product.id)}`),
          lastModified: new Date(product.priceUpdatedAt),
          changeFrequency: 'daily',
          alternates: languages(`/products/${encodeURIComponent(product.id)}`),
        });
      cursor = page.nextCursor;
      if (!cursor) break;
    }
  } catch (error) {
    // The fixed pages are still listed when the catalogue cannot be read right now; the next
    // hourly rebuild tries again.
    console.warn(
      JSON.stringify({
        event: 'SITEMAP_CATALOGUE_UNAVAILABLE',
        errorType: error instanceof Error ? error.constructor.name : 'Unknown',
      }),
    );
  }
  return entries;
}

const readPage = (cursor: string | null) =>
  publicGet(
    `/products?limit=100${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`,
    pageResponse,
  );
