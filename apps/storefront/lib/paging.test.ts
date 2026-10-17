import assert from 'node:assert/strict';
import test from 'node:test';
import { mergePage } from './paging';

const row = (id: string, revision = 0) => ({ id, revision });

test('a first-page refresh updates rows in place and keeps rows from later pages', () => {
  const loaded = [row('c'), row('b'), row('a')];
  assert.deepEqual(mergePage(loaded, [row('d'), row('c', 1)], true), [
    row('d'),
    row('c', 1),
    row('b'),
    row('a'),
  ]);
});

test('a later page appends only rows not already shown', () => {
  assert.deepEqual(mergePage([row('c'), row('b')], [row('b'), row('a')], false), [
    row('c'),
    row('b'),
    row('a'),
  ]);
});
