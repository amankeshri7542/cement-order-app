import assert from 'node:assert/strict';
import test from 'node:test';
import { loadTs } from './load-ts.mjs';

const { money } = loadTs('src/logic/money.ts', {}, {});

test('rupees as a shop writes them, with Indian grouping', () => {
  assert.equal(money(39500), '₹395');
  assert.equal(money(0), '₹0');
  assert.equal(money(100000), '₹1,000');
  assert.equal(money(11169000), '₹1,11,690');
  assert.equal(money(1234567800), '₹1,23,45,678');
});

test('paise show only when there are any', () => {
  assert.equal(money(39550), '₹395.50');
  assert.equal(money(39505), '₹395.05');
  assert.equal(money(5), '₹0.05');
});

test('a negative amount keeps its sign outside the rupee mark', () => {
  assert.equal(money(-2000000), '-₹20,000');
});
