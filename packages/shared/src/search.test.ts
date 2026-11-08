import assert from 'node:assert/strict';
import { test } from 'node:test';
import { searchCatalogue, searchQueries } from './search-cases';
import {
  editDistance,
  indexProducts,
  materialWords,
  normaliseText,
  rankProducts,
  searchKey,
} from './search-normalise';

const index = indexProducts(searchCatalogue);

test('the query table: what must come first', () => {
  assert.ok(searchQueries.length >= 60, 'at least 60 queries');
  for (const [query, expected] of searchQueries) {
    const first = rankProducts(index, query)[0]?.id ?? null;
    if (expected === null) assert.equal(first, null, query);
    else if (typeof expected === 'string') assert.equal(first, expected, query);
    else assert.ok(first && expected.includes(first), `${query}: ${first}`);
  }
});

test('the stored form keeps Hindi marks and joins sizes, as saved aliases expect', () => {
  assert.equal(normaliseText('  Tata-Tiscon, 12 MM! '), 'tata tiscon 12mm');
  assert.equal(normaliseText('५० kg'), '50kg');
  assert.equal(normaliseText('Neo Steel'), 'neosteel');
  // The vowel signs stay on the letters, so a Hindi word is still one word.
  assert.deepEqual(normaliseText('सीमेंट की बोरी').split(' '), ['सीमेंट', 'की', 'बोरी']);
});

test('search words: spellings fixed, sizes in words become digits', () => {
  assert.deepEqual(searchKey('altratek siment'), ['ultratech', 'cement']);
  assert.deepEqual(searchKey('Ultra Tech'), ['ultratech']);
  assert.deepEqual(searchKey('barah mm'), ['12mm']);
  assert.deepEqual(searchKey('बारह mm'), ['12mm']);
  assert.deepEqual(searchKey('12 mm'), ['12mm']);
  assert.deepEqual(searchKey('do inch'), ['2inch']);
  // A number word alone is not a size, so "do" (two) stays a word.
  assert.deepEqual(searchKey('do bori'), ['do', 'bori']);
  assert.deepEqual(searchKey('x'.repeat(500)), ['x'.repeat(100)]);
});

test('every material has its everyday words, from the glossary and in Hindi', () => {
  for (const [slug, word] of [
    ['steel', 'sariya'],
    ['steel', 'सरिया'],
    ['cement', 'bori'],
    ['sand', 'balu'],
    ['sand', 'बालू'],
    ['aggregates', 'gitti'],
    ['bricks', 'eent'],
  ] as const)
    assert.ok(materialWords[slug]!.includes(word), `${slug} ${word}`);
});

test('a near miss counts after real hits, and never for sizes', () => {
  assert.equal(editDistance('ultrtech', 'ultratech', 2), 1);
  assert.equal(editDistance('tiscno', 'tiscon', 1), 1);
  assert.ok(editDistance('abcdefgh', 'zzzzzzzz', 2) > 2);
  // 16mm is not 12mm, however close the digits are.
  assert.deepEqual(
    rankProducts(index, 'tata 15mm').map((item) => item.id),
    [],
  );
  // A real hit beats a near miss: "ring" is the stirrup, not something one letter away.
  assert.equal(rankProducts(index, 'ring')[0]?.id, 'sq-ring-6');
});

test('four letters find any product by its brand or first word', () => {
  for (const product of searchCatalogue) {
    const word =
      searchKey(
        product.brand === 'Local' || product.brand === 'Local supply'
          ? product.name
          : (product.brand ?? ''),
      ).find((part) => part.length >= 4) ?? searchKey(product.name)[0]!;
    const found = rankProducts(
      index,
      `${word.slice(0, 4)} ${searchKey(product.grade ?? '').join(' ')}`,
    ).map((item) => item.id);
    assert.ok(found.slice(0, 5).includes(product.id), `${product.name}: ${found.join(',')}`);
  }
});

test('odd input never breaks search', () => {
  for (const odd of ['', '   ', '.*', '(', '\\', '%', "'; drop", '🙂', 'a'.repeat(1000), '\u0000'])
    assert.deepEqual(rankProducts(index, odd), [], JSON.stringify(odd));
  assert.equal(rankProducts(index, 'cement', 3).length, 3);
});
