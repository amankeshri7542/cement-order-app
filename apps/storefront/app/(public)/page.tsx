import type { Metadata } from 'next';
import Link from 'next/link';
import { plates } from '../../art';
import { AwardsBand } from '../../components/awards';
import { JsonLd } from '../../components/json-ld';
import { ListSlip, RateGroup, RatesDown } from '../../components/rates';
import { Placeholder } from '../../components/review';
import { Specimen } from '../../components/specimen';
import { Film } from '../../film/Film';
import { freshness, groupByMaterial, rateText, unitWords } from '../../lib/catalog';
import { materialFor, materials } from '../../lib/materials';
import {
  phoneNumber,
  readCatalog,
  readClientConfig,
  readGuide,
  readShop,
  whatsappNumber,
} from '../../lib/public-data';
import { contentReview } from '../../lib/review';
import { pageMeta, robotsFor } from '../../lib/seo';
import { pageUrl, siteName } from '../../lib/site';
import { waLink, waText } from '../../lib/whatsapp';
import s from './home.module.css';

export async function generateMetadata(): Promise<Metadata> {
  const read = await readCatalog();
  const today = read.catalog ? freshness(read.catalog.products).today : false;
  return {
    ...pageMeta(
      '/',
      '',
      `Cement, sariya, bricks, balu and gitti from a family shop in Patna, with ${today ? 'today’s' : 'the'} rate beside every item.`,
    ),
    title: { absolute: `${siteName}, Patna: cement, sariya and balu rates` },
    robots: robotsFor(read),
  };
}

const specimenClass: Record<string, string | undefined> = { cement: s.sCement, sariya: s.sSariya };
// Reviewed starters (packages/shared/src/advisor.ts), each tied to the signed article that answers it.
const starters = [
  { slug: 'what-comes-when', label: 'What do I buy first?' },
  { slug: 'check-bricks', label: 'How do I check bricks before I pay?' },
  { slug: 'cement-storage', label: 'How do I store cement at site?' },
];

export default async function Home() {
  const [read, shop, config, guide] = await Promise.all([
    readCatalog(),
    readShop(),
    readClientConfig(),
    readGuide(),
  ]);
  const catalog = read.catalog;
  const groups = catalog ? groupByMaterial(catalog) : [];
  const sample = catalog?.sampleRates ?? false;
  const fresh = catalog ? freshness(catalog.products) : { today: false, text: '' };
  const number = whatsappNumber(shop);
  // A review build shows every WhatsApp button, so it can be judged before the number is approved.
  const waOn = Boolean(number) || contentReview;
  const orderLink = waOn ? waLink(number, waText.order()) : '';
  const phone = phoneNumber(shop);
  return (
    <>
      <a className="skip" href="#rates">
        Skip to today&apos;s rates
      </a>
      {shop.contactApproved ? (
        <JsonLd
          data={{
            '@context': 'https://schema.org',
            '@type': 'HardwareStore',
            name: siteName,
            url: pageUrl('/'),
            areaServed: { '@type': 'City', name: 'Patna' },
            currenciesAccepted: 'INR',
            ...(shop.address
              ? {
                  address: {
                    '@type': 'PostalAddress',
                    streetAddress: shop.address,
                    addressLocality: 'Patna',
                    addressRegion: 'Bihar',
                    addressCountry: 'IN',
                  },
                }
              : {}),
            ...(phone ? { telephone: phone } : {}),
          }}
        />
      ) : null}
      <JsonLd
        data={{
          '@context': 'https://schema.org',
          '@type': 'WebSite',
          name: siteName,
          url: pageUrl('/'),
        }}
      />
      <Film
        catalog={catalog}
        whatsappHref={orderLink}
        fallbackHref={config.askEnabled ? '/ask' : '/contact'}
        fallbackLabel={config.askEnabled ? 'Ask about your home' : 'Ask the shop'}
      />

      <section
        className={`${s.rates} on-night`}
        id="rates"
        aria-labelledby="rates-title"
        data-nav-tone="night"
      >
        <div className={s.ratesGrid}>
          <div className={s.ratesSide}>
            <h2 id="rates-title">{fresh.today ? 'Today’s rates' : 'Rates'}</h2>
            <p>
              Rates for Patna, for the unit written beside them. Add what you need and send the
              whole list to the shop.
            </p>
            {sample ? (
              <div className={s.sampleLine}>
                <span className="sample">Sample rates, not real prices</span>
              </div>
            ) : fresh.text ? (
              <p>{fresh.text}</p>
            ) : null}
            <div className={s.slipBox} data-needs-js>
              <ListSlip whatsappHref={waOn ? waLink(number) : ''} />
            </div>
          </div>
          <div>
            {catalog && groups.length ? (
              groups.map((group, index) => (
                <RateGroup group={group} sample={sample} open={index === 0} key={group.slug} />
              ))
            ) : (
              <RatesDown whatsapp={number ? waLink(number, waText.rates()) : undefined} />
            )}
            <p className={s.allRates}>
              <Link className="btn btn-line" href="/rates" prefetch={false}>
                Open the full rate page
              </Link>
            </p>
          </div>
        </div>
      </section>

      {groups.length ? (
        <section className={s.materials} aria-labelledby="materials-title" data-nav-tone="day">
          <div className={s.specimens}>
            <h2 className={s.materialsHead} id="materials-title">
              One place, from the first bori to the last slab
            </h2>
            {groups.map((group) => {
              const material = materialFor(group.slug);
              return (
                <Link
                  className={`${s.spec} ${specimenClass[group.slug] ?? ''}`}
                  href={`/materials/${group.slug}`}
                  key={group.slug}
                  prefetch={false}
                >
                  {material?.specimen ? <Specimen kind={material.specimen} /> : null}
                  <span className={s.specName}>{group.name}</span>
                  <span className={s.specRate}>
                    {material?.plain
                      ? `${material.plain[0]!.toUpperCase()}${material.plain.slice(1)}. `
                      : ''}
                    {group.lowest
                      ? `${group.from ? 'From ' : ''}${rateText(group.lowest)} ${unitWords(group.lowest.unit).short}${sample ? ', sample' : ''}`
                      : 'Ask for the rate'}
                  </span>
                </Link>
              );
            })}
          </div>
        </section>
      ) : null}

      <section className={s.ask} aria-labelledby="ask-title" data-nav-tone="down" id="ask">
        <div className={s.plumb} aria-hidden="true">
          <img
            src={plates.plumb.src}
            width={400}
            height={1040}
            alt=""
            loading="lazy"
            decoding="async"
          />
        </div>
        <div className={s.askGrid}>
          <div>
            <h2 id="ask-title">
              Not sure about something? {config.askEnabled ? 'Ask.' : 'Start here.'}
            </h2>
            <p className={s.askSub}>
              Plain words on buying and checking materials.{' '}
              {config.askEnabled
                ? 'Rates come from the shop’s list, and anything structural goes to a qualified engineer.'
                : 'For anything structural, ask a qualified engineer.'}
            </p>
            <p style={{ marginTop: '1.25rem' }}>
              {config.askEnabled ? (
                <Link className="btn btn-solid" href="/ask" data-ask prefetch={false}>
                  Ask your question
                </Link>
              ) : guide.length ? (
                <Link className="btn btn-solid" href="/guide" prefetch={false}>
                  Read the guide
                </Link>
              ) : (
                <Link className="btn btn-solid" href="/contact" prefetch={false}>
                  Ask the shop
                </Link>
              )}
            </p>
          </div>
          <ul className={s.articles}>
            {starters
              .filter(
                (starter) => config.askEnabled || guide.some((item) => item.slug === starter.slug),
              )
              .map((starter) => (
                <li key={starter.label}>
                  {config.askEnabled ? (
                    <Link
                      href={`/ask?q=${encodeURIComponent(starter.label)}`}
                      data-ask
                      data-ask-send
                      data-ask-seed={starter.label}
                      prefetch={false}
                    >
                      {starter.label}
                    </Link>
                  ) : (
                    <Link href={`/guide/${starter.slug}`} prefetch={false}>
                      {starter.label}
                    </Link>
                  )}
                </li>
              ))}
            {!config.askEnabled && !guide.length
              ? materials.slice(0, 3).map((material) => (
                  <li key={material.slug}>
                    <Link href={`/materials/${material.slug}`} prefetch={false}>
                      How {material.name.toLowerCase()} is sold and what to check
                    </Link>
                  </li>
                ))
              : null}
          </ul>
        </div>
      </section>

      {waOn ? (
        <section className={s.wa} aria-labelledby="wa-title" data-nav-tone="day" id="whatsapp">
          <div className={s.waGrid}>
            <div className={s.waCopy}>
              <h2 id="wa-title">
                <span className={s.brk}>Order on WhatsApp.</span>{' '}
                <span className={s.brk}>A person confirms it.</span>
              </h2>
              <p>
                Send it the way you already do: a line of text or your whole list. A person at the
                shop reads it and confirms. Nothing is confirmed until someone at the shop says yes.
              </p>
              <div className={s.waActions}>
                <a
                  className="btn btn-solid"
                  href={waLink(number)}
                  data-wa-list={waLink(number)}
                  target="_blank"
                  rel="noopener noreferrer"
                  suppressHydrationWarning
                >
                  <span data-wa-count="Open WhatsApp" suppressHydrationWarning>
                    Open WhatsApp
                  </span>
                </a>
                <Link className="link" href="/whatsapp" prefetch={false}>
                  How it works
                </Link>
              </div>
              {!number ? (
                <div style={{ marginTop: '1rem' }}>
                  <Placeholder id="whatsapp-number">
                    WhatsApp number not approved yet, so these buttons open WhatsApp with no number.
                    Set it in <code>apps/api/src/public-content.ts</code>. Until then customers see
                    no WhatsApp button at all.
                  </Placeholder>
                </div>
              ) : null}
              <div className={s.waTractor} aria-hidden="true">
                <img
                  src={plates.tractor.src}
                  width={860}
                  height={430}
                  alt=""
                  loading="lazy"
                  decoding="async"
                />
              </div>
            </div>
            <div className={s.chat}>
              <div className={s.chatTop}>
                <b>{siteName}</b>
                <span>Example chat</span>
              </div>
              <div className={s.msgs}>
                <div className={`${s.msg} ${s.msgIn}`}>
                  Bhaiya 50 bori cement aur 1 trolley balu chahiye, kal site pe
                  <small>Customer</small>
                </div>
                <div className={`${s.msg} ${s.msgShop}`}>
                  Aapka message dukaan tak pahunch gaya. Yeh abhi pakka nahi hai.
                  <small>The shop, not yet confirmed</small>
                </div>
                <div className={`${s.msg} ${s.msgOk}`}>
                  Pakka. Dukaan ne aapka order pakka kiya.
                  <small>Example. Confirmed by a person</small>
                </div>
              </div>
            </div>
          </div>
        </section>
      ) : null}

      <AwardsBand />

      <section className={s.shop} aria-labelledby="shop-title" data-nav-tone="up">
        <div className={s.shopHead}>
          <h2 id="shop-title">A family shop in Patna</h2>
          <div>
            <p>{shop.story || 'A family shop for the materials your next project needs.'}</p>
            <p style={{ marginTop: '1rem' }}>
              <Link className="btn btn-line" href="/about" prefetch={false}>
                About the shop
              </Link>
            </p>
          </div>
        </div>
        {shop.gallery.length ? (
          <div className={s.photos}>
            {shop.gallery.slice(0, 5).map((photo) => (
              <figure className={s.photoSlot} key={photo.image}>
                <img src={photo.image} alt={photo.alt} loading="lazy" decoding="async" />
              </figure>
            ))}
          </div>
        ) : contentReview ? (
          <>
            <div className={s.photos}>
              {[
                'Photo of the shop front. The family adds this.',
                'Photo of the family at the shop, if they want one.',
                'Photo of the stock in the yard.',
                'Photo of a tractor loading.',
                'A home the shop supplied, with permission.',
              ].map((caption) => (
                <div className={s.photoSlot} key={caption}>
                  {caption}
                </div>
              ))}
            </div>
            <div style={{ marginTop: '1rem' }}>
              <Placeholder id="shop-photos">
                Real photographs only. Customers do not see these empty frames.
              </Placeholder>
            </div>
          </>
        ) : null}
      </section>
    </>
  );
}
