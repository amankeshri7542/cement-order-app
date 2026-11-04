import type { Metadata } from 'next';
import { Suspense } from 'react';
import { Home } from '../components/home';
import { JsonLd } from '../components/json-ld';
import { pageMetadata } from '../lib/language';
import { readShop } from '../lib/server';
import { pageUrl, siteName } from '../lib/site';

export async function generateMetadata(): Promise<Metadata> {
  const copy = {
    en: {
      title: `${siteName}, Patna | Cement, steel and sand rates`,
      description:
        'Cement, steel, bricks, sand and stone chips at Shiv Cement Store, Patna: current rates with the selling unit beside every price, delivery by pincode, cash on delivery and written bulk quotes.',
    },
    hi: {
      title: 'शिव सीमेंट स्टोर, पटना | सीमेंट, सरिया, बालू के भाव',
      description:
        'पटना में सीमेंट, सरिया, ईंट, बालू और गिट्टी के मौजूदा भाव, हर भाव के साथ बिक्री इकाई। पिनकोड से डिलीवरी, डिलीवरी पर नकद भुगतान और लिखित थोक भाव।',
    },
  };
  const metadata = await pageMetadata('/', copy);
  // The home page's title stands alone, without the "| Shiv Cement Store" ending.
  return { ...metadata, title: { absolute: String(metadata.title) } };
}

export default async function Page() {
  const shop = await readShop();
  const approved = Boolean(shop?.contactApproved);
  return (
    <>
      {/* Only what the family has approved is said about the shop: the address and number appear
          once contactApproved is set, never before. */}
      <JsonLd
        data={{
          '@context': 'https://schema.org',
          '@type': 'HardwareStore',
          name: siteName,
          url: pageUrl('/'),
          image: pageUrl('/opengraph-image.png'),
          description:
            'Cement, steel, bricks, sand and stone chips in Patna, with delivery by pincode and cash on delivery.',
          areaServed: { '@type': 'City', name: 'Patna' },
          paymentAccepted: 'Cash',
          currenciesAccepted: 'INR',
          address: {
            '@type': 'PostalAddress',
            ...(approved && shop?.address ? { streetAddress: shop.address } : {}),
            addressLocality: 'Patna',
            addressRegion: 'Bihar',
            addressCountry: 'IN',
          },
          ...(approved && shop?.phone ? { telephone: shop.phone } : {}),
        }}
      />
      <Suspense>
        <Home />
      </Suspense>
    </>
  );
}
