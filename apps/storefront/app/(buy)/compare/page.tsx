import type { Metadata } from 'next';
import { ComparePage } from '../../../components/buy/compare';
import { readCatalog } from '../../../lib/public-data';

export const metadata: Metadata = { title: 'Compare', robots: { index: false, follow: false } };

export default async function Page() {
  const { catalog } = await readCatalog();
  // Only what the comparison prints reaches the browser, never the search words.
  const products = (catalog?.products ?? []).map(
    ({ searchTerms: _terms, images: _images, ...rest }) => rest,
  );
  return <ComparePage products={products} />;
}
