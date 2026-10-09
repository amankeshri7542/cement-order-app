'use client';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { useLanguage } from './language';
import { MaterialArt } from './material-art';
import { Catalogue } from './catalogue';
import { Delivery } from './delivery';
import { ShopContent } from './shop-content';
import { brandsResponse, publicGet } from '../lib/api';

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
      <section className="hero">
        <div className="hero-copy">
          <p className="eyebrow">
            {t('PATNA’S LOCAL MATERIALS COUNTER', 'पटना की अपनी सामग्री की दुकान')}
          </p>
          <h1>
            {t('Good materials.', 'सही सामग्री।')}
            <br />
            <span>{t('A stronger start.', 'मज़बूत शुरुआत।')}</span>
          </h1>
          <p className="hero-description">
            {t(
              'From a home repair to a full site order. Find your material, check the selling unit and plan delivery.',
              'घर की मरम्मत से पूरी साइट के ऑर्डर तक। सामग्री चुनें, बिक्री इकाई जाँचें और डिलीवरी की तैयारी करें।',
            )}
          </p>
          <div className="hero-actions">
            <Link className="button" href="/products">
              {t('Shop materials', 'सामग्री खरीदें')} ↗
            </Link>
            <Link className="button secondary" href="/quotes">
              {t('Request bulk quote', 'थोक भाव माँगें')}
            </Link>
          </div>
          <p className="hero-footnote">
            {t('Retail & wholesale · English / हिन्दी', 'खुदरा और थोक · हिंदी / English')}
          </p>
        </div>
        <div
          className="material-board"
          aria-label={t('Illustrations of building materials', 'निर्माण सामग्री के चित्र')}
        >
          <span className="board-label">
            शिव
            <br />
            <small>{t('BUILDING MATERIALS', 'निर्माण सामग्री')}</small>
          </span>
          <div className="board-cement">
            <MaterialArt category="cement" />
          </div>
          <div className="board-steel">
            <MaterialArt category="steel" />
          </div>
          <div className="board-brick">
            <MaterialArt category="brick" />
          </div>
          <span className="board-caption">
            {t(
              'MATERIAL ILLUSTRATIONS · CHECK EACH PRODUCT’S PACK',
              'सामग्री के चित्र · हर सामग्री का पैक जाँचें',
            )}
          </span>
        </div>
      </section>
      <div className="buying-paths">
        <Link href="/products">
          <span>{t('For your home', 'आपके घर के लिए')}</span>
          <p>{t('Choose, review, order COD.', 'चुनें, जाँचें, COD ऑर्डर करें।')}</p>
          <b aria-hidden="true">↗</b>
        </Link>
        <Link href="/quotes">
          <span>{t('For your site', 'आपकी साइट के लिए')}</span>
          <p>{t('One list. A written offer.', 'एक सूची। लिखित भाव।')}</p>
          <b aria-hidden="true">↗</b>
        </Link>
        <a href="#delivery">
          <span>{t('For your pincode', 'आपके पिनकोड के लिए')}</span>
          <p>{t('Delivery terms before you buy.', 'खरीदने से पहले डिलीवरी की शर्तें।')}</p>
          <b aria-hidden="true">↗</b>
        </a>
      </div>
      <Catalogue preview />
      {brands.length > 0 && (
        <section
          className="brands-section"
          aria-label={t('Brands in the current catalogue', 'मौजूदा सूची के ब्रांड')}
        >
          <p className="eyebrow">{t('BRANDS IN OUR CATALOGUE', 'हमारी सामग्री सूची के ब्रांड')}</p>
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
      <section className="buying-guide">
        <div>
          <p className="eyebrow">{t('BUY WITH A CLEAR PLAN', 'साफ तैयारी के साथ खरीदें')}</p>
          <h2>{t('A few details make a big difference.', 'छोटी जानकारी, बड़ा फ़र्क।')}</h2>
        </div>
        <div className="guide-steps">
          {[
            [
              t('Read the pack & unit', 'पैक और इकाई पढ़ें'),
              t(
                'A bag, bundle and tonne are different units. Compare the same grade and pack; check the minimum and quantity step.',
                'बैग, बंडल और टन अलग इकाइयाँ हैं। समान ग्रेड और पैक की तुलना करें; न्यूनतम मात्रा और बढ़ोतरी जाँचें।',
              ),
            ],
            [
              t('Check the site & delivery', 'साइट और डिलीवरी जाँचें'),
              t(
                'Save your complete address. Review current delivery fees, minimum order and timing before you confirm.',
                'पूरा पता सहेजें। पुष्टि से पहले मौजूदा डिलीवरी शुल्क, न्यूनतम ऑर्डर और समय जाँचें।',
              ),
            ],
            [
              t('Choose an order or an offer', 'ऑर्डर या प्रस्ताव चुनें'),
              t(
                'Use COD checkout for available quantities. For a larger list, request a written quotation and review its revision before accepting.',
                'उपलब्ध मात्रा के लिए COD चेकआउट करें। बड़ी सूची के लिए लिखित भाव माँगें और स्वीकार करने से पहले उसका संस्करण जाँचें।',
              ),
            ],
          ].map(([title, text], i) => (
            <div key={title}>
              <span>{i + 1}</span>
              <div>
                <h3>{title}</h3>
                <p>{text}</p>
              </div>
            </div>
          ))}
        </div>
      </section>
    </>
  );
}
export function CatalogueHeading() {
  const { t } = useLanguage();
  return (
    <div className="page-heading">
      <p className="eyebrow">{t('SHIV CEMENT STORE · PATNA', 'शिव सीमेंट स्टोर · पटना')}</p>
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
