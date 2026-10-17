import { Suspense } from 'react';
import { BasketPage } from '../../components/basket';
export default function Page() {
  return (
    <Suspense>
      <BasketPage />
    </Suspense>
  );
}
