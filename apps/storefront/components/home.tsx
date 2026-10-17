'use client';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { useLanguage } from './language';
import { Catalogue } from './catalogue';
import { Delivery } from './delivery';
import { ShopContent } from './shop-content';
import { brandsResponse, publicGet } from '../lib/api';
import { RateBoard } from './rate-board';
import { FirstOrderCard } from './first-run';

export function Home() {
  const { t } = useLanguage();
  const [brands, setBrands] = useState<string[]>([]);
  useEffect(() => {
    let active = true;
    void publicGet('/brands', brandsResponse)
      .then((items) => {
        if (active) setBrands(items.map((item) => item.brand));
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, []);
  return (
    <>
      <section className="hero" aria-labelledby="hero-title">
        <h1 id="hero-title">
          <span>{t('Building materials,', 'निर्माण सामग्री,')}</span>{' '}
          <span>{t('every rate in plain sight.', 'हर भाव साफ़-साफ़।')}</span>
        </h1>
        <div className="hero-copy">
          <p className="hero-description">
            {t(
              'Cement, steel, bricks and sand with the selling unit beside every price. Order for your home with cash on delivery, or send a site list for a written quotation.',
              'सीमेंट, सरिया, ईंट और बालू — हर भाव के साथ उसकी बिक्री इकाई। घर के लिए कैश ऑन डिलीवरी ऑर्डर करें, या साइट की सूची भेजकर लिखित भाव लें।',
            )}
          </p>
          <div className="hero-actions">
            <Link className="button" href="/products">
              {t('Shop materials', 'सामग्री खरीदें')} <span aria-hidden="true">→</span>
            </Link>
            <Link className="button secondary" href="/quotes">
              {t('Request bulk quote', 'थोक भाव माँगें')}
            </Link>
          </div>
        </div>
        <RateBoard />
        {/* Beside the rate board on a wide screen; right after it on a phone. */}
        <Delivery variant="hero" />
      </section>
      <FirstOrderCard />
      <Catalogue preview />
      <section className="buying-routes" aria-labelledby="routes-title">
        <h2 id="routes-title">{t('Two ways to buy.', 'खरीदने के दो तरीके।')}</h2>
        {/* The home counter is a parchi slip; the site counter answers on the shop letterhead. */}
        <div className="route route-retail">
          <h3>{t('For your home', 'घर के काम के लिए')}</h3>
          <p>
            {t(
              'A few bags to a few hundred: add them to your basket at the listed price and pay cash when they arrive.',
              'कुछ बोरी से कुछ सौ तक: सूची के भाव पर टोकरी में डालें और सामान पहुँचने पर नकद दें।',
            )}
          </p>
          <Link className="button" href="/products">
            {t('Shop materials', 'सामग्री खरीदें')} <span aria-hidden="true">→</span>
          </Link>
        </div>
        <div className="route route-bulk">
          <div className="route-head">
            <span className="brand-stamp" aria-hidden="true">
              शिव
            </span>
            <h3>{t('For your site', 'साइट के काम के लिए')}</h3>
          </div>
          <p>
            {t(
              'Truck-sized quantities: send one list and the shop replies with item prices, freight and an expiry date.',
              'ट्रक भर मात्रा: एक सूची भेजें, दुकान हर सामग्री का भाव, भाड़ा और समय-सीमा लिखकर भेजेगी।',
            )}
          </p>
          <Link className="button secondary" href="/quotes">
            {t('Request bulk quote', 'थोक भाव माँगें')} <span aria-hidden="true">→</span>
          </Link>
        </div>
      </section>
      {brands.length > 0 && (
        <section
          className="brands-section"
          aria-label={t('Brands in the current catalogue', 'मौजूदा सूची के ब्रांड')}
        >
          <h2>{t('Brands in our catalogue', 'हमारी सामग्री सूची के ब्रांड')}</h2>
          <div>
            {brands.slice(0, 10).map((brand) => (
              <Link href={`/products?brand=${encodeURIComponent(brand)}`} key={brand}>
                {brand}
              </Link>
            ))}
          </div>
          <p>
            {t(
              'Check each material for current availability.',
              'मौजूदा उपलब्धता के लिए हर सामग्री देखें।',
            )}
          </p>
        </section>
      )}
      <ShopContent />
    </>
  );
}
export function CatalogueHeading() {
  const { t } = useLanguage();
  return (
    <div className="page-heading">
      <h1>{t('The materials counter.', 'सामग्री का काउंटर।')}</h1>
      <p>
        {t(
          'Find the right brand, grade and pack. See what you’re buying before you add it.',
          'सही ब्रांड, ग्रेड और पैक चुनें। जोड़ने से पहले जानें कि आप क्या खरीद रहे हैं।',
        )}
      </p>
    </div>
  );
}
