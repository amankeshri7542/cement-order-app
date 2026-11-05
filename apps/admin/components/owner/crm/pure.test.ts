import assert from 'node:assert/strict';
import { test } from 'node:test';
import { bookMoney, dayFor } from './pure';

test('Kal and Agle hafte count from today in India, across a month end', () => {
  assert.equal(dayFor('today', '', '2026-12-31'), '2026-12-31');
  assert.equal(dayFor('tomorrow', '', '2026-12-31'), '2027-01-01');
  assert.equal(dayFor('week', '', '2026-12-28'), '2027-01-04');
  assert.equal(dayFor('pick', '2027-02-03', '2026-12-31'), '2027-02-03');
});
test('Tally money keeps every paisa, past what a number can hold', () => {
  assert.equal(bookMoney('90071992547409931'), '₹90,07,19,92,54,74,099.31');
  assert.equal(bookMoney('12500000'), '₹1,25,000');
  assert.equal(bookMoney('150'), '₹1.50');
  assert.equal(bookMoney('5'), '₹0.05');
  assert.equal(bookMoney('0'), '₹0');
  assert.equal(bookMoney('-700000'), '-₹7,000');
});
