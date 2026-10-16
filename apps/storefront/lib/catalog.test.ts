import assert from 'node:assert/strict';
import test from 'node:test';
import { deliveryDateOptions } from '@shiv/shared';
import { categoryResponse, deliveryResponse, productResponse } from './api';
import {
  MAX_PAGES,
  timeLabel,
  price,
  queryString,
  ratesFrom,
  readQuery,
  uniqueProducts,
} from './catalog';
import { localPhone } from './customer-api';

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

test('rate board keeps the cheapest in-stock item per material with its own selling unit', () => {
  const item = (id: string, slug: string, pricePaise: number, stock: number, unit = 'bag') =>
    productResponse.parse({
      ...fixture,
      id,
      unit,
      pricePaise,
      stock,
      categoryId: slug,
      category: { id: slug, name: `TEST ${slug}`, slug },
    });
  const rates = ratesFrom([
    item('steel-a', 'steel', 6800, 10, 'kg'),
    item('cement-cheap-but-empty', 'cement', 30000, 0),
    item('cement-b', 'cement', 41000, 4),
    item('cement-a', 'cement', 39000, 4),
    item('custom', 'zinc-sheets', 100, 3, 'sheet'),
    item('sand', 'sand', 680000, 1, '100 cu ft'),
  ]);
  assert.deepEqual(
    rates.map((rate) => [rate.slug, rate.product.id, rate.product.unit]),
    [
      ['cement', 'cement-a', 'bag'],
      ['steel', 'steel-a', 'kg'],
      ['sand', 'sand', '100 cu ft'],
      ['zinc-sheets', 'custom', 'sheet'],
    ],
  );
  assert.equal(ratesFrom([item('only-empty', 'cement', 100, 0)]).length, 0);
  assert.equal(
    ratesFrom(['a', 'b', 'c', 'd', 'e', 'f'].map((slug) => item(slug, slug, 100, 1))).length,
    5,
  );
});

test('sign-in phone accepts autofilled and pasted Indian mobile formats', () => {
  for (const value of [
    '9876543210',
    '+91 98765 43210',
    '+91-98765-43210',
    '098765 43210',
    '0091 98765 43210',
    '919876543210',
    '(98765) 43210',
  ])
    assert.equal(localPhone(value), '9876543210', value);
  // Ten-digit numbers that start with 91 and half-typed prefixes stay as typed.
  assert.equal(localPhone('9198765432'), '9198765432');
  assert.equal(localPhone('+91'), '+91');
  assert.equal(localPhone('0'), '0');
  assert.equal(localPhone('98765abc'), '98765abc');
});

test('checkout default delivery date is tomorrow in Patna, not tomorrow in UTC', () => {
  // 01:30 IST on 17 Oct is still 16 Oct in UTC.
  assert.deepEqual(deliveryDateOptions(new Date('2026-10-16T20:00:00Z'), 1, 1), ['2026-10-18']);
  assert.deepEqual(deliveryDateOptions(new Date('2026-10-16T12:00:00Z'), 1, 1), ['2026-10-17']);
});
