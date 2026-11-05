import type { Metadata } from 'next';
import Link from 'next/link';
import { pageStyles as s, PageHead } from '../../../components/page';
import { RateTable, RatesDown } from '../../../components/rates';
import { Specimen } from '../../../components/specimen';
import { groupByMaterial, rateText, searchCatalog, unitWords } from '../../../lib/catalog';
import { materialFor } from '../../../lib/materials';
import { readCatalog, readShop, whatsappNumber } from '../../../lib/public-data';
import { pageMeta, robotsFor } from '../../../lib/seo';
import { waLink, waText } from '../../../lib/whatsapp';
import m from './materials.module.css';

type Props = { searchParams: Promise<{ q?: string | string[] }> };

export async function generateMetadata({ searchParams }: Props): Promise<Metadata> {
  const read = await readCatalog();
  const { q } = await searchParams;
  return {
    ...pageMeta(
      '/materials',
      'Building materials in Patna',
      'Cement, sariya, bricks, balu and gitti at Shiv Cement Store, Patna, with how each is sold and what to check when it arrives.',
    ),
    // A search result is never a page of its own for Google.
    robots: q ? { index: false, follow: true } : robotsFor(read),
  };
}

export default async function MaterialsPage({ searchParams }: Props) {
  const [read, shop, params] = await Promise.all([readCatalog(), readShop(), searchParams]);
  const raw = Array.isArray(params.q) ? params.q[0] : params.q;
  const q = (raw ?? '').trim().slice(0, 100);
  const catalog = read.catalog;
  const groups = catalog ? groupByMaterial(catalog) : [];
  const results = catalog && q ? searchCatalog(catalog, q) : [];
  const number = whatsappNumber(shop);
  return (
    <div className={s.page}>
      <PageHead
        title="Materials"
        lead="Everything used while building a home, with how it is sold and what to check when it arrives."
      >
        <form className={s.search} action="/materials" role="search">
          <label className="sr" htmlFor="material-search">
            Search materials
          </label>
          <input
            id="material-search"
            type="search"
            name="q"
            maxLength={100}
            defaultValue={q}
            placeholder="Cement, sariya, a brand"
          />
          <button type="submit" className="btn btn-solid">
            Search
          </button>
        </form>
      </PageHead>
      {!catalog ? (
        <RatesDown whatsapp={number ? waLink(number, waText.rates()) : undefined} />
      ) : q ? (
        <section className={s.sectionBand} aria-live="polite">
          {results.length ? (
            <>
              <h2>
                {results.length === 1 ? '1 result' : `${results.length} results`} for &ldquo;{q}
                &rdquo;
              </h2>
              <div style={{ marginTop: '1rem' }}>
                <RateTable
                  products={results}
                  sample={catalog.sampleRates}
                  caption="Search results"
                />
              </div>
            </>
          ) : (
            <div className={s.state}>
              <h2>Not listed? Ask the shop.</h2>
              <p>
                Nothing here matches &ldquo;{q}&rdquo;. The shop may still have it, or can tell you
                what to use instead.
              </p>
              <p className={s.actions}>
                {number ? (
                  <a
                    className="btn btn-solid"
                    href={waLink(number, waText.material(q))}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    Ask on WhatsApp
                  </a>
                ) : null}
                <Link
                  className={number ? 'btn btn-line' : 'btn btn-solid'}
                  href={`/contact?interest=${encodeURIComponent(q)}#enquiry`}
                  prefetch={false}
                >
                  Ask the shop
                </Link>
              </p>
            </div>
          )}
        </section>
      ) : null}
      {catalog && !groups.length ? (
        <div className={s.state}>
          <h2>The shop&apos;s list is being prepared.</h2>
          <p>Nothing is listed yet. Ask the shop for what you need.</p>
        </div>
      ) : null}
      <div className={m.shelf}>
        {groups.map((group) => {
          const material = materialFor(group.slug);
          return (
            <Link
              className={m.item}
              href={`/materials/${group.slug}`}
              key={group.slug}
              prefetch={false}
            >
              <span className={m.words}>
                <span className={m.name}>{group.name}</span>
                {material?.plain ? <span className={m.plain}>{material.plain}</span> : null}
                <span className={m.rate}>
                  {group.lowest ? (
                    <>
                      {group.from ? 'from ' : ''}
                      <b>{rateText(group.lowest)}</b> {unitWords(group.lowest.unit).short}
                      {catalog?.sampleRates ? ', sample' : ''}
                    </>
                  ) : (
                    'Ask for the rate'
                  )}
                </span>
              </span>
              {material?.specimen ? <Specimen kind={material.specimen} className={m.art} /> : null}
            </Link>
          );
        })}
      </div>
    </div>
  );
}
