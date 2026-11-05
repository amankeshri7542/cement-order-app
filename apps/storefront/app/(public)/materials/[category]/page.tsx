import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { JsonLd } from '../../../../components/json-ld';
import { pageStyles as s, PageHead } from '../../../../components/page';
import { RateTable, RatesDown } from '../../../../components/rates';
import { Specimen } from '../../../../components/specimen';
import {
  findGroup,
  freshness,
  offerText,
  offersFor,
  rateText,
  unitWords,
} from '../../../../lib/catalog';
import { materialFor } from '../../../../lib/materials';
import {
  readCatalog,
  readClientConfig,
  readOffers,
  readShop,
  whatsappNumber,
} from '../../../../lib/public-data';
import { contentReview } from '../../../../lib/review';
import { pageMeta, robotsFor } from '../../../../lib/seo';
import { pageUrl } from '../../../../lib/site';
import { waLink, waText } from '../../../../lib/whatsapp';
import m from '../materials.module.css';

type Props = {
  params: Promise<{ category: string }>;
  searchParams: Promise<{ brand?: string | string[]; grade?: string | string[] }>;
};
const first = (value?: string | string[]) => (Array.isArray(value) ? value[0] : value) ?? '';
const fullName = (slug: string, name: string) => {
  const plain = materialFor(slug)?.plain;
  return plain && slug !== 'cement' && slug !== 'bricks' ? `${name} (${plain})` : name;
};

export async function generateMetadata({ params, searchParams }: Props): Promise<Metadata> {
  const [{ category }, query, read] = await Promise.all([params, searchParams, readCatalog()]);
  const group = read.catalog ? findGroup(read.catalog, category) : null;
  if (!group) return { title: 'Materials', robots: { index: false } };
  const fresh = freshness(group.products);
  const title = `${fullName(group.slug, group.name)} rate in Patna${fresh.today ? ' today' : ''}${
    group.lowest
      ? `: ${group.from ? 'from ' : ''}${rateText(group.lowest)} ${unitWords(group.lowest.unit).short}`
      : ''
  }`;
  return {
    ...pageMeta(
      `/materials/${group.slug}`,
      title,
      `${group.name} at Shiv Cement Store, Patna: rates with the unit beside them, how it is sold and what to check when it arrives.`,
    ),
    // Filter addresses point Google at the base page.
    robots:
      first(query.brand) || first(query.grade) ? { index: false, follow: true } : robotsFor(read),
  };
}

export default async function MaterialPage({ params, searchParams }: Props) {
  const [{ category }, query, read, offers, shop, config] = await Promise.all([
    params,
    searchParams,
    readCatalog(),
    readOffers(),
    readShop(),
    readClientConfig(),
  ]);
  const number = whatsappNumber(shop);
  if (!read.catalog)
    return (
      <div className={s.page}>
        <PageHead title="Materials" />
        <RatesDown whatsapp={number ? waLink(number, waText.rates()) : undefined} />
      </div>
    );
  const { catalog } = read;
  const group = findGroup(catalog, category);
  if (!group) notFound();
  const material = materialFor(group.slug);
  const brand = first(query.brand).slice(0, 80);
  const grade = first(query.grade).slice(0, 40);
  const shown = group.products.filter(
    (product) => (!brand || product.brand === brand) && (!grade || product.grade === grade),
  );
  const brands = [...new Set(group.products.map((product) => product.brand))].sort();
  const fresh = freshness(group.products);
  const categoryId = (slug: string) => catalog.categories.find((item) => item.slug === slug)?.id;
  const groupOffers = offers.filter((offer) =>
    group.products.some((product) => offersFor([offer], product, categoryId).length),
  );
  const path = `/materials/${group.slug}`;
  return (
    <div className={s.page}>
      <JsonLd
        data={{
          '@context': 'https://schema.org',
          '@type': 'BreadcrumbList',
          itemListElement: [
            { '@type': 'ListItem', position: 1, name: 'Materials', item: pageUrl('/materials') },
            { '@type': 'ListItem', position: 2, name: group.name, item: pageUrl(path) },
          ],
        }}
      />
      <div className={m.hero}>
        <PageHead
          title={`${group.name} rate in Patna${fresh.today ? ' today' : ''}`}
          crumbs={[{ href: '/materials', label: 'Materials' }, { label: group.name }]}
          lead={material?.also}
        >
          {group.lowest ? (
            <p className={m.lowest}>
              {group.from ? <small>from </small> : null}
              {rateText(group.lowest)} <small>{unitWords(group.lowest.unit).short}</small>
            </p>
          ) : (
            <p className={s.meta}>Ask for the rate.</p>
          )}
          {catalog.sampleRates ? (
            <p className={s.note}>
              <span className="sample">Sample rates, not real prices</span>
            </p>
          ) : null}
          {fresh.text ? <p className={s.meta}>{fresh.text}</p> : null}
          {groupOffers.map((offer) => (
            <p className={s.offer} key={`${offer.title}${offer.endsOn}`}>
              {offerText(offer)}
            </p>
          ))}
        </PageHead>
        {material?.specimen ? (
          <Specimen first kind={material.specimen} className={m.heroArt} />
        ) : null}
      </div>

      {brands.length > 1 ? (
        <nav className={m.filters} aria-label={`Filter ${group.name} by brand`}>
          <Link href={path} aria-current={!brand ? 'true' : undefined} prefetch={false}>
            All
          </Link>
          {brands.map((name) => (
            <Link
              href={`${path}?brand=${encodeURIComponent(name)}`}
              aria-current={brand === name ? 'true' : undefined}
              key={name}
              prefetch={false}
            >
              {name}
            </Link>
          ))}
        </nav>
      ) : null}
      <div style={{ marginTop: '1rem' }}>
        {shown.length ? (
          <RateTable
            products={shown}
            sample={catalog.sampleRates}
            caption={`${group.name} rates`}
          />
        ) : (
          <div className={s.state}>
            <h2>Nothing matches that filter.</h2>
            <p>
              <Link className="link" href={path} prefetch={false}>
                See all {group.name.toLowerCase()}
              </Link>
            </p>
          </div>
        )}
      </div>

      {material ? (
        <section className={s.sectionBand}>
          <h2>Before you buy {material.name.toLowerCase()}</h2>
          <div className={s.columns}>
            <div>
              <h3>How it is sold</h3>
              <ul>
                {material.sold.map((line) => (
                  <li key={line}>{line}</li>
                ))}
              </ul>
            </div>
            <div>
              <h3>How to choose</h3>
              <ul>
                {material.choose.map((line) => (
                  <li key={line}>{line}</li>
                ))}
              </ul>
            </div>
            <div>
              <h3>What to check when it arrives</h3>
              <ul>
                {[...material.arrival, ...(material.storage ?? [])].map((line) => (
                  <li key={line}>{line}</li>
                ))}
              </ul>
            </div>
          </div>
        </section>
      ) : null}

      <section className={s.sectionBand}>
        <h2>Still not sure?</h2>
        <p className={s.actions}>
          {config.askEnabled ? (
            <Link
              className="btn btn-solid"
              href={`/ask?about=${encodeURIComponent(group.name)}`}
              data-ask
              data-ask-seed={`About ${group.name}: `}
              prefetch={false}
            >
              Ask about {group.name.toLowerCase()}
            </Link>
          ) : (
            <Link className="btn btn-solid" href="/guide" prefetch={false}>
              Read the guide
            </Link>
          )}
          {number || contentReview ? (
            <a
              className="btn btn-line"
              href={waLink(number, waText.material(group.name))}
              target="_blank"
              rel="noopener noreferrer"
            >
              Ask on WhatsApp
            </a>
          ) : (
            <Link
              className="btn btn-line"
              href={`/contact?interest=${encodeURIComponent(group.name)}#enquiry`}
              prefetch={false}
            >
              Ask the shop
            </Link>
          )}
        </p>
      </section>
    </div>
  );
}
