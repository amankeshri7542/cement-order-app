import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  dayLines,
  emptyMonth,
  markFor,
  monthGrid,
  shiftMonth,
  type DayEventRow,
  type MonthDay,
} from '../src/logic/record';
import { makeTr } from '../src/logic/words';

const hi = makeTr('hinglish');
const row = (extra: Partial<MonthDay>): MonthDay => ({
  day: '2026-11-02',
  status: 'PRESENT',
  firstInAt: null,
  lastOutAt: null,
  minutes: null,
  lateMinutes: 0,
  flags: [],
  ...extra,
});
const event = (extra: Partial<DayEventRow>): DayEventRow => ({
  id: 'e',
  kind: 'IN',
  serverAt: '2026-11-03T03:32:00.000Z',
  claimedAgeMs: null,
  result: 'GREEN',
  reasons: [],
  reason: '',
  correctsKind: null,
  correctedAt: null,
  shopName: 'Main',
  actorName: 'Self',
  byHand: false,
  review: null,
  ...extra,
});

test('each kind of day has its own mark', () => {
  const today = '2026-11-05';
  assert.equal(markFor(row({}), '2026-11-02', today, []), 'present');
  assert.equal(markFor(row({ lateMinutes: 5 }), '2026-11-02', today, []), 'late');
  assert.equal(markFor(row({ status: 'REVIEW' }), '2026-11-02', today, []), 'review');
  assert.equal(markFor(row({ status: 'WEEKLY_OFF' }), '2026-11-02', today, []), 'off');
  assert.equal(markFor(row({ status: 'ABSENT' }), '2026-11-02', today, []), 'absent');
  assert.equal(markFor(undefined, '2026-11-02', today, []), 'absent');
});
test('a weekly off with nothing on it is off, not absent', () => {
  // 1 Nov 2026 is a Sunday.
  assert.equal(markFor(undefined, '2026-11-01', '2026-11-05', [0]), 'off');
});
test('days to come, and today before any scan, carry no mark', () => {
  assert.equal(markFor(undefined, '2026-11-06', '2026-11-05', []), 'none');
  assert.equal(markFor(undefined, '2026-11-05', '2026-11-05', []), 'none');
  assert.equal(markFor(row({ status: 'ABSENT' }), '2026-11-05', '2026-11-05', []), 'none');
});
test('the month lays out on its weekdays', () => {
  const cells = monthGrid('2026-11', [], '2026-11-05', [0]);
  // November 2026 starts on a Sunday: no blanks, and 30 days.
  assert.equal(cells[0]?.date, 1);
  assert.equal(cells.length, 30);
  const october = monthGrid('2026-10', [], '2026-11-05', []);
  // October 2026 starts on a Thursday: four blanks.
  assert.deepEqual(october.slice(0, 4), [null, null, null, null]);
  assert.equal(october[4]?.date, 1);
  assert.equal(october.length, 35);
});
test('a correction shows on the day', () => {
  const cells = monthGrid(
    '2026-11',
    [row({ day: '2026-11-02', flags: ['CORRECTED'] })],
    '2026-11-05',
    [],
  );
  assert.equal(cells[1]?.corrected, true);
});
test('an empty month', () => {
  assert.equal(emptyMonth([]), true);
  assert.equal(emptyMonth([row({})]), false);
});
test('months move across years', () => {
  assert.equal(shiftMonth('2026-01', -1), '2025-12');
  assert.equal(shiftMonth('2026-12', 1), '2027-01');
});

test('a scan reads with its time and shop', () => {
  const [line] = dayLines([event({})], hi);
  assert.equal(line?.title, 'Aaye: 9:02 AM');
  assert.deepEqual(line?.detail, ['Main']);
  assert.equal(line?.tone, 'ok');
});
test('a stale code that was simply scanned again is left out', () => {
  assert.deepEqual(dayLines([event({ result: 'RETRY' })], hi), []);
});
test('a review says where it stands, and rejected stays on record', () => {
  const open = dayLines([event({ review: { status: 'OPEN', note: '' } })], hi)[0]!;
  assert.equal(open.tone, 'amber');
  assert.ok(open.detail.includes('Manager dekh raha hai'));
  const no = dayLines([event({ review: { status: 'REJECTED', note: 'Nahi tha' } })], hi)[0]!;
  assert.ok(no.detail.includes('Manager ne galat maana. Entry record mein rahegi.'));
  assert.ok(no.detail.includes('Nahi tha'));
});
test('an offline scan shows both times', () => {
  const line = dayLines([event({ claimedAgeMs: 3600000 })], hi)[0]!;
  assert.equal(line.title, 'Aaye: 9:02 AM');
  assert.ok(line.detail.includes('Bina internet ke: 8:02 AM par liya'));
});
test('every correction says who made it and why', () => {
  const line = dayLines(
    [
      event({
        kind: 'CORRECTION',
        actorName: 'Test Manager',
        reason: 'Screen band thi',
        correctsKind: 'IN',
        correctedAt: '2026-11-03T03:35:00.000Z',
      }),
    ],
    hi,
  )[0]!;
  assert.equal(line.title, 'Test Manager ne sahi kiya');
  assert.deepEqual(line.detail, ['Aaye: 9:05 AM', 'Wajah: Screen band thi']);
});
test('a mark by hand says who marked it', () => {
  const line = dayLines([event({ kind: 'MANUAL_IN', actorName: 'Test Manager' })], hi)[0]!;
  assert.ok(line.detail.includes('Test Manager ne lagayi'));
});
test('a decision says who decided, and a question is kept', () => {
  assert.equal(
    dayLines([event({ kind: 'DECISION', reasons: ['ACCEPTED'], actorName: 'M' })], hi)[0]!.title,
    'M ne 9:02 AM par sahi maana',
  );
  assert.equal(
    dayLines([event({ kind: 'DECISION', reasons: ['REJECTED'], actorName: 'M' })], hi)[0]!.title,
    'M ne 9:02 AM par galat maana',
  );
  assert.deepEqual(
    dayLines([event({ kind: 'SIGNAL', reason: '2026-11-03: Galat hai' })], hi)[0]!.detail,
    ['2026-11-03: Galat hai'],
  );
});
test('anything unknown is skipped, not shown raw', () => {
  assert.deepEqual(dayLines([event({ kind: 'NEW_KIND' })], hi), []);
});
