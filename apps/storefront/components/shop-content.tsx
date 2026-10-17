'use client';
import { useEffect, useState, type ReactNode } from 'react';
import Link from 'next/link';
import { z } from 'zod';
import { useLanguage } from './language';
import { publicGet } from '../lib/api';
import { contentReview } from '../lib/review';
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
  pending: z.array(z.string().max(80)).max(20).optional(),
});
// Marks unapproved placeholders for the family's review; never rendered as a business fact.
export function ReviewNote({ children }: { children: ReactNode }) {
  if (!contentReview) return null;
  return (
    <aside className="review-note" aria-label="Internal content review note">
      <strong>Review note · not shown to customers</strong>
      <div>{children}</div>
    </aside>
  );
}
const approvedSrc = (src: string) =>
  /^\/shop-assets\/[a-zA-Z0-9_-]+\.(?:png|jpe?g|webp)$/.test(src);
function ApprovedImage({ src, alt }: { src: string; alt: string }) {
  if (!approvedSrc(src)) return null;
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
  const cover = shop?.gallery.find((item) => approvedSrc(item.image));
  return (
    <>
      <section className={`shop-story${cover || contentReview ? '' : ' no-photo'}`} id="our-shop">
        {/* Honest imagery: the family's own photograph. Until one is approved, production shows
            nothing; review builds show a labelled slot so the family sees what is missing. */}
        {cover ? (
          <figure className="photo-slot photo-slot-filled">
            <ApprovedImage src={cover.image} alt={cover.alt} />
          </figure>
        ) : !contentReview ? null : (
          <div className="photo-slot">
            <div>
              <strong>
                {t("The shop's own photograph goes here", 'यहाँ दुकान की असली तस्वीर आएगी')}
              </strong>
              <p>
                {t(
                  'The counter, the rate board and the godown, photographed by the family.',
                  'काउंटर, भाव-पट और गोदाम, परिवार की खींची हुई।',
                )}
              </p>
            </div>
          </div>
        )}
        <div>
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
          {hasGallery ? (
            <details className="content-review">
              <summary>{t('Meet the family & see the shop', 'परिवार और दुकान से परिचय')}</summary>
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
          ) : (
            <ReviewNote>
              Family introductions, genuine shop photographs and verified credentials appear here
              once approved in <code>apps/api/src/public-content.ts</code>. Still pending:{' '}
              {(shop?.pending || ['family history', 'shop photographs', 'credentials']).join(', ')}.
              See <code>docs/FAMILY_CONTENT_CHECKLIST.md</code>.
            </ReviewNote>
          )}
        </div>
      </section>
      <section className="visit-section" id="visit">
        <div>
          {shop?.contactApproved ? (
            <>
              <h2>{t('Your shop in Patna.', 'पटना में आपकी दुकान।')}</h2>
              <p>{shop.address}</p>
              <p>{shop.hours}</p>
            </>
          ) : (
            <>
              <h2>{t('Talk it through first.', 'पहले बात कर लें।')}</h2>
              <p>
                {t(
                  'Ask about a material, its selling unit or delivery. Shiv Assistant answers from the current catalogue and the shop’s written terms. For a site list, a bulk quote gets a written reply.',
                  'किसी सामग्री, उसकी बिक्री इकाई या डिलीवरी के बारे में पूछें। शिव सहायक मौजूदा सूची और दुकान की लिखित शर्तों से जवाब देता है। साइट की सूची के लिए थोक भाव माँगें, जवाब लिखित में मिलेगा।',
                )}
              </p>
            </>
          )}
          {!shop?.contactApproved && (
            <ReviewNote>
              Address, visiting hours, call/WhatsApp numbers and directions stay hidden until the
              family confirms them and sets <code>contactApproved: true</code>.
            </ReviewNote>
          )}
        </div>
        <div className="visit-actions">
          {/* Only an approved number is printed, in the shop's large counter type. */}
          {phone && (
            <p className="shop-phone" lang="en">
              {phone.slice(3, 8)} {phone.slice(8)}
            </p>
          )}
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
              {t('Open directions in Google Maps', 'Google Maps में रास्ता खोलें')} ↗
            </a>
          )}
          {!phone && (
            <button
              className="button"
              onClick={(event) => {
                event.currentTarget.focus();
                window.dispatchEvent(new CustomEvent('shiv-ask-material', { detail: null }));
              }}
            >
              <span aria-hidden="true">✳</span> {t('Ask a question', 'सवाल पूछें')}
            </button>
          )}
          <Link className="button secondary" href="/quotes">
            {t('Request bulk quote', 'थोक भाव माँगें')}
          </Link>
        </div>
      </section>
    </>
  );
}
