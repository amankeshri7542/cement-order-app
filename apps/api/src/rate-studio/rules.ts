import type { ExtractedRate, RateIssue } from '@shiv/shared';
import type { Prisma, Product, PriceUpdateBatchItem } from '@prisma/client';
export function normalizeAlias(value: string) {
  return value
    .normalize('NFKC')
    .toLowerCase()
    .replace(/neo\s*steel/g, 'neosteel')
    .replace(/(\d)\s*(mm|kg)\b/g, '$1$2')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}
export function extractionAlias(
  row: Pick<ExtractedRate, 'brand' | 'product' | 'size' | 'specification'>,
) {
  return [row.brand, row.product, row.size, row.specification].filter(Boolean).join(' ');
}
export function rupeesToPaise(text: string | null): number | null {
  if (!text) return null;
  const value = text
    .trim()
    .replace(/^(?:₹|INR|Rs\.?)\s*/i, '')
    .replace(/\s*\/-$/, '');
  if (!/^(?:\d+|\d{1,3}(?:,\d{3})+|\d{1,2}(?:,\d{2})*,\d{3})(?:\.\d{1,2})?$/.test(value))
    return null;
  const [whole, fraction = ''] = value.replaceAll(',', '').split('.');
  const result = Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
  return Number.isSafeInteger(result) && result > 0 && result <= 100_000_000 ? result : null;
}
export function adjustedPrice(
  price: number,
  kind: 'FIXED' | 'PERCENT',
  direction: 'INCREASE' | 'DECREASE',
  amount: number,
) {
  // Integer basis points and half-up rounding; no floating rupee arithmetic.
  const change = kind === 'FIXED' ? amount : Math.floor((price * amount + 5000) / 10000);
  const next = direction === 'INCREASE' ? price + change : price - change;
  return Number.isSafeInteger(next) && next > 0 && next <= 100_000_000 ? next : null;
}
export type ReviewRow = Pick<
  PriceUpdateBatchItem,
  | 'included'
  | 'productId'
  | 'proposedPricePaise'
  | 'oldPricePaise'
  | 'expectedProductVersion'
  | 'reviewed'
  | 'acknowledged'
  | 'confidence'
  | 'unit'
> & { product: Product | null };
export function rowIssues(row: ReviewRow, duplicate: boolean): RateIssue[] {
  if (!row.included) return [];
  const issues: RateIssue[] = [];
  const add = (code: string, message: string, blocking = false) =>
    issues.push({ code, message, blocking });
  if (!row.product || !row.product.active)
    add('MISSING_PRODUCT', 'Choose an active store product.', true);
  if (duplicate) add('DUPLICATE', 'Two selected rows map to the same product. Exclude one.', true);
  if (!row.proposedPricePaise || row.proposedPricePaise < 1 || row.proposedPricePaise > 100_000_000)
    add('MISSING_PRICE', 'Enter a valid selling price.', true);
  if (row.product && row.expectedProductVersion !== row.product.version)
    add(
      'PRODUCT_CHANGED',
      'This product changed after review. Refresh its baseline and review again.',
      true,
    );
  if (!row.reviewed)
    add('NEEDS_REVIEW', 'Confirm the product, selling unit and proposed price.', true);
  if (row.confidence !== null && row.confidence < 0.85)
    add(
      'LOW_CONFIDENCE',
      `Extraction confidence ${Math.round(row.confidence * 100)}%. Check the source digits.`,
    );
  if (row.product && row.unit && normalizeAlias(row.unit) !== normalizeAlias(row.product.unit))
    add(
      'UNIT_MISMATCH',
      `Source says “${row.unit}”; store sells per ${row.product.unit}. Confirm the proposed price uses the store unit.`,
    );
  if (row.oldPricePaise && row.proposedPricePaise) {
    const change = row.proposedPricePaise - row.oldPricePaise;
    if (!change) add('UNCHANGED', 'Price is unchanged; no monetary history entry will be created.');
    if (Math.abs(change) * 100 >= row.oldPricePaise * 25)
      add(
        'LARGE_CHANGE',
        `${change > 0 ? '+' : ''}${((change / row.oldPricePaise) * 100).toFixed(1)}% change. Check for a missing decimal or extra zero.`,
      );
  }
  return issues;
}
export async function matchRate(tx: Prisma.TransactionClient, row: ExtractedRate) {
  const normalizedAlias = normalizeAlias(extractionAlias(row));
  if (normalizedAlias) {
    const known = await tx.productAlias.findUnique({
      where: { normalizedAlias },
      include: { product: true },
    });
    if (known?.product.active) return { product: known.product, method: 'CONFIRMED_ALIAS' };
  }
  const filters: Prisma.ProductWhereInput[] = [];
  if (row.brand) filters.push({ brand: { equals: row.brand, mode: 'insensitive' } });
  if (row.product) filters.push({ name: { contains: row.product, mode: 'insensitive' } });
  if (!filters.length) return { product: null, method: 'UNRECOGNIZED' };
  const candidates = await tx.product.findMany({
    where: { active: true, OR: filters },
    take: 100,
    orderBy: { id: 'asc' },
  });
  const exact = candidates.filter(
    (p) =>
      normalizeAlias(p.name) === normalizeAlias(row.product || '') ||
      normalizeAlias(`${p.brand} ${p.name} ${p.grade}`) === normalizedAlias,
  );
  if (
    exact.length === 1 &&
    (!row.brand || normalizeAlias(exact[0]!.brand) === normalizeAlias(row.brand))
  )
    return { product: exact[0], method: 'NORMALIZED_NAME' };
  const spec = normalizeAlias([row.size, row.specification].filter(Boolean).join(' '))
    .split(' ')
    .filter(Boolean);
  const branded =
    row.brand && spec.length
      ? candidates.filter(
          (p) =>
            normalizeAlias(p.brand) === normalizeAlias(row.brand!) &&
            spec.every((token) =>
              normalizeAlias(`${p.name} ${p.grade} ${p.type} ${p.packSize}`)
                .split(' ')
                .includes(token),
            ),
        )
      : [];
  if (branded.length === 1) return { product: branded[0], method: 'BRAND_SPECIFICATION' };
  return { product: null, method: candidates.length ? 'NEEDS_MATCH' : 'UNRECOGNIZED' };
}
