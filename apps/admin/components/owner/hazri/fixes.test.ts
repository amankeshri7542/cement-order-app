import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  averageFixes,
  browserFix,
  collectFixes,
  LocationRefused,
  mapLink,
  typedPin,
  type Fix,
} from './fixes';

const fix = (lat: number, lng: number, accuracyM = 10): Fix => ({ lat, lng, accuracyM });

test('ten fixes make one position in their middle', () => {
  const pin = averageFixes(
    Array.from({ length: 10 }, (_, index) => fix(25.6 + index * 0.00001, 85.1)),
  );
  assert.equal(pin?.count, 10);
  assert.equal(pin?.lat, 25.600045);
  assert.equal(pin?.lng, 85.1);
  assert.equal(pin?.worstAccuracyM, 10);
  assert.ok((pin?.spreadM ?? 0) > 0 && (pin?.spreadM ?? 99) < 10);
});
test('a fix the phone calls hopeless gets no vote', () => {
  const pin = averageFixes([fix(25.6, 85.1), fix(25.6, 85.1), fix(25.6, 85.1), fix(30, 90, 900)]);
  assert.equal(pin?.count, 3);
  assert.equal(pin?.lat, 25.6);
  assert.equal(pin?.worstAccuracyM, 10);
});
test('too few good fixes is no position at all', () => {
  assert.equal(averageFixes([]), null);
  assert.equal(averageFixes([fix(25.6, 85.1), fix(25.6, 85.1)]), null);
  assert.equal(averageFixes([fix(25.6, 85.1, 900), fix(25.6, 85.1, 900), fix(25, 85, 900)]), null);
});
test('fixes that wander far apart show how far', () => {
  const pin = averageFixes([fix(25.6, 85.1), fix(25.602, 85.1), fix(25.604, 85.1)]);
  assert.ok((pin?.spreadM ?? 0) > 200);
});

const instant = { sleep: async () => {}, gapMs: 0 };
test('it stops at the number wanted, and counts up as it goes', async () => {
  const seen: number[] = [];
  const fixes = await collectFixes(async () => fix(25.6, 85.1), {
    ...instant,
    wanted: 4,
    onFix: (count) => seen.push(count),
  });
  assert.equal(fixes.length, 4);
  assert.deepEqual(seen, [1, 2, 3, 4]);
});
test('a refused permission ends it at once', async () => {
  let asked = 0;
  await assert.rejects(
    collectFixes(
      async () => {
        asked++;
        throw new LocationRefused('no');
      },
      { ...instant },
    ),
    LocationRefused,
  );
  assert.equal(asked, 1);
});
test('a slow or failing phone keeps being given time, until the time is up', async () => {
  let clock = 0;
  let asked = 0;
  const fixes = await collectFixes(
    async () => {
      asked++;
      clock += 10000;
      if (asked % 2) throw new Error('timeout');
      return fix(25.6, 85.1);
    },
    { ...instant, now: () => clock, maxMs: 45000 },
  );
  assert.equal(asked, 5);
  assert.equal(fixes.length, 2);
});
test('leaving the page stops the asking', async () => {
  let gone = false;
  const fixes = await collectFixes(
    async () => {
      gone = true;
      return fix(25.6, 85.1);
    },
    { ...instant, stopped: () => gone },
  );
  assert.equal(fixes.length, 1);
});

const positionError = (code: number) =>
  ({ code, PERMISSION_DENIED: 1, message: 'nope' }) as GeolocationPositionError;
test('the browser’s answer becomes a fix, asking for a fresh reading each time', async () => {
  const got = await browserFix({
    getCurrentPosition: (
      ok: PositionCallback,
      _bad: PositionErrorCallback | null | undefined,
      options?: PositionOptions,
    ) => {
      assert.equal(options?.maximumAge, 0);
      assert.equal(options?.enableHighAccuracy, true);
      ok({ coords: { latitude: 25.6, longitude: 85.1, accuracy: 12 } } as GeolocationPosition);
    },
  } as Geolocation);
  assert.deepEqual(got, { lat: 25.6, lng: 85.1, accuracyM: 12 });
});
test('a refusal from the browser is told apart from a slow fix', async () => {
  const failing = (code: number) =>
    ({
      getCurrentPosition: (_ok: PositionCallback, bad: PositionErrorCallback) =>
        bad(positionError(code)),
    }) as unknown as Geolocation;
  await assert.rejects(browserFix(failing(1)), LocationRefused);
  await assert.rejects(browserFix(failing(3)), (error) => !(error instanceof LocationRefused));
});

test('typed figures must be a place on the map', () => {
  assert.deepEqual(typedPin('25.6', '85.1'), { lat: 25.6, lng: 85.1 });
  assert.deepEqual(typedPin(' 25.60000049 ', '85.1'), { lat: 25.6, lng: 85.1 });
  for (const [lat, lng] of [
    ['', '85'],
    ['25', ''],
    ['abc', '85'],
    ['91', '85'],
    ['25', '181'],
    ['Infinity', '85'],
  ])
    assert.equal(typedPin(lat!, lng!), null, `${lat},${lng}`);
});
test('the map link holds only the two figures', () => {
  assert.equal(mapLink(25.6, 85.1), 'https://www.google.com/maps/search/?api=1&query=25.6,85.1');
});
