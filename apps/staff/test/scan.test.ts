import assert from 'node:assert/strict';
import { test } from 'node:test';
import { scanLocked, scanStart, scanStep, slowAfterMs, type ScanState } from '../src/logic/scan';

const qr = 'SHV1.ABC234.88888888.AAAAAAAAAAAAAAAA';
const run = (state: ScanState, ...events: Parameters<typeof scanStep>[1][]) =>
  events.reduce(scanStep, state);
const sending = run(scanStart, { type: 'CODE', text: qr }, { type: 'SAVED', captureId: 'c1' });

test('slow means 8 seconds', () => assert.equal(slowAfterMs, 8000));
test('the first code locks the camera, and more reads do nothing', () => {
  const once = scanStep(scanStart, { type: 'CODE', text: qr });
  assert.equal(once.step, 'saving');
  assert.equal(scanLocked(once), true);
  assert.equal(scanStep(once, { type: 'CODE', text: qr }), once);
  assert.equal(scanStep(sending, { type: 'CODE', text: qr }), sending);
});
test('a code that is not ours is refused on the spot, saving nothing', () => {
  const state = scanStep(scanStart, { type: 'CODE', text: 'https://example.com' });
  assert.deepEqual(state.step === 'shown' && state.shown, { kind: 'refused', code: 'NOT_QR' });
});
test('saved, sent, answered', () => {
  const state = scanStep(sending, {
    type: 'ANSWER',
    captureId: 'c1',
    reply: { result: 'GREEN' },
    result: 'GREEN',
  });
  assert.equal(state.step, 'shown');
  assert.deepEqual(state.step === 'shown' && state.shown.kind, 'answered');
});
test('if the phone cannot save, nothing is claimed', () => {
  const saving = scanStep(scanStart, { type: 'CODE', text: qr });
  const state = scanStep(saving, { type: 'SAVE_FAILED' });
  assert.deepEqual(state.step === 'shown' && state.shown, { kind: 'refused', code: 'NOT_SAVED' });
});
test('no signal shows the saved scan', () => {
  const state = scanStep(sending, { type: 'NO_SIGNAL', captureId: 'c1' });
  assert.deepEqual(state.step === 'shown' && state.shown, { kind: 'saved', why: 'offline' });
});
test('a slow network shows the saved scan when the timer ends', () => {
  const state = scanStep(sending, { type: 'TIMER', captureId: 'c1' });
  assert.deepEqual(state.step === 'shown' && state.shown, { kind: 'saved', why: 'slow' });
});
test('the timer does nothing once the answer is in', () => {
  const answered = scanStep(sending, {
    type: 'ANSWER',
    captureId: 'c1',
    reply: {},
    result: 'GREEN',
  });
  assert.equal(scanStep(answered, { type: 'TIMER', captureId: 'c1' }), answered);
});
test('an answer after "saved" replaces it, so the person sees what really happened', () => {
  const saved = scanStep(sending, { type: 'TIMER', captureId: 'c1' });
  const state = scanStep(saved, {
    type: 'ANSWER',
    captureId: 'c1',
    reply: { result: 'REVIEW' },
    result: 'REVIEW',
  });
  assert.equal(state.step === 'shown' && state.shown.kind, 'answered');
});
test('a refusal after "saved" replaces it too', () => {
  const saved = scanStep(sending, { type: 'NO_SIGNAL', captureId: 'c1' });
  const state = scanStep(saved, { type: 'REFUSED', captureId: 'c1', code: 'BAD_QR' });
  assert.deepEqual(state.step === 'shown' && state.shown, { kind: 'refused', code: 'BAD_QR' });
});
test('an answer for some other scan is not this screen’s business', () => {
  assert.equal(
    scanStep(sending, { type: 'ANSWER', captureId: 'old', reply: {}, result: 'GREEN' }),
    sending,
  );
  assert.equal(scanStep(sending, { type: 'REFUSED', captureId: 'old', code: 'X' }), sending);
  assert.equal(scanStep(sending, { type: 'NO_SIGNAL', captureId: 'old' }), sending);
  assert.equal(scanStep(sending, { type: 'TIMER', captureId: 'old' }), sending);
  assert.equal(
    scanStep(scanStart, { type: 'ANSWER', captureId: 'c', reply: {}, result: null }),
    scanStart,
  );
});
test('a shown answer is not replaced by a second one', () => {
  const answered = scanStep(sending, {
    type: 'ANSWER',
    captureId: 'c1',
    reply: { first: true },
    result: 'GREEN',
  });
  assert.equal(
    scanStep(answered, { type: 'ANSWER', captureId: 'c1', reply: {}, result: 'RETRY' }),
    answered,
  );
});
test('stale codes count up in a row, and anything else ends the run', () => {
  const stale = (state: ScanState, id: string): ScanState =>
    run(
      state,
      { type: 'AGAIN' },
      { type: 'CODE', text: qr },
      { type: 'SAVED', captureId: id },
      { type: 'ANSWER', captureId: id, reply: {}, result: 'RETRY' },
    );
  let state = stale(scanStart, 'a');
  assert.equal(state.retries, 1);
  state = stale(state, 'b');
  state = stale(state, 'c');
  assert.equal(state.retries, 3);
  state = run(
    state,
    { type: 'AGAIN' },
    { type: 'CODE', text: qr },
    { type: 'SAVED', captureId: 'd' },
    { type: 'ANSWER', captureId: 'd', reply: {}, result: 'GREEN' },
  );
  assert.equal(state.retries, 0);
});
test('scanning again opens the lock', () => {
  const state = scanStep(scanStep(sending, { type: 'TIMER', captureId: 'c1' }), { type: 'AGAIN' });
  assert.equal(scanLocked(state), false);
});
