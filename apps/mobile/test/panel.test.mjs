import assert from 'node:assert/strict';
import test from 'node:test';
import { loadTs } from './load-ts.mjs';

const panel = loadTs('src/logic/panel-core.ts', { Date }, {});
const {
  linesKey,
  reviewKey,
  repeatLines,
  repeatSite,
  dayAfter,
  chooseSite,
  placeable,
  orderedRecently,
  leftOutWord,
  makeKey,
  refusalMeansLook,
  SAME_ORDER_WINDOW_MS,
  REVIEW_REFRESH_MS,
} = panel;

test('a review key ignores order of lines, and changes with quantity, site, day or note', () => {
  const a = [
    { productId: 'a', quantity: 1 },
    { productId: 'b', quantity: 2 },
  ];
  const b = [...a].reverse();
  assert.equal(linesKey(a), linesKey(b));
  const base = reviewKey(a, 's', '2026-11-06');
  assert.equal(base, reviewKey(b, 's', '2026-11-06'));
  assert.notEqual(base, reviewKey([{ productId: 'a', quantity: 9 }, a[1]], 's', '2026-11-06'));
  assert.notEqual(base, reviewKey(a, 't', '2026-11-06'));
  assert.notEqual(base, reviewKey(a, 's', '2026-11-07'));
  assert.notEqual(base, reviewKey(a, 's', '2026-11-06', 'note'));
});

test('a seen rate cannot change what a review answers for', () => {
  assert.equal(
    linesKey([{ productId: 'a', quantity: 1, seenPricePaise: 1 }]),
    linesKey([{ productId: 'a', quantity: 1, seenPricePaise: 999 }]),
  );
});

test('a repeat takes the lines and leaves the old rates behind', () => {
  const lines = repeatLines({ items: [{ productId: 'a', quantity: 5, pricePaise: 1, name: 'x' }] });
  assert.deepEqual(lines, [{ productId: 'a', quantity: 5 }]);
});

test('the next day crosses months and years', () => {
  assert.equal(dayAfter('2026-11-30'), '2026-12-01');
  assert.equal(dayAfter('2026-12-31'), '2027-01-01');
});

test('the panel opens on the site asked for if it still exists, else the last used, else none', () => {
  const sites = [{ id: 'last' }, { id: 'older' }];
  assert.equal(chooseSite(sites, 'older'), 'older');
  assert.equal(chooseSite(sites, 'gone'), 'last');
  assert.equal(chooseSite(sites, null), 'last');
  assert.equal(chooseSite([], 'older'), '');
});

test('a repeat opens on its own site, and on none if that site is gone or was never saved', () => {
  const sites = [{ id: 'last' }, { id: 'old' }];
  assert.equal(repeatSite(sites, null, 'old'), 'old');
  assert.equal(repeatSite(sites, 'last', 'old'), 'last');
  assert.equal(repeatSite(sites, null, 'gone'), '');
  assert.equal(repeatSite(sites, null, undefined), '');
  assert.equal(repeatSite(sites, 'gone', 'old'), 'old');
});

test('Place waits: only a review of exactly what is on screen, not expired, can be placed', () => {
  const now = Date.parse('2026-11-05T10:00:00Z');
  const review = { id: 'r', expiresAt: '2026-11-05T10:05:00Z' };
  assert.equal(placeable(review, 'k', 'k', now), true);
  assert.equal(placeable(null, 'k', 'k', now), false);
  assert.equal(placeable(review, 'old', 'k', now), false);
  assert.equal(placeable(review, 'k', 'k', now + 5 * 60 * 1000), false);
  assert.equal(REVIEW_REFRESH_MS, 4 * 60 * 1000);
});

test('the same lines to the same site lately earns a line, and never blocks', () => {
  const now = Date.parse('2026-11-05T10:00:00Z');
  const order = (over = {}) => ({
    status: 'AWAITING_CONFIRMATION',
    createdAt: new Date(now - 60000).toISOString(),
    address: { id: 's' },
    items: [{ productId: 'a', quantity: 5 }],
    ...over,
  });
  const lines = [{ productId: 'a', quantity: 5 }];
  assert.ok(orderedRecently(lines, 's', [order()], now));
  assert.equal(orderedRecently(lines, 't', [order()], now), null);
  assert.equal(orderedRecently([{ productId: 'a', quantity: 6 }], 's', [order()], now), null);
  assert.equal(orderedRecently(lines, 's', [order({ status: 'CANCELLED' })], now), null);
  assert.equal(
    orderedRecently(
      lines,
      's',
      [order({ createdAt: new Date(now - SAME_ORDER_WINDOW_MS - 1).toISOString() })],
      now,
    ),
    null,
  );
  assert.equal(orderedRecently([], 's', [order()], now), null);
});

test('each reason for a line left out has its own word', () => {
  assert.equal(leftOutWord('NOT_SOLD'), 'notSold');
  assert.equal(leftOutWord('QUANTITY'), 'quantity');
  assert.equal(leftOutWord('ASK_SHOP'), 'askShop');
});

test('request keys are well-formed uuids, and each is new', () => {
  const key = makeKey();
  assert.match(key, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  assert.notEqual(key, makeKey());
});

test('a moved rate or an old review means look again, nothing else', () => {
  assert.equal(refusalMeansLook('PRICE_CHANGED'), true);
  assert.equal(refusalMeansLook('REVIEW_EXPIRED'), true);
  assert.equal(refusalMeansLook('NETWORK_ERROR'), false);
  assert.equal(refusalMeansLook(undefined), false);
});
