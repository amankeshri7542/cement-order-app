import type { Metadata } from 'next';
import { pageStyles as s, PageHead } from '../../../components/page';
import { ListSlip, RateGroup, RatesDown } from '../../../components/rates';
import { freshness, groupByMaterial, offerText } from '../../../lib/catalog';
import { readCatalog, readOffers, readShop, whatsappNumber } from '../../../lib/public-data';
import { contentReview } from '../../../lib/review';
import { pageMeta, robotsFor } from '../../../lib/seo';
import { waLink, waText } from '../../../lib/whatsapp';

export async function generateMetadata(): Promise<Metadata> {
  const read = await readCatalog();
  const today = read.catalog ? freshness(read.catalog.products).today : false;
  const title = `Cement, sariya and balu rates in Patna${today ? ' today' : ''}`;
  return {
    ...pageMeta(
      '/rates',
      title,
      `Every rate at Shiv Cement Store, Patna${today ? ', checked today' : ''}, with the selling unit beside it. Build a list and send it to the shop.`,
    ),
    robots: robotsFor(read),
  };
}

export default async function RatesPage() {
  const [read, offers, shop] = await Promise.all([readCatalog(), readOffers(), readShop()]);
  const catalog = read.catalog;
  const number = whatsappNumber(shop);
  const waHref = number || contentReview ? waLink(number) : '';
  const fresh = catalog ? freshness(catalog.products) : { today: false, text: '' };
  const groups = catalog ? groupByMaterial(catalog) : [];
  const old =
    catalog &&
    read.status === 'stale' &&
    Date.now() - new Date(catalog.generatedAt).getTime() > 86400000;
  return (
    <div className={`${s.page} ${s.night} on-night`} data-page-night>
      <div className={s.split}>
        <div className={s.side}>
          <PageHead
            title={fresh.today ? 'Today’s rates' : 'Rates'}
            lead="Rates for Patna, for the unit written beside them. Add what you need and send the whole list to the shop."
          >
            {catalog?.sampleRates ? (
              <p className={s.note}>
                <span className="sample">Sample rates, not real prices</span>
              </p>
            ) : null}
            {fresh.text ? <p className={s.meta}>{fresh.text}</p> : null}
            {old ? (
              <p className={s.meta} role="status">
                The shop&apos;s list could not be read since then, so check with the shop before you
                rely on these.
              </p>
            ) : null}
            {offers.length ? (
              <div className={s.note}>
                {offers.map((offer) => (
                  <p className={s.offer} key={`${offer.title}${offer.endsOn}`}>
                    {offerText(offer)}
                  </p>
                ))}
              </div>
            ) : null}
          </PageHead>
          <div style={{ marginTop: '2rem', maxWidth: '26rem' }} data-needs-js>
            <ListSlip whatsappHref={waHref} heading="h2" />
          </div>
        </div>
        <div>
          {catalog && groups.length ? (
            groups.map((group) => (
              <RateGroup group={group} sample={catalog.sampleRates} open key={group.slug} />
            ))
          ) : (
            <RatesDown whatsapp={number ? waLink(number, waText.rates()) : undefined} />
          )}
        </div>
      </div>
    </div>
  );
}
