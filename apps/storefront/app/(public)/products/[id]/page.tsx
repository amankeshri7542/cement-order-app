import { notFound, permanentRedirect } from 'next/navigation';
import { pageStyles as s, PageHead } from '../../../../components/page';
import { RatesDown } from '../../../../components/rates';
import { findProduct, productPath } from '../../../../lib/catalog';
import { readCatalog } from '../../../../lib/public-data';

/** An old product address. It moves for good to the new one, found by lookup in the catalogue. */
export default async function OldProduct({ params }: { params: Promise<{ id: string }> }) {
  const [{ id }, read] = await Promise.all([params, readCatalog()]);
  if (!read.catalog)
    return (
      <div className={s.page}>
        <PageHead title="Materials" />
        <RatesDown />
      </div>
    );
  const product = findProduct(read.catalog, id);
  if (!product) notFound();
  permanentRedirect(productPath(product));
}
