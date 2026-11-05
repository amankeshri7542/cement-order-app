import type { Metadata } from 'next';
import { DeleteAccountPage } from '../../../components/buy/delete-account';

export const metadata: Metadata = {
  title: 'Delete your account',
  robots: { index: false, follow: false },
};
export default function Page() {
  return <DeleteAccountPage />;
}
