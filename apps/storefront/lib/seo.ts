import type { Metadata } from 'next';
import type { CatalogRead } from './types';
import { indexingOn } from './site';

/** Sample rates, or no rates at all, never reach a search result, whatever SITE_INDEXING says. */
export function robotsFor(read: CatalogRead): Metadata['robots'] {
  if (!indexingOn || read.status === 'down' || read.catalog.sampleRates)
    return { index: false, follow: false };
  return { index: true, follow: true };
}
export function pageMeta(
  path: string,
  title: string,
  description: string,
  extra: Metadata = {},
): Metadata {
  return {
    title,
    description,
    alternates: { canonical: path },
    openGraph: {
      title,
      description,
      url: path,
      siteName: 'Shiv Cement Store',
      type: 'website',
      locale: 'en_IN',
      images: ['/opengraph-image.png'],
    },
    twitter: { card: 'summary_large_image' },
    ...extra,
  };
}
