import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { priceLine, type PriceRuleInput } from './pricing';

const rule = (id: string, rest: Partial<PriceRuleInput>): PriceRuleInput => ({
  id,
  kind: 'SLAB',
  productId: null,
  categoryId: null,
  minQuantity: 1,
  groupId: null,
  customerId: null,
  valueType: 'RATE',
  value: 30000,
  startsOn: null,
  endsOn: null,
  active: true,
  stacks: false,
  ...rest,
});
const line = (rules: PriceRuleInput[], rest: Partial<Parameters<typeof priceLine>[0]> = {}) =>
  priceLine({
    listPaise: 40000,
    quantity: 100,
    productId: 'ultratech',
    categoryId: 'cement',
    customerId: 'ramesh',
    groupId: 'regular',
    day: '2026-11-10',
    rules,
    ...rest,
  });

describe('how a rate is worked out', () => {
  test('with no rules it is the list rate', () => {
    assert.deepEqual(line([]), { pricePaise: 40000, ruleId: null, ruleKind: null });
  });
  test('a slab applies from its quantity, and not one bag below', () => {
    const slab = rule('s', { minQuantity: 100, productId: 'ultratech', value: 39000 });
    assert.equal(line([slab], { quantity: 100 }).pricePaise, 39000);
    assert.equal(line([slab], { quantity: 99 }).pricePaise, 40000);
  });
  test('a rule for another product or category does nothing', () => {
    assert.equal(line([rule('a', { productId: 'acc' })]).pricePaise, 40000);
    assert.equal(
      line([rule('a', { categoryId: 'sand', valueType: 'AMOUNT_OFF', value: 100 })]).pricePaise,
      40000,
    );
  });
  test('a category rule reaches every product in it', () => {
    const off = rule('c', { categoryId: 'cement', valueType: 'AMOUNT_OFF', value: 1000 });
    assert.equal(line([off]).pricePaise, 39000);
  });
  test('a group rate only for that group, and a special rate only for that customer', () => {
    const group = rule('g', {
      kind: 'GROUP',
      groupId: 'contractor',
      valueType: 'AMOUNT_OFF',
      value: 500,
    });
    assert.equal(line([group]).pricePaise, 40000);
    assert.equal(line([group], { groupId: 'contractor' }).pricePaise, 39500);
    assert.equal(line([group], { groupId: null }).pricePaise, 40000);
    const special = rule('p', {
      kind: 'SPECIAL',
      customerId: 'ramesh',
      value: 38000,
      productId: 'ultratech',
    });
    assert.equal(line([special]).pricePaise, 38000);
    assert.equal(line([special], { customerId: 'someone' }).pricePaise, 40000);
    assert.equal(line([special], { customerId: null }).pricePaise, 40000);
  });
  test('a group or special rule naming nobody reaches nobody', () => {
    assert.equal(
      line([rule('x', { kind: 'GROUP', groupId: null, value: 1 })], { groupId: null }).pricePaise,
      40000,
    );
    assert.equal(
      line([rule('x', { kind: 'SPECIAL', customerId: null, value: 1 })], { customerId: null })
        .pricePaise,
      40000,
    );
  });
  test('takes the lowest of slab, group and special, and says which', () => {
    const rules = [
      rule('slab', { productId: 'ultratech', value: 39000 }),
      rule('group', { kind: 'GROUP', groupId: 'regular', productId: 'ultratech', value: 38500 }),
      rule('special', {
        kind: 'SPECIAL',
        customerId: 'ramesh',
        productId: 'ultratech',
        value: 39500,
      }),
    ];
    assert.deepEqual(line(rules), { pricePaise: 38500, ruleId: 'group', ruleKind: 'GROUP' });
  });
  test('an offer applies only if lower, and does not add on top', () => {
    const special = rule('special', {
      kind: 'SPECIAL',
      customerId: 'ramesh',
      productId: 'ultratech',
      value: 38000,
    });
    const small = rule('offer', {
      kind: 'OFFER',
      valueType: 'AMOUNT_OFF',
      value: 1000,
      categoryId: 'cement',
    });
    assert.deepEqual(line([special, small]), {
      pricePaise: 38000,
      ruleId: 'special',
      ruleKind: 'SPECIAL',
    });
    const big = rule('offer', {
      kind: 'OFFER',
      valueType: 'AMOUNT_OFF',
      value: 5000,
      categoryId: 'cement',
    });
    assert.deepEqual(line([special, big]), {
      pricePaise: 35000,
      ruleId: 'offer',
      ruleKind: 'OFFER',
    });
  });
  test('an offer adds on top only where an owner allowed it', () => {
    const special = rule('special', {
      kind: 'SPECIAL',
      customerId: 'ramesh',
      productId: 'ultratech',
      value: 38000,
    });
    const stacked = rule('offer', {
      kind: 'OFFER',
      valueType: 'AMOUNT_OFF',
      value: 1000,
      categoryId: 'cement',
      stacks: true,
    });
    assert.equal(line([special, stacked]).pricePaise, 37000);
  });
  test('starts and ends on the named day in India, inclusive at both ends', () => {
    const offer = rule('o', {
      kind: 'OFFER',
      startsOn: '2026-11-10',
      endsOn: '2026-11-12',
      productId: 'ultratech',
      value: 39000,
    });
    for (const [day, price] of [
      ['2026-11-09', 40000],
      ['2026-11-10', 39000],
      ['2026-11-12', 39000],
      ['2026-11-13', 40000],
    ] as const)
      assert.equal(line([offer], { day }).pricePaise, price, day);
  });
  test('a switched-off rule does nothing', () => {
    assert.equal(line([rule('o', { active: false, productId: 'ultratech' })]).pricePaise, 40000);
  });
  test('a rule above the list never raises the rate', () => {
    assert.equal(line([rule('o', { productId: 'ultratech', value: 90000 })]).pricePaise, 40000);
  });
  test('percent is exact and rounds in the shop’s favour, in whole paise', () => {
    const percent = (value: number, listPaise: number) =>
      line([rule('p', { categoryId: 'cement', valueType: 'PERCENT_OFF', value })], { listPaise })
        .pricePaise;
    assert.equal(percent(1000, 40000), 36000);
    assert.equal(percent(250, 40000), 39000);
    assert.equal(percent(1000, 33333), 30000);
    assert.equal(percent(3333, 100), 67);
    for (const value of [1, 7, 33, 250, 9000]) assert.ok(Number.isInteger(percent(value, 39999)));
  });
  test('an amount off bigger than the rate does not apply: goods are never nearly free', () => {
    const off = rule('a', { categoryId: 'cement', valueType: 'AMOUNT_OFF', value: 99999999 });
    assert.deepEqual(line([off]), { pricePaise: 40000, ruleId: null, ruleKind: null });
    const exact = rule('a', { categoryId: 'cement', valueType: 'AMOUNT_OFF', value: 40000 });
    assert.equal(line([exact]).pricePaise, 40000);
    const offer = rule('o', {
      kind: 'OFFER',
      categoryId: 'cement',
      valueType: 'AMOUNT_OFF',
      value: 99999999,
    });
    assert.equal(line([offer]).pricePaise, 40000);
  });
  test('a stacked offer that would reach nothing on a rate still works from the list, or not at all', () => {
    const special = rule('s', {
      kind: 'SPECIAL',
      customerId: 'ramesh',
      valueType: 'RATE',
      value: 35000,
    });
    const offer = rule('o', {
      kind: 'OFFER',
      categoryId: 'cement',
      valueType: 'AMOUNT_OFF',
      value: 36000,
      stacks: true,
    });
    assert.equal(line([special, offer], { customerId: 'ramesh' }).pricePaise, 4000);
  });
  test('does not depend on the order rules arrive in', () => {
    const a = rule('a', { productId: 'ultratech', value: 39000 });
    const b = rule('b', { productId: 'ultratech', value: 39000 });
    assert.deepEqual(line([a, b]), line([b, a]));
    assert.equal(line([b, a]).ruleId, 'a');
  });
  test('handles very large quantities without changing the per-unit rate', () => {
    const slab = rule('s', { minQuantity: 1000000, productId: 'ultratech', value: 39000 });
    assert.equal(line([slab], { quantity: 1_000_000 }).pricePaise, 39000);
  });
});

describe('for any mix of rules', () => {
  // A small fixed generator, so a failure repeats.
  let seed = 20261104;
  const next = (below: number) => {
    seed = (seed * 1664525 + 1013904223) % 4294967296;
    return seed % below;
  };
  const pick = <T>(list: readonly T[]) => list[next(list.length)]!;
  const randomRule = (index: number): PriceRuleInput => {
    const valueType = pick(['RATE', 'PERCENT_OFF', 'AMOUNT_OFF'] as const);
    return rule(`r${index}`, {
      kind: pick(['SLAB', 'GROUP', 'SPECIAL', 'OFFER'] as const),
      productId: pick([null, 'ultratech', 'acc']),
      categoryId: pick([null, 'cement', 'sand']),
      minQuantity: pick([1, 2, 50, 100, 1000]),
      groupId: pick([null, 'regular', 'contractor']),
      customerId: pick([null, 'ramesh', 'other']),
      valueType,
      value: valueType === 'PERCENT_OFF' ? 1 + next(9000) : 1 + next(100000),
      startsOn: pick([null, '2026-11-01', '2026-11-10', '2026-12-01']),
      endsOn: pick([null, '2026-11-09', '2026-11-10', '2026-12-31']),
      active: next(5) > 0,
      stacks: next(3) === 0,
    });
  };
  test('a rate is whole, at least one paisa, never above list, and repeatable', () => {
    for (let round = 0; round < 3000; round++) {
      const rules = Array.from({ length: next(6) }, (_, index) => randomRule(index));
      const input = {
        listPaise: 1 + next(200000),
        quantity: 1 + next(2000),
        productId: pick(['ultratech', 'acc']),
        categoryId: pick(['cement', 'sand']),
        customerId: pick([null, 'ramesh', 'other']),
        groupId: pick([null, 'regular', 'contractor']),
        day: pick(['2026-10-31', '2026-11-10', '2027-01-01']),
        rules,
      };
      const first = priceLine(input);
      assert.ok(Number.isInteger(first.pricePaise), 'whole paise');
      assert.ok(first.pricePaise >= 1, 'at least one paisa');
      assert.ok(first.pricePaise <= input.listPaise, 'never above list');
      assert.deepEqual(priceLine({ ...input, rules: [...rules].reverse() }), first);
      if (first.ruleId === null) assert.equal(first.pricePaise, input.listPaise);
    }
  });
  test('adding a rule can only keep a rate or lower it', () => {
    for (let round = 0; round < 1000; round++) {
      const rules = Array.from({ length: 1 + next(4) }, (_, index) => randomRule(index));
      const input = {
        listPaise: 1 + next(200000),
        quantity: 1 + next(2000),
        productId: 'ultratech',
        categoryId: 'cement',
        customerId: 'ramesh',
        groupId: 'regular',
        day: '2026-11-10',
      };
      const without = priceLine({ ...input, rules });
      const added = priceLine({ ...input, rules: [...rules, randomRule(99)] });
      assert.ok(added.pricePaise <= without.pricePaise);
    }
  });
});
