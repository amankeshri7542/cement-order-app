import { Suspense } from 'react';
import { OrderHistory } from '../../../components/order-history';
export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <Suspense>
      <OrderHistory orderId={id} />
    </Suspense>
  );
}
