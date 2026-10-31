import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { ProductDetail } from '../../../components/detail';
import { JsonLd } from '../../../components/json-ld';
import { approvedPhoto } from '../../../lib/api';
import { readProduct } from '../../../lib/server';
import { price } from '../../../lib/catalog';
import { languageAlternates, requestLanguage } from '../../../lib/language';
import { pageUrl, siteName } from '../../../lib/site';

type Props = { params: Promise<{ id: string }> };
export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { id } = await params;
  const { product, missing } = await readProduct(id);
  if (!product)
    return {
      title: missing ? 'Material unavailable' : 'Material details',
      description:
        'Material details at Shiv Cement Store, Patna: price per selling unit, pack size and availability.',
    };
  const { language } = await requestLanguage();
  const path = `/products/${encodeURIComponent(id)}`;
  const hi = language === 'hi';
  const name = hi && product.nameHi ? product.nameHi : product.name;
  const summary = hi && product.descriptionHi ? product.descriptionHi : product.description;
  const alternates = languageAlternates(path, language);
  return {
    title: name,
    alternates,
    description: hi
      ? `${name}, ${product.brand}। ${product.type}, ${product.grade}। ${price(product.pricePaise)} प्रति ${product.unit}${product.packSize ? `, ${product.packSize}` : ''}। ${product.stock > 0 ? 'स्टॉक में' : 'अभी स्टॉक में नहीं'}, शिव सीमेंट स्टोर, पटना।`
      : `${product.name} by ${product.brand}. ${product.type}, ${product.grade}. ${price(product.pricePaise)} per ${product.unit}${product.packSize ? `, ${product.packSize}` : ''}. ${product.stock > 0 ? 'Listed in stock' : 'Currently out of stock'} at Shiv Cement Store, Patna.`,
    // A page's openGraph replaces the layout's, so the share card (and its picture, which WhatsApp
    // shows) is given in full.
    openGraph: {
      title: `${name} | ${siteName}`,
      description: summary.slice(0, 200),
      url: alternates.canonical,
      siteName,
      type: 'website',
      locale: hi ? 'hi_IN' : 'en_IN',
      images: [approvedPhoto(product) ?? '/opengraph-image.png'],
    },
    twitter: { card: 'summary_large_image' },
  };
}
export default async function Page({ params }: Props) {
  const { id } = await params;
  const { product, missing } = await readProduct(id);
  if (missing) notFound();
  const url = pageUrl(`/products/${encodeURIComponent(id)}`);
  const photo = product ? approvedPhoto(product) : null;
  const amount = product ? (product.pricePaise / 100).toFixed(2) : '';
  return (
    <>
      {product ? (
        <>
          {/* What the page itself says, for search engines: the real price per selling unit. */}
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
              category: product.category.name,
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
                availability:
                  product.stock > 0
                    ? 'https://schema.org/InStock'
                    : 'https://schema.org/OutOfStock',
                itemCondition: 'https://schema.org/NewCondition',
                seller: { '@type': 'Organization', name: siteName },
              },
            }}
          />
          <JsonLd
            data={{
              '@context': 'https://schema.org',
              '@type': 'BreadcrumbList',
              itemListElement: [
                { '@type': 'ListItem', position: 1, name: 'Home', item: pageUrl('/') },
                { '@type': 'ListItem', position: 2, name: 'Materials', item: pageUrl('/products') },
                { '@type': 'ListItem', position: 3, name: product.name, item: url },
              ],
            }}
          />
        </>
      ) : null}
      <ProductDetail
        id={id}
        initial={product}
        checked={product ? new Date().toISOString() : null}
      />
    </>
  );
}
