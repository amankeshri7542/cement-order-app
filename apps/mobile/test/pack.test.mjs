import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';
import { loadTs } from './load-ts.mjs';

const shared = createRequire(import.meta.url)('@shiv/shared');
const { packLine, orderRule } = loadTs('src/logic/pack.ts', {}, { '@shiv/shared': shared });
const cement = { unit: 'bag', packSize: '50 kg bag', minQuantity: 1, quantityStep: 1 };

test('says what one container holds without repeating the unit', () => {
  assert.equal(packLine(cement), '1 bag = 50 kg');
  assert.equal(packLine({ ...cement, packSize: '50 kg' }), '1 bag = 50 kg');
  assert.equal(packLine({ unit: 'piece', packSize: '9 × 4 × 3 in' }), '1 piece = 9 × 4 × 3 in');
  assert.equal(packLine({ unit: 'bundle', packSize: '12 mm × 12 m' }), '1 bundle = 12 mm × 12 m');
});

test('says nothing when it would be a wrong sentence', () => {
  // No pack size.
  assert.equal(packLine({ unit: 'bag', packSize: '' }), '');
  assert.equal(packLine({ unit: 'bag', packSize: '   ' }), '');
  // Units that measure, or that are already a phrase, are not containers.
  assert.equal(packLine({ unit: 'kg', packSize: '12 mm' }), '');
  assert.equal(packLine({ unit: 'tonne', packSize: '1 tonne bundle' }), '');
  assert.equal(packLine({ unit: 'cu ft', packSize: '100 cu ft' }), '');
  assert.equal(packLine({ unit: '50 kg bag', packSize: '50 kg bag' }), '');
  assert.equal(packLine({ unit: 'kg · 12 mm', packSize: '12 mm' }), '');
  assert.equal(packLine({ unit: '1,000 bricks', packSize: '' }), '');
  // A pack size that names the unit elsewhere, or is only a number.
  assert.equal(packLine({ unit: 'bag', packSize: '50 kg bag (PPC)' }), '');
  assert.equal(packLine({ unit: 'bag', packSize: '50' }), '');
  assert.equal(packLine({ unit: 'bag', packSize: 'bag' }), '');
});

test('explains a minimum and a lot size in plain words', () => {
  assert.equal(
    orderRule({ unit: 'bag', minQuantity: 10, quantityStep: 10 }),
    'At least 10 bags, in lots of 10',
  );
  assert.equal(
    orderRule({ unit: 'bag', minQuantity: 1, quantityStep: 5 }),
    'At least 1 bag, in lots of 5',
  );
  assert.equal(orderRule({ unit: 'box', minQuantity: 5, quantityStep: 1 }), 'At least 5 boxes');
  assert.equal(orderRule({ unit: 'pcs', minQuantity: 20, quantityStep: 1 }), 'At least 20 pcs');
});

test('never builds grammar out of a unit that is not a single container word', () => {
  assert.equal(orderRule({ unit: 'kg', minQuantity: 50, quantityStep: 1 }), 'At least 50');
  assert.equal(
    orderRule({ unit: 'cu ft', minQuantity: 100, quantityStep: 50 }),
    'At least 100, in lots of 50',
  );
  assert.equal(
    orderRule({ unit: 'kg · 12 mm', minQuantity: 100, quantityStep: 1 }),
    'At least 100',
  );
});

test('says nothing when any whole number can be ordered', () => {
  assert.equal(orderRule({ unit: 'bag', minQuantity: 1, quantityStep: 1 }), '');
});
