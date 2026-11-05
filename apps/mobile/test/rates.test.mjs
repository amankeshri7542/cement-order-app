import assert from 'node:assert/strict';
import test from 'node:test';
import { loadTs } from './load-ts.mjs';

const { rateItems, rowDetail, rateToShow, offerFor } = loadTs('src/logic/rates.ts', {}, {});
const { searchProducts, normalize } = loadTs('src/logic/search.ts', {}, {});

const product = (id, categorySlug, pricePaise, over = {}) => ({
  id,
  name: id,
  brand: 'B',
  grade: '',
  type: '',
  unit: 'bag',
  categorySlug,
  pricePaise,
  searchTerms: [],
  ...over,
});
const categories = [
  { id: 'c1', slug: 'bricks', name: 'Bricks' },
  { id: 'c2', slug: 'cement', name: 'Cement' },
  { id: 'c3', slug: 'steel', name: 'Steel' },
  { id: 'c4', slug: 'unknown', name: 'Zzz' },
];

test('materials go in building order, cheapest first, with no-rate items last', () => {
  const items = rateItems(
    [
      product('b1', 'bricks', 100),
      product('c-dear', 'cement', 500),
      product('c-cheap', 'cement', 300),
      product('c-none', 'cement', null),
      product('s1', 'steel', 60),
      product('z1', 'unknown', 1),
    ],
    categories,
  );
  assert.deepEqual(
    items.map((item) => item.key),
    [
      'h:cement',
      'c-cheap',
      'c-dear',
      'c-none',
      'h:steel',
      's1',
      'h:bricks',
      'b1',
      'h:unknown',
      'z1',
    ],
  );
  assert.equal(items[0].name, 'Cement');
  assert.equal(items[0].unit, 'bag');
});

test('a material with no products shows no heading', () => {
  assert.equal(rateItems([], categories).length, 0);
});

test('the detail line says only what the shop typed', () => {
  assert.equal(rowDetail({ grade: 'PPC', type: 'x', unit: '50 kg bag' }), 'PPC · 50 kg bag');
  assert.equal(rowDetail({ grade: '', type: 'TMT', unit: 'kg' }), 'TMT · kg');
  assert.equal(rowDetail({ grade: '', type: '', unit: 'kg' }), 'kg');
});

test("a customer's own rate shows only when lower; nobody else's is ever read", () => {
  const list = product('a', 'cement', 40000);
  assert.deepEqual(rateToShow(list), { paise: 40000, listPaise: 40000, yours: false });
  assert.deepEqual(rateToShow(list, { yourPaise: 39000 }), {
    paise: 39000,
    listPaise: 40000,
    yours: true,
  });
  assert.deepEqual(rateToShow(list, { yourPaise: 40000 }), {
    paise: 40000,
    listPaise: 40000,
    yours: false,
  });
  assert.deepEqual(rateToShow(product('b', 'cement', null)), {
    paise: null,
    listPaise: null,
    yours: false,
  });
});

test('an offer on the product wins over one on its material', () => {
  const item = product('a', 'cement', 1);
  const onMaterial = { title: 'All cement', productId: null, categoryId: 'c2' };
  const onItem = { title: 'This one', productId: 'a', categoryId: null };
  const elsewhere = { title: 'Steel', productId: null, categoryId: 'c3' };
  const ids = (slug) => ({ cement: 'c2', steel: 'c3' })[slug];
  assert.equal(offerFor(item, [elsewhere], ids), null);
  assert.equal(offerFor(item, [onMaterial, onItem], ids), onItem);
  assert.equal(offerFor(item, [elsewhere, onMaterial], ids), onMaterial);
});

const shelf = [
  product('UltraTech Super', 'cement', 1, { brand: 'UltraTech', grade: 'PPC' }),
  product('Tata Tiscon 550SD', 'steel', 1, { brand: 'Tata', grade: '12 mm' }),
  product('Construction sand', 'sand', 1, { brand: 'Local' }),
  product('Binding wire', 'steel', 1, { brand: 'Local', searchTerms: ['tar', 'bandhai'] }),
];
const names = (query) => searchProducts(shelf, query).map((item) => item.name);

test('search finds by name, brand and grade, in any case', () => {
  assert.deepEqual(names('ultra'), ['UltraTech Super']);
  assert.deepEqual(names('ULTRATECH'), ['UltraTech Super']);
  assert.deepEqual(names('ppc'), ['UltraTech Super']);
});

test('sariya, saria and rod all hit, and balu finds sand', () => {
  for (const word of ['sariya', 'saria', 'rod', 'tmt'])
    assert.ok(names(word).includes('Tata Tiscon 550SD'), word);
  assert.deepEqual(names('balu'), ['Construction sand']);
});

test('words people use from the shop list are matched, never shown', () => {
  assert.deepEqual(names('bandhai'), ['Binding wire']);
});

test('every word typed must hit, and the name comes first', () => {
  assert.deepEqual(names('tata 12'), ['Tata Tiscon 550SD']);
  assert.deepEqual(names('tata cement'), []);
  assert.deepEqual(names(''), []);
  assert.deepEqual(names('   '), []);
  assert.equal(normalize('  Tata-Tiscon, 12mm! '), 'tata tiscon 12mm');
});

test('odd input never breaks search', () => {
  for (const odd of ['.*', '(', '\\', '%', "'; drop", '🙂', 'a'.repeat(1000)])
    assert.deepEqual(searchProducts(shelf, odd), []);
});
