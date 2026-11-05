import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  claimedAge,
  createQueue,
  maxClaimedAgeMs,
  offlineAfterMs,
  rebase,
  verdictFor,
  type QueueDeps,
  type QueueEntry,
  type SendReply,
} from '../src/logic/queue';

type Harness = ReturnType<typeof harness>;
function harness(start?: { entries: QueueEntry[]; failures: [] }) {
  const state = {
    saved: start ?? (null as null | { entries: QueueEntry[]; failures: unknown[] }),
    mono: 1000,
    boot: 5,
    sent: [] as { id: string; body: Record<string, unknown> }[],
    replies: [] as (SendReply | Promise<SendReply>)[],
    results: [] as string[],
    stops: [] as string[],
    deleted: [] as string[],
    uploads: 0,
    uploadReply: { ok: true, id: 'ev1' } as Awaited<ReturnType<QueueDeps['upload']>>,
    saveFails: false,
  };
  const deps: QueueDeps = {
    load: async () => state.saved as never,
    save: async (next) => {
      if (state.saveFails) throw new Error('disk full');
      state.saved = JSON.parse(JSON.stringify(next));
    },
    send: async (entry, body) => {
      state.sent.push({ id: entry.id, body });
      return state.replies.shift() ?? { ok: true, body: {} };
    },
    upload: async () => {
      state.uploads++;
      return state.uploadReply;
    },
    prepare: async (entry, age) => ({
      ...entry.body,
      ...(entry.claimsAge ? { claimedAgeMs: age } : {}),
    }),
    deletePhoto: async (uri) => {
      state.deleted.push(uri);
    },
    mono: () => state.mono,
    boot: () => state.boot,
    now: () => 42,
    onResult: (entry, _reply, verdict) => state.results.push(`${entry.id}:${verdict}`),
    onStop: (reason) => state.stops.push(reason),
  };
  return { state, queue: createQueue(deps) };
}
const step = (id: string, extra: Partial<QueueEntry> = {}) => ({
  id,
  kind: 'delivered' as const,
  method: 'POST' as const,
  path: `staff/stops/${id}/delivered`,
  body: { idempotencyKey: id },
  userId: 'keeper',
  claimsAge: true,
  ...extra,
});
const noReply: SendReply = { ok: false, code: 'NETWORK' };

test('saved before it is sent, and gone once the server has it', async () => {
  const { state, queue } = harness();
  await queue.add(step('a'));
  assert.equal(state.saved?.entries.length, 1);
  await queue.flush();
  assert.equal(state.sent.length, 1);
  assert.equal(state.saved?.entries.length, 0);
  assert.deepEqual(state.results, ['a:done']);
});
test('no signal keeps it, in order, and stops at the first that cannot go', async () => {
  const { state, queue } = harness();
  await queue.add(step('a'));
  await queue.add(step('b'));
  state.replies = [noReply];
  await queue.flush();
  assert.equal(state.sent.length, 1, 'b must wait for a');
  assert.deepEqual(
    queue.entries().map((row) => row.id),
    ['a', 'b'],
  );
  await queue.flush();
  assert.deepEqual(
    state.sent.map((row) => row.id),
    ['a', 'a', 'b'],
  );
  assert.equal(queue.entries().length, 0);
});
test('the same step added twice is kept once', async () => {
  const { state, queue } = harness();
  await queue.add(step('a'));
  await queue.add(step('a'));
  await queue.flush();
  assert.equal(state.sent.length, 1);
});
test('a retry carries the very same key, so the server can tell it is a repeat', async () => {
  const { state, queue } = harness();
  await queue.add(step('a'));
  state.replies = [noReply];
  await queue.flush();
  await queue.flush();
  assert.equal(state.sent[0]!.body.idempotencyKey, state.sent[1]!.body.idempotencyKey);
});
test('a closed app picks up where it was, from the phone’s storage', async () => {
  const first = harness();
  await first.queue.add(step('a'));
  const saved = first.state.saved as { entries: QueueEntry[]; failures: [] };
  const second = harness(saved);
  await second.queue.flush();
  assert.deepEqual(
    second.state.sent.map((row) => row.id),
    ['a'],
  );
});
test('two flushes at once never send the same thing twice', async () => {
  const { state, queue } = harness();
  await queue.add(step('a'));
  await Promise.all([queue.flush(), queue.flush(), queue.flush()]);
  assert.equal(state.sent.length, 1);
});
test('asking during a send looks again afterwards, so nothing waits for no reason', async () => {
  const { state, queue } = harness();
  await queue.add(step('a'));
  let release: (reply: SendReply) => void = () => {};
  state.replies = [new Promise<SendReply>((resolve) => (release = resolve))];
  const running = queue.flush();
  await new Promise((resolve) => setTimeout(resolve, 5));
  await queue.add(step('b'));
  void queue.flush();
  release({ ok: true, body: {} });
  await running;
  assert.deepEqual(
    state.sent.map((row) => row.id),
    ['a', 'b'],
  );
});
test('the age grows by the boot clock while it waits', async () => {
  const { state, queue } = harness();
  await queue.add(step('a'));
  state.mono += 30000;
  state.replies = [noReply];
  await queue.flush();
  state.mono += 15000;
  await queue.flush();
  assert.equal(state.sent[0]!.body.claimedAgeMs, 30000);
  assert.equal(state.sent[1]!.body.claimedAgeMs, 45000);
});
test('a step that claims no age sends none', async () => {
  const { state, queue } = harness();
  await queue.add(step('a', { claimsAge: false }));
  await queue.flush();
  assert.equal('claimedAgeMs' in state.sent[0]!.body, false);
});
test('a reboot on the way counts as carried, and is marked', () => {
  const entry: QueueEntry = {
    ...step('a'),
    mono: 5000,
    boot: 5,
    carriedMs: 1000,
    rebooted: false,
  };
  const after = rebase(entry, 2000, 6);
  assert.equal(after.rebooted, true);
  assert.equal(after.boot, 6);
  assert.ok(after.carriedMs > offlineAfterMs);
  // From there it grows as usual.
  assert.equal(rebase(after, 3000, 6).carriedMs, after.carriedMs + 1000);
});
test('a boot clock that went backwards is treated the same way', () => {
  const entry: QueueEntry = { ...step('a'), mono: 5000, boot: 5, carriedMs: 0, rebooted: false };
  assert.equal(rebase(entry, 1000, 5).rebooted, true);
});
test('the age stays inside what the server accepts', () => {
  const entry: QueueEntry = { ...step('a'), mono: 0, boot: 5, carriedMs: 1e12, rebooted: false };
  assert.equal(claimedAge(entry), maxClaimedAgeMs);
  assert.equal(claimedAge({ ...entry, carriedMs: -5 }), 0);
  assert.equal(claimedAge({ ...entry, carriedMs: 12.7 }), 13);
});

test('what each answer means', () => {
  assert.equal(verdictFor('delivered', 'NETWORK'), 'retry');
  assert.equal(verdictFor('delivered', 'HTTP_503', 503), 'retry');
  assert.equal(verdictFor('delivered', 'RATE_LIMITED', 429), 'retry');
  assert.equal(verdictFor('delivered', 'UNAUTHORIZED', 401), 'signin');
  assert.equal(verdictFor('delivered', 'DEVICE_REVOKED', 401), 'revoked');
  assert.equal(verdictFor('punch', 'NOTICE_NEEDED', 409), 'notice');
  assert.equal(verdictFor('punch', 'NOT_LINKED', 403), 'notlinked');
  assert.equal(verdictFor('punch', 'BAD_QR', 400), 'failed');
  assert.equal(verdictFor('load', 'ORDER_CHANGED', 409), 'failed');
  assert.equal(verdictFor('transfer', 'TRANSFER_DONE', 409), 'done');
  assert.equal(verdictFor('countSubmit', 'COUNT_NOT_OPEN', 409), 'done');
  assert.equal(verdictFor('countLine', 'COUNT_NOT_OPEN', 409), 'failed');
});
test('a refusal is told once, kept to read, and does not hold up the rest', async () => {
  const { state, queue } = harness();
  await queue.add(step('a'));
  await queue.add(step('b'));
  state.replies = [{ ok: false, code: 'ORDER_CHANGED', status: 409 }];
  await queue.flush();
  assert.deepEqual(
    state.sent.map((row) => row.id),
    ['a', 'b'],
  );
  assert.deepEqual(
    queue.failures().map((row) => [row.id, row.code]),
    [['a', 'ORDER_CHANGED']],
  );
  await queue.dismiss('a');
  assert.equal(queue.failures().length, 0);
});
test('work already done counts as done, on a repeat', async () => {
  const { state, queue } = harness();
  await queue.add(step('a', { kind: 'transfer' }));
  state.replies = [{ ok: false, code: 'TRANSFER_DONE', status: 409 }];
  await queue.flush();
  assert.equal(queue.entries().length, 0);
  assert.equal(queue.failures().length, 0);
});
for (const [code, status, reason] of [
  ['NOTICE_NEEDED', 409, 'notice'],
  ['UNAUTHORIZED', 401, 'signin'],
  ['NOT_LINKED', 403, 'notlinked'],
  ['DEVICE_REVOKED', 401, 'revoked'],
] as const)
  test(`${code} keeps the work and says why it stopped`, async () => {
    const { state, queue } = harness();
    await queue.add(step('a'));
    state.replies = [{ ok: false, code, status }];
    await queue.flush();
    assert.deepEqual(state.stops, [reason]);
    assert.equal(queue.entries().length, 1);
  });

const withPhoto = (fallback?: Record<string, unknown>) =>
  step('a', {
    photo: { uri: 'file:///p.jpg', kind: 'DELIVERY_PHOTO', locationId: 'loc', fallback },
  });
test('a photo goes first, then its id with the step, and then the file is removed', async () => {
  const { state, queue } = harness();
  await queue.add(withPhoto());
  await queue.flush();
  assert.equal(state.sent[0]!.body.evidenceId, 'ev1');
  assert.deepEqual(state.deleted, ['file:///p.jpg']);
});
test('a photo uploaded before a lost reply is not uploaded again', async () => {
  const { state, queue } = harness();
  await queue.add(withPhoto());
  state.replies = [noReply];
  await queue.flush();
  await queue.flush();
  assert.equal(state.uploads, 1);
  assert.equal(state.sent[1]!.body.evidenceId, 'ev1');
});
test('no signal for the photo keeps the whole step', async () => {
  const { state, queue } = harness();
  await queue.add(withPhoto());
  state.uploadReply = { ok: false, code: 'NETWORK' };
  await queue.flush();
  assert.equal(state.sent.length, 0);
  assert.equal(queue.entries().length, 1);
});
test('a photo refused for good does not lose the delivery', async () => {
  const { state, queue } = harness();
  await queue.add(withPhoto({ skipReason: 'Photo nahi gayi' }));
  state.uploadReply = { ok: false, code: 'INVALID_IMAGE', status: 400 };
  await queue.flush();
  assert.equal(state.sent[0]!.body.skipReason, 'Photo nahi gayi');
  assert.equal(state.sent[0]!.body.evidenceId, undefined);
  assert.equal(queue.entries().length, 0);
});
test('the newest figure for a line replaces the older one still waiting', async () => {
  const { state, queue } = harness();
  await queue.add(step('l1', { kind: 'countLine', replaceKey: 'c:p', body: { countedQty: 1 } }));
  await queue.add(step('l2', { kind: 'countLine', replaceKey: 'c:p', body: { countedQty: 2 } }));
  await queue.flush();
  assert.equal(state.sent.length, 1);
  assert.equal(state.sent[0]!.body.countedQty, 2);
});
test('when the phone cannot save, it says so instead of pretending', async () => {
  const { state, queue } = harness();
  state.saveFails = true;
  assert.equal(await queue.add(step('a')), false);
});
test('after a wipe nothing is sent and nothing is written back', async () => {
  const { state, queue } = harness();
  await queue.add(step('a'));
  let release: (reply: SendReply) => void = () => {};
  state.replies = [new Promise<SendReply>((resolve) => (release = resolve))];
  const running = queue.flush();
  await new Promise((resolve) => setTimeout(resolve, 5));
  const savedBefore = JSON.stringify(state.saved);
  queue.wipe();
  release({ ok: true, body: {} });
  await running;
  assert.equal(queue.entries().length, 0);
  assert.equal(JSON.stringify(state.saved), savedBefore, 'a wiped queue must not save again');
  await queue.add(step('b'));
  await queue.flush();
  assert.equal(state.sent.length, 1, 'nothing further was sent');
});
test('a queue can start clean after a phone is linked again', async () => {
  const { state, queue } = harness();
  queue.wipe();
  queue.reopen();
  state.saved = null;
  await queue.add(step('a'));
  await queue.flush();
  assert.equal(state.sent.length, 1);
});
void (0 as unknown as Harness);
