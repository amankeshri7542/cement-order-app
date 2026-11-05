import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  distanceMeters,
  impossibleTravel,
  placeOf,
  punchVerdict,
  qrCounter,
  qrFresh,
  qrMsLeft,
  summarizeDay,
  type DayEvent,
} from './attendance';

const fine = {
  qrFresh: true,
  place: 'INSIDE' as const,
  location: 'OK' as const,
  mocked: false,
  assignedHere: true,
  offline: false,
  impossibleTravel: false,
  weakFixesThisWeek: 0,
  noPin: false,
};
const at = (day: string, time: string) => new Date(`${day}T${time}:00+05:30`);
const event = (kind: DayEvent['kind'], when: Date, extra: Partial<DayEvent> = {}): DayEvent => ({
  id: `${kind}-${when.getTime()}`,
  kind,
  serverAt: when,
  locationId: 'shop',
  result: 'GREEN',
  review: null,
  ...extra,
});
const shift = { startMinute: 540, endMinute: 1140, breakMinutes: 60, weeklyOffs: [0] };

describe('the code on the wall', () => {
  test('changes every 20 seconds', () => {
    assert.equal(qrCounter(0), 0);
    assert.equal(qrCounter(19_999), 0);
    assert.equal(qrCounter(20_000), 1);
  });
  test('stays good for about a minute, and a little ahead for clock drift', () => {
    const now = 1_000_000_000;
    const counter = qrCounter(now);
    assert.equal(qrFresh(counter, now), true);
    assert.equal(qrFresh(counter - 2, now), true);
    assert.equal(qrFresh(counter + 1, now), true);
    assert.equal(qrFresh(counter - 3, now), false);
    assert.equal(qrFresh(counter + 2, now), false);
  });
  test('a code from two minutes ago, as sent by a friend, is old', () => {
    const now = 2_000_000_000;
    assert.equal(qrFresh(qrCounter(now - 120_000), now), false);
  });
  test('says how long is left, for the bar on the screen', () => {
    assert.equal(qrMsLeft(20_000), 20_000);
    assert.equal(qrMsLeft(25_000), 15_000);
  });
});

describe('where someone is', () => {
  test('measures the distance between two points', () => {
    const shop = { lat: 25.6, lng: 85.1 };
    assert.equal(distanceMeters(shop, shop), 0);
    const near = distanceMeters(shop, { lat: 25.601, lng: 85.1 });
    assert.ok(near > 100 && near < 120, String(near));
  });
  test('inside the radius', () => {
    assert.equal(placeOf(80, 20, 100), 'INSIDE');
    assert.equal(placeOf(100, 20, 100), 'INSIDE');
  });
  test('the GPS margin counts in the person’s favour', () => {
    assert.equal(placeOf(160, 30, 100), 'PLAUSIBLE');
    assert.equal(placeOf(150, 0, 100), 'PLAUSIBLE');
  });
  test('clearly far, even allowing for the margin', () => {
    assert.equal(placeOf(151, 0, 100), 'FAR');
    assert.equal(placeOf(2100, 30, 100), 'FAR');
  });
  test('a phone guessing widely has no position at all', () => {
    assert.equal(placeOf(2100, 501, 100), 'NO_FIX');
    assert.equal(placeOf(null, null, 100), 'NO_FIX');
    assert.equal(placeOf(50, null, 100), 'NO_FIX');
  });
  test('a truck cannot cross Patna in two minutes', () => {
    const shop = { lat: 25.6, lng: 85.1 };
    const far = { lat: 25.7, lng: 85.2 };
    assert.equal(impossibleTravel({ at: 0, ...shop }, { at: 120_000, ...far }), true);
    assert.equal(impossibleTravel({ at: 0, ...shop }, { at: 3_600_000, ...far }), false);
    assert.equal(impossibleTravel(null, { at: 0, ...far }), false);
    assert.equal(impossibleTravel({ at: 0, ...shop }, { at: 1, ...shop }), false);
  });
});

describe('what a scan comes to', () => {
  test('fresh code, own phone, inside: green, and nobody bothered', () => {
    assert.deepEqual(punchVerdict(fine), { result: 'GREEN', reasons: [] });
    assert.equal(punchVerdict({ ...fine, place: 'PLAUSIBLE' }).result, 'GREEN');
  });
  test('a rare weak fix is green with a note', () => {
    assert.deepEqual(
      punchVerdict({ ...fine, place: 'NO_FIX', location: 'NO_FIX', weakFixesThisWeek: 2 }),
      { result: 'GREEN_NOTE', reasons: ['WEAK_FIX'] },
    );
  });
  test('too many weak fixes in a week, and someone looks', () => {
    assert.deepEqual(
      punchVerdict({ ...fine, place: 'NO_FIX', location: 'NO_FIX', weakFixesThisWeek: 3 }),
      { result: 'REVIEW', reasons: ['MANY_WEAK'] },
    );
  });
  test('a shop with no position taken yet cannot judge location, and blames nobody', () => {
    assert.deepEqual(punchVerdict({ ...fine, place: 'NO_FIX', location: 'NO_FIX', noPin: true }), {
      result: 'GREEN_NOTE',
      reasons: ['NO_PIN'],
    });
  });
  test('old code at the shop: try again, with no manager', () => {
    assert.deepEqual(punchVerdict({ ...fine, qrFresh: false }), {
      result: 'RETRY',
      reasons: ['OLD_QR'],
    });
  });
  test('old code away from the shop goes to a person', () => {
    const verdict = punchVerdict({ ...fine, qrFresh: false, place: 'FAR' });
    assert.equal(verdict.result, 'REVIEW');
    assert.deepEqual(verdict.reasons, ['FAR', 'OLD_QR']);
  });
  for (const [name, change, reason] of [
    ['a fake-location mark', { mocked: true }, 'MOCKED'],
    ['location refused', { location: 'DENIED', place: 'NO_FIX' }, 'LOCATION_OFF'],
    ['GPS switched off', { location: 'GPS_OFF', place: 'NO_FIX' }, 'LOCATION_OFF'],
    ['approximate location', { location: 'APPROXIMATE' }, 'APPROXIMATE'],
    ['clearly far', { place: 'FAR' }, 'FAR'],
    ['a shop they do not work at', { assignedHere: false }, 'OTHER_SHOP'],
    ['two shops too far apart', { impossibleTravel: true }, 'IMPOSSIBLE_TRAVEL'],
    ['carried offline', { offline: true }, 'OFFLINE'],
  ] as const)
    test(`${name} is written down and goes to a person`, () => {
      const verdict = punchVerdict({ ...fine, ...change });
      assert.equal(verdict.result, 'REVIEW');
      assert.ok(verdict.reasons.includes(reason));
    });
  test('every reason found is kept, so the card can say all of them', () => {
    assert.deepEqual(punchVerdict({ ...fine, mocked: true, place: 'FAR', offline: true }).reasons, [
      'MOCKED',
      'FAR',
      'OFFLINE',
    ]);
  });
});

describe('a day, worked out from its record', () => {
  const day = '2026-11-04'; // A Wednesday.
  test('nothing recorded is absent', () => {
    const summary = summarizeDay(day, [], shift, 10);
    assert.equal(summary.status, 'ABSENT');
    assert.equal(summary.firstInAt, null);
  });
  test('a weekly off with nothing recorded is not absence', () => {
    assert.equal(summarizeDay('2026-11-08', [], shift, 10).status, 'WEEKLY_OFF');
  });
  test('in and out give the minutes', () => {
    const summary = summarizeDay(
      day,
      [event('IN', at(day, '09:00')), event('OUT', at(day, '18:30'))],
      shift,
      10,
    );
    assert.equal(summary.status, 'PRESENT');
    assert.equal(summary.minutes, 570);
    assert.equal(summary.lateMinutes, 0);
  });
  test('within the grace is not late; past it counts from the start of the shift', () => {
    const on = (time: string) =>
      summarizeDay(day, [event('IN', at(day, time))], shift, 10).lateMinutes;
    assert.equal(on('09:10'), 0);
    assert.equal(on('09:11'), 11);
    assert.equal(on('09:17'), 17);
  });
  test('nobody is late with no shift set', () => {
    assert.equal(summarizeDay(day, [event('IN', at(day, '13:00'))], null, 10).lateMinutes, 0);
  });
  test('moving shops mid-day is two pairs, and both count', () => {
    const summary = summarizeDay(
      day,
      [
        event('IN', at(day, '09:00')),
        event('OUT', at(day, '12:00')),
        event('IN', at(day, '13:00'), { locationId: 'other' }),
        event('OUT', at(day, '18:00'), { locationId: 'other' }),
      ],
      shift,
      10,
    );
    assert.equal(summary.minutes, 480);
    assert.deepEqual(summary.locationIds.sort(), ['other', 'shop']);
  });
  test('forgot to scan out: present, with hours unknown', () => {
    const summary = summarizeDay(day, [event('IN', at(day, '09:00'))], shift, 10);
    assert.equal(summary.status, 'PRESENT');
    assert.equal(summary.minutes, null);
    assert.ok(summary.flags.includes('NO_OUT'));
  });
  test('a scan waiting for a person still counts, and shows as waiting', () => {
    const summary = summarizeDay(
      day,
      [event('IN', at(day, '09:00'), { result: 'REVIEW', review: 'OPEN' })],
      shift,
      10,
    );
    assert.equal(summary.status, 'REVIEW');
    assert.ok(summary.firstInAt);
  });
  test('a scan a person turned down does not count', () => {
    const summary = summarizeDay(
      day,
      [event('IN', at(day, '09:00'), { result: 'REVIEW', review: 'REJECTED' })],
      shift,
      10,
    );
    assert.equal(summary.status, 'ABSENT');
  });
  test('a "scan again" never counts as arriving', () => {
    assert.equal(
      summarizeDay(day, [event('IN', at(day, '09:00'), { result: 'RETRY' })], shift, 10).status,
      'ABSENT',
    );
  });
  test('a correction replaces the time it names, and says so', () => {
    const summary = summarizeDay(
      day,
      [
        event('IN', at(day, '09:30')),
        event('OUT', at(day, '18:00')),
        event('CORRECTION', at(day, '19:00'), {
          correctsKind: 'IN',
          correctedAt: at(day, '09:00'),
          result: null,
        }),
      ],
      shift,
      10,
    );
    assert.equal(summary.minutes, 540);
    assert.equal(summary.lateMinutes, 0);
    assert.ok(summary.flags.includes('CORRECTED'));
  });
  test('working on a weekly off shows as such, and moves no money', () => {
    const sunday = '2026-11-08';
    const summary = summarizeDay(sunday, [event('IN', at(sunday, '09:30'))], shift, 10);
    assert.ok(summary.flags.includes('WORKED_WEEKLY_OFF'));
    assert.equal(summary.lateMinutes, 0);
  });
  test('hand marks are flagged', () => {
    assert.ok(
      summarizeDay(day, [event('MANUAL_IN', at(day, '09:00'))], shift, 10).flags.includes('MANUAL'),
    );
  });
});
