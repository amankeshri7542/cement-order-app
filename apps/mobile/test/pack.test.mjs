import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';
import { loadTs } from './load-ts.mjs';

const shared = createRequire(import.meta.url)('@shiv/shared');
const { packLine, orderRule } = loadTs('src/pack.ts', {}, { '@shiv/shared': shared });
const cement = { unit: 'bag', packSize: '50 kg bag', minQuantity: 1, quantityStep: 1 };

test('says what one container holds without repeating the unit', () => {
  assert.equal(packLine(cement, 'en'), '1 bag = 50 kg');
  assert.equal(packLine({ ...cement, packSize: '50 kg' }, 'en'), '1 bag = 50 kg');
  assert.equal(
    packLine({ unit: 'piece', packSize: '9 × 4 × 3 in' }, 'en'),
    '1 piece = 9 × 4 × 3 in',
  );
  assert.equal(
    packLine({ unit: 'bundle', packSize: '12 mm × 12 m' }, 'en'),
    '1 bundle = 12 mm × 12 m',
  );
});

test('uses the Hindi unit words in Hindi', () => {
  assert.equal(packLine(cement, 'hi'), '1 बोरी = 50 किलो');
});

test('says nothing when it would be a wrong sentence', () => {
  // No pack size.
  assert.equal(packLine({ unit: 'bag', packSize: '' }, 'en'), '');
  assert.equal(packLine({ unit: 'bag', packSize: '   ' }, 'hi'), '');
  // Units that measure, or that are already a phrase, are not containers.
  assert.equal(packLine({ unit: 'kg', packSize: '12 mm' }, 'en'), '');
  assert.equal(packLine({ unit: 'tonne', packSize: '1 tonne bundle' }, 'en'), '');
  assert.equal(packLine({ unit: 'cu ft', packSize: '100 cu ft' }, 'en'), '');
  assert.equal(packLine({ unit: '50 kg bag', packSize: '50 kg bag' }, 'en'), '');
  assert.equal(packLine({ unit: 'kg · 12 mm', packSize: '12 mm' }, 'en'), '');
  assert.equal(packLine({ unit: '1,000 bricks', packSize: '' }, 'en'), '');
  // A pack size that names the unit elsewhere, or is only a number.
  assert.equal(packLine({ unit: 'bag', packSize: '50 kg bag (PPC)' }, 'en'), '');
  assert.equal(packLine({ unit: 'bag', packSize: '50' }, 'en'), '');
  assert.equal(packLine({ unit: 'bag', packSize: 'bag' }, 'en'), '');
});

test('explains a minimum and a lot size in plain words, in both languages', () => {
  assert.equal(
    orderRule({ unit: 'bag', minQuantity: 10, quantityStep: 10 }, 'en'),
    'At least 10 bags, in lots of 10',
  );
  assert.equal(
    orderRule({ unit: 'bag', minQuantity: 1, quantityStep: 5 }, 'en'),
    'At least 1 bag, in lots of 5',
  );
  assert.equal(
    orderRule({ unit: 'box', minQuantity: 5, quantityStep: 1 }, 'en'),
    'At least 5 boxes',
  );
  assert.equal(
    orderRule({ unit: 'pcs', minQuantity: 20, quantityStep: 1 }, 'en'),
    'At least 20 pcs',
  );
  assert.equal(
    orderRule({ unit: 'bag', minQuantity: 10, quantityStep: 10 }, 'hi'),
    'कम से कम 10 बोरी, 10-10 की गिनती में',
  );
});

test('never builds grammar out of a unit that is not a single container word', () => {
  assert.equal(orderRule({ unit: 'kg', minQuantity: 50, quantityStep: 1 }, 'en'), 'At least 50');
  assert.equal(
    orderRule({ unit: 'cu ft', minQuantity: 100, quantityStep: 50 }, 'en'),
    'At least 100, in lots of 50',
  );
  assert.equal(
    orderRule({ unit: 'kg · 12 mm', minQuantity: 100, quantityStep: 1 }, 'en'),
    'At least 100',
  );
  assert.equal(
    orderRule({ unit: '50 kg bag', minQuantity: 10, quantityStep: 10 }, 'hi'),
    'कम से कम 10, 10-10 की गिनती में',
  );
});

test('says nothing when any whole number can be ordered', () => {
  assert.equal(orderRule({ unit: 'bag', minQuantity: 1, quantityStep: 1 }, 'en'), '');
  assert.equal(orderRule({ unit: 'bag', minQuantity: 1, quantityStep: 1 }, 'hi'), '');
});
