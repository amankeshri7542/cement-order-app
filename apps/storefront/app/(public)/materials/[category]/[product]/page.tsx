import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound, permanentRedirect } from 'next/navigation';
import { JsonLd } from '../../../../../components/json-ld';
import { pageStyles as s, PageHead } from '../../../../../components/page';
import { AddButton, RatesDown, Stepper } from '../../../../../components/rates';
import { Specimen } from '../../../../../components/specimen';
import { approvedPhoto } from '../../../../../lib/api';
import {
  availabilityText,
  findProduct,
  hasRate,
  offerText,
  offersFor,
  productPath,
  rateText,
  unitWords,
} from '../../../../../lib/catalog';
import { dayText, isToday, timeText } from '../../../../../lib/format';
import { materialFor, siteSlug } from '../../../../../lib/materials';
import {
  readCatalog,
  readClientConfig,
  readOffers,
  readShop,
  whatsappNumber,
} from '../../../../../lib/public-data';
import { contentReview } from '../../../../../lib/review';
import { pageMeta, robotsFor } from '../../../../../lib/seo';
import { pageUrl, siteName } from '../../../../../lib/site';
import { waLink, waText } from '../../../../../lib/whatsapp';
import m from '../../materials.module.css';

type Props = { params: Promise<{ category: string; product: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const [{ product: slug }, read] = await Promise.all([params, readCatalog()]);
  const product = read.catalog ? findProduct(read.catalog, slug) : null;
  if (!product) return { title: 'Material', robots: { index: false } };
  const photo = approvedPhoto(product.images);
  const title = `${product.name} rate in Patna${hasRate(product) ? `: ${rateText(product)} ${unitWords(product.unit).short}` : ''}`;
  return {
    ...pageMeta(
      productPath(product),
      title,
      `${product.name} by ${product.brand}. ${product.type}, ${product.grade}. ${availabilityText(product)} At ${siteName}, Patna.`,
      // Link previews are cached, so a share image never shows a price.
      photo ? { openGraph: { title, images: [photo] } } : {},
    ),
    robots: robotsFor(read),
  };
}

export default async function ProductPage({ params }: Props) {
  const [{ category, product: slug }, read, offers, shop, config] = await Promise.all([
    params,
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
  const product = findProduct(catalog, slug);
  if (!product) notFound();
  const path = productPath(product);
  // The one address for a product: an old name or the wrong shelf moves here for good.
  if (path !== `/materials/${category}/${slug}`) permanentRedirect(path);
  const materialSlug = siteSlug(product.categorySlug);
  const material = materialFor(materialSlug);
  const units = unitWords(product.unit);
  const photo = approvedPhoto(product.images);
  const url = pageUrl(path);
  const amount = hasRate(product) ? (product.pricePaise / 100).toFixed(2) : '';
  const offered = offersFor(
    offers,
    product,
    (slug) => catalog.categories.find((item) => item.slug === slug)?.id,
  );
  const available = product.availability === 'IN_STOCK';
  const groupName =
    material?.name ??
    catalog.categories.find((c) => c.slug === product.categorySlug)?.name ??
    materialSlug;
  return (
    <div className={s.page}>
      {hasRate(product) ? (
        <JsonLd
          data={{
            '@context': 'https://schema.org',
            '@type': 'Product',
            name: product.name,
            description: product.description,
            // "Local supply" and "Local kiln" describe where it comes from; they are not brands.
            ...(/^local\b/i.test(product.brand)
              ? {}
              : { brand: { '@type': 'Brand', name: product.brand } }),
            category: groupName,
            ...(photo ? { image: [photo] } : {}),
            offers: {
              '@type': 'Offer',
              url,
              priceCurrency: 'INR',
              price: amount,
              priceSpecification: {
                '@type': 'UnitPriceSpecification',
                price: amount,
                priceCurrency: 'INR',
                unitText: product.unit,
              },
              availability: available
                ? 'https://schema.org/InStock'
                : 'https://schema.org/OutOfStock',
              itemCondition: 'https://schema.org/NewCondition',
              seller: { '@type': 'Organization', name: siteName },
            },
          }}
        />
      ) : null}
      <JsonLd
        data={{
          '@context': 'https://schema.org',
          '@type': 'BreadcrumbList',
          itemListElement: [
            { '@type': 'ListItem', position: 1, name: 'Materials', item: pageUrl('/materials') },
            {
              '@type': 'ListItem',
              position: 2,
              name: groupName,
              item: pageUrl(`/materials/${materialSlug}`),
            },
            { '@type': 'ListItem', position: 3, name: product.name, item: url },
          ],
        }}
      />
      <div className={m.product}>
        <div>
          <PageHead
            title={product.name}
            crumbs={[
              { href: '/materials', label: 'Materials' },
              { href: `/materials/${materialSlug}`, label: groupName },
              { label: product.name },
            ]}
          >
            <p className={s.meta}>
              {[product.brand, product.type, product.grade].filter(Boolean).join(', ')}
            </p>
            <p className={m.word} data-off={available ? undefined : ''}>
              {availabilityText(product)}
            </p>
            {hasRate(product) ? (
              <p className={m.price}>
                {rateText(product)}
                <small>{units.long}</small>
              </p>
            ) : null}
            {hasRate(product) ? (
              <p
                className="your-rate"
                data-your-rate={product.id}
                hidden
                suppressHydrationWarning
              />
            ) : null}
            {catalog.sampleRates && hasRate(product) ? (
              <p className={s.note}>
                <span className="sample">Sample rate, not a real price</span>
              </p>
            ) : null}
            {hasRate(product) ? (
              <p className={s.meta}>
                {isToday(product.checkedAt)
                  ? `Checked today, ${timeText(product.checkedAt)}`
                  : `Rate as of ${dayText(product.checkedAt)}`}
              </p>
            ) : null}
            {offered.map((offer) => (
              <p className={s.offer} key={`${offer.title}${offer.endsOn}`}>
                {offerText(offer, product)}
              </p>
            ))}
            {available ? (
              <div className={m.buy} data-needs-js>
                <Stepper product={product} />
                <AddButton product={product} />
              </div>
            ) : null}
            <p className={s.actions}>
              {config.askEnabled ? (
                <Link
                  className="btn btn-quiet"
                  href={`/ask?about=${encodeURIComponent(product.name)}&product=${encodeURIComponent(product.id)}`}
                  data-ask
                  data-ask-seed={`About ${product.name}: `}
                  data-ask-product={product.id}
                  prefetch={false}
                >
                  Ask about this
                </Link>
              ) : null}
              {number || contentReview ? (
                <a
                  className="btn btn-line"
                  href={waLink(number, waText.product(product.name, units.short))}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  Ask on WhatsApp
                </a>
              ) : (
                <Link
                  className="btn btn-line"
                  href={`/contact?interest=${encodeURIComponent(product.name)}#enquiry`}
                  prefetch={false}
                >
                  Ask the shop
                </Link>
              )}
              <Link className="btn btn-quiet" href="/delivery" prefetch={false}>
                Check delivery
              </Link>
              <button
                type="button"
                className="btn btn-quiet"
                data-compare={product.id}
                data-needs-js
                suppressHydrationWarning
              >
                Compare
              </button>
              <Link
                className="btn btn-quiet"
                href="/compare"
                data-compare-open
                hidden
                prefetch={false}
                suppressHydrationWarning
              >
                Open comparison
              </Link>
            </p>
          </PageHead>
        </div>
        <div>
          {photo ? (
            // Approved photos live on the asset host, already sized when they were uploaded.
            <img
              src={photo}
              alt={product.name}
              className={m.heroArt}
              loading="eager"
              referrerPolicy="no-referrer"
            />
          ) : material?.specimen ? (
            <figure>
              <Specimen first kind={material.specimen} className={m.heroArt} />
              <figcaption className={s.meta}>A drawing, not a photo of this product.</figcaption>
            </figure>
          ) : null}
        </div>
      </div>
      <section className={s.sectionBand}>
        <h2>Details</h2>
        <table className={s.facts}>
          <tbody>
            {(
              [
                ['Sold by', units.long],
                ['Pack size', product.packSize || 'Ask the shop'],
                ['Smallest order', `${product.minQuantity}`],
                ['In steps of', `${product.quantityStep}`],
                ['Type', product.type],
                ['Grade', product.grade],
              ] as const
            ).map(([name, value]) => (
              <tr key={name}>
                <th scope="row">{name}</th>
                <td>{value}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {product.description ? (
          <p style={{ marginTop: '1.5rem', maxWidth: '44rem' }}>{product.description}</p>
        ) : null}
        {product.recommendedUse ? (
          <p style={{ marginTop: '1rem', maxWidth: '44rem' }}>
            Often used for: {product.recommendedUse} Your engineer decides what goes in your
            structure.
          </p>
        ) : null}
      </section>
    </div>
  );
}
