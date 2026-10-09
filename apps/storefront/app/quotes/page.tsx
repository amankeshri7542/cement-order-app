import { Suspense } from 'react';
import { QuotationsPage } from '../../components/quotations';
export default function Page() {
  return (
    <Suspense>
      <QuotationsPage />
    </Suspense>
  );
}
