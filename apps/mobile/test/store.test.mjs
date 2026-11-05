import assert from 'node:assert/strict';
import test from 'node:test';
import { loadTs } from './load-ts.mjs';

const { createStore } = loadTs('src/logic/store-core.ts', {}, {});

test('patches a value, and a listener hears each change', () => {
  const store = createStore({ a: 1, b: 2 });
  let heard = 0;
  store.subscribe(() => heard++);
  store.patch({ a: 5 });
  assert.equal(store.get().a, 5);
  assert.equal(store.get().b, 2);
  assert.equal(heard, 1);
});

test('setting the same object tells nobody', () => {
  const start = { a: 1 };
  const store = createStore(start);
  let heard = 0;
  store.subscribe(() => heard++);
  store.set(start);
  store.set((old) => old);
  assert.equal(heard, 0);
});

test('a listener that left hears nothing, even one leaving during a change', () => {
  const store = createStore({ a: 1 });
  let first = 0;
  let second = 0;
  const leave = store.subscribe(() => {
    first++;
    leave();
  });
  store.subscribe(() => second++);
  store.patch({ a: 2 });
  store.patch({ a: 3 });
  assert.equal(first, 1);
  assert.equal(second, 2);
});
