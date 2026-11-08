import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  fullPhone,
  linkStage,
  mustWait,
  revokedScreen,
  signInError,
  validCode,
  type LinkState,
} from '../src/logic/link';
import { makeTr } from '../src/logic/words';

const link = (extra: Partial<LinkState> = {}): LinkState => ({
  device: { id: 'd', status: 'PENDING' },
  request: { kind: 'FIRST', status: 'PENDING', qrScannedAt: null, createdAt: '2026-11-03' },
  noticeVersion: 1,
  noticeAccepted: true,
  user: { id: 'u', name: 'Test' },
  ...extra,
});
test('the notice comes first for everyone', () => {
  assert.equal(linkStage(link({ noticeAccepted: false })), 'NOTICE');
  assert.equal(
    linkStage(link({ noticeAccepted: false, device: { id: 'd', status: 'ACTIVE' } })),
    'NOTICE',
  );
});
test('then waiting, new phone, or in', () => {
  assert.equal(linkStage(link()), 'WAITING');
  assert.equal(
    linkStage(
      link({
        request: { kind: 'CHANGE', status: 'PENDING', qrScannedAt: null, createdAt: '2026-11-03' },
      }),
    ),
    'NEW_PHONE',
  );
  assert.equal(linkStage(link({ device: { id: 'd', status: 'ACTIVE' } })), 'READY');
});
test('numbers as people type them', () => {
  for (const typed of ['9000000001', '+91 90000 00001', '09000000001', '919000000001'])
    assert.equal(fullPhone(typed), '+919000000001', typed);
  for (const typed of ['', '12345', '5000000001', 'abcdefghij', '90000000012345'])
    assert.equal(fullPhone(typed), null, typed);
});
test('a code is six digits', () => {
  assert.equal(validCode('123456'), true);
  for (const code of ['', '12345', '1234567', 'abcdef']) assert.equal(validCode(code), false);
});
test('a phone waiting that is cut off was refused; a working one was cut off', () => {
  assert.equal(revokedScreen(true), 'REFUSED');
  assert.equal(revokedScreen(false), 'CUT_OFF');
});
test('each sign-in error has plain words, and an unknown one still reads', () => {
  const hi = makeTr('hinglish');
  for (const code of [
    'RATE_LIMITED',
    'OTP_UNAVAILABLE',
    'INVALID_OTP',
    'NOT_STAFF',
    'DEVICE_TAKEN',
    'BAD_SIGNATURE',
    'INVALID_INPUT',
    'NETWORK',
    'SOMETHING_NEW',
  ])
    assert.ok(hi(signInError(code)).length > 5, code);
  assert.equal(hi(signInError('NOT_STAFF')), 'Yeh number staff mein nahi hai. Malik se poochho.');
});
test('at the OTP limit the screen says to wait, rather than offering more tries', () => {
  assert.equal(mustWait('RATE_LIMITED'), true);
  assert.equal(mustWait('OTP_UNAVAILABLE'), true);
  assert.equal(mustWait('INVALID_OTP'), false);
});
