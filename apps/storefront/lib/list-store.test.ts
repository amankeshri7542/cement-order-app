import assert from 'node:assert/strict';
import { beforeEach, test } from 'node:test';
import {
  quantityProblem,
  roundUpQuantity,
  stepDown as sharedDown,
  stepUp as sharedUp,
} from '@shiv/shared';
import {
  drain,
  list,
  MAX_LINES,
  MAX_QTY,
  parseState,
  readLine,
  reconcile,
  roundUp,
  stepDown,
  stepUp,
  validInput,
  withoutAsked,
  type ListInput,
  type ListLine,
} from './list-store';

// A browser's storage, as little of one as the store needs.
const store = new Map<string, string>();
let failWrites = false;
const fakeStorage = {
  getItem: (key: string) => store.get(key) ?? null,
  setItem: (key: string, value: string) => {
    if (failWrites) throw new Error('QuotaExceededError');
    store.set(key, value);
  },
  removeItem: (key: string) => void store.delete(key),
};
(globalThis as unknown as { window: unknown }).window = {
  localStorage: fakeStorage,
  addEventListener: () => {},
  removeEventListener: () => {},
};

const input = (i = 'a', over: Partial<ListInput> = {}): ListInput => ({
  i,
  n: `Name ${i}`,
  u: 'a bori (50 kg)',
  m: 1,
  s: 1,
  r: 41000,
  h: `/materials/cement/${i}`,
  ...over,
});
const line = (i: string, q: number, over: Partial<ListInput> = {}): ListLine => ({
  ...input(i, over),
  q,
});

beforeEach(() => {
  store.clear();
  failWrites = false;
  list.forget();
});

test('adding puts a product on at its minimum', () => {
  list.add(input('a', { m: 10, s: 5 }));
  assert.equal(list.quantityOf('a'), 10);
});
test('adding twice does not double it, and Add toggles off', () => {
  list.add(input('a'));
  list.add(input('a'));
  assert.equal(list.quantityOf('a'), 1);
  list.toggle(input('a'));
  assert.equal(list.quantityOf('a'), 0);
  list.toggle(input('a'));
  assert.equal(list.quantityOf('a'), 1);
});
test('steps follow the minimum and the step, and below the minimum takes the line off', () => {
  const rules = input('a', { m: 10, s: 5 });
  list.step(rules, 1);
  assert.equal(list.quantityOf('a'), 10);
  list.step(rules, 1);
  assert.equal(list.quantityOf('a'), 15);
  list.step(rules, -1);
  assert.equal(list.quantityOf('a'), 10);
  list.step(rules, -1);
  assert.equal(list.quantityOf('a'), 0);
  assert.deepEqual(list.snapshot().lines, []);
});
test('a quantity set by hand is rounded up to something the shop can sell', () => {
  list.set(input('a', { m: 10, s: 5 }), 12);
  assert.equal(list.quantityOf('a'), 15);
  list.set(input('b', { m: 10, s: 5 }), 3);
  assert.equal(list.quantityOf('b'), 10);
});
test('no line goes above what the cart can hold', () => {
  list.set(input('a'), 1e9);
  assert.equal(list.quantityOf('a'), MAX_QTY);
  list.step(input('a'), 1);
  assert.equal(list.quantityOf('a'), MAX_QTY);
});
test('the 51st line is refused, and an existing line can still change', () => {
  for (let n = 0; n < MAX_LINES; n++) assert.equal(list.add(input(`p${n}`)), true);
  assert.equal(list.add(input('extra')), false);
  assert.equal(list.quantityOf('extra'), 0);
  assert.equal(list.set(input('p0'), 4), true);
  assert.equal(list.quantityOf('p0'), 4);
});
test('the list survives a reload', () => {
  list.add(input('a'));
  assert.deepEqual(parseState(store.get('shiv_list_v1')!).lines[0], { ...input('a'), q: 1 });
});
test('full or blocked storage keeps the list for this visit and never throws', () => {
  failWrites = true;
  assert.doesNotThrow(() => list.add(input('a')));
  assert.equal(list.quantityOf('a'), 1);
});

test('same rules as the shared code the API trusts', () => {
  for (const [m, s] of [
    [1, 1],
    [10, 5],
    [7, 3],
    [50, 50],
  ] as const) {
    const rules = { minQuantity: m, quantityStep: s };
    const mine = { m, s };
    for (const value of [0, 1, 2, 3, 7, 10, 11, 49, 50, 51, 100]) {
      assert.equal(roundUp(mine, value), roundUpQuantity(rules, value), `round ${m} ${s} ${value}`);
      assert.equal(stepUp(mine, value), sharedUp(rules, value), `up ${m} ${s} ${value}`);
      assert.equal(stepDown(mine, value), sharedDown(rules, value), `down ${m} ${s} ${value}`);
      assert.equal(quantityProblem(rules, roundUp(mine, value)), null);
    }
  }
});

test('tampered storage cannot put a bad link or rate on the page', () => {
  for (const bad of [
    { h: 'javascript:alert(1)' },
    { h: 'https://evil.example/materials/a/b' },
    { h: '//evil.example/materials/a/b' },
    { h: '/materials/a/b"><script>' },
    { h: '/materials/../../etc' },
    { r: -5 },
    { r: 1.5 },
    { r: '100' },
    { m: 0 },
    { s: 0 },
    { m: 1e9 },
    { n: 'x'.repeat(201) },
    { n: '' },
    { i: 42 },
  ])
    assert.equal(validInput({ ...input(), ...bad }), null, JSON.stringify(bad));
});
test('one bad line in storage does not lose the good ones', () => {
  const state = parseState(
    JSON.stringify({
      lines: [
        { ...input('good'), q: 3 },
        { ...input('bad'), h: 'javascript:alert(1)', q: 3 },
        { ...input('negative'), q: -1 },
        { ...input('fraction'), q: 1.5 },
        { ...input('good'), q: 9 },
        null,
        'text',
      ],
    }),
  );
  assert.deepEqual(
    state.lines.map((row) => [row.i, row.q]),
    [['good', 3]],
  );
});
test('storage that is not even JSON reads as empty', () => {
  for (const bad of ['{', 'null', '[]', '"x"', '{"lines":"x"}', '{"lines":{}}'])
    assert.deepEqual(parseState(bad).lines, []);
  assert.deepEqual(parseState(null).lines, []);
});
test('storage holding thousands of lines keeps 50', () => {
  const lines = Array.from({ length: 5000 }, (_, n) => ({ ...input(`p${n}`), q: 1 }));
  assert.equal(parseState(JSON.stringify({ lines })).lines.length, MAX_LINES);
});
test('a tampered hint is dropped, not trusted', () => {
  const lines = [{ ...input('a'), q: 1 }];
  assert.equal(
    parseState(JSON.stringify({ lines, hint: { owner: 'u', lines: { a: -1 } } })).hint,
    null,
  );
  assert.equal(parseState(JSON.stringify({ lines, hint: { owner: 5, lines: {} } })).hint, null);
  assert.equal(parseState(JSON.stringify({ lines, hint: 'x' })).hint, null);
});

const cart = (id: string, quantity: number) => ({ id, quantity, input: input(id) });
test('a guest list joins an empty cart with absolute quantities', () => {
  const { lines, puts } = reconcile([line('a', 3)], null, 'u1', []);
  assert.deepEqual(
    lines.map((row) => row.i),
    ['a'],
  );
  assert.deepEqual(puts, [{ productId: 'a', quantity: 3 }]);
});
test('never double counts: the list says 3, the cart says 5, the answer is 3', () => {
  const { puts } = reconcile([line('a', 3)], null, 'u1', [cart('a', 5)]);
  assert.deepEqual(puts, [{ productId: 'a', quantity: 3 }]);
});
test('sending the same list twice sends nothing the second time', () => {
  const { puts } = reconcile([line('a', 3)], { owner: 'u1', lines: { a: 3 } }, 'u1', [
    cart('a', 3),
  ]);
  assert.deepEqual(puts, []);
});
test('a line added on another phone joins the list', () => {
  const { lines, puts } = reconcile([line('a', 1)], { owner: 'u1', lines: { a: 1 } }, 'u1', [
    cart('a', 1),
    cart('b', 2),
  ]);
  assert.deepEqual(
    lines.map((row) => [row.i, row.q]),
    [
      ['a', 1],
      ['b', 2],
    ],
  );
  assert.deepEqual(puts, []);
});
test('a line taken off here stays off the cart too', () => {
  const { lines, puts } = reconcile([], { owner: 'u1', lines: { a: 1 } }, 'u1', [cart('a', 1)]);
  assert.deepEqual(lines, []);
  assert.deepEqual(puts, [{ productId: 'a', quantity: 0 }]);
});
test('a line seen on the cart, then taken off here, goes with the next list', () => {
  // The hint holds what was on the cart when this browser last read it, not what is on the list.
  const { lines, puts } = reconcile([line('b', 5)], { owner: 'u1', lines: { a: 4 } }, 'u1', [
    cart('a', 4),
  ]);
  assert.deepEqual(
    lines.map((row) => row.i),
    ['b'],
  );
  assert.deepEqual(puts, [
    { productId: 'b', quantity: 5 },
    { productId: 'a', quantity: 0 },
  ]);
});
test('asking about a list takes off exactly what was asked', () => {
  const left = withoutAsked(
    [line('a', 3), line('b', 2)],
    [
      { productId: 'a', quantity: 3 },
      { productId: 'b', quantity: 2 },
    ],
  );
  assert.deepEqual(left, []);
});
test('recovering a lost answer keeps what the customer changed or added since', () => {
  const left = withoutAsked(
    [line('a', 3), line('b', 9), line('c', 1)],
    [
      { productId: 'a', quantity: 3 },
      { productId: 'b', quantity: 2 },
    ],
  );
  assert.deepEqual(
    left.map((row) => [row.i, row.q]),
    [
      ['b', 9],
      ['c', 1],
    ],
  );
});
test('another customer’s hint means nothing on this account', () => {
  const { lines, puts } = reconcile([], { owner: 'someone-else', lines: { a: 1 } }, 'u1', [
    cart('a', 1),
  ]);
  assert.deepEqual(
    lines.map((row) => row.i),
    ['a'],
  );
  assert.deepEqual(puts, []);
});
test('a full list does not grow past 50 from the cart', () => {
  const local = Array.from({ length: MAX_LINES }, (_, n) => line(`p${n}`, 1));
  const { lines } = reconcile(local, null, 'u1', [cart('extra', 1)]);
  assert.equal(lines.length, MAX_LINES);
});

test('taps made before the page was ready are all kept, once each', () => {
  const data = JSON.stringify(input('a'));
  const queue = [
    { line: data, step: null },
    { line: data, step: 1 },
    { line: JSON.stringify(input('b')), step: null },
  ];
  assert.equal(drain(queue), 3);
  assert.equal(queue.length, 0);
  assert.equal(list.quantityOf('a'), 2);
  assert.equal(list.quantityOf('b'), 1);
  assert.equal(drain(queue), 0);
  assert.equal(list.quantityOf('a'), 2);
});
test('a queued tap with bad data is skipped', () => {
  assert.equal(
    drain([
      { line: '{not json', step: null },
      { line: null, step: 1 },
      { line: '{"i":1}', step: null },
    ]),
    0,
  );
  assert.equal(readLine('nope'), null);
});
test('forgetting clears the list and the hint; clearing keeps who it belongs to', () => {
  list.add(input('a'));
  list.replace(list.snapshot().lines, { owner: 'u1', lines: { a: 1 } });
  list.clear();
  assert.deepEqual(list.snapshot(), { lines: [], hint: { owner: 'u1', lines: {} } });
  list.forget();
  assert.deepEqual(list.snapshot(), { lines: [], hint: null });
});
