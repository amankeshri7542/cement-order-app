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
    assert.deepEqual(of('DRIVER', 'shop'), {});
    assert.deepEqual(of('HELPER', 'shop'), {});
  });
  test('a stock keeper never sees money', () => {
    const access = of('STOCK_KEEPER', 'shop');
    for (const name of ['orders.read.money', 'money.receive', 'reports.read', 'khata.read.one'])
      assert.equal(access[name as keyof typeof access], undefined);
    assert.deepEqual(access['orders.read'], ['shop']);
  });
  test('the technical operator keeps the system running and touches no business data', () => {
    assert.deepEqual(Object.keys(of('TECH_OPERATOR')).sort(), [
      'alerts.manage',
      'desk.use',
      'system.ops',
      // Counts and connection state only, never a customer's words.
      'wa.admin',
    ]);
  });
  test('the accountant reads everything and changes nothing', () => {
    const written = Object.keys(of('ACCOUNTANT')).filter(
      (name) => !/\.read|^desk\.use$/.test(name),
    );
    assert.deepEqual(written, []);
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
