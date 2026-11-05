import type { Metadata } from 'next';
import { ShopScreen } from '../../components/owner/shop-screen';

export const metadata: Metadata = {
  title: 'Shiv Cement · Hazri screen',
  robots: { index: false, follow: false },
};

export default function Page() {
  return <ShopScreen />;
}
