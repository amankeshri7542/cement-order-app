import type { Metadata } from 'next';
import { CheckoutPage } from '../../../components/buy/checkout';

export const metadata: Metadata = {
  title: 'Check and confirm',
  robots: { index: false, follow: false },
};
export default function Page() {
  return <CheckoutPage />;
}
