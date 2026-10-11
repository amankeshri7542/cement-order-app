'use client';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { useLanguage } from './language';
import { MaterialArt } from './material-art';
import { Catalogue } from './catalogue';
import { Delivery } from './delivery';
import { ShopContent } from './shop-content';
import { brandsResponse, publicGet } from '../lib/api';
import { RateBoard } from './rate-board';

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
        <div className="hero-copy">
          <p className="hero-kicker">
            {t('Family materials shop · Patna, Bihar', 'पारिवारिक सामग्री दुकान · पटना, बिहार')}
          </p>
          <h1 id="hero-title">
            <span>{t('Building materials,', 'निर्माण सामग्री,')}</span>
            <span>{t('every rate in plain sight.', 'हर भाव साफ़-साफ़।')}</span>
          </h1>
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
          <a className="hero-delivery" href="#delivery">
            {t('Check delivery for your pincode', 'अपने पिनकोड पर डिलीवरी जाँचें')}{' '}
            <span aria-hidden="true">↓</span>
          </a>
        </div>
        <RateBoard />
      </section>
      <section className="buying-routes" aria-labelledby="routes-title">
        <h2 id="routes-title">{t('Two ways to buy.', 'खरीदने के दो तरीके।')}</h2>
        <div className="route route-retail">
          <div className="route-head">
            <span className="route-art" aria-hidden="true">
              <MaterialArt category="cement" />
            </span>
            <div>
              <h3>{t('For your home', 'घर के काम के लिए')}</h3>
              <p>{t('A few bags to a few hundred.', 'कुछ बोरी से कुछ सौ तक।')}</p>
            </div>
          </div>
          <ul>
            <li>
              {t(
                'Add materials to your basket at the listed price.',
                'सूची के भाव पर सामग्री टोकरी में डालें।',
              )}
            </li>
            <li>
              {t(
                'Checkout shows the current total, delivery fee and date before you confirm.',
                'पुष्टि से पहले चेकआउट में मौजूदा कुल, डिलीवरी शुल्क और तारीख दिखती है।',
              )}
            </li>
            <li>
              {t('Pay cash when the material arrives.', 'सामग्री पहुँचने पर नकद भुगतान करें।')}
            </li>
          </ul>
          <Link className="text-link" href="/products">
            {t('Shop materials', 'सामग्री खरीदें')} <span aria-hidden="true">→</span>
          </Link>
        </div>
        <div className="route route-bulk">
          <div className="route-head">
            <span className="route-art" aria-hidden="true">
              <MaterialArt category="steel" />
            </span>
            <div>
              <h3>{t('For your site', 'साइट के काम के लिए')}</h3>
              <p>
                {t('Several materials, truck-sized quantities.', 'कई सामग्री, ट्रक भर मात्रा।')}
              </p>
            </div>
          </div>
          <ul>
            <li>
              {t(
                'Put every material on one list, even beyond current stock.',
                'सारी सामग्री एक सूची में रखें, मौजूदा स्टॉक से ज़्यादा भी।',
              )}
            </li>
            <li>
              {t(
                'The shop replies with item prices, freight and an expiry date.',
                'दुकान हर सामग्री का भाव, भाड़ा और समय-सीमा भेजती है।',
              )}
            </li>
            <li>
              {t(
                'Accept the offer you reviewed; the shop then confirms it as an order.',
                'जाँचा हुआ प्रस्ताव स्वीकार करें; फिर दुकान उसे पक्का ऑर्डर बनाती है।',
              )}
            </li>
          </ul>
          <Link className="text-link" href="/quotes">
            {t('Request bulk quote', 'थोक भाव माँगें')} <span aria-hidden="true">→</span>
          </Link>
        </div>
      </section>
      <Catalogue preview />
      {brands.length > 0 && (
        <section
          className="brands-section"
          aria-label={t('Brands in the current catalogue', 'मौजूदा सूची के ब्रांड')}
        >
          <p className="eyebrow">{t('Brands in our catalogue', 'हमारी सामग्री सूची के ब्रांड')}</p>
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
      <Delivery />
      <ShopContent />
      <section className="buying-guide" aria-labelledby="guide-title">
        <h2 id="guide-title">{t('Before you buy', 'खरीदने से पहले')}</h2>
        <div className="guide-notes">
          <div>
            <h3>{t('Compare the same unit', 'एक जैसी इकाई की तुलना करें')}</h3>
            <p>
              {t(
                'A bag, a kilogram, a thousand bricks and 100 cu ft of sand are different units. Compare the same grade and pack, and check each material’s minimum and quantity step.',
                'बोरी, किलो, हज़ार ईंट और 100 घन फुट बालू अलग इकाइयाँ हैं। समान ग्रेड और पैक की तुलना करें, और हर सामग्री की न्यूनतम मात्रा व बढ़ोतरी देखें।',
              )}
            </p>
            <Link className="text-link" href="/compare">
              {t('Compare materials', 'सामग्री की तुलना करें')} <span aria-hidden="true">→</span>
            </Link>
          </div>
          <div>
            <h3>{t('Save the full site address', 'साइट का पूरा पता सहेजें')}</h3>
            <p>
              {t(
                'Delivery fee, minimum order and timing depend on the pincode. Checkout shows the current terms again before you confirm.',
                'डिलीवरी शुल्क, न्यूनतम ऑर्डर और समय पिनकोड पर निर्भर हैं। पुष्टि से पहले चेकआउट में मौजूदा शर्तें फिर दिखती हैं।',
              )}
            </p>
            <Link className="text-link" href="/account">
              {t('Manage addresses', 'पते सँभालें')} <span aria-hidden="true">→</span>
            </Link>
          </div>
        </div>
      </section>
    </>
  );
}
export function CatalogueHeading() {
  const { t } = useLanguage();
  return (
    <div className="page-heading">
      <p className="eyebrow">{t('Shiv Cement Store · Patna', 'शिव सीमेंट स्टोर · पटना')}</p>
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
