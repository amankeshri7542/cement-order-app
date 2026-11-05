import assert from 'node:assert/strict';
import test from 'node:test';
import { loadTs } from './load-ts.mjs';

const { savedAge, isFresh, cacheMaxAge } = loadTs('src/logic/age.ts');
const now = Date.UTC(2026, 9, 21, 10, 0, 0);
const ago = (ms) => now - ms;
const minute = 60 * 1000;
const hour = 60 * minute;
const day = 24 * hour;

test('says how long ago ', () => {
  assert.equal(savedAge(ago(10 * 1000), now), 'just now');
  assert.equal(savedAge(ago(minute), now), '1 minute ago');
  assert.equal(savedAge(ago(5 * minute + 20000), now), '5 minutes ago');
  assert.equal(savedAge(ago(hour), now), '1 hour ago');
  assert.equal(savedAge(ago(3 * hour), now), '3 hours ago');
  assert.equal(savedAge(ago(day), now), '1 day ago');
  assert.equal(savedAge(ago(2 * day + hour), now), '2 days ago');
});

test('a clock set back never shows a negative age', () => {
  assert.equal(savedAge(now + 5 * minute, now), 'just now');
});

test('saved lists expire after two weeks and a future date is not trusted', () => {
  assert.equal(cacheMaxAge, 14 * day);
  assert.equal(isFresh(ago(13 * day), now), true);
  assert.equal(isFresh(ago(15 * day), now), false);
  assert.equal(isFresh(now + 2 * hour, now), false);
  assert.equal(isFresh(Number.NaN, now), false);
});
