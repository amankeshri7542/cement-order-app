import type { Metadata } from 'next';
import { pageMetadata } from '../../lib/language';
import { Suspense } from 'react';
import { Catalogue } from '../../components/catalogue';
import { CatalogueHeading } from '../../components/home';

export function generateMetadata(): Promise<Metadata> {
  return pageMetadata('/products', {
    en: {
      title: 'Browse materials',
      description:
        'Current rates for cement, steel, bricks, sand and more at Shiv Cement Store, Patna, with the selling unit beside every price.',
    },
    hi: {
      title: 'सामग्री देखें',
      description:
        'शिव सीमेंट स्टोर, पटना में सीमेंट, सरिया, ईंट, बालू और दूसरी सामग्री के मौजूदा भाव, हर भाव के साथ बिक्री इकाई।',
    },
  });
}
export default function Page() {
  return (
    <>
      <CatalogueHeading />
      <Suspense>
        <Catalogue />
      </Suspense>
    </>
  );
}
