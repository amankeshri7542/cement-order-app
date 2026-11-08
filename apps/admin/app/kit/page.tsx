import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { KitGallery } from '../../components/kit-gallery';

export const metadata: Metadata = {
  title: 'Shiv Cement · Kit',
  robots: { index: false, follow: false },
};

/**
 * Every kit part with sample data, for the browser checks in tests/desk-kit.spec.ts (plan v4 B3a):
 * both themes, every size, axe and 10,000 rows. It holds no shop data and is off in production
 * unless SHIV_KIT_PAGE=on.
 */
export default function Page() {
  if (process.env.NODE_ENV === 'production' && process.env.SHIV_KIT_PAGE !== 'on') notFound();
  return <KitGallery />;
}
