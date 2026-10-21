import assert from 'node:assert/strict';
import test from 'node:test';
import { loadTs } from './load-ts.mjs';

const { secondsLeft, resendSeconds } = loadTs('src/countdown.ts');

test('a new code can be asked for after thirty seconds', () => {
  assert.equal(resendSeconds, 30);
});

test('counts whole seconds up to the deadline and stops at zero', () => {
  const deadline = 100000;
  assert.equal(secondsLeft(deadline, deadline - 30000), 30);
  assert.equal(secondsLeft(deadline, deadline - 29001), 30);
  assert.equal(secondsLeft(deadline, deadline - 29000), 29);
  assert.equal(secondsLeft(deadline, deadline - 1), 1);
  assert.equal(secondsLeft(deadline, deadline), 0);
  assert.equal(secondsLeft(deadline, deadline + 5000), 0);
});

test('stays right when the app was in the background for a while', () => {
  const sent = 1_000_000;
  const deadline = sent + resendSeconds * 1000;
  assert.equal(secondsLeft(deadline, sent + 12000), 18);
  assert.equal(secondsLeft(deadline, sent + 10 * 60 * 1000), 0);
});

test('the button waits as long as the server does', async () => {
  const { createRequire } = await import('node:module');
  const { otpResendSeconds } = createRequire(import.meta.url)('@shiv/shared');
  assert.equal(resendSeconds, otpResendSeconds);
});
