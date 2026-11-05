import type { Metadata } from 'next';
import { Suspense } from 'react';
import { AccountPage } from '../../../components/buy/account';

export const metadata: Metadata = {
  title: 'Your account',
  robots: { index: false, follow: false },
};
export default function Page() {
  return (
    <Suspense>
      <AccountPage />
    </Suspense>
  );
}
