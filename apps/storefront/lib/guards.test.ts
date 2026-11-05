import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  addressSchema,
  localPhone as sharedLocalPhone,
  placeOrderSchema,
  quoteRequestSchema,
} from '@shiv/shared';
import { goodAddress, goodName, isPendingOrder, isQuoteDraft, isQuoteRequest } from './guards';
import { localPhone } from './customer-api';

const uuid = '3f1c2b9e-7a44-4c11-9d11-0a1b2c3d4e5f';
test('a saved order the shared rules accept is accepted here too', () => {
  const pending = { reviewId: 'abc', idempotencyKey: uuid };
  assert.equal(placeOrderSchema.safeParse(pending).success, true);
  assert.equal(isPendingOrder(pending), true);
});
test('a damaged saved order is dropped', () => {
  for (const bad of [
    null,
    'x',
    {},
    { reviewId: '', idempotencyKey: uuid },
    { reviewId: 'a' },
    { reviewId: 5, idempotencyKey: 'x' },
  ])
    assert.equal(isPendingOrder(bad), false, JSON.stringify(bad));
});
const request = {
  idempotencyKey: uuid,
  items: [{ productId: 'a', quantity: 2 }],
  addressId: 'addr',
  deliveryDate: '2026-11-10',
  company: '',
  gstin: '',
  notes: '',
};
test('a saved rate request the shared rules accept is accepted here too', () => {
  assert.equal(quoteRequestSchema.safeParse(request).success, true);
  assert.equal(isQuoteRequest(request), true);
});
test('a damaged saved rate request is dropped', () => {
  for (const bad of [
    null,
    { ...request, items: [] },
    { ...request, items: 'x' },
    { ...request, items: [{ productId: 'a', quantity: -1 }] },
    { ...request, items: [{ productId: 'a', quantity: 1.5 }] },
    { ...request, items: Array(51).fill(request.items[0]) },
    { ...request, notes: 'x'.repeat(1501) },
    { ...request, gstin: 'x'.repeat(16) },
    { ...request, idempotencyKey: '' },
  ])
    assert.equal(isQuoteRequest(bad), false);
});
test('a saved draft keeps only what fits', () => {
  assert.equal(isQuoteDraft({ addressId: '', date: '', company: '', gstin: '', notes: '' }), true);
  assert.equal(isQuoteDraft({ addressId: 5 }), false);
  assert.equal(isQuoteDraft(null), false);
});
const address = {
  label: 'Site',
  name: 'A Person',
  phone: '+919876543210',
  line1: 'Plot 18',
  area: 'Area',
  city: 'Patna',
  pincode: '800020',
};
test('an address the shared rules accept is accepted here too', () => {
  assert.equal(addressSchema.safeParse({ ...address, state: 'Bihar', landmark: '' }).success, true);
  assert.equal(goodAddress(address), true);
});
test('bad addresses are caught before sending', () => {
  for (const bad of [
    { phone: '9876543210' },
    { phone: '+915876543210' },
    { pincode: '80002' },
    { pincode: 'abcdef' },
    { line1: '   ' },
    { name: 'A\u202eB' },
    { area: 'x'.repeat(121) },
  ]) {
    const form = { ...address, ...bad };
    assert.equal(goodAddress(form), false, JSON.stringify(bad));
    assert.equal(addressSchema.safeParse({ ...form, state: 'Bihar', landmark: '' }).success, false);
  }
});
test('names follow the same rule', () => {
  assert.equal(goodName('Ramesh'), true);
  assert.equal(goodName('   '), false);
  assert.equal(goodName('x'.repeat(101)), false);
  assert.equal(goodName('a\u0000b'), false);
});
test('phone numbers read the same as the shared rule', () => {
  for (const value of [
    '+919876543210',
    '91 98765 43210',
    '09876543210',
    '(987) 654-3210',
    '0091 9876543210',
    'abc',
  ])
    assert.equal(localPhone(value), sharedLocalPhone(value), value);
});
