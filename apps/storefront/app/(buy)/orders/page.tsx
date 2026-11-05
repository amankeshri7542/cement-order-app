import type { Metadata } from 'next';
import { Suspense } from 'react';
import { OrderHistory } from '../../../components/buy/order-history';

export const metadata: Metadata = { title: 'Your orders', robots: { index: false, follow: false } };
export default function Page() {
  return (
    <Suspense>
      <OrderHistory />
    </Suspense>
  );
}
