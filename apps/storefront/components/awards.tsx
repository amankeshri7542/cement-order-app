import Link from 'next/link';
import { awardSlots, awardsLive, certificates } from '../lib/awards';
import { contentReview } from '../lib/review';
import s from './awards.module.css';
import { Placeholder } from './review';

/**
 * Real certificates on a dark wall, lit in the house's amber (decision 50). Each shows the photo,
 * the brand, the year and the exact printed words, and nothing more. Hidden until real.
 */
export function AwardsBand({
  heading = 'h2',
  more = true,
}: {
  heading?: 'h1' | 'h2';
  more?: boolean;
}) {
  if (!awardsLive() && !contentReview) return null;
  const Heading = heading;
  return (
    <section
      className={`${s.awards} on-night`}
      aria-labelledby="awards-title"
      data-nav-tone="night"
    >
      <div className={s.awardsHead}>
        <Heading id="awards-title">Top 5 in Bihar. The brands said so.</Heading>
        <p>The certificates, as the brands wrote them. Nothing here says more than they print.</p>
      </div>
      {awardsLive() ? (
        <ul className={s.certs}>
          {certificates.map((certificate) => (
            <li className={s.cert} key={certificate.id}>
              <figure style={{ margin: 0 }}>
                <a className={s.frame} href={certificate.photo.src} target="_blank" rel="noopener">
                  <img
                    src={certificate.photo.src}
                    width={certificate.photo.width}
                    height={certificate.photo.height}
                    alt={certificate.alt}
                    loading="lazy"
                    decoding="async"
                  />
                  <span className="sr">Open the certificate</span>
                </a>
                <figcaption>
                  <b>
                    {certificate.brand}, {certificate.year}
                  </b>
                  {certificate.wording}
                </figcaption>
              </figure>
            </li>
          ))}
        </ul>
      ) : (
        <>
          <ul className={s.certs}>
            {awardSlots.map((slot) => (
              <li className={s.cert} key={slot.brand}>
                <figure style={{ margin: 0 }}>
                  <div className={s.frame}>
                    <div className={s.slot}>
                      <span className={s.slotBrand}>{slot.brand}</span>
                      <span>Certificate photo goes here</span>
                    </div>
                  </div>
                  <figcaption>{slot.note}</figcaption>
                </figure>
              </li>
            ))}
          </ul>
          <div style={{ marginTop: '1.5rem' }}>
            <Placeholder id="awards">
              This whole section is hidden from customers until a real certificate is added to{' '}
              <code>apps/storefront/lib/awards.ts</code>.
            </Placeholder>
          </div>
        </>
      )}
      {more ? (
        <p className={s.awardsMore}>
          <Link className="link" href="/awards" prefetch={false}>
            See every certificate
          </Link>
        </p>
      ) : null}
    </section>
  );
}
