import assert from 'node:assert/strict';
import { test } from 'node:test';
import { t as translate, type MessageKey, type Params } from '@shiv/i18n';
import {
  actorOf,
  datesOf,
  minuteTop,
  moneyScale,
  nameOf,
  sentence,
  shortMoney,
  tickText,
  unitWord,
  waitText,
  type LogEntry,
} from './report-helpers';

const hinglish = (key: MessageKey, params?: Params) => translate(key, params, 'hinglish');
const lakh = (value: number) => value * 100000 * 100;
const entry = (fields: Partial<LogEntry>): LogEntry => ({
  actorId: 'someone',
  event: 'ORDER_CONFIRMED',
  details: {},
  actorName: 'Papa',
  entityLabel: '',
  customerName: '',
  ...fields,
});

test('ranges end today and start on the right day, across a month and a year', () => {
  assert.deepEqual(datesOf('7', '2026-11-04'), { from: '2026-10-29', to: '2026-11-04' });
  assert.deepEqual(datesOf('30', '2026-11-04'), { from: '2026-10-06', to: '2026-11-04' });
  assert.deepEqual(datesOf('7', '2027-01-03'), { from: '2026-12-28', to: '2027-01-03' });
  assert.deepEqual(datesOf('month', '2026-11-04'), { from: '2026-11-01', to: '2026-11-04' });
  assert.deepEqual(datesOf('month', '2026-11-01'), { from: '2026-11-01', to: '2026-11-01' });
});

test('axis ticks read the way a shopkeeper says them', () => {
  assert.equal(shortMoney(0), '0');
  assert.equal(shortMoney(5000 * 100), '₹5K');
  assert.equal(shortMoney(lakh(2)), '₹2L');
  assert.equal(shortMoney(lakh(100)), '₹1Cr');
});

test('lines sit at each lakh until that would make more than five', () => {
  assert.deepEqual(moneyScale(lakh(3.2)).lines, [0, lakh(1), lakh(2), lakh(3), lakh(4)]);
  assert.equal(moneyScale(lakh(1)).step, lakh(1));
  assert.equal(moneyScale(lakh(5)).step, lakh(1));
  assert.equal(moneyScale(lakh(5.5)).step, lakh(2));
  assert.equal(moneyScale(lakh(30)).step, lakh(10));
});

test('a small day gets smaller lines, and an empty or negative one never divides by zero', () => {
  assert.equal(moneyScale(40000 * 100).step, 10000 * 100);
  assert.equal(moneyScale(200 * 100).step, 1000 * 100);
  for (const value of [0, -500]) {
    const scale = moneyScale(value);
    assert.ok(scale.top > 0);
    assert.deepEqual(scale.lines, [0, scale.top]);
  }
});

test('the top line always clears the tallest day, however big the days get', () => {
  for (const value of [1, 99999, lakh(1), lakh(4.99), lakh(77), lakh(90000)])
    assert.ok(moneyScale(value).top >= value, String(value));
});

test('waits read in plain words, on each side of an hour', () => {
  assert.equal(waitText(0.4, hinglish), '1 min se kam');
  assert.equal(waitText(7, hinglish), '7 min');
  assert.equal(waitText(59.6, hinglish), '1 ghante 0 min');
  assert.equal(waitText(125, hinglish), '2 ghante 5 min');
});

test('the wait chart has a round top, and short ticks', () => {
  assert.equal(minuteTop(0), 10);
  assert.equal(minuteTop(7), 10);
  assert.equal(minuteTop(30), 30);
  assert.equal(minuteTop(31), 60);
  assert.equal(minuteTop(5000), 5000);
  assert.equal(tickText(0, hinglish), '0');
  assert.equal(tickText(30, hinglish), '30 min');
  assert.equal(tickText(120, hinglish), '2 ghante');
});

test('a bag is a bori in Hinglish and nothing turns into another script', () => {
  assert.equal(unitWord('bag', 'hinglish'), 'bori');
  assert.equal(unitWord('Bags', 'hinglish'), 'bori');
  assert.equal(unitWord('50 kg bag', 'hinglish'), '50 kg bori');
  assert.equal(unitWord('cu ft', 'hinglish'), 'cu ft');
  assert.equal(unitWord('bag', 'en'), 'bag');
  assert.doesNotMatch(unitWord('kg', 'hinglish'), /[ऀ-ॿ]/);
});

test('the log says the sentence from the plan, with the customer and the order', () => {
  assert.equal(
    sentence(entry({ customerName: 'Ramesh Yadav', entityLabel: 'SC-2192' }), hinglish),
    'Ramesh Yadav ka order pakka kiya, SC-2192',
  );
});

test('a customer with no name is still a customer, in words', () => {
  assert.equal(
    sentence(entry({ entityLabel: 'SC-1' }), hinglish),
    'Grahak ka order pakka kiya, SC-1',
  );
  assert.equal(
    sentence(entry({ event: 'CUSTOMER_NOTE_ADDED', entityLabel: 'Customer' }), hinglish),
    'Grahak par note likha, Grahak',
  );
});

test('money shows without its sign, because the sentence already says which way it went', () => {
  assert.equal(
    sentence(
      entry({
        event: 'KHATA_PAYMENT_RECEIVED',
        details: { amountPaise: -500000 },
        entityLabel: 'Ramesh',
      }),
      hinglish,
    ),
    'Udhaar ka ₹5,000.00 liya, Ramesh',
  );
});

test('an event the desk has no words for yet never shows its name', () => {
  const said = sentence(entry({ event: 'SOMETHING_NEW_LATER' }), hinglish);
  assert.equal(said, 'Kuch aur kiya');
  assert.doesNotMatch(said, /SOMETHING|_/);
});

test('odd details cannot break a sentence', () => {
  for (const details of [null, {}, { amountPaise: 'lots' }])
    assert.doesNotMatch(sentence(entry({ details, event: 'COD_RECEIVED' }), hinglish), /\{/);
});

test('people show by name, and machines by the name the plan gives them', () => {
  assert.equal(actorOf(entry({ actorName: 'Ramesh' }), hinglish), 'Ramesh');
  assert.equal(actorOf(entry({ actorName: '', actorId: 'whatsapp' }), hinglish), 'WhatsApp AI');
  assert.equal(actorOf(entry({ actorName: 'Setup', actorId: 'seed' }), hinglish), 'Setup');
  assert.equal(actorOf(entry({ actorName: 'Customer' }), hinglish), 'Grahak');
  assert.equal(actorOf(entry({ actorName: '', actorId: 'cuid123' }), hinglish), 'Koi');
  assert.equal(nameOf('constructor', hinglish), 'constructor');
});
