import assert from 'node:assert/strict';
import test from 'node:test';
import { loadTs } from './load-ts.mjs';

const { savedAge, isFresh, cacheMaxAge } = loadTs('src/age.ts');
const now = Date.UTC(2026, 9, 21, 10, 0, 0);
const ago = (ms) => now - ms;
const minute = 60 * 1000;
const hour = 60 * minute;
const day = 24 * hour;

test('says how long ago in English', () => {
  assert.equal(savedAge(ago(10 * 1000), now, 'en'), 'just now');
  assert.equal(savedAge(ago(minute), now, 'en'), '1 minute ago');
  assert.equal(savedAge(ago(5 * minute + 20000), now, 'en'), '5 minutes ago');
  assert.equal(savedAge(ago(hour), now, 'en'), '1 hour ago');
  assert.equal(savedAge(ago(3 * hour), now, 'en'), '3 hours ago');
  assert.equal(savedAge(ago(day), now, 'en'), '1 day ago');
  assert.equal(savedAge(ago(2 * day + hour), now, 'en'), '2 days ago');
});

test('says how long ago in Hindi', () => {
  assert.equal(savedAge(ago(0), now, 'hi'), 'अभी');
  assert.equal(savedAge(ago(5 * minute), now, 'hi'), '5 मिनट पहले');
  assert.equal(savedAge(ago(3 * hour), now, 'hi'), '3 घंटे पहले');
  assert.equal(savedAge(ago(2 * day), now, 'hi'), '2 दिन पहले');
});

test('a clock set back never shows a negative age', () => {
  assert.equal(savedAge(now + 5 * minute, now, 'en'), 'just now');
});

test('saved lists expire after two weeks and a future date is not trusted', () => {
  assert.equal(cacheMaxAge, 14 * day);
  assert.equal(isFresh(ago(13 * day), now), true);
  assert.equal(isFresh(ago(15 * day), now), false);
  assert.equal(isFresh(now + 2 * hour, now), false);
  assert.equal(isFresh(Number.NaN, now), false);
});
