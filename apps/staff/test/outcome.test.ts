import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  isRefusal,
  punchOutcome,
  refusedOutcome,
  savedOutcome,
  type PunchReply,
} from '../src/logic/outcome';
import { makeTr } from '../src/logic/words';

const hi = makeTr('hi');
const en = makeTr('en');
const reply = (extra: Partial<PunchReply>): PunchReply => ({
  kind: 'IN',
  result: 'GREEN',
  reasons: [],
  serverAt: '2026-11-03T03:32:00.000Z',
  ...extra,
});

test('green: the words and the time, and nothing else', () => {
  const shown = punchOutcome(reply({}), hi);
  assert.equal(shown.tone, 'ok');
  assert.equal(shown.title, 'Hazri lag gayi, 9:02 AM');
  assert.deepEqual(shown.lines, []);
  assert.equal(shown.autoReturn, true);
});
test('late is still green, with a line under it', () => {
  const shown = punchOutcome(reply({ lateMinutes: 17 }), hi);
  assert.equal(shown.tone, 'ok');
  assert.deepEqual(shown.lines, ['Aaj 17 minute late likha gaya.']);
});
test('green with a note looks just like green: nobody is bothered', () => {
  const shown = punchOutcome(reply({ result: 'GREEN_NOTE', reasons: ['WEAK_FIX'] }), hi);
  assert.equal(shown.tone, 'ok');
  assert.deepEqual(shown.lines, []);
});
test('leaving says the hours', () => {
  const shown = punchOutcome(reply({ kind: 'OUT', serverAt: '2026-11-03T13:11:00.000Z' }), hi, {
    arrivedAt: '2026-11-03T03:32:00.000Z',
  });
  assert.equal(shown.title, 'Jaane ki hazri lag gayi, 6:41 PM');
  assert.deepEqual(shown.lines, ['Aaj 9 ghante 39 minute.']);
});
test('leaving with no arrival known leaves the hours out', () => {
  assert.deepEqual(punchOutcome(reply({ kind: 'OUT' }), hi).lines, []);
});
test('an old code is amber, and only asks for another scan', () => {
  const shown = punchOutcome(reply({ result: 'RETRY', reasons: ['OLD_QR'] }), hi);
  assert.equal(shown.tone, 'amber');
  assert.equal(shown.title, 'QR purana ho gaya');
  assert.deepEqual(shown.lines, ['Screen par naya QR aa gaya hai. Dobara scan karo.']);
  assert.deepEqual(shown.actions, ['rescan']);
});
test('the third old code in a row offers the way through', () => {
  assert.deepEqual(punchOutcome(reply({ result: 'RETRY' }), hi, { retriesInARow: 3 }).actions, [
    'rescan',
    'problem',
  ]);
});
test('a review is amber, says the time is saved, and who looks', () => {
  const shown = punchOutcome(reply({ result: 'REVIEW', reasons: ['FAR'] }), hi);
  assert.equal(shown.tone, 'amber');
  assert.equal(shown.title, 'Time likh liya: 9:02 AM');
  assert.deepEqual(shown.lines, [
    'Phone ki location dukaan se door dikh rahi hai.',
    'Manager dekh kar pakka karega.',
  ]);
});
test('each reason for a review reads in plain words, and always amber', () => {
  for (const reason of [
    'MOCKED',
    'LOCATION_OFF',
    'APPROXIMATE',
    'FAR',
    'OTHER_SHOP',
    'IMPOSSIBLE_TRAVEL',
    'OFFLINE',
    'OLD_QR',
    'MANY_WEAK',
    'NO_IN',
    'TIME_MISMATCH',
    'SOMETHING_NEW',
  ]) {
    const shown = punchOutcome(reply({ result: 'REVIEW', reasons: [reason] }), hi);
    assert.equal(shown.tone, 'amber', reason);
    assert.ok(shown.lines.includes('Manager dekh kar pakka karega.'), reason);
  }
});
test('no screen ever calls anyone a cheat', () => {
  for (const language of [hi, en])
    for (const reason of ['MOCKED', 'IMPOSSIBLE_TRAVEL', 'FAR', 'TIME_MISMATCH']) {
      const text = JSON.stringify(
        punchOutcome(reply({ result: 'REVIEW', reasons: [reason] }), language),
      );
      assert.doesNotMatch(text, /fraud|cheat|fake|nakli|chori|thief|dhokha/i, reason);
    }
});
test('location off offers the Settings button', () => {
  assert.ok(
    punchOutcome(reply({ result: 'REVIEW', reasons: ['LOCATION_OFF'] }), hi).actions.includes(
      'settings',
    ),
  );
});
test('a repeat is not an error: it says when the first one was', () => {
  const shown = punchOutcome(reply({ already: true }), hi);
  assert.equal(shown.title, 'Aap 9:02 AM par laga chuke ho');
  assert.notEqual(shown.tone, 'red');
});
test('saved on the phone is amber, and says it has not gone', () => {
  for (const why of ['offline', 'slow'] as const) {
    const shown = savedOutcome(hi, why);
    assert.equal(shown.tone, 'amber');
    assert.ok(shown.lines.includes('Abhi gaya nahi'));
  }
});
test('red only when nothing was saved, and each says so', () => {
  for (const code of ['BAD_QR', 'NOT_QR', 'ATTENDANCE_OFF', 'BAD_SIGNATURE', 'NOT_SAVED', 'NEW']) {
    const shown = refusedOutcome(code, hi);
    assert.equal(shown.tone, 'red', code);
    assert.equal(shown.autoReturn, false, code);
    assert.ok(shown.actions.length > 0, code);
  }
  assert.equal(refusedOutcome('BAD_QR', hi).title, 'Yeh hamara QR nahi hai');
  assert.deepEqual(refusedOutcome('NOT_LINKED', hi).actions, ['relink']);
});
test('a refused scan still offers the Problem path', () => {
  assert.ok(refusedOutcome('BAD_QR', hi).actions.includes('problem'));
});
test('what counts as a refusal, and what stays saved', () => {
  assert.equal(isRefusal('BAD_QR', 400), true);
  assert.equal(isRefusal('ATTENDANCE_OFF', 409), true);
  assert.equal(isRefusal('NETWORK'), false);
  assert.equal(isRefusal('HTTP_503', 503), false);
  assert.equal(isRefusal('RATE_LIMITED', 429), false);
  assert.equal(isRefusal('UNAUTHORIZED', 401), false);
  assert.equal(isRefusal('NOTICE_NEEDED', 409), false);
});
