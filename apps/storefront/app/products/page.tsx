import type { Metadata } from 'next';
import { Suspense } from 'react';
import { Catalogue } from '../../components/catalogue';
import { CatalogueHeading } from '../../components/home';

export const metadata: Metadata = { title: 'Browse materials' };
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
