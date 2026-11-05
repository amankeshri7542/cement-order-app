import assert from 'node:assert/strict';
import { test } from 'node:test';
import { dayText, isToday, plural, rupees, timeText } from './format';

test('rupees use Indian grouping and hide paise only when there are none', () => {
  assert.equal(rupees(41000), '₹410');
  assert.equal(rupees(11169000), '₹1,11,690');
  assert.equal(rupees(100), '₹1');
  assert.equal(rupees(12345), '₹123.45');
});
test('a bad amount never prints', () => {
  for (const bad of [-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, 2 ** 60])
    assert.throws(() => rupees(bad));
});
test('dates and times are Patna’s, whatever the server clock', () => {
  assert.equal(timeText('2026-11-05T04:10:00.000Z'), '9:40 AM');
  assert.equal(timeText('2026-11-05T12:40:00.000Z'), '6:10 PM');
  const now = new Date('2026-11-05T04:00:00.000Z');
  assert.equal(dayText('2026-11-05T19:00:00.000Z', now), '6 November');
  assert.equal(dayText('2025-11-05T04:00:00.000Z', now), '5 November 2025');
});
test('isToday works across midnight in Patna', () => {
  const now = new Date('2026-11-05T19:00:00.000Z'); // 00:30 on the 6th
  assert.equal(isToday('2026-11-05T18:40:00.000Z', now), true);
  assert.equal(isToday('2026-11-05T18:20:00.000Z', now), false);
});
test('nonsense dates say nothing rather than Invalid Date', () => {
  assert.equal(dayText('not a date'), '');
  assert.equal(timeText('not a date'), '');
  assert.equal(isToday('not a date'), false);
});
test('counts read properly', () => {
  assert.equal(plural(1, 'line'), '1 line');
  assert.equal(plural(3, 'line'), '3 lines');
});
