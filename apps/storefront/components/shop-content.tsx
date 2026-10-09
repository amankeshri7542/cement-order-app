'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { z } from 'zod';
import { useLanguage } from './language';
import { publicGet } from '../lib/api';
const shopSchema = z.object({
  name: z.string(),
  city: z.string(),
  story: z.object({ en: z.string(), hi: z.string() }),
  contactApproved: z.boolean(),
  phone: z.string(),
  whatsapp: z.string(),
  address: z.string(),
  hours: z.string(),
  directionsUrl: z.string(),
  family: z.array(z.object({ name: z.string(), role: z.string(), image: z.string() })),
  gallery: z.array(z.object({ title: z.string(), image: z.string(), alt: z.string() })),
  credentials: z.array(z.object({ title: z.string(), issuer: z.string(), image: z.string() })),
});
function ApprovedImage({ src, alt }: { src: string; alt: string }) {
  if (!/^\/shop-assets\/[a-zA-Z0-9_-]+\.(?:png|jpe?g|webp)$/.test(src)) return null;
  return <img src={src} alt={alt} width={640} height={480} loading="lazy" decoding="async" />;
}
export function ShopContent() {
  const { t, language } = useLanguage();
  const [shop, setShop] = useState<z.infer<typeof shopSchema> | null>(null);
  useEffect(() => {
    let active = true;
    void publicGet('/shop-content', shopSchema)
      .then((data) => {
        if (active) setShop(data);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, []);
  const phone = shop?.contactApproved && /^\+91[6-9]\d{9}$/.test(shop.phone) ? shop.phone : null;
  const whatsapp =
    shop?.contactApproved && /^\+91[6-9]\d{9}$/.test(shop.whatsapp) ? shop.whatsapp : null;
  const hasGallery = Boolean(
    shop && (shop.family.length || shop.gallery.length || shop.credentials.length),
  );
  const directions =
    shop?.contactApproved && /^https:\/\/(www\.)?google\.com\/maps\//.test(shop.directionsUrl)
      ? shop.directionsUrl
      : null;
  return (
    <>
      <section className="shop-story" id="our-shop">
        <div className="story-sign">
          <span>शिव</span>
          <p>सीमेंट एवं निर्माण सामग्री</p>
          <strong>PATNA · BIHAR</strong>
        </div>
        <div>
          <p className="eyebrow">{t('A FAMILY AT THE COUNTER', 'काउंटर पर एक परिवार')}</p>
          <h2>{t('For the work that makes a home.', 'उस काम के लिए, जो घर बनाता है।')}</h2>
          <p>
            {shop?.story[language] ||
              t(
                'A family shop for the materials your next project needs.',
                'आपके अगले निर्माण के लिए सामग्री की पारिवारिक दुकान।',
              )}
          </p>
          <p>
            {t(
              'Bring the material name, quantity and site pincode. We’ll help you put the buying details together.',
              'सामग्री का नाम, मात्रा और साइट का पिनकोड साथ रखें। खरीदारी की जानकारी पूरी करने में हम मदद करेंगे।',
            )}
          </p>
          <details className="content-review">
            <summary>
              {hasGallery
                ? t('Meet the family & see the shop', 'परिवार और दुकान से परिचय')
                : t(
                    'Family story & shop gallery · awaiting approval',
                    'परिवार की कहानी और दुकान की तस्वीरें · मंज़ूरी बाकी',
                  )}
            </summary>
            {!hasGallery && (
              <p>
                {t(
                  'This local review area is reserved for family introductions, genuine shop photographs and verified credentials. No dates, awards or dealership claims have been published.',
                  'इस स्थानीय समीक्षा क्षेत्र में परिवार का परिचय, असली दुकान की तस्वीरें और जाँचे प्रमाण रखे जाएँगे। अभी साल, पुरस्कार या डीलरशिप के दावे प्रकाशित नहीं हैं।',
                )}
              </p>
            )}
            <div className="approved-gallery">
              {shop?.family.map((person) => (
                <figure key={person.name}>
                  <ApprovedImage src={person.image} alt={person.name} />
                  <figcaption>
                    {person.name} · {person.role}
                  </figcaption>
                </figure>
              ))}
              {shop?.gallery.map((item) => (
                <figure key={item.title}>
                  <ApprovedImage src={item.image} alt={item.alt} />
                  <figcaption>{item.title}</figcaption>
                </figure>
              ))}
              {shop?.credentials.map((item) => (
                <figure key={item.title}>
                  <ApprovedImage src={item.image} alt={item.title} />
                  <figcaption>
                    {item.title} · {item.issuer}
                  </figcaption>
                </figure>
              ))}
            </div>
          </details>
        </div>
      </section>
      <section className="visit-section" id="visit">
        <div>
          <p className="eyebrow">{t('COME BY. TALK IT THROUGH.', 'आइए। ज़रूरत पर बात करें।')}</p>
          <h2>{t('Your shop in Patna.', 'पटना में आपकी दुकान।')}</h2>
          <p>
            {shop?.contactApproved
              ? shop.address
              : t(
                  'Exact visiting address and hours are awaiting family approval in this local review.',
                  'इस स्थानीय समीक्षा में आने का सटीक पता और समय परिवार की मंज़ूरी की प्रतीक्षा में हैं।',
                )}
          </p>
          {shop?.contactApproved && <p>{shop.hours}</p>}
        </div>
        <div className="visit-actions">
          {phone && (
            <a className="button" href={`tel:${phone}`}>
              {t('Call the shop', 'दुकान पर फ़ोन करें')}
            </a>
          )}
          {whatsapp && (
            <a
              className="button secondary"
              href={`https://wa.me/${whatsapp.slice(1)}`}
              target="_blank"
              rel="noopener noreferrer"
            >
              WhatsApp ↗
            </a>
          )}
          {directions && (
            <a className="text-link" href={directions} target="_blank" rel="noopener noreferrer">
              {t('Open directions', 'रास्ता खोलें')} ↗
            </a>
          )}
          {!phone && (
            <Link className="button secondary" href="/quotes">
              {t('Plan a material request', 'सामग्री का अनुरोध बनाएँ')} ↗
            </Link>
          )}
          <small>
            {t(
              'Directions open only when you choose them. No map loads in the background.',
              'रास्ता आपके चुनने पर ही खुलता है। पीछे से कोई नक्शा लोड नहीं होता।',
            )}
          </small>
        </div>
      </section>
    </>
  );
}
