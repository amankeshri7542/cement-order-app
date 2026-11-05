import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ApiError } from '../../../lib/api';
import {
  nextFetchIn,
  qrPath,
  qrSymbol,
  screenGone,
  startCodeLoop,
  troubleRetryMs,
} from './code-loop';
import type { WallData } from './types';

const wall = (qr: string, msLeft = 20000): WallData => ({
  shopName: 'Dukaan',
  attendanceOn: true,
  qr,
  msLeft,
  serverNow: '2026-11-05T04:00:00.000Z',
  people: [],
});
const settle = () => new Promise((done) => setImmediate(done));

function harness(load: () => Promise<WallData>) {
  const timers: { run: () => void; ms: number; cleared?: boolean }[] = [];
  const seen: string[] = [];
  const troubles: unknown[] = [];
  const gone: unknown[] = [];
  const loop = startCodeLoop({
    load,
    onWall: (next) => seen.push(next.qr),
    onTrouble: (error) => troubles.push(error),
    onGone: (error) => gone.push(error),
    setTimer: (run, ms) => {
      const timer = { run, ms };
      timers.push(timer);
      return timer;
    },
    clearTimer: (timer) => {
      if (timer) (timer as { cleared?: boolean }).cleared = true;
    },
  });
  const live = () => timers.filter((timer) => !timer.cleared);
  return { loop, timers, seen, troubles, gone, live };
}

test('the next code is asked for just after this one ends, and never in a flood', () => {
  assert.equal(nextFetchIn(20000), 20150);
  assert.equal(nextFetchIn(10), 500);
  assert.equal(nextFetchIn(-5000), 500);
  assert.equal(nextFetchIn(Number.NaN), 500);
});
test('it fetches at once, then on the server’s timing', async () => {
  let n = 0;
  const { seen, live } = harness(async () => wall(`CODE${++n}`, 7000));
  await settle();
  assert.deepEqual(seen, ['CODE1']);
  assert.equal(live().length, 1);
  assert.equal(live()[0]!.ms, 7150);
  live()[0]!.run();
  await settle();
  assert.deepEqual(seen, ['CODE1', 'CODE2']);
});
test('a bad connection is trouble, not the end: it keeps trying and recovers', async () => {
  let fail = true;
  const { seen, troubles, gone, live } = harness(async () => {
    if (fail) throw new ApiError('NETWORK_ERROR', 'down');
    return wall('BACK');
  });
  await settle();
  assert.equal(troubles.length, 1);
  assert.equal(gone.length, 0);
  assert.equal(live()[0]!.ms, troubleRetryMs);
  fail = false;
  live()[0]!.run();
  await settle();
  assert.deepEqual(seen, ['BACK']);
});
test('a server error is also only trouble, and keeps the screen paired', async () => {
  const { troubles, gone } = harness(async () => {
    throw new ApiError('REQUEST_FAILED', 'boom');
  });
  await settle();
  assert.equal(troubles.length, 1);
  assert.equal(gone.length, 0);
});
test('being turned off ends it, with nothing left running', async () => {
  const { gone, live, troubles } = harness(async () => {
    throw new ApiError('SCREEN_REVOKED', 'off');
  });
  await settle();
  assert.equal(gone.length, 1);
  assert.equal(troubles.length, 0);
  assert.equal(live().length, 0);
});
test('a poke looks now, and never runs two requests at once', async () => {
  let running = 0;
  let most = 0;
  let release: (() => void) | undefined;
  const { loop, seen, live } = harness(async () => {
    running++;
    most = Math.max(most, running);
    await new Promise<void>((done) => {
      release = done;
    });
    running--;
    return wall('CODE');
  });
  loop.poke();
  loop.poke();
  release?.();
  await settle();
  assert.equal(most, 1);
  assert.equal(seen.length, 1);
  loop.poke();
  release?.();
  await settle();
  assert.equal(seen.length, 2);
  assert.equal(live().length, 1);
});
test('after stopping, a late answer changes nothing', async () => {
  let release: (() => void) | undefined;
  const { loop, seen, live } = harness(async () => {
    await new Promise<void>((done) => {
      release = done;
    });
    return wall('LATE');
  });
  loop.stop();
  release?.();
  await settle();
  assert.deepEqual(seen, []);
  assert.equal(live().length, 0);
});
test('a screen knows being turned off from any other trouble', () => {
  assert.equal(screenGone(new ApiError('SCREEN_REVOKED', 'x')), true);
  assert.equal(screenGone(new ApiError('UNAUTHORIZED', 'x')), true);
  assert.equal(screenGone(new ApiError('NETWORK_ERROR', 'x')), false);
  assert.equal(screenGone(new Error('x')), false);
});

const real = 'SHV1.ABC234.88150000.ABCDEFGHIJKLMNOP';
test('the code is alphanumeric, medium correction, and big squares', () => {
  const symbol = qrSymbol(real);
  assert.equal(symbol.segments.length, 1);
  assert.equal(symbol.segments[0]!.mode.id, 'Alphanumeric');
  assert.equal(symbol.errorCorrectionLevel.bit, 0);
  assert.ok(symbol.modules.size <= 29, `size ${symbol.modules.size}`);
});
test('the drawing has a clear margin and is the same for the same text', () => {
  const { path, box, size } = qrPath(real);
  assert.equal(box, size + 8);
  assert.equal(qrPath(real).path, path);
  assert.notEqual(qrPath('SHV1.ABC234.88150001.ABCDEFGHIJKLMNOP').path, path);
  // Finder pattern: the top-left corner sits exactly on the margin.
  assert.match(path, /^M4 4h7v1h-7z/);
  assert.doesNotMatch(path, /[<>"']/);
});
test('text that cannot be alphanumeric is refused rather than drawn wrongly', () => {
  assert.throws(() => qrSymbol('lowercase is not allowed'));
});
