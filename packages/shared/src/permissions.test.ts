import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  accessFor,
  allShopRoles,
  canDo,
  isShopScoped,
  needsShop,
  permissions,
  rolePermissions,
  staffRoles,
} from './permissions';

const of = (role: (typeof staffRoles)[number], locationId: string | null = null) =>
  accessFor([{ role, locationId }]);

describe('the role table', () => {
  test('every role is defined, and only names permissions that exist', () => {
    assert.deepEqual(Object.keys(rolePermissions).sort(), [...staffRoles].sort());
    for (const role of staffRoles)
      for (const name of Object.keys(rolePermissions[role]))
        assert.ok((permissions as readonly string[]).includes(name), name);
  });
  test('owners hold every permission at every shop', () => {
    const access = of('OWNER');
    for (const name of permissions) assert.equal(access[name], 'ALL');
  });
  test('drivers and helpers have nothing on the desk until the staff app', () => {
    assert.deepEqual(of('DRIVER', 'shop'), { 'staffapp.use': ['shop'], 'trip.drive': ['shop'] });
    assert.deepEqual(of('HELPER', 'shop'), { 'staffapp.use': ['shop'] });
  });
  test('a stock keeper never sees money', () => {
    const access = of('STOCK_KEEPER', 'shop');
    for (const name of ['orders.read.money', 'money.receive', 'reports.read', 'khata.read.one'])
      assert.equal(access[name as keyof typeof access], undefined);
    assert.deepEqual(access['orders.read'], ['shop']);
  });
  test('the technical operator keeps the system running and touches no business data', () => {
    assert.deepEqual(Object.keys(of('TECH_OPERATOR')).sort(), [
      // Ask: numbers only, never a customer's words, and a way to stop the AI.
      'advisor.control',
      'advisor.health',
      'alerts.manage',
      'desk.use',
      'system.ops',
      // The shop PCs and whether they answer. No party, amount or Tally number.
      'tally.devices',
      'tally.health',
      // Counts and connection state only, never a customer's words.
      'wa.admin',
    ]);
  });
  test('the accountant reads everything and changes nothing but the sheets given to them', () => {
    const written = Object.keys(of('ACCOUNTANT')).filter(
      (name) => !/\.read|^desk\.use$/.test(name),
    );
    assert.deepEqual(written.sort(), [
      // Typing what the paper book says. Only an owner signs it.
      'khata.opening.draft',
      // Their own Tally page: seeing the numbers, and saying which party is which.
      'tally.match',
      'tally.numbers.view',
    ]);
  });
  test('a cashier does collection work and reads no owner report', () => {
    const access = of('CASHIER', 'shop');
    assert.deepEqual(access['crm.followups'], ['shop']);
    assert.deepEqual(access['crm.followups.read'], ['shop']);
    assert.deepEqual(access['crm.remind'], ['shop']);
    for (const name of [
      'reports.read',
      'crm.vasooli.read',
      'crm.dormant.read',
      'crm.followups.assign',
      'khata.read.list',
      'khata.opening.draft',
      'khata.opening.approve',
      'tally.numbers.view',
    ] as const)
      assert.equal(access[name], undefined, name);
  });
  test('a manager runs only their own shops', () => {
    const access = of('MANAGER', 'shop');
    for (const name of [
      'crm.followups',
      'crm.followups.read',
      'crm.followups.assign',
      'crm.remind',
      'crm.vasooli.read',
      'crm.dormant.read',
    ] as const)
      assert.deepEqual(access[name], ['shop'], name);
    assert.equal(access['khata.opening.approve'], undefined);
    assert.equal(access['tally.numbers.view'], undefined);
  });
  test('only an owner signs an opening balance', () => {
    for (const role of staffRoles)
      assert.equal(!!rolePermissions[role]['khata.opening.approve'], role === 'OWNER', role);
  });
  test('the accountant reads the lists without any customer’s number, and calls nobody', () => {
    const access = of('ACCOUNTANT');
    for (const name of ['crm.followups.read', 'crm.vasooli.read', 'crm.dormant.read'] as const)
      assert.equal(access[name], 'ALL', name);
    for (const name of ['customers.phone.read', 'crm.remind', 'crm.followups'] as const)
      assert.equal(access[name], undefined, name);
  });
  test('Tally numbers are for owners and the accountant, and nobody else', () => {
    for (const role of staffRoles)
      assert.equal(
        !!rolePermissions[role]['tally.numbers.view'],
        role === 'OWNER' || role === 'ACCOUNTANT',
        role,
      );
  });
  test('drivers, helpers, stock keepers and the technical operator get nothing from the CRM', () => {
    for (const role of ['DRIVER', 'HELPER', 'STOCK_KEEPER', 'TECH_OPERATOR'] as const) {
      const held = Object.keys(rolePermissions[role]);
      assert.deepEqual(
        held.filter((name) => /^crm\.|^khata\.|^customers\./.test(name)),
        [],
        role,
      );
    }
  });
  test('only an owner can manage people, set credit, publish rates or change the count', () => {
    for (const name of [
      'staff.manage',
      'khata.credit.set',
      'rates.publish',
      'stock.adjust',
    ] as const)
      for (const role of staffRoles)
        assert.equal(!!rolePermissions[role][name], role === 'OWNER', `${role} ${name}`);
  });
  test('cashiers can take money and cannot give it back', () => {
    const access = of('CASHIER', 'shop');
    assert.deepEqual(access['money.receive'], ['shop']);
    assert.equal(access['money.refund'], undefined);
    assert.equal(access['quotes.price'], undefined);
  });
  test('all-shop roles need no shop, and every other role does', () => {
    for (const role of staffRoles) assert.equal(needsShop(role), !allShopRoles.includes(role));
  });
});

describe('working out access', () => {
  test('nobody holds anything without a membership', () => {
    assert.deepEqual(accessFor([]), {});
  });
  test('shop memberships add up, without repeating a shop', () => {
    const access = accessFor([
      { role: 'CASHIER', locationId: 'a' },
      { role: 'CASHIER', locationId: 'b' },
      { role: 'MANAGER', locationId: 'a' },
    ]);
    assert.deepEqual(access['orders.read'], ['a', 'b']);
    assert.deepEqual(access['money.refund'], ['a']);
  });
  test('holding a permission everywhere is not narrowed by a later shop', () => {
    const access = accessFor([
      { role: 'OWNER', locationId: null },
      { role: 'CASHIER', locationId: 'a' },
    ]);
    assert.equal(access['orders.read'], 'ALL');
  });
  test('a firm-wide permission stays firm-wide when held through a shop', () => {
    assert.equal(of('CASHIER', 'a')['customers.read'], 'ALL');
  });
});

describe('checking access', () => {
  const access = of('CASHIER', 'a');
  test('at a shop they hold', () => assert.equal(canDo(access, 'orders.read', 'a'), true));
  test('at another shop', () => assert.equal(canDo(access, 'orders.read', 'b'), false));
  test('with no shop named it only asks whether they hold it at all', () => {
    assert.equal(canDo(access, 'orders.read'), true);
    assert.equal(canDo(access, 'money.refund'), false);
  });
  test('a firm-wide permission works at any shop', () => {
    assert.equal(canDo(access, 'customers.read', 'b'), true);
  });
  test('knows which permissions depend on the shop', () => {
    assert.equal(isShopScoped('orders.read'), true);
    assert.equal(isShopScoped('customers.read'), false);
    assert.equal(isShopScoped('staff.manage'), false);
  });
});
