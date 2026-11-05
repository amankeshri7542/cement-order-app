import type { Metadata } from 'next';
import { QuotationsPage } from '../../../components/buy/quotations';

export const metadata: Metadata = {
  title: 'Ask for a rate',
  robots: { index: false, follow: false },
};
export default function Page() {
  return <QuotationsPage />;
}
