import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { accessFor, allShopRoles, staffRoles, type StaffRole } from '@shiv/shared';
import { en, hinglish, hi } from '@shiv/i18n';
import { moreRoutes, pathAllowed } from './nav';
import { allowedScope, readScope, scopeParams, scopeQuery, writeScope, type Scope } from './scope';
import {
  currentItem,
  groupsWhere,
  navGroups,
  phoneTabs,
  plusActions,
  routeMoves,
  visibleGroups,
} from './shell-nav';

const of = (role: StaffRole) =>
  accessFor([{ role, locationId: allShopRoles.includes(role) ? null : 'shop' }]);
const pages = join(__dirname, '../app/(owner)');
const routeExists = (path: string) => existsSync(join(pages, path.split('?')[0]!, 'page.tsx'));
const items = navGroups.flatMap((group) => group.items);

test('every item in the rail is a real page, listed once, with words in all three languages', () => {
  const hrefs = items.map((item) => item.href);
  assert.deepEqual(hrefs, [...new Set(hrefs)]);
  for (const item of items) {
    assert.ok(routeExists(item.href), `${item.href} has no page`);
    assert.ok(en[item.key] && hinglish[item.key], item.key);
  }
  for (const group of navGroups)
    if (group.label) assert.ok(hi[group.label], `${group.label} in Hindi`);
  // Every old desk link has a place in the new groups or a move in the table.
  for (const old of [
    '/today',
    '/inbox',
    '/orders',
    '/lists',
    '/customers',
    '/calls',
    '/udhaar',
    '/rates',
    '/stock',
    '/manzoori',
    '/galla',
    '/hazri',
    '/trips',
    '/salary',
    '/reports',
    '/tally',
    '/activity',
    '/users',
    '/staff',
    '/whatsapp',
    '/settings',
    '/system',
  ])
    assert.ok(hrefs.includes(old) || routeMoves.some((move) => move.from === old), old);
});

test('six groups in the plan order, Aaj first', () => {
  assert.deepEqual(
    navGroups.map((group) => group.id),
    ['top', 'bikri', 'paisa', 'maal', 'log', 'setup'],
  );
  assert.equal(items[0]!.href, '/today');
});

test('each role sees only the pages it may open, and no empty group', () => {
  for (const role of staffRoles) {
    const access = of(role);
    const groups = visibleGroups(access);
    for (const group of groups) {
      assert.ok(group.items.length > 0, `${role} ${group.id} is empty`);
      for (const item of group.items)
        assert.ok(pathAllowed(access, item.href), `${role} ${item.href}`);
    }
    const shown = new Set(groups.flatMap((group) => group.items.map((item) => item.href)));
    for (const item of items)
      if (pathAllowed(access, item.href))
        assert.ok(shown.has(item.href), `${role} misses ${item.href}`);
  }
});

test('what a few jobs see', () => {
  const hrefs = (role: StaffRole) =>
    visibleGroups(of(role)).flatMap((group) => group.items.map((item) => item.href));
  // The owner sees every page.
  assert.deepEqual(
    hrefs('OWNER'),
    items.map((item) => item.href),
  );
  // A stock keeper has stock and no money pages.
  const stock = hrefs('STOCK_KEEPER');
  assert.ok(stock.includes('/stock'));
  for (const money of ['/galla', '/reports', '/salary', '/udhaar'])
    assert.ok(!stock.includes(money), money);
  // The technical operator keeps the PCs running: System and Tally, no money.
  const tech = hrefs('TECH_OPERATOR');
  assert.ok(tech.includes('/system'));
  for (const money of ['/galla', '/reports', '/udhaar', '/salary'])
    assert.ok(!tech.includes(money), money);
  // Drivers and helpers work in the staff app.
  assert.deepEqual(hrefs('DRIVER'), []);
  assert.deepEqual(hrefs('HELPER'), []);
});

test('the page a person is on is the longest matching item', () => {
  assert.equal(currentItem('/orders/abc'), '/orders');
  assert.equal(currentItem('/customers/12'), '/customers');
  assert.equal(currentItem('/udhaar/opening'), '/udhaar');
  assert.equal(currentItem('/reports/hisaab'), '/reports');
  assert.equal(currentItem('/ordersx'), null);
  assert.equal(currentItem('/more'), null);
  assert.equal(groupsWhere(() => false).length, 0);
});

test('the phone has five tabs and the [+] sheet only offers pages that exist', () => {
  assert.deepEqual([...phoneTabs], ['/today', '/inbox', 'plus', 'saathi', '/more']);
  for (const action of plusActions) assert.ok(routeExists(action.needs), action.href);
});

test('the old-to-new table: every move today lands on a page that exists', () => {
  for (const move of routeMoves) {
    if (!move.now) {
      // A later move names the phase that builds its home, and its old page still opens.
      assert.match(move.phase ?? '', /^[A-G]\d/, move.from);
      if (!move.from.includes('…')) assert.ok(routeExists(move.from), `${move.from} still opens`);
      continue;
    }
    assert.ok(routeExists(move.to), `${move.from} → ${move.to}`);
    const view = new URLSearchParams(move.from.split('?')[1] ?? '').get('view');
    if (view) assert.equal(moreRoutes[view as keyof typeof moreRoutes], move.to, move.from);
  }
  // Every saved More link is in the table.
  for (const view of Object.keys(moreRoutes))
    assert.ok(
      routeMoves.some((move) => move.from === `/more?view=${view}`),
      view,
    );
});

test('the scope reads, writes and refuses what this person cannot see', () => {
  const shops = [{ id: 'main' }, { id: 'godown_1' }];
  const firms = [{ id: 'sipara' }, { id: 'sampatchak' }];
  const cases: [string, Scope][] = [
    ['', { kind: 'all' }],
    ['shop:main', { kind: 'shop', shopId: 'main' }],
    ['firm:sipara', { kind: 'firm', firmId: 'sipara' }],
    ['shop:', { kind: 'all' }],
    ['shop:<script>', { kind: 'all' }],
    ['firm:a b', { kind: 'all' }],
    ['nonsense', { kind: 'all' }],
    ['shop:main:extra', { kind: 'all' }],
  ];
  for (const [stored, expected] of cases) assert.deepEqual(readScope(stored), expected, stored);
  for (const scope of cases.map(([, scope]) => scope))
    assert.deepEqual(readScope(writeScope(scope)), scope);
  // A shop or firm that is not this person's falls back to every shop.
  assert.deepEqual(allowedScope({ kind: 'shop', shopId: 'other' }, shops, firms), { kind: 'all' });
  assert.deepEqual(allowedScope({ kind: 'firm', firmId: 'other' }, shops, firms), { kind: 'all' });
  // With only one firm there is nothing to choose between.
  assert.deepEqual(allowedScope({ kind: 'firm', firmId: 'sipara' }, shops, [firms[0]!]), {
    kind: 'all',
  });
  assert.deepEqual(allowedScope({ kind: 'shop', shopId: 'main' }, shops, firms), {
    kind: 'shop',
    shopId: 'main',
  });
});

test('the scope becomes the query a page sends', () => {
  assert.deepEqual(scopeParams({ kind: 'all' }), {});
  assert.deepEqual(scopeParams({ kind: 'shop', shopId: 'main' }), { locationId: 'main' });
  assert.deepEqual(scopeParams({ kind: 'firm', firmId: 'sipara' }), { firmId: 'sipara' });
  assert.equal(scopeQuery({ kind: 'all' }), '');
  assert.equal(scopeQuery({ kind: 'shop', shopId: 'main' }), '?locationId=main');
  assert.equal(scopeQuery({ kind: 'firm', firmId: 'sipara' }, '&'), '&firmId=sipara');
});
