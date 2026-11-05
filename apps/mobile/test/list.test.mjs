import assert from 'node:assert/strict';
import test from 'node:test';
import { loadTs } from './load-ts.mjs';

const steps = loadTs('src/logic/quantity-steps.ts', {}, {});
const list = loadTs('src/logic/list-core.ts', {}, { './quantity-steps': steps });
const {
  addLine,
  setLine,
  restoreLine,
  withoutPlaced,
  cleanSaved,
  roughTotal,
  quantities,
  MAX_LINES,
} = list;
const { nextUp, nextDown, parseTyped, MAX_QUANTITY } = steps;

const bag = { id: 'bag', minQuantity: 1, quantityStep: 1 };
const lot = { id: 'lot', minQuantity: 10, quantityStep: 5 };

test('Add puts one pack on the list and remembers the rate on screen', () => {
  assert.deepEqual(addLine([], bag, 41000), [
    { productId: 'bag', quantity: 1, seenPricePaise: 41000 },
  ]);
  assert.deepEqual(addLine([], lot), [{ productId: 'lot', quantity: 10 }]);
});

test('an item with no public rate still goes on the list', () => {
  assert.deepEqual(addLine([], bag, null), [{ productId: 'bag', quantity: 1 }]);
});

test('adding again steps up by the pack rule and keeps the first rate seen', () => {
  const one = addLine([], lot, 100);
  assert.deepEqual(addLine(one, lot, 999), [
    { productId: 'lot', quantity: 15, seenPricePaise: 100 },
  ]);
});

test('a full list says no with null, and only then', () => {
  const full = Array.from({ length: MAX_LINES }, (_, i) => ({ productId: `p${i}`, quantity: 1 }));
  assert.equal(addLine(full, bag), null);
  assert.deepEqual(addLine(full, { id: 'p0', minQuantity: 1, quantityStep: 1 })[0].quantity, 2);
  assert.equal(setLine(full, 'new', 3).length, MAX_LINES);
});

test('0 takes a line off, and any other quantity sets it', () => {
  const one = [{ productId: 'bag', quantity: 2 }];
  assert.deepEqual(setLine(one, 'bag', 0), []);
  assert.deepEqual(setLine(one, 'bag', 200), [{ productId: 'bag', quantity: 200 }]);
  assert.deepEqual(setLine(one, 'other', 0), one);
});

test('undo puts a removed line back where it was, once', () => {
  const lines = [
    { productId: 'a', quantity: 1 },
    { productId: 'c', quantity: 1 },
  ];
  const back = restoreLine(lines, { productId: 'b', quantity: 2 }, 1);
  assert.deepEqual(
    back.map((line) => line.productId),
    ['a', 'b', 'c'],
  );
  assert.equal(restoreLine(back, { productId: 'b', quantity: 2 }, 1).length, 3);
  assert.equal(restoreLine([], { productId: 'b', quantity: 2 }, 9).length, 1);
});

test('placing takes the placed lines off and leaves what could not be sold', () => {
  const lines = [
    { productId: 'a', quantity: 2 },
    { productId: 'b', quantity: 1 },
    { productId: 'c', quantity: 5 },
  ];
  assert.deepEqual(withoutPlaced(lines, [{ productId: 'a', quantity: 2 }]), lines.slice(1));
  // Changed after the review: it stays, because that quantity was not what was ordered.
  assert.deepEqual(withoutPlaced(lines, [{ productId: 'c', quantity: 9 }]), lines);
});

test('a saved list trusts nothing about what it reads back', () => {
  assert.deepEqual(cleanSaved(null), []);
  assert.deepEqual(cleanSaved('junk'), []);
  assert.deepEqual(cleanSaved({ lines: [] }), []);
  const dirty = [
    { productId: 'good', quantity: 2, seenPricePaise: 100 },
    { productId: 'good', quantity: 3 },
    { productId: 'no quantity' },
    { productId: '../etc', quantity: 1 },
    { productId: 'zero', quantity: 0 },
    { productId: 'neg', quantity: -1 },
    { productId: 'part', quantity: 1.5 },
    { productId: 'huge', quantity: MAX_QUANTITY + 1 },
    { productId: 'badseen', quantity: 1, seenPricePaise: -5 },
    null,
    5,
  ];
  assert.deepEqual(cleanSaved(dirty), [
    { productId: 'good', quantity: 2, seenPricePaise: 100 },
    { productId: 'badseen', quantity: 1 },
  ]);
  const many = Array.from({ length: 80 }, (_, i) => ({ productId: `p${i}`, quantity: 1 }));
  assert.equal(cleanSaved(many).length, MAX_LINES);
});

test('the rough total says when it is not whole', () => {
  const lines = [
    { productId: 'a', quantity: 2 },
    { productId: 'b', quantity: 1 },
  ];
  const rate = { a: 100, b: 50 };
  assert.deepEqual(
    roughTotal(lines, (id) => rate[id]),
    { totalPaise: 250, whole: true },
  );
  assert.deepEqual(
    roughTotal(lines, (id) => (id === 'a' ? 100 : null)),
    { totalPaise: 200, whole: false },
  );
});

test('quantities are keyed for one-step reads by a row', () => {
  assert.deepEqual(quantities([{ productId: 'a', quantity: 3 }]), { a: 3 });
});

test('the stepper moves by the pack rule and down to 0 removes', () => {
  assert.equal(nextUp(1, 1, 1), 2);
  assert.equal(nextUp(10, 10, 5), 15);
  assert.equal(nextUp(12, 10, 5), 15);
  assert.equal(nextUp(MAX_QUANTITY, 1, 1), MAX_QUANTITY);
  assert.equal(nextDown(2, 1, 1), 1);
  assert.equal(nextDown(1, 1, 1), 0);
  assert.equal(nextDown(15, 10, 5), 10);
  assert.equal(nextDown(10, 10, 5), 0);
  assert.equal(nextDown(12, 10, 5), 10);
});

test('what is typed obeys the rules: 200 bori is one entry', () => {
  assert.equal(parseTyped('200', 1, 1), 200);
  assert.equal(parseTyped('0', 1, 1), 0);
  assert.equal(parseTyped('', 1, 1), null);
  assert.equal(parseTyped('abc', 1, 1), null);
  assert.equal(parseTyped('-5', 1, 1), null);
  assert.equal(parseTyped('1.5', 1, 1), null);
  assert.equal(parseTyped('7', 10, 5), null);
  assert.equal(parseTyped('12', 10, 5), null);
  assert.equal(parseTyped('15', 10, 5), 15);
  assert.equal(parseTyped('99999', 1, 1), null);
});
