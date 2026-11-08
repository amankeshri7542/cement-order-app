import assert from 'node:assert/strict';
import { test } from 'node:test';
import { en, hinglish } from '@shiv/i18n';
import { attendanceProblems, offlineAfterMs, type DayStatus } from '@shiv/shared';
import {
  correctionProblem,
  dayBounds,
  distanceText,
  flagCodes,
  flagKey,
  istMinute,
  minuteOf,
  reasonCodes,
  reasonLines,
  stamp,
  statusKey,
  timeOf,
  wasOffline,
} from './words';

const facts = (extra: object) => ({
  serverAt: '2026-11-05T04:00:00.000Z',
  claimedAgeMs: null,
  qrShownAt: null,
  distanceM: null,
  reasons: [],
  ...extra,
});
const said = (key: string, params: Record<string, string | number> = {}) =>
  Object.entries(params).reduce(
    (text, [name, value]) => text.replace(`{${name}}`, String(value)),
    hinglish[key as keyof typeof hinglish],
  );

test('every code a scan or a card can carry has words in both catalogues', () => {
  const expected = [
    'MOCKED',
    'LOCATION_OFF',
    'APPROXIMATE',
    'FAR',
    'OTHER_SHOP',
    'IMPOSSIBLE_TRAVEL',
    'OFFLINE',
    'OLD_QR',
    'MANY_WEAK',
    'WEAK_FIX',
    'NO_PIN',
    'NO_IN',
    'TIME_MISMATCH',
    'QUERY',
    'BY_HAND',
    ...attendanceProblems.map((problem) => `PROBLEM_${problem}`),
  ];
  assert.deepEqual([...reasonCodes].sort(), expected.sort());
  for (const code of reasonCodes) {
    const [line] = reasonLines(facts({ reasons: [code], distanceM: 1200 }), 'hinglish');
    assert.ok(line, code);
    assert.ok(hinglish[line.key], code);
    assert.ok(en[line.key], code);
  }
});

test('a far scan with a fresh code reads as the owners say it', () => {
  const [line] = reasonLines(facts({ reasons: ['FAR'], distanceM: 1200 }), 'hinglish');
  assert.equal(said(line!.key, line!.params), 'Fresh QR, lekin dukaan se door, 1.2 km');
  const [old] = reasonLines(facts({ reasons: ['FAR', 'OLD_QR'], distanceM: 400 }), 'hinglish');
  assert.equal(said(old!.key, old!.params), 'Dukaan se door, 400 m');
});

test('a fake-location mark and a clock mismatch read plainly', () => {
  const [mock] = reasonLines(facts({ reasons: ['MOCKED'] }), 'hinglish');
  assert.equal(said(mock!.key), 'Apna phone. Nakli location ka nishan mila.');
  const lines = reasonLines(
    facts({ reasons: ['TIME_MISMATCH'], qrShownAt: '2026-11-05T03:30:00.000Z' }),
    'hinglish',
  );
  assert.equal(said(lines[0]!.key), 'Phone ka time aur QR ka time alag hain.');
  assert.equal(said(lines[1]!.key, lines[1]!.params), 'Yeh QR 09:00 par screen par tha.');
});

test('an offline scan shows both times', () => {
  const [line] = reasonLines(
    facts({
      reasons: ['OFFLINE'],
      serverAt: '2026-11-05T06:00:00.000Z',
      claimedAgeMs: 2 * 3600000,
    }),
    'hinglish',
  );
  assert.equal(
    said(line!.key, line!.params),
    'Internet ke bina scan hua. Phone par 09:30, server par 11:30.',
  );
});

test('an offline scan carried over midnight says which day each time was', () => {
  const [line] = reasonLines(
    facts({
      reasons: ['OFFLINE'],
      serverAt: '2026-11-05T04:00:00.000Z',
      claimedAgeMs: 24 * 3600000,
    }),
    'hinglish',
  );
  assert.match(String(line!.params!.taken), /4 Nov/);
  assert.match(String(line!.params!.server), /5 Nov/);
  assert.equal(stamp('2026-11-05T04:00:00Z', '2026-11-05T06:00:00Z', 'hinglish'), '09:30');
});

test('a code nobody has words for never reaches the page as a code', () => {
  const lines = reasonLines(facts({ reasons: ['SOMETHING_NEW', 'ANOTHER_NEW'] }), 'hinglish');
  assert.equal(lines.length, 1);
  assert.equal(lines[0]!.key, 'owner.hazri.why.other');
});

test('the same finding is said once', () => {
  assert.equal(reasonLines(facts({ reasons: ['MOCKED', 'MOCKED'] }), 'hinglish').length, 1);
});

test('nothing on a card, flag or status accuses anybody', () => {
  const accusing =
    /\b(chor|chori|fraud|dhokha|dhokhebaaz|jhooth|jhootha|theft|cheat|cheating|shortage|fine|penalty)\b/i;
  for (const [key, value] of [...Object.entries(hinglish), ...Object.entries(en)])
    if (/^owner\.(hazri|cash|trips|screen|salary)\./.test(key))
      assert.doesNotMatch(value, accusing, key);
});

test('every flag and status has words, and today a missing way out only means still at work', () => {
  for (const flag of flagCodes) assert.ok(hinglish[flagKey(flag, false)!], flag);
  assert.equal(flagKey('NO_OUT', true), 'owner.hazri.flag.stillHere');
  assert.equal(flagKey('NO_OUT', false), 'owner.hazri.flag.NO_OUT');
  assert.equal(flagKey('toString', false), null);
  assert.equal(flagKey('UNKNOWN', false), null);
  for (const status of ['PRESENT', 'REVIEW', 'ABSENT', 'WEEKLY_OFF'] as DayStatus[])
    assert.ok(hinglish[statusKey[status]]);
});

test('distance reads in metres, then kilometres', () => {
  assert.equal(distanceText(0), '0 m');
  assert.equal(distanceText(999), '999 m');
  assert.equal(distanceText(1000), '1.0 km');
  assert.equal(distanceText(2140), '2.1 km');
});

test('offline means older than a slow network explains', () => {
  assert.equal(wasOffline(null), false);
  assert.equal(wasOffline(offlineAfterMs), false);
  assert.equal(wasOffline(offlineAfterMs + 1), true);
});

test('clock times turn into minutes and back, and nonsense does not', () => {
  assert.equal(minuteOf('09:30'), 570);
  assert.equal(minuteOf('00:00'), 0);
  assert.equal(minuteOf('23:59'), 1439);
  for (const bad of ['', '24:00', '9:30', '09:60', 'abc']) assert.equal(minuteOf(bad), null, bad);
  assert.equal(timeOf(570), '09:30');
  assert.equal(timeOf(1440), '23:59');
  assert.equal(timeOf(-5), '00:00');
  assert.equal(istMinute('2026-11-05T04:00:00.000Z'), 570);
});

const fix = (extra: object) => ({
  corrects: 'IN' as const,
  minute: 540,
  day: '2026-11-04',
  now: new Date('2026-11-05T06:00:00Z'),
  firstInAt: null,
  lastOutAt: null,
  ...extra,
});
test('a correction cannot be in the future', () => {
  assert.equal(correctionProblem(fix({ day: '2026-11-06' })), 'owner.hazri.fix.future');
  assert.equal(
    correctionProblem(fix({ day: '2026-11-05', minute: 700 })),
    'owner.hazri.fix.future',
  );
  assert.equal(correctionProblem(fix({ day: '2026-11-05', minute: 680 })), null);
});
test('a correction cannot put going home before arriving, or the other way', () => {
  const firstInAt = '2026-11-04T04:00:00Z';
  const lastOutAt = '2026-11-04T12:00:00Z';
  assert.equal(
    correctionProblem(fix({ corrects: 'OUT', minute: 500, firstInAt })),
    'owner.hazri.fix.outBeforeIn',
  );
  assert.equal(correctionProblem(fix({ corrects: 'OUT', minute: 600, firstInAt })), null);
  assert.equal(
    correctionProblem(fix({ corrects: 'IN', minute: 1200, lastOutAt })),
    'owner.hazri.fix.inAfterOut',
  );
  assert.equal(correctionProblem(fix({ corrects: 'IN', minute: 600, lastOutAt })), null);
  assert.equal(correctionProblem(fix({ minute: null })), 'owner.hazri.fix.needTime');
});

const event = (kind: string, serverAt: string, extra: object = {}) => ({
  kind,
  serverAt,
  result: 'GREEN',
  correctsKind: null,
  correctedAt: null,
  review: null,
  ...extra,
});
test('the day’s two ends come from the record, with corrections counted and retries not', () => {
  assert.deepEqual(dayBounds([]), { firstInAt: null, lastOutAt: null });
  assert.deepEqual(
    dayBounds([
      event('IN', 'a', { result: 'RETRY' }),
      event('IN', 'b'),
      event('OUT', 'c', { review: { status: 'REJECTED' } }),
      event('MANUAL_OUT', 'd'),
    ]),
    { firstInAt: 'b', lastOutAt: 'd' },
  );
  assert.deepEqual(
    dayBounds([
      event('IN', 'b'),
      event('CORRECTION', 'x', { correctsKind: 'IN', correctedAt: 'one' }),
      event('CORRECTION', 'y', { correctsKind: 'IN', correctedAt: 'two' }),
    ]),
    { firstInAt: 'two', lastOutAt: null },
  );
});
