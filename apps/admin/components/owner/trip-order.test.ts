import assert from 'node:assert/strict';
import { test } from 'node:test';
import { moved } from './trip-order';

test('moving a stop swaps it with its neighbour', () => {
  assert.deepEqual(moved(['a', 'b', 'c'], 1, -1), ['b', 'a', 'c']);
  assert.deepEqual(moved(['a', 'b', 'c'], 1, 1), ['a', 'c', 'b']);
});
test('the first cannot go up and the last cannot go down', () => {
  assert.deepEqual(moved(['a', 'b'], 0, -1), ['a', 'b']);
  assert.deepEqual(moved(['a', 'b'], 1, 1), ['a', 'b']);
  assert.deepEqual(moved([], 0, 1), []);
});
test('it hands back a new list and leaves the old one alone', () => {
  const list = ['a', 'b'];
  const next = moved(list, 0, 1);
  assert.notEqual(next, list);
  assert.deepEqual(list, ['a', 'b']);
});
