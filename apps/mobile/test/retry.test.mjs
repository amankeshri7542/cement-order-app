import assert from 'node:assert/strict';
import test from 'node:test';
import { loadTs } from './load-ts.mjs';

const { withRetry, retryDelays } = loadTs('src/retry.ts', { setTimeout });
const transport = new Error('transport');
const refusal = new Error('refusal');
const retryable = (error) => error === transport;
const slept = [];
const sleep = async (ms) => void slept.push(ms);

test('waits one, two and four seconds, in that order', () => {
  assert.deepEqual([...retryDelays], [1000, 2000, 4000]);
});

test('a read that succeeds on the third try is retried twice and returns its result', async () => {
  slept.length = 0;
  let calls = 0;
  const result = await withRetry(
    async () => {
      calls += 1;
      if (calls < 3) throw transport;
      return 'prices';
    },
    { retryable, sleep },
  );
  assert.equal(result, 'prices');
  assert.equal(calls, 3);
  assert.deepEqual(slept, [1000, 2000]);
});

test('gives up after the last delay and throws the last failure', async () => {
  slept.length = 0;
  let calls = 0;
  await assert.rejects(
    withRetry(
      async () => {
        calls += 1;
        throw transport;
      },
      { retryable, sleep },
    ),
    (error) => error === transport,
  );
  assert.equal(calls, 4);
  assert.deepEqual(slept, [1000, 2000, 4000]);
});

test('a refusal from the store is not retried', async () => {
  slept.length = 0;
  let calls = 0;
  await assert.rejects(
    withRetry(
      async () => {
        calls += 1;
        throw refusal;
      },
      { retryable, sleep },
    ),
    (error) => error === refusal,
  );
  assert.equal(calls, 1);
  assert.deepEqual(slept, []);
});

test('nothing waits while the phone has no network', async () => {
  slept.length = 0;
  let calls = 0;
  await assert.rejects(
    withRetry(
      async () => {
        calls += 1;
        throw transport;
      },
      { retryable, sleep, online: () => false },
    ),
  );
  assert.equal(calls, 1);
  assert.deepEqual(slept, []);
});

test('custom delays are honoured', async () => {
  slept.length = 0;
  let calls = 0;
  await assert.rejects(
    withRetry(
      async () => {
        calls += 1;
        throw transport;
      },
      { retryable, sleep, delays: [5] },
    ),
  );
  assert.equal(calls, 2);
  assert.deepEqual(slept, [5]);
});
