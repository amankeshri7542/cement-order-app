import assert from 'node:assert/strict';
import test from 'node:test';
import { loadTs } from './load-ts.mjs';

const { homeState, otherSites, orderLines } = loadTs('src/logic/home-state.ts', {}, {});
const order = (id, siteId, label, status = 'DELIVERED') => ({
  id,
  status,
  address: siteId ? { id: siteId, label } : { name: 'Counter' },
  items: [{ name: 'UltraTech Super', quantity: 50 }],
});

test('a guest gets the new Home', () => {
  assert.equal(homeState({ user: null, ordersKnown: false, latestOrder: null }), 'new');
});

test('a regular never sees a beginner flash while orders load', () => {
  assert.equal(homeState({ user: { id: 'u' }, ordersKnown: false, latestOrder: null }), 'repeat');
});

test('someone signed in with no orders gets the new Home; the first order flips it', () => {
  assert.equal(homeState({ user: { id: 'u' }, ordersKnown: true, latestOrder: null }), 'new');
  assert.equal(
    homeState({ user: { id: 'u' }, ordersKnown: true, latestOrder: { id: 'o' } }),
    'repeat',
  );
});

test('other sites: the last order at each other site, newest first', () => {
  const rows = otherSites([
    order('1', 'kk', 'Kankarbagh site'),
    order('2', 'kk', 'Kankarbagh site'),
    order('3', 'dn', 'Danapur site'),
    order('4', 'br', 'Boring Road site'),
    order('5', 'dn', 'Danapur site'),
  ]);
  assert.deepEqual(
    rows.map((row) => row.order.id),
    ['3', '4'],
  );
  assert.equal(rows[0].label, 'Danapur site');
});

test('at most three rows, so the rates stay near the top', () => {
  const orders = [
    order('0', 'a', 'A'),
    ...['b', 'c', 'd', 'e', 'f'].map((id) => order(id, id, id)),
  ];
  assert.equal(otherSites(orders).length, 3);
});

test('phone and counter orders with no saved site are not grouped; cancelled ones are skipped', () => {
  const rows = otherSites([
    order('1', 'kk', 'K'),
    order('2', null),
    order('3', 'x', 'X', 'CANCELLED'),
    order('4', 'y', 'Y'),
  ]);
  assert.deepEqual(
    rows.map((row) => row.siteId),
    ['y'],
  );
});

test('no orders, no rows; the latest order with no site still lets others show', () => {
  assert.deepEqual(otherSites([]), []);
  assert.equal(otherSites([order('1', null), order('2', 'a', 'A')]).length, 1);
});

test('an order reads as plain lines', () => {
  assert.equal(
    orderLines({
      items: [
        { name: 'A', quantity: 2 },
        { name: 'B', quantity: 1 },
      ],
    }),
    '2 × A, 1 × B',
  );
});
