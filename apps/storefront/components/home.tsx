'use client';

import Link from 'next/link';
import { useLanguage } from './language';
import { MaterialArt } from './material-art';
import { Catalogue } from './catalogue';
import { Delivery } from './delivery';

export function Home() {
  const { t } = useLanguage();
  return (
    <>
      <section className="hero">
        <div className="hero-copy">
          <p className="eyebrow">
            {t('YOUR MATERIALS COUNTER IN PATNA', 'पटना में आपकी सामग्री की दुकान')}
          </p>
          <h1>
            {t('Good work starts', 'काम की शुरुआत,')}
            <br />
            <em>{t('with the right materials.', 'सही सामग्री के साथ।')}</em>
          </h1>
          <p className="hero-description">
            {t(
              'Cement and building materials for your next job. Compare prices, check the pack and plan what you need.',
              'आपके अगले काम के लिए सीमेंट और निर्माण सामग्री। कीमतें देखें, पैक जाँचें और ज़रूरत की तैयारी करें।',
            )}
          </p>
          <div className="hero-actions">
            <Link className="button" href="/products">
              {t('Browse materials', 'सामग्री देखें')}
              <span aria-hidden="true">↗</span>
            </Link>
            <a className="text-link" href="#delivery">
              {t('Check delivery', 'डिलीवरी जाँचें')}
              <span aria-hidden="true">↓</span>
            </a>
          </div>
          <p className="hero-footnote">
            {t('For home projects & bulk requirements', 'घर के काम और थोक ज़रूरतों के लिए')}
          </p>
        </div>
        <div className="hero-board" aria-hidden="true">
          <div className="board-top">
            <span>
              SHIV
              <br />
              CEMENT STORE
            </span>
            <span>
              पटना
              <br />
              BIHAR
            </span>
          </div>
          <div className="board-name">
            शिव<span>निर्माण का सामान</span>
          </div>
          <MaterialArt large />
          <div className="board-bottom">
            <span>
              MATERIALS FOR
              <br />
              THE WORK AHEAD.
            </span>
            <span>
              सीमेंट एवं
              <br />
              निर्माण सामग्री
            </span>
          </div>
        </div>
      </section>
      <div className="shop-strip">
        <span>{t('Know your material.', 'अपनी सामग्री समझें।')}</span>
        <p>{t('Brand & grade', 'ब्रांड और ग्रेड')}</p>
        <p>{t('Price & selling unit', 'कीमत और बिक्री इकाई')}</p>
        <p>{t('Pack & quantity', 'पैक और मात्रा')}</p>
      </div>
      <Catalogue preview />
      <Delivery />
      <section className="buying-guide" aria-labelledby="guide-title">
        <div>
          <p className="eyebrow">
            {t('A LITTLE PLANNING GOES A LONG WAY', 'थोड़ी तैयारी, काम में आसानी')}
          </p>
          <h2 id="guide-title">
            {t('Small repair. Bigger build.', 'छोटी मरम्मत हो या बड़ा निर्माण।')}
          </h2>
          <p>
            {t(
              'Make a material list before you visit the shop.',
              'दुकान आने से पहले सामग्री की सूची तैयार करें।',
            )}
          </p>
        </div>
        <div className="guide-item">
          <h3>{t('Check the selling unit', 'बिक्री इकाई जाँचें')}</h3>
          <p>
            {t(
              'Compare like for like. A bag, bundle or tonne is a different selling unit. Read the pack size and grade on each material.',
              'समान इकाइयों की तुलना करें। बैग, बंडल और टन अलग बिक्री इकाइयाँ हैं। हर सामग्री का पैक और ग्रेड पढ़ें।',
            )}
          </p>
        </div>
        <div className="guide-item">
          <h3>{t('Plan your quantities', 'मात्रा की तैयारी करें')}</h3>
          <p>
            {t(
              'For retail or bulk requirements, note the material, quantity and site pincode. Confirm the final price and availability with the shop.',
              'खुदरा या थोक ज़रूरत के लिए सामग्री, मात्रा और काम की जगह का पिनकोड लिखें। अंतिम कीमत और उपलब्धता की दुकान से पुष्टि करें।',
            )}
          </p>
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
          'Compare the brand, grade and selling unit before you choose.',
          'चुनने से पहले ब्रांड, ग्रेड और बिक्री इकाई की तुलना करें।',
        )}
      </p>
    </div>
  );
}
