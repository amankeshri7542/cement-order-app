import assert from 'node:assert/strict';
import test from 'node:test';
import { phoneSearch, searchCatalogue, searchQueries } from './shared-search.mjs';

// Plan v4, 09 section 5: the same real-world queries the server answers, on the phone's code.
const shelf = searchCatalogue.map((product) => ({
  id: product.id,
  name: product.name,
  brand: product.brand,
  grade: product.grade,
  type: product.type,
  unit: 'bag',
  categorySlug: product.category,
  pricePaise: 1,
  searchTerms: product.words ?? [],
}));

test('the query table on the phone: what must come first', () => {
  assert.ok(searchQueries.length >= 60);
  for (const [query, expected] of searchQueries) {
    // The phone has no Hindi product names, so Hindi queries are checked on the server only.
    if (/\p{Script=Devanagari}/u.test(query) && typeof expected === 'string') continue;
    const first = phoneSearch.searchProducts(shelf, query)[0]?.id ?? null;
    if (expected === null) assert.equal(first, null, query);
    else if (typeof expected === 'string') assert.equal(first, expected, query);
    else assert.ok(first && expected.includes(first), `${query}: ${first}`);
  }
});

test('the phone keeps Hindi words whole, as the server does', () => {
  // Before the shared normaliser the phone dropped vowel signs and split Hindi words apart.
  const word = String.fromCodePoint(0x0938, 0x0940, 0x092e, 0x0947, 0x0902, 0x091f);
  assert.equal(phoneSearch.normalize(word), word);
});

test('the same list is indexed once, and a new list is indexed again', () => {
  const first = phoneSearch.searchProducts(shelf, 'ultr').map((item) => item.id);
  const changed = [...shelf, { ...shelf[0], id: 'new', name: 'UltraTech Cement Aaa' }];
  assert.equal(phoneSearch.searchProducts(changed, 'ultr')[0].id, 'new');
  assert.deepEqual(
    phoneSearch.searchProducts(shelf, 'ultr').map((item) => item.id),
    first,
  );
});
