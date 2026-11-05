import assert from 'node:assert/strict';
import { test } from 'node:test';
import { hi } from '@shiv/i18n';
import {
  adjustmentRows,
  cashDayLimitPaise,
  currentMonth,
  ledgerWords,
  monthChoices,
  monthName,
  overCashLimit,
  paidAnswer,
  paiseOf,
  previousMonth,
  readSource,
  recoveryReason,
  sourceValue,
} from './pure';
import type { Adjustment } from './types';

const november = new Date('2026-11-05T06:00:00Z');

test('money typed in rupees becomes paise, and nonsense is nothing', () => {
  assert.equal(paiseOf('15000'), 1500000);
  assert.equal(paiseOf('15000.50'), 1500050);
  assert.equal(paiseOf('0'), 0);
  for (const bad of ['', '  ', 'abc', '-5', '1.234']) assert.equal(paiseOf(bad), null, bad);
});

test('months count back from this one, across a new year', () => {
  assert.equal(currentMonth(november), '2026-11');
  assert.equal(previousMonth(november), '2026-10');
  assert.equal(previousMonth(new Date('2026-01-10T06:00:00Z')), '2025-12');
  const choices = monthChoices(new Date('2026-02-10T06:00:00Z'), 4);
  assert.deepEqual(choices, ['2026-02', '2026-01', '2025-12', '2025-11']);
  assert.equal(monthName('2026-09'), 'September 2026');
});
test('the month turns over at midnight in Patna, not in London', () => {
  assert.equal(currentMonth(new Date('2026-10-31T19:00:00Z')), '2026-11');
});

const entry = (extra: object) => ({
  kind: 'PAID',
  channel: 'CASH',
  amountPaise: 400000,
  at: '2026-11-05T04:00:00Z',
  reversed: false,
  reversesId: null,
  ...extra,
});
test('cash above the day’s line warns, counting what was already given today', () => {
  assert.equal(overCashLimit(cashDayLimitPaise, 'CASH', [], november), false);
  assert.equal(overCashLimit(cashDayLimitPaise + 1, 'CASH', [], november), true);
  assert.equal(overCashLimit(700000, 'CASH', [entry({})], november), true);
  assert.equal(overCashLimit(600000, 'CASH', [entry({})], november), false);
  assert.equal(overCashLimit(700000, 'CASH', [entry({ kind: 'ADVANCE_GIVEN' })], november), true);
});
test('only today’s cash that still stands counts', () => {
  for (const other of [
    entry({ channel: 'UPI' }),
    entry({ at: '2026-11-04T04:00:00Z' }),
    entry({ reversed: true }),
    entry({ kind: 'REVERSAL', reversesId: 'x' }),
    entry({ kind: 'EARNED' }),
  ])
    assert.equal(overCashLimit(700000, 'CASH', [other], november), false);
});
test('UPI and an empty box never warn', () => {
  assert.equal(overCashLimit(5000000, 'UPI', [], november), false);
  assert.equal(overCashLimit(null, 'CASH', [], november), false);
  assert.equal(overCashLimit(0, 'CASH', [], november), false);
});

const line = (extra: Partial<Adjustment>): Adjustment => ({
  id: 'a',
  kind: 'ADDITION',
  amountPaise: 100,
  reason: 'Bonus',
  reversesId: null,
  live: true,
  at: '2026-11-05T04:00:00Z',
  ...extra,
});
test('a line taken back stays on the page, beside what took it back', () => {
  const rows = adjustmentRows([
    line({ id: 'a', live: false }),
    line({ id: 'b', kind: 'DEDUCTION', reason: 'Nuksan' }),
    line({ id: 'c', kind: 'REVERSAL', reversesId: 'a', reason: 'Galti', live: false }),
    line({ id: 'd', kind: 'RECOVERY_SET', reason: 'Kam karo' }),
  ]);
  assert.deepEqual(
    rows.map((row) => row.id),
    ['a', 'b'],
  );
  assert.equal(rows[0]!.takenBack?.reason, 'Galti');
  assert.equal(rows[1]!.takenBack, null);
});
test('the last word on recovery is the one that stands', () => {
  assert.equal(recoveryReason([]), '');
  assert.equal(
    recoveryReason([
      line({ kind: 'RECOVERY_SET', reason: 'Pehle' }),
      line({ kind: 'RECOVERY_SET', reason: 'Baad mein' }),
    ]),
    'Baad mein',
  );
});

test('every kind of ledger entry has words', () => {
  for (const key of Object.values(ledgerWords)) assert.ok(hi[key], key);
});
test('where money came from is one value, and reads back the same', () => {
  assert.equal(sourceValue({ paidFrom: 'OWNER' }), 'OWNER');
  assert.deepEqual(readSource('OWNER'), { paidFrom: 'OWNER' });
  assert.equal(sourceValue({ paidFrom: 'GALLA', locationId: 'loc_main' }), 'GALLA:loc_main');
  assert.deepEqual(readSource('GALLA:loc_main'), { paidFrom: 'GALLA', locationId: 'loc_main' });
});

const paid = (ack: 'GOT' | 'NOT_GOT' | null, extra: object = {}) => ({
  kind: 'PAID',
  month: '2026-09',
  reversed: false,
  ack,
  ...extra,
});
test('the month’s answer: not received outranks all, and no payment asks nothing', () => {
  assert.equal(paidAnswer([], '2026-09'), null);
  assert.equal(paidAnswer([paid('GOT')], '2026-09'), 'GOT');
  assert.equal(paidAnswer([paid('GOT'), paid(null)], '2026-09'), 'NONE');
  assert.equal(paidAnswer([paid('GOT'), paid('NOT_GOT'), paid(null)], '2026-09'), 'NOT_GOT');
});
test('another month, an advance, or a payment taken back does not count', () => {
  assert.equal(paidAnswer([paid('NOT_GOT', { month: '2026-08' })], '2026-09'), null);
  assert.equal(paidAnswer([paid('NOT_GOT', { kind: 'ADVANCE_GIVEN' })], '2026-09'), null);
  assert.equal(paidAnswer([paid('NOT_GOT', { reversed: true })], '2026-09'), null);
});
