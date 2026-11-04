import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { ProductDetail } from '../../../components/detail';
import { readProduct } from '../../../lib/server';
import { price } from '../../../lib/catalog';

type Props = { params: Promise<{ id: string }> };
export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { product, missing } = await readProduct((await params).id);
  if (!product) return { title: missing ? 'Material unavailable' : 'Material details' };
  return {
    title: product.name,
    description: `${product.name} by ${product.brand}. ${product.type}, ${product.grade}. ${price(product.pricePaise)} per ${product.unit}${product.packSize ? `, ${product.packSize}` : ''}. ${product.stock > 0 ? 'Listed in stock' : 'Currently out of stock'} at Shiv Cement Store, Patna.`,
    openGraph: {
      title: `${product.name} | Shiv Cement Store`,
      description: product.description.slice(0, 200),
      type: 'website',
      locale: 'en_IN',
    },
  };
}
export default async function Page({ params }: Props) {
  const { id } = await params;
  const { product, missing } = await readProduct(id);
  if (missing) notFound();
  return (
    <ProductDetail id={id} initial={product} checked={product ? new Date().toISOString() : null} />
  );
}
