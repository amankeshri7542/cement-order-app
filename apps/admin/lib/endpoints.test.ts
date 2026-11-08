import assert from 'node:assert/strict';
import { test } from 'node:test';
import { customerPageSchema, orderPageSchema, searchResponseSchema } from '@shiv/shared';
import { ApiError } from './api';
import { keyFor, queryString, readAnswer, scopeFor, type Schema } from './endpoints/core';
import { customerList, listEndpoints, orderList } from './endpoints/lists';
import { searchEndpoint } from './endpoints/search';
import { readRecent, remember } from './recent';
import type { Scope } from './scope';

const shops = [
  { id: 'main', firmId: 'sipara' },
  { id: 'godown', firmId: 'sipara' },
  { id: 'second', firmId: 'sampatchak' },
];

test('a query string is sorted and leaves out empty values, so equal filters share a key', () => {
  assert.equal(queryString({}), '');
  assert.equal(
    queryString({ q: '', limit: 24, b: 'x y', a: null, c: undefined }),
    '?b=x+y&limit=24',
  );
  assert.equal(queryString({ q: 'a&b=c' }), '?q=a%26b%3Dc');
  assert.deepEqual(
    keyFor(orderList, { q: 'x', limit: 24 }),
    keyFor(orderList, { limit: 24, q: 'x' }),
  );
  // The key starts with the endpoint's own, which the refresh rules invalidate by.
  assert.deepEqual(keyFor(orderList, {}).slice(0, 2), ['orders', 'list']);
  assert.deepEqual(keyFor(customerList, {}).slice(0, 2), ['customers', 'list']);
});

test('the top bar’s choice as each kind of endpoint takes it', () => {
  const all: Scope = { kind: 'all' };
  const shop: Scope = { kind: 'shop', shopId: 'second' };
  const firm: Scope = { kind: 'firm', firmId: 'sipara' };
  assert.deepEqual(scopeFor('shop', all, shops), {});
  assert.deepEqual(scopeFor('shop', shop, shops), { locationId: 'second' });
  assert.deepEqual(scopeFor('shop', firm, shops), { firmId: 'sipara' });
  // Customers belong to firms, not shops: a chosen shop stands for its firm.
  assert.deepEqual(scopeFor('firm', shop, shops), { firmId: 'sampatchak' });
  assert.deepEqual(scopeFor('firm', firm, shops), { firmId: 'sipara' });
  assert.deepEqual(scopeFor('firm', { kind: 'shop', shopId: 'unknown' }, shops), {});
  assert.deepEqual(scopeFor('none', shop, shops), {});
});

test('every list endpoint takes the top bar’s choice', () => {
  for (const [name, list] of Object.entries(listEndpoints)) {
    assert.notEqual(list.scope, 'none', name);
    const sent = list.url(scopeFor(list.scope, { kind: 'shop', shopId: 'main' }, shops) as never);
    assert.match(sent, /[?&](locationId|firmId)=/, name);
  }
  assert.equal(searchEndpoint.scope, 'shop');
});

test('an answer in the wrong shape is a server error, not a half-drawn page', () => {
  const good = { items: [], nextCursor: null };
  assert.deepEqual(readAnswer(orderPageSchema, good, '/admin/orders'), good);
  assert.deepEqual(readAnswer(searchResponseSchema, { query: 'a' }, '/admin/search'), {
    query: 'a',
  });
  const errors = console.error;
  console.error = () => {};
  try {
    for (const [schema, bad] of [
      [orderPageSchema, { items: [{ id: 'x' }], nextCursor: null }],
      [customerPageSchema, { items: 'nope' }],
      [searchResponseSchema, { query: 'a', salary: [] }],
      [searchResponseSchema, null],
    ] as [Schema<unknown>, unknown][])
      assert.throws(
        () => readAnswer(schema, bad, '/x'),
        (error: unknown) => error instanceof ApiError && error.code === 'BAD_RESPONSE',
      );
  } finally {
    console.error = errors;
  }
});

test('recent items keep only a name and a desk address, and ignore anything else', () => {
  const store = new Map<string, string>();
  (globalThis as { localStorage?: unknown }).localStorage = {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => void store.set(key, value),
  };
  assert.deepEqual(readRecent('u1'), []);
  for (let i = 0; i < 8; i++)
    remember('u1', { href: `/orders/o${i}`, label: `SC-${i}`, group: 'orders' });
  remember('u1', { href: '/orders/o3', label: 'SC-3', group: 'orders' });
  const kept = readRecent('u1');
  assert.equal(kept.length, 6);
  assert.equal(kept[0]!.href, '/orders/o3');
  assert.equal(new Set(kept.map((row) => row.href)).size, 6);
  // Someone else on this computer has their own list.
  assert.deepEqual(readRecent('u2'), []);
  // A tampered list: outside addresses, scripts and odd shapes are dropped.
  store.set(
    'shiv-desk-recent:u1',
    JSON.stringify([
      { href: 'https://evil.example/', label: 'x', group: 'orders' },
      { href: 'javascript:alert(1)', label: 'x', group: 'orders' },
      { href: '/orders/../settings', label: 'x', group: 'orders' },
      { href: '/customers/c1', label: 'x'.repeat(500), group: 'customers' },
      { href: '/customers/c1', label: 'Ramesh', group: 'salary' },
      'nope',
      null,
      { href: '/stock?product=p1', label: 'Tata 12', group: 'products' },
    ]),
  );
  assert.deepEqual(readRecent('u1'), [
    { href: '/stock?product=p1', label: 'Tata 12', group: 'products' },
  ]);
  store.set('shiv-desk-recent:u1', '{not json');
  assert.deepEqual(readRecent('u1'), []);
});
