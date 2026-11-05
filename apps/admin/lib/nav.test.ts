import assert from 'node:assert/strict';
import { test } from 'node:test';
import { accessFor, staffRoles, type StaffRole } from '@shiv/shared';
import { homeFor, moreRoutes, moreViews, pathAllowed, viewAllowed, type MoreView } from './nav';

const of = (role: StaffRole) => accessFor([{ role, locationId: 'shop' }]);

test('an owner opens everything', () => {
  const access = accessFor([{ role: 'OWNER', locationId: null }]);
  for (const path of [
    '/today',
    '/orders',
    '/orders/new',
    '/orders/1',
    '/customers/1',
    '/khata',
    '/udhaar',
    '/lists',
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
    '/more',
  ])
    assert.equal(pathAllowed(access, path), true, path);
  for (const view of Object.keys(moreViews)) assert.equal(viewAllowed(access, view), true, view);
  assert.equal(homeFor(access), '/today');
});

test('a stock keeper starts at stock and never reaches the money pages', () => {
  const access = of('STOCK_KEEPER');
  assert.equal(homeFor(access), '/stock');
  for (const path of ['/today', '/customers', '/customers/1', '/khata', '/orders/new'])
    assert.equal(pathAllowed(access, path), false, path);
  assert.equal(pathAllowed(access, '/orders'), true);
  assert.equal(viewAllowed(access, 'reports'), false);
  assert.equal(viewAllowed(access, 'users'), false);
});

test('a cashier takes orders and has no khata list, reports or people', () => {
  const access = of('CASHIER');
  assert.equal(pathAllowed(access, '/orders/new'), true);
  assert.equal(pathAllowed(access, '/khata'), false);
  assert.equal(viewAllowed(access, 'reports'), false);
  assert.equal(viewAllowed(access, 'users'), false);
  // Reads rates to answer customers. Changing them is refused on the page and by the API.
  assert.equal(viewAllowed(access, 'rates'), true);
  assert.equal(viewAllowed(access, 'products'), false);
});

test('the accountant reads and creates nothing', () => {
  const access = of('ACCOUNTANT');
  assert.equal(pathAllowed(access, '/khata'), true);
  assert.equal(pathAllowed(access, '/orders/new'), false);
  assert.equal(viewAllowed(access, 'activity'), true);
  assert.equal(viewAllowed(access, 'store'), false);
});

test('the technical operator gets the system pages and no business pages', () => {
  const access = of('TECH_OPERATOR');
  assert.equal(homeFor(access), '/system');
  for (const path of ['/today', '/orders', '/customers', '/khata', '/stock'])
    assert.equal(pathAllowed(access, path), false, path);
  assert.equal(viewAllowed(access, 'staff'), true);
  assert.equal(viewAllowed(access, 'reports'), false);
});

test('drivers and helpers have no desk pages, and an unknown address gives nothing away', () => {
  for (const role of ['DRIVER', 'HELPER'] as const) {
    for (const path of ['/today', '/more', '/somewhere'])
      assert.equal(pathAllowed(of(role), path), false);
  }
  for (const role of staffRoles) assert.equal(viewAllowed(of(role), 'not-a-page'), false);
});

test('a view named after something on every object is not a way in', () => {
  const access = accessFor([{ role: 'OWNER', locationId: null }]);
  for (const view of ['constructor', 'toString', '__proto__'])
    assert.equal(viewAllowed(access, view), false, view);
});

test('each role reaches the new pages that belong to its job, and only those', () => {
  const opens = (role: StaffRole, path: string) => pathAllowed(of(role), path);
  assert.equal(opens('MANAGER', '/rates'), true);
  assert.equal(opens('MANAGER', '/galla'), true);
  assert.equal(opens('MANAGER', '/manzoori'), true);
  assert.equal(opens('MANAGER', '/system'), false);
  assert.equal(opens('CASHIER', '/galla'), true);
  assert.equal(opens('CASHIER', '/rates'), true);
  assert.equal(opens('CASHIER', '/reports'), false);
  assert.equal(opens('CASHIER', '/users'), false);
  assert.equal(opens('STOCK_KEEPER', '/stock'), true);
  assert.equal(opens('STOCK_KEEPER', '/manzoori'), true);
  assert.equal(opens('STOCK_KEEPER', '/rates'), false);
  assert.equal(opens('STOCK_KEEPER', '/galla'), false);
  assert.equal(opens('ACCOUNTANT', '/activity'), true);
  assert.equal(opens('ACCOUNTANT', '/galla'), true);
  assert.equal(opens('ACCOUNTANT', '/manzoori'), false);
  assert.equal(opens('TECH_OPERATOR', '/system'), true);
  assert.equal(opens('TECH_OPERATOR', '/whatsapp'), true);
  // Cards belong to whoever takes orders at the shop. What they can do there is per permission.
  assert.equal(opens('MANAGER', '/whatsapp'), true);
  assert.equal(opens('CASHIER', '/whatsapp'), true);
  assert.equal(opens('ACCOUNTANT', '/whatsapp'), false);
  assert.equal(opens('STOCK_KEEPER', '/whatsapp'), false);
  assert.equal(opens('TECH_OPERATOR', '/rates'), false);
  assert.equal(opens('TECH_OPERATOR', '/orders'), false);
});
test('the technical operator’s day starts on System', () => {
  assert.equal(homeFor(of('TECH_OPERATOR')), '/system');
});
test('every old address leads to its page', () => {
  for (const view of Object.keys(moreViews))
    assert.match(moreRoutes[view as MoreView], /^\/[a-z]+(\?[a-z]+=[a-z]+)?$/);
});

test('hazri is for those who look after attendance, and the accountant reads it', () => {
  const opens = (role: StaffRole) => pathAllowed(of(role), '/hazri');
  assert.equal(opens('MANAGER'), true);
  assert.equal(opens('ACCOUNTANT'), true);
  for (const role of ['CASHIER', 'STOCK_KEEPER', 'DRIVER', 'HELPER', 'TECH_OPERATOR'] as const)
    assert.equal(opens(role), false, role);
});
test('trips are for whoever assigns them', () => {
  const opens = (role: StaffRole) => pathAllowed(of(role), '/trips');
  assert.equal(opens('MANAGER'), true);
  for (const role of [
    'ACCOUNTANT',
    'CASHIER',
    'STOCK_KEEPER',
    'DRIVER',
    'HELPER',
    'TECH_OPERATOR',
  ] as const)
    assert.equal(opens(role), false, role);
});
test('salary is for owners and the accountant, and nobody else', () => {
  const owner = accessFor([{ role: 'OWNER', locationId: null }]);
  assert.equal(pathAllowed(owner, '/salary'), true);
  assert.equal(pathAllowed(of('ACCOUNTANT'), '/salary'), true);
  for (const role of [
    'MANAGER',
    'CASHIER',
    'STOCK_KEEPER',
    'DRIVER',
    'HELPER',
    'TECH_OPERATOR',
  ] as const)
    assert.equal(pathAllowed(of(role), '/salary'), false, role);
});

test('calls and the reports open for the right people', () => {
  const opens = (role: StaffRole, path: string) => pathAllowed(of(role), path);
  for (const role of ['OWNER', 'MANAGER', 'CASHIER', 'ACCOUNTANT'] as const)
    assert.equal(opens(role, '/calls'), true, role);
  for (const role of ['STOCK_KEEPER', 'DRIVER', 'HELPER', 'TECH_OPERATOR'] as const)
    assert.equal(opens(role, '/calls'), false, role);
  // A cashier's work is the calls. The owner's reports are not.
  assert.equal(opens('CASHIER', '/reports/hisaab'), false);
  assert.equal(opens('MANAGER', '/reports/hisaab'), true);
  assert.equal(opens('ACCOUNTANT', '/reports/hisaab'), true);
});
test('only those who may type it reach the opening sheet', () => {
  const opens = (role: StaffRole) => pathAllowed(of(role), '/udhaar/opening');
  assert.equal(opens('OWNER'), true);
  assert.equal(opens('ACCOUNTANT'), true);
  for (const role of ['MANAGER', 'CASHIER', 'STOCK_KEEPER', 'DRIVER', 'HELPER'] as const)
    assert.equal(opens(role), false, role);
});

test('Tally opens for those who keep the books or the PCs, and for nobody else', () => {
  for (const role of ['OWNER', 'ACCOUNTANT', 'TECH_OPERATOR'] as const) {
    const access = accessFor([{ role, locationId: null }]);
    assert.equal(pathAllowed(access, '/tally'), true, role);
  }
  for (const role of ['MANAGER', 'CASHIER', 'STOCK_KEEPER', 'DRIVER', 'HELPER'] as const) {
    const access = of(role);
    assert.equal(pathAllowed(access, '/tally'), false, role);
    assert.equal(pathAllowed(access, '/tally/anything'), false, role);
  }
  // Nobody's home moves because of it.
  assert.equal(homeFor(accessFor([{ role: 'ACCOUNTANT', locationId: null }])), '/today');
  assert.equal(homeFor(of('TECH_OPERATOR')), '/system');
});
