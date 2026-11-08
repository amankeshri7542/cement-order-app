import assert from 'node:assert/strict';
import { test } from 'node:test';
import { makeTr } from '../src/logic/words';
import {
  dayText,
  hoursWords,
  istDay,
  monthText,
  serverNow,
  syncClock,
  timeText,
} from '../src/logic/time';

const hi = makeTr('hinglish');
const en = makeTr('en');
// 3 Nov 2026, 9:02 AM in Patna.
const at = Date.parse('2026-11-03T03:32:00.000Z');

test('server time is read at the middle of the request', () => {
  const base = syncClock('2026-11-03T03:32:00.000Z', 1000, 3000, 7);
  assert.deepEqual(base, { serverMs: at, monoMs: 2000, boot: 7 });
});
test('a reply that is not a time gives no clock at all', () => {
  assert.equal(syncClock('not a date', 1, 2, 7), null);
});
test('the clock moves with the boot clock, and only with it', () => {
  const base = syncClock('2026-11-03T03:32:00.000Z', 1000, 1000, 7);
  assert.equal(serverNow(base, 1000, 7), at);
  assert.equal(serverNow(base, 61000, 7), at + 60000);
});
test('changing the phone clock changes nothing, because it is never read', () => {
  const real = Date.now;
  Date.now = () => 0;
  try {
    const base = syncClock('2026-11-03T03:32:00.000Z', 1000, 1000, 7);
    assert.equal(serverNow(base, 2000, 7), at + 1000);
  } finally {
    Date.now = real;
  }
});
test('after a reboot, or with no base, there is no time to trust', () => {
  const base = syncClock('2026-11-03T03:32:00.000Z', 1000, 1000, 7);
  assert.equal(serverNow(base, 2000, 8), null);
  assert.equal(serverNow(base, 500, 7), null);
  assert.equal(serverNow(null, 2000, 7), null);
});
test('times read in India, whatever the phone is set to', () => {
  assert.equal(timeText(at), '9:02 AM');
  assert.equal(timeText('2026-11-03T13:11:00.000Z'), '6:41 PM');
  assert.equal(timeText('2026-11-03T18:30:00.000Z'), '12:00 AM');
  assert.equal(timeText('2026-11-03T06:30:00.000Z'), '12:00 PM');
});
test('the India day turns over at India midnight', () => {
  assert.equal(istDay(Date.parse('2026-11-03T18:29:59.000Z')), '2026-11-03');
  assert.equal(istDay(Date.parse('2026-11-03T18:30:00.000Z')), '2026-11-04');
});
test('days and months read in both languages', () => {
  assert.equal(dayText('2026-11-03', hi), 'Mangal, 3 Nov');
  assert.equal(dayText('2026-11-03', en), 'Tue, 3 Nov');
  assert.equal(monthText('2026-10', hi), 'October 2026');
});
test('hours in plain words', () => {
  assert.equal(hoursWords(579, hi), '9 ghante 39 minute');
  assert.equal(hoursWords(45, hi), '45 minute');
  assert.equal(hoursWords(120, hi), '2 ghante');
  assert.equal(hoursWords(-5, en), '0 minutes');
});
