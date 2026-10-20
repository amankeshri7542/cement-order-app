import { test } from 'node:test';
import assert from 'node:assert/strict';
import { customerUpdateSchema, khataBalance, khataPaymentSchema, phoneOrderSchema } from './index';

const input = {
  customerPhone: '+919999999983',
  source: 'WALK_IN',
  items: [{ productId: 'cement', quantity: 1 }],
  deliveryDate: 'today',
  paymentMethod: 'COD',
  idempotencyKey: '53288d07-735b-4be1-90d3-eafc4bffca73',
};

test('phone order contracts distinguish delivery from pickup and reject untrusted prices', () => {
  assert.equal(phoneOrderSchema.safeParse(input).success, true);
  for (const changes of [
    { source: 'PHONE' },
    { totalPaise: 1 },
    { source: 'APP' },
    { deliveryDate: '2026-02-30' },
    { customerPhone: '+919297513707 ', actorId: 'papa' },
    { items: [...input.items, ...input.items] },
  ])
    assert.equal(phoneOrderSchema.safeParse({ ...input, ...changes }).success, false);
});

test('khata balances use signed integer paise and reject either overflow boundary', () => {
  assert.equal(khataBalance(50000, -30000), 20000);
  assert.equal(khataBalance(0, -10000), -10000);
  assert.equal(khataBalance(2_000_000_000, -1), 1_999_999_999);
  assert.throws(() => khataBalance(2_000_000_000, 1));
  assert.throws(() => khataBalance(-2_000_000_000, -1));
  assert.throws(() => khataBalance(1, 0.5));
});

test('cash receipts require positive integer paise and explicit idempotency', () => {
  const payment = { amountPaise: 100, note: 'Cash received', idempotencyKey: input.idempotencyKey };
  assert.equal(khataPaymentSchema.parse(payment).channel, 'CASH');
  for (const amountPaise of [0, -100, 0.5, 2_000_000_001])
    assert.equal(khataPaymentSchema.safeParse({ ...payment, amountPaise }).success, false);
  assert.equal(
    khataPaymentSchema.safeParse({ ...payment, idempotencyKey: undefined }).success,
    false,
  );
});

test('credit settings reject negative limits, duplicate tags and empty updates', () => {
  assert.equal(
    customerUpdateSchema.safeParse({ creditAllowed: true, creditLimitPaise: 10000 }).success,
    true,
  );
  for (const update of [
    {},
    { creditLimitPaise: -1 },
    { tags: ['regular', 'regular'] },
    { khataBalancePaise: 1 },
  ])
    assert.equal(customerUpdateSchema.safeParse(update).success, false);
});
