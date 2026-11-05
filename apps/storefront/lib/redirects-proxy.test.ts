import assert from 'node:assert/strict';
import { test } from 'node:test';
import { NextRequest } from 'next/server';
import { proxy } from '../proxy';

const go = (path: string) => proxy(new NextRequest(new URL(path, 'http://localhost:3003')));
const moved = (path: string) => {
  const response = go(path);
  assert.equal(response.status, 308, path);
  const target = new URL(response.headers.get('location')!);
  return target.pathname + target.search;
};

test('old Hindi addresses land on the same page in English, keeping the rest', () => {
  assert.equal(moved('/about?lang=hi'), '/about');
  assert.equal(moved('/about?lang=en'), '/about');
  assert.equal(moved('/materials/cement?brand=ACC&lang=hi'), '/materials/cement?brand=ACC');
  assert.equal(moved('/?lang=hi'), '/');
  assert.equal(moved('/hi'), '/');
  assert.equal(moved('/hi/rates'), '/rates');
  assert.equal(moved('/hi/materials/cement'), '/materials/cement');
});
test('a redirect never leaves this site', () => {
  for (const path of [
    '/hi//evil.example',
    '/hi///evil.example/x',
    '//evil.example',
    '//evil.example?lang=hi',
  ]) {
    const response = proxy(new NextRequest(`http://localhost:3003${path}`));
    assert.equal(response.status, 308, path);
    const target = new URL(response.headers.get('location')!, 'http://localhost:3003');
    assert.equal(target.host, 'localhost:3003', path);
    assert.ok(!target.pathname.startsWith('//'), path);
  }
});
test('a word starting with hi is not a Hindi address', () => {
  assert.equal(go('/history').status, 200);
});
test('old pages move for good', () => {
  assert.equal(moved('/cart'), '/list');
  assert.equal(moved('/products'), '/materials');
  assert.equal(moved('/products?category=steel'), '/materials/sariya');
  assert.equal(moved('/products?category=sand'), '/materials/balu');
  assert.equal(moved('/products?category=aggregates&brand=X'), '/materials/gitti?brand=X');
  assert.equal(moved('/products?q=rod'), '/materials?q=rod');
});
test('a strange category cannot build a strange address', () => {
  assert.ok(moved('/products?category=../../etc').startsWith('/materials?'));
  assert.equal(moved('/products?category=%0d%0aSet-Cookie:x=1').startsWith('/materials?'), true);
});
test('public pages may be kept for back and forward; private ones never', () => {
  assert.equal(go('/rates').headers.get('cache-control'), 'private, no-cache');
  for (const path of [
    '/list',
    '/checkout',
    '/account',
    '/orders/1',
    '/quotes',
    '/compare',
    '/delete-account',
  ])
    assert.equal(go(path).headers.get('cache-control'), 'no-store', path);
});
test('every page gets its security headers and a fresh script nonce', () => {
  const first = go('/rates').headers.get('content-security-policy')!;
  const second = go('/rates').headers.get('content-security-policy')!;
  assert.match(first, /script-src 'self' 'nonce-[^']+' 'strict-dynamic'/);
  assert.notEqual(first, second);
  assert.match(first, /frame-ancestors 'none'/);
  const headers = go('/rates').headers;
  assert.equal(headers.get('x-frame-options'), 'DENY');
  assert.equal(headers.get('x-content-type-options'), 'nosniff');
  assert.equal(headers.get('referrer-policy'), 'no-referrer');
});
