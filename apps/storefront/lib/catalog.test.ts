import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  availabilityText,
  findGroup,
  findProduct,
  freshness,
  groupByMaterial,
  hasRate,
  offersFor,
  offerText,
  productPath,
  productSlug,
  rateText,
  searchCatalog,
  slugify,
  unitWords,
} from './catalog';
import { materials, siteSlug } from './materials';
import type { Catalog, CatalogProduct, Offer } from './types';

const product = (id: string, over: Partial<CatalogProduct> = {}): CatalogProduct => ({
  id,
  name: `Name ${id}`,
  brand: 'Brand',
  type: 'Type',
  grade: 'Grade',
  unit: '50 kg bag',
  packSize: '',
  minQuantity: 1,
  quantityStep: 1,
  pricePaise: 41000,
  availability: 'IN_STOCK',
  priceUpdatedAt: '2026-11-05T03:00:00.000Z',
  checkedAt: '2026-11-05T03:00:00.000Z',
  images: [],
  description: '',
  recommendedUse: '',
  categorySlug: 'cement',
  searchTerms: [],
  ...over,
});
const catalogOf = (...products: CatalogProduct[]): Catalog => ({
  products,
  categories: [
    { id: 'c1', name: 'Cement', slug: 'cement' },
    { id: 'c2', name: 'Steel', slug: 'steel' },
    { id: 'c3', name: 'Pipes', slug: 'pipes' },
  ],
  ratesCheckedAt: null,
  sampleRates: false,
  generatedAt: '2026-11-05T03:00:00.000Z',
});

test('every material has its address, and steel, sand and aggregates read as the trade words', () => {
  assert.equal(siteSlug('steel'), 'sariya');
  assert.equal(siteSlug('sand'), 'balu');
  assert.equal(siteSlug('aggregates'), 'gitti');
  assert.equal(siteSlug('pipes'), 'pipes');
  assert.equal(new Set(materials.map((item) => item.slug)).size, materials.length);
});
test('materials are grouped in building order, unknown ones last', () => {
  const groups = groupByMaterial(
    catalogOf(
      product('p', { categorySlug: 'pipes' }),
      product('s', { categorySlug: 'steel', unit: 'kg · 12 mm', pricePaise: 6800 }),
      product('c'),
    ),
  );
  assert.deepEqual(
    groups.map((group) => group.slug),
    ['cement', 'sariya', 'pipes'],
  );
  assert.equal(groups[1]!.name, 'Sariya');
  assert.equal(groups[2]!.name, 'Pipes');
});
test('"from" appears only when more than one product has a rate', () => {
  const one = findGroup(catalogOf(product('a')), 'cement')!;
  assert.equal(one.from, false);
  const two = findGroup(catalogOf(product('a'), product('b', { pricePaise: 39500 })), 'cement')!;
  assert.equal(two.from, true);
  assert.equal(two.lowest?.id, 'b');
});
test('a product with no public rate is never the lowest and never ₹0', () => {
  const group = findGroup(
    catalogOf(product('a', { pricePaise: null, availability: 'ON_REQUEST' }), product('b')),
    'cement',
  )!;
  assert.equal(group.lowest?.id, 'b');
  assert.equal(group.from, false);
  assert.equal(rateText(product('c', { pricePaise: null })), '');
  assert.equal(hasRate(product('d', { pricePaise: 0 })), false);
});
test('a group of only on-request items has no lowest rate', () => {
  const group = findGroup(catalogOf(product('a', { pricePaise: null })), 'cement')!;
  assert.equal(group.lowest, null);
});

test('readable ids stand as the address; generated ids get a name and a stable key', () => {
  assert.equal(productSlug({ id: 'ultratech-ppc', name: 'UltraTech Super' }), 'ultratech-ppc');
  const cuid = 'clx9f2ab12cd34ef56gh78ij90';
  const slug = productSlug({ id: cuid, name: 'Tata Tiscon 550SD' });
  assert.equal(slug, `tata-tiscon-550sd-${cuid.slice(-8)}`);
  assert.equal(
    productPath({ id: cuid, name: 'Tata Tiscon 550SD', categorySlug: 'steel' }),
    `/materials/sariya/${slug}`,
  );
});
test('renaming a product keeps the old link finding it', () => {
  const cuid = 'clx9f2ab12cd34ef56gh78ij90';
  const catalog = catalogOf(product(cuid, { name: 'New name' }));
  assert.equal(findProduct(catalog, `old-name-${cuid.slice(-8)}`)?.id, cuid);
  assert.equal(findProduct(catalog, cuid)?.id, cuid);
});
test('a made-up address finds nothing, and short keys never match by accident', () => {
  const catalog = catalogOf(product('ultratech-ppc'), product('clx9f2ab12cd34ef56gh78ij90'));
  assert.equal(findProduct(catalog, 'nothing'), null);
  assert.equal(findProduct(catalog, 'x'), null);
  assert.equal(findProduct(catalog, ''), null);
  assert.equal(findProduct(catalog, '../../etc/passwd'), null);
  assert.equal(findProduct(catalog, 'ppc'), null);
  // A readable id is not found by its tail, only whole.
  assert.equal(findProduct(catalog, 'ech-ppcx'), null);
});
test('slugs are plain and bounded', () => {
  assert.equal(slugify('  ACC Gold: Water-Shield! '), 'acc-gold-water-shield');
  assert.ok(slugify('a'.repeat(200)).length <= 60);
  assert.equal(slugify('!!!'), '');
});

test('units read the way people say them', () => {
  assert.deepEqual(unitWords('50 kg bag'), {
    long: 'a bori (50 kg)',
    short: 'a bori',
    slash: 'bori',
  });
  assert.equal(unitWords('kg · 12 mm').long, 'a kg, 12 mm');
  assert.equal(unitWords('kg').short, 'a kg');
  assert.equal(unitWords('100 cu ft').short, 'per 100 cu ft');
  assert.equal(unitWords('1,000 bricks').short, 'per 1,000 bricks');
  assert.equal(unitWords('trolley').short, 'a trolley');
});

test('"today" is said only when every rate was checked today, in Patna time', () => {
  const now = new Date('2026-11-05T18:00:00.000Z'); // 23:30 in Patna on the 5th
  assert.equal(
    freshness([product('a', { checkedAt: '2026-11-05T03:30:00.000Z' })], now).today,
    true,
  );
  assert.equal(
    freshness([product('a', { checkedAt: '2026-11-05T03:30:00.000Z' })], now).text,
    'Checked today, 9:00 AM',
  );
  const mixed = freshness(
    [product('a'), product('b', { checkedAt: '2026-11-03T03:30:00.000Z' })],
    now,
  );
  assert.equal(mixed.today, false);
  assert.equal(mixed.text, 'Rates as of 3 November');
});
test('just after midnight in Patna, yesterday is not today even though UTC agrees', () => {
  const now = new Date('2026-11-05T18:45:00.000Z'); // 00:15 on the 6th in Patna
  assert.equal(
    freshness([product('a', { checkedAt: '2026-11-05T17:00:00.000Z' })], now).today,
    false,
  );
});
test('nothing with a rate means nothing to say', () => {
  assert.deepEqual(freshness([product('a', { pricePaise: null })]), { today: false, text: '' });
  assert.deepEqual(freshness([]), { today: false, text: '' });
});

test('availability is a word, never a count', () => {
  assert.equal(availabilityText(product('a')), 'Available');
  assert.match(availabilityText(product('a', { availability: 'ASK_SHOP' })), /Not available/);
  assert.match(availabilityText(product('a', { availability: 'ON_REQUEST' })), /Ask for the rate/);
});

test('search finds a product by name, brand, trade word and confirmed alias', () => {
  const catalog = catalogOf(
    product('s', { name: 'Tata Tiscon', categorySlug: 'steel', searchTerms: ['alias-word'] }),
    product('c', { name: 'UltraTech Super' }),
  );
  for (const q of ['saria', 'sariya', 'rod', 'tata', 'alias-word', 'TMT'])
    assert.deepEqual(
      searchCatalog(catalog, q).map((row) => row.id),
      ['s'],
      q,
    );
  assert.deepEqual(
    searchCatalog(catalog, 'ultratech').map((row) => row.id),
    ['c'],
  );
  assert.deepEqual(searchCatalog(catalog, 'nothing like this'), []);
  assert.deepEqual(searchCatalog(catalog, '   '), []);
});
test('search takes any text safely', () => {
  const catalog = catalogOf(product('c'));
  assert.deepEqual(searchCatalog(catalog, '.*('), []);
  assert.deepEqual(searchCatalog(catalog, '<script>alert(1)</script>'), []);
  assert.deepEqual(searchCatalog(catalog, 'x'.repeat(100000)), []);
});

const offer = (over: Partial<Offer> = {}): Offer => ({
  title: 'Winter offer',
  productId: null,
  categoryId: 'c1',
  minQuantity: 1,
  valueType: 'PERCENT_OFF',
  value: 500,
  endsOn: '2026-11-30',
  ...over,
});
test('an offer says what it is, how much and until when', () => {
  assert.equal(offerText(offer()), 'Winter offer 5% off. Until 30 November.');
  assert.match(
    offerText(offer({ valueType: 'AMOUNT_OFF', value: 1000, minQuantity: 100 })),
    /₹10 off on 100 or more\./,
  );
});
test('a fixed-rate offer shows the rate only when it is lower', () => {
  const p = product('c');
  assert.match(offerText(offer({ valueType: 'RATE', value: 39000 }), p), /₹390/);
  assert.doesNotMatch(offerText(offer({ valueType: 'RATE', value: 99000 }), p), /₹990/);
});
test('an offer reaches its own product and category only', () => {
  const lookup = (slug: string) => ({ cement: 'c1', steel: 'c2' })[slug];
  assert.equal(offersFor([offer()], product('c'), lookup).length, 1);
  assert.equal(offersFor([offer()], product('s', { categorySlug: 'steel' }), lookup).length, 0);
  assert.equal(
    offersFor([offer({ categoryId: null, productId: 'c' })], product('c'), lookup).length,
    1,
  );
  assert.equal(
    offersFor([offer({ categoryId: null, productId: 'x' })], product('c'), lookup).length,
    0,
  );
});
