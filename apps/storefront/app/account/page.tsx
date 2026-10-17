import { Suspense } from 'react';
import { AccountPage } from '../../components/account';
export default function Page() {
  return (
    <Suspense>
      <AccountPage />
    </Suspense>
  );
}
