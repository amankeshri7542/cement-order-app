import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  answerOf,
  askWords,
  payIsEmpty,
  paymentToAsk,
  rowWords,
  slipLines,
  slipRow,
  slipTitle,
  type MyPay,
  type PayPayment,
} from '../src/logic/paisa';
import type { QueueEntry } from '../src/logic/queue';
import { makeTr } from '../src/logic/words';

const hi = makeTr('hi');
const en = makeTr('en');
const empty: MyPay = {
  monthlyPaise: null,
  advancePaise: 0,
  wagesDuePaise: 0,
  payments: [],
  slips: [],
};
const paid = (extra: Partial<PayPayment> = {}): PayPayment => ({
  id: 'p1',
  kind: 'PAID',
  amountPaise: 1385600,
  channel: 'UPI',
  month: '2026-10',
  at: '2026-11-02T06:00:00.000Z',
  ack: null,
  ...extra,
});
const ackEntry = (id: string, answer: string): QueueEntry => ({
  id: 'k',
  kind: 'payAck',
  method: 'POST',
  path: `staff/me/payments/${id}/ack`,
  body: { answer },
  userId: 'u',
  claimsAge: false,
  mono: 0,
  boot: 1,
  carriedMs: 0,
  rebooted: false,
});

test('someone with no pay set has an empty page, not a broken one', () => {
  assert.equal(payIsEmpty(empty), true);
  assert.equal(payIsEmpty(null), true);
  assert.equal(paymentToAsk(empty, []), null);
  assert.equal(hi('staff.paisa.empty'), 'Abhi yahan koi salary nahi likhi hai.');
});
test('any figure at all makes it not empty', () => {
  assert.equal(payIsEmpty({ ...empty, monthlyPaise: 1500000 }), false);
  assert.equal(payIsEmpty({ ...empty, advancePaise: 1 }), false);
  assert.equal(payIsEmpty({ ...empty, wagesDuePaise: 1 }), false);
  assert.equal(payIsEmpty({ ...empty, payments: [paid()] }), false);
  assert.equal(payIsEmpty({ ...empty, slips: [{ month: '2026-10', netPaise: 1 }] }), false);
});
test('"Mil gaya?" in the words of the plan', () => {
  assert.equal(askWords(paid(), hi), '2 Nov ko ₹13,856 UPI se bheja gaya. Mil gaya?');
  assert.equal(
    askWords(paid({ channel: 'CASH', kind: 'ADVANCE_GIVEN', amountPaise: 200000 }), hi),
    '2 Nov ko ₹2,000 advance cash se diya gaya. Mil gaya?',
  );
  assert.match(askWords(paid(), en), /Did you get it\?$/);
});
test('rows read plainly', () => {
  assert.equal(rowWords(paid(), hi), '2 Nov: ₹13,856, UPI');
  assert.equal(rowWords(paid({ kind: 'ADVANCE_GIVEN' }), hi), '2 Nov: advance ₹13,856, UPI');
});
test('a channel the phone does not know does not print a code', () => {
  assert.doesNotMatch(rowWords(paid({ channel: null }), hi), /null|undefined/);
});
test('asks about the oldest unanswered payment, one at a time', () => {
  const pay = {
    ...empty,
    payments: [paid({ id: 'new' }), paid({ id: 'old' }), paid({ id: 'done', ack: 'GOT' })],
  };
  assert.equal(paymentToAsk(pay, [])?.id, 'old');
});
test('an answer given is not asked again, nor an answer still on the phone', () => {
  assert.equal(paymentToAsk({ ...empty, payments: [paid({ ack: 'GOT' })] }, []), null);
  assert.equal(paymentToAsk({ ...empty, payments: [paid({ ack: 'NOT_GOT' })] }, []), null);
  assert.equal(paymentToAsk({ ...empty, payments: [paid()] }, [ackEntry('p1', 'GOT')]), null);
  const state = answerOf(paid(), [ackEntry('p1', 'NOT_GOT')]);
  assert.deepEqual(state, { answer: 'NOT_GOT', waiting: true });
});
test('an answer for one payment says nothing about another', () => {
  assert.equal(
    paymentToAsk({ ...empty, payments: [paid()] }, [ackEntry('other', 'GOT')])?.id,
    'p1',
  );
});
const slip = {
  month: '2026-10',
  monthlyPaise: 1500000,
  earnedPaise: 1500000,
  deductionsPaise: 0,
  recoveryPaise: 100000,
  roundOffPaise: 0,
  netPaise: 1400000,
  advanceLeftPaise: 300000,
  facts: { daysPresent: 26 },
};
test('a slip reads Bana, Advance kata, Milega', () => {
  const lines = slipLines(slip, hi);
  assert.deepEqual(
    lines.map((line) => [line.label, line.amount]),
    [
      ['Bana', '₹15,000'],
      ['Advance kata', '-₹1,000'],
      ['Milega', '₹14,000'],
      ['Advance baaki', '₹3,000'],
      ['Hazri: 26 din', ''],
    ],
  );
  assert.equal(lines.find((line) => line.big)?.label, 'Milega');
});
test('every addition and cut carries its reason', () => {
  const lines = slipLines(
    {
      ...slip,
      earnedPaise: 1550000,
      adjustments: [
        { kind: 'ADDITION', amountPaise: 50000, reason: 'Diwali' },
        { kind: 'DEDUCTION', amountPaise: 20000, reason: 'Maal kharab' },
      ],
    },
    hi,
  );
  assert.ok(lines.some((line) => line.label === 'Salary' && line.amount === '₹15,000'));
  assert.ok(lines.some((line) => line.label === 'Joda: Diwali' && line.amount === '₹500'));
  assert.ok(lines.some((line) => line.label === 'Kata: Maal kharab' && line.amount === '-₹200'));
});
test('an old slip with no facts still reads', () => {
  const { facts: _facts, ...old } = slip;
  assert.equal(slipLines(old, hi).length, 4);
});
test('round off appears only when there is any', () => {
  assert.ok(!slipLines(slip, hi).some((line) => line.label === 'Round off'));
  assert.ok(
    slipLines({ ...slip, roundOffPaise: 44 }, hi).some((line) => line.label === 'Round off'),
  );
});
test('titles', () => {
  assert.equal(slipTitle('2026-10', hi), 'October 2026 ki slip');
  assert.equal(slipRow({ month: '2026-10', netPaise: 1400000 }, hi), 'October 2026: ₹14,000');
});
