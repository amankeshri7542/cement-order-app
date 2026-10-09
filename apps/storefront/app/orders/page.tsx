import { Suspense } from 'react';
import { OrderHistory } from '../../components/order-history';
export default function Page() {
  return (
    <Suspense>
      <OrderHistory />
    </Suspense>
  );
}
