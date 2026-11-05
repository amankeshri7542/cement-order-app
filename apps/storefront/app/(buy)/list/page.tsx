import type { Metadata } from 'next';
import { Suspense } from 'react';
import { ListPage } from '../../../components/buy/list-page';
import { readCatalog, readShop, whatsappNumber } from '../../../lib/public-data';
import { contentReview } from '../../../lib/review';

export const metadata: Metadata = { title: 'Your list', robots: { index: false, follow: false } };

export default async function Page() {
  const [shop, read] = await Promise.all([readShop(), readCatalog()]);
  const number = whatsappNumber(shop);
  return (
    <Suspense>
      <ListPage
        whatsappNumber={number}
        whatsappOn={Boolean(number) || contentReview}
        sampleRates={read.catalog?.sampleRates ?? false}
      />
    </Suspense>
  );
}
