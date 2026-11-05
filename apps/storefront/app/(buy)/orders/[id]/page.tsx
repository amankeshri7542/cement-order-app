import type { Metadata } from 'next';
import { Suspense } from 'react';
import { OrderHistory } from '../../../../components/buy/order-history';

export const metadata: Metadata = { title: 'Your order', robots: { index: false, follow: false } };
export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <Suspense>
      <OrderHistory orderId={id} />
    </Suspense>
  );
}
