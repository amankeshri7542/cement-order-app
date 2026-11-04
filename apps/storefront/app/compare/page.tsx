import { Suspense } from 'react';
import { ComparePage } from '../../components/basket';
export default function Page() {
  return (
    <Suspense>
      <ComparePage />
    </Suspense>
  );
}
