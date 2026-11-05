import assert from 'node:assert/strict';
import test from 'node:test';
import { loadTs } from './load-ts.mjs';

const nav = loadTs('src/logic/nav-core.ts', {}, {});
const {
  startNav,
  pushRoute,
  openTab,
  openSheet,
  closeSheet,
  backFrom,
  navFromHash,
  hashFromNav,
  orderIdFromPush,
  privateRoute,
  validId,
} = nav;

test('back closes a sheet, pops a screen, returns to Home, then lets the app exit', () => {
  let state = openSheet(pushRoute(openTab(startNav(), 'orders'), { screen: 'order', id: 'a' }), {
    sheet: 'list',
  });
  state = backFrom(state);
  assert.equal(state.sheets.length, 0);
  assert.equal(state.stack.length, 1);
  state = backFrom(state);
  assert.equal(state.stack.length, 0);
  assert.equal(state.tab, 'orders');
  state = backFrom(state);
  assert.equal(state.tab, 'home');
  assert.equal(backFrom(state), null);
});

test('a double tap never stacks the same screen or sheet twice', () => {
  const once = pushRoute(startNav(), { screen: 'product', id: 'a' });
  assert.equal(pushRoute(once, { screen: 'product', id: 'a' }), once);
  assert.equal(pushRoute(once, { screen: 'product', id: 'b' }).stack.length, 2);
  const sheet = openSheet(startNav(), { sheet: 'list' });
  assert.equal(openSheet(sheet, { sheet: 'list' }), sheet);
});

test('a tab press starts that tab afresh; sheets stay on their own stack', () => {
  const deep = pushRoute(startNav(), { screen: 'search' });
  assert.equal(openTab(deep, 'orders').stack.length, 0);
  const two = openSheet(openSheet(startNav(), { sheet: 'list' }), { sheet: 'day' });
  assert.equal(closeSheet(two, 'list').sheets[0].sheet, 'day');
  assert.equal(closeSheet(two).sheets.at(-1).sheet, 'list');
});

test('the stack cannot grow without end', () => {
  let state = startNav();
  for (let i = 0; i < 40; i++) state = pushRoute(state, { screen: 'product', id: `p${i}` });
  assert.equal(state.stack.length, 12);
});

test('reads an address, and anything odd opens Home', () => {
  assert.equal(navFromHash('#/orders').tab, 'orders');
  assert.deepEqual(navFromHash('#/order/abc').stack, [{ screen: 'order', id: 'abc' }]);
  assert.deepEqual(navFromHash('#/search').stack, [{ screen: 'search' }]);
  for (const odd of [
    '',
    '#',
    '#/nonsense',
    '#/order',
    '#/order/..%2F..%2Fadmin',
    '#/product/%E0%A4',
    '#/order/a b',
  ])
    assert.deepEqual(navFromHash(odd), startNav(), odd);
});

test('writes an address and reads the same place back', () => {
  for (const state of [
    startNav(),
    openTab(startNav(), 'account'),
    pushRoute(startNav(), { screen: 'order', id: 'abc' }),
    pushRoute(startNav(), { screen: 'article', slug: 'store-cement' }),
  ])
    assert.deepEqual(navFromHash(hashFromNav(state)).stack, state.stack);
});

test('a push opens its order, and a tampered one opens nothing', () => {
  assert.equal(orderIdFromPush({ orderId: 'cm123' }), 'cm123');
  for (const bad of [
    null,
    undefined,
    'cm123',
    5,
    {},
    { orderId: 5 },
    { orderId: '' },
    { orderId: '../../me/khata' },
    { orderId: 'a'.repeat(101) },
    { orderId: 'a b' },
  ])
    assert.equal(orderIdFromPush(bad), null);
  assert.equal(validId('abc_D-1'), true);
});

test("someone's own pages need a sign-in; a rate or a product does not", () => {
  for (const screen of ['order', 'reply', 'udhaar', 'people', 'sites'])
    assert.equal(privateRoute({ screen }), true);
  for (const screen of ['product', 'search', 'article'])
    assert.equal(privateRoute({ screen }), false);
});
