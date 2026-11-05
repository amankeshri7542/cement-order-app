import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createQueue } from '../src/logic/queue';
import {
  cachePrefix,
  clockKey,
  cutOffKey,
  languageKey,
  queueKey,
  survivesWipe,
  wipeEverything,
} from '../src/logic/wipe';

function phone() {
  const order: string[] = [];
  const failing = new Set<string>();
  const step = (name: string) => async () => {
    order.push(name);
    if (failing.has(name)) throw new Error(name);
  };
  return {
    order,
    failing,
    deps: {
      stopQueue: () => {
        order.push('stopQueue');
      },
      deleteTokens: step('tokens'),
      deleteCaches: step('caches'),
      deleteQueue: step('queue'),
      deletePhotos: step('photos'),
      markCutOff: step('mark'),
    },
  };
}
test('everything goes, with the queue stopped and the tokens gone first', async () => {
  const { order, deps } = phone();
  assert.deepEqual(await wipeEverything(deps, 'CUT_OFF'), []);
  assert.deepEqual(order, ['stopQueue', 'tokens', 'caches', 'queue', 'photos', 'mark']);
});
test('one step failing does not stop the rest, and says which', async () => {
  const { order, failing, deps } = phone();
  failing.add('caches');
  assert.deepEqual(await wipeEverything(deps, 'CUT_OFF'), ['caches']);
  assert.ok(order.includes('photos'));
  assert.ok(order.includes('mark'));
});
test('a failed token delete still marks the phone as cut off', async () => {
  const { order, failing, deps } = phone();
  failing.add('tokens');
  await wipeEverything(deps, 'REFUSED');
  assert.ok(order.includes('mark'));
});
test('the mark says which screen to stay on', async () => {
  const { deps } = phone();
  let saw = '';
  await wipeEverything({ ...deps, markCutOff: async (kind) => void (saw = kind) }, 'REFUSED');
  assert.equal(saw, 'REFUSED');
});
test('only the language and the cut-off note survive', () => {
  assert.equal(survivesWipe(languageKey), true);
  assert.equal(survivesWipe(cutOffKey), true);
  for (const key of [
    queueKey,
    clockKey,
    `${cachePrefix}u:trips`,
    `${cachePrefix}u:today`,
    `${cachePrefix}u:pay`,
    `${cachePrefix}u:slip:2026-10`,
    `${cachePrefix}u:cash`,
    `${cachePrefix}u:stock`,
    'staff:lastUser',
    'anything-else',
  ])
    assert.equal(survivesWipe(key), false, key);
});
test('a wipe in the middle of sending writes nothing back', async () => {
  const saves: unknown[] = [];
  let release: () => void = () => {};
  const queue = createQueue({
    load: async () => null,
    save: async (state) => {
      saves.push(state);
    },
    send: () =>
      new Promise((resolve) => {
        release = () => resolve({ ok: true, body: {} });
      }),
    upload: async () => ({ ok: true, id: 'x' }),
    prepare: async (entry) => entry.body,
    deletePhoto: async () => {},
    mono: () => 0,
    boot: () => 1,
    now: () => 0,
  });
  await queue.add({
    id: 'a',
    kind: 'delivered',
    method: 'POST',
    path: 'p',
    body: {},
    userId: 'u',
    claimsAge: false,
  });
  const running = queue.flush();
  await new Promise((resolve) => setTimeout(resolve, 5));
  const count = saves.length;
  queue.wipe();
  release();
  await running;
  assert.equal(saves.length, count);
});
