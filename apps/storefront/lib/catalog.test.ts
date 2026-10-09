import assert from 'node:assert/strict';
import test from 'node:test';
import { categoryResponse, deliveryResponse, productResponse } from './api';
import { MAX_PAGES, timeLabel, price, queryString, readQuery, uniqueProducts } from './catalog';

// Isolated synthetic contract fixture: never used as storefront fallback content.
const fixture = {
  id: 'test-material',
  name: 'TEST material',
  brand: 'TEST brand',
  categoryId: 'test-category',
  category: { id: 'test-category', name: 'TEST category', slug: 'test-category' },
  type: 'TEST type',
  grade: 'TEST grade',
  unit: 'bag',
  packSize: '50 kg',
  pricePaise: 10025,
  stock: 5,
  minQuantity: 10,
  quantityStep: 5,
  active: true,
  description: 'TEST description',
  recommendedUse: 'TEST use',
  images: [],
  version: 1,
  priceVersion: 1,
  priceUpdatedAt: '2026-10-09T00:00:00.000Z',
};

test('integer paise retains paise and Indian grouping without implicit rupee conversion', () => {
  assert.equal(price(10025), '₹100.25');
  assert.equal(price(12345678), '₹1,23,456.78');
  assert.equal(price(0), '₹0.00');
  for (const invalid of [-1, 1.25, NaN, Infinity]) assert.throws(() => price(invalid));
});

test('public response schema strips private and unknown fields at every rendered object', () => {
  const parsed = productResponse.parse({
    ...fixture,
    purchaseCostPaise: 999,
    supplier: { name: 'private' },
    staff: [{ phone: 'private' }],
    category: { ...fixture.category, attendance: 'private' },
  });
  assert.deepEqual(parsed, fixture);
  assert.deepEqual(
    categoryResponse.parse({ ...fixture.category, private: true }),
    fixture.category,
  );
  assert.equal(productResponse.safeParse({ ...fixture, pricePaise: 100.25 }).success, false);
  assert.equal(
    productResponse.safeParse({ ...fixture, priceUpdatedAt: 'yesterday' }).success,
    false,
  );
  assert.equal(productResponse.safeParse({ ...fixture, stock: true }).success, false);
});

test('public records may omit a recommended-use note without losing the catalogue', () => {
  assert.equal(productResponse.parse({ ...fixture, recommendedUse: '' }).recommendedUse, '');
  assert.equal(productResponse.safeParse({ ...fixture, recommendedUse: null }).success, false);
});

test('query state is normalized, bounded and round-trips supported API filters', () => {
  const a = readQuery(
    new URLSearchParams(
      'q=+cement+&category=cement&brand=TEST&availability=in&sort=price_desc&pages=2',
    ),
  );
  assert.equal(a.q, 'cement');
  assert.deepEqual(readQuery(new URLSearchParams(queryString(a))), a);
  assert.equal(queryString(a), queryString({ ...a, q: ' cement ' }));
  const invalid = readQuery(
    new URLSearchParams('q=' + 'x'.repeat(101) + '&availability=bad&sort=bad&pages=-3'),
  );
  assert.equal(invalid.q.length, 100);
  assert.equal(invalid.pages, 1);
  assert.equal(invalid.availability, 'all');
  assert.equal(invalid.sort, 'name');
  assert.equal(readQuery(new URLSearchParams('pages=999')).pages, MAX_PAGES);
  assert.equal(readQuery(new URLSearchParams('pages=1.5')).pages, 1);
});

test('pagination deduplicates stable ids and retains the latest product value', () => {
  const product = productResponse.parse(fixture);
  const result = uniqueProducts([
    product,
    { ...product, id: 'other' },
    { ...product, pricePaise: 20025 },
  ]);
  assert.equal(result.length, 2);
  assert.equal(result[0]?.pricePaise, 20025);
  assert.equal(result[1]?.id, 'other');
});

test('delivery requires a consistent serviceability flag and nonnegative paise', () => {
  assert.equal(deliveryResponse.safeParse({ serviceable: true, zone: null }).success, false);
  assert.deepEqual(deliveryResponse.parse({ serviceable: false, zone: null, private: 'ignored' }), {
    serviceable: false,
    zone: null,
  });
  assert.equal(
    deliveryResponse.safeParse({
      serviceable: true,
      zone: {
        name: 'TEST zone',
        deliveryFeePaise: -1,
        minimumOrderPaise: 0,
        freeDeliveryAbovePaise: null,
        estimate: 'TEST',
      },
    }).success,
    false,
  );
});

test('IST time is stable across runtime day-period conventions', () => {
  assert.equal(timeLabel('2026-10-09T09:36:00.000Z'), '15:06');
  assert.equal(timeLabel('2026-10-09T18:45:00.000Z'), '00:15');
});
