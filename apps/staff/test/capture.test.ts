import assert from 'node:assert/strict';
import { generateKeyPairSync, sign, verify } from 'node:crypto';
import { test } from 'node:test';
import { attendancePunchSchema, punchMessage, staffVerifySchema } from '@shiv/shared';
import {
  betterFix,
  fixWaitMs,
  isShopQr,
  linkProofToSign,
  linkVerifyToSign,
  locationFields,
  punchBody,
  punchToSign,
  renewToSign,
} from '../src/logic/capture';

const good = 'SHV1.ABC234.88888888.AAAAAAAAAAAAAAAA';

test('a shop code is told from anything else, with no server', () => {
  assert.equal(isShopQr(good), true);
  for (const bad of [
    '',
    'HELLO',
    'https://example.com',
    'SHV1.ABC234.1.short',
    `${good}X`,
    'shv1.abc234.88888888.aaaaaaaaaaaaaaaa',
    `${good}\n`,
    '<script>alert(1)</script>',
  ])
    assert.equal(isShopQr(bad), false, bad);
});

test('a good fix goes as it is', () => {
  assert.deepEqual(
    locationFields({
      status: 'OK',
      fix: { lat: 25.6, lng: 85.1, accuracyM: 15, mocked: false },
    }),
    { location: 'OK', mocked: false, lat: 25.6, lng: 85.1, accuracyM: 15 },
  );
});
test('no fix, or a guess past 500 m, is reported as no fix and sends no position', () => {
  assert.deepEqual(locationFields({ status: 'OK', fix: null }), {
    location: 'NO_FIX',
    mocked: false,
  });
  assert.deepEqual(
    locationFields({ status: 'OK', fix: { lat: 25.6, lng: 85.1, accuracyM: 900, mocked: false } }),
    { location: 'NO_FIX', mocked: false },
  );
  assert.deepEqual(
    locationFields({ status: 'OK', fix: { lat: 25.6, lng: 85.1, accuracyM: null, mocked: false } }),
    { location: 'NO_FIX', mocked: false },
  );
});
test('impossible figures are not sent', () => {
  for (const fix of [
    { lat: 500, lng: 85.1, accuracyM: 10, mocked: false },
    { lat: Number.NaN, lng: 85.1, accuracyM: 10, mocked: false },
    { lat: 25.6, lng: 85.1, accuracyM: -1, mocked: false },
  ])
    assert.equal(locationFields({ status: 'OK', fix }).location, 'NO_FIX');
});
test('a fake-location mark is never lost, even with a weak fix', () => {
  assert.equal(
    locationFields({ status: 'OK', fix: { lat: 25.6, lng: 85.1, accuracyM: 900, mocked: true } })
      .mocked,
    true,
  );
  assert.equal(
    locationFields({ status: 'OK', fix: { lat: 25.6, lng: 85.1, accuracyM: 5, mocked: true } })
      .mocked,
    true,
  );
});
test('permission off and GPS off say so, with no position', () => {
  assert.deepEqual(locationFields({ status: 'DENIED', fix: null }), {
    location: 'DENIED',
    mocked: false,
  });
  assert.deepEqual(locationFields({ status: 'GPS_OFF', fix: null }), {
    location: 'GPS_OFF',
    mocked: false,
  });
});
test('approximate says so, with the position if it is usable', () => {
  assert.deepEqual(locationFields({ status: 'APPROXIMATE', fix: null }), {
    location: 'APPROXIMATE',
    mocked: false,
  });
  assert.deepEqual(
    locationFields({
      status: 'APPROXIMATE',
      fix: { lat: 25.6, lng: 85.1, accuracyM: 300, mocked: false },
    }),
    { location: 'APPROXIMATE', mocked: false, lat: 25.6, lng: 85.1, accuracyM: 300 },
  );
});
test('no scan ever waits past the 8 second look, nor long after the scan', () => {
  assert.equal(fixWaitMs(0), 3000);
  assert.equal(fixWaitMs(6000), 2000);
  assert.equal(fixWaitMs(8000), 0);
  assert.equal(fixWaitMs(60000), 0);
});
test('the best position so far is the most accurate', () => {
  const a: { accuracyM: number | null } = { accuracyM: 30 };
  const b: { accuracyM: number | null } = { accuracyM: 10 };
  assert.equal(betterFix(null, a), a);
  assert.equal(betterFix(a, b), b);
  assert.equal(betterFix(b, a), b);
  assert.equal(betterFix(b, { accuracyM: null }), b);
  const none: { accuracyM: number | null } = { accuracyM: null };
  assert.equal(betterFix(none, a), a);
});

const capture = {
  captureId: '6f9619ff-8b86-4d01-b42d-00cf4fc964ff',
  qr: good,
  kind: 'IN' as const,
  location: 'OK' as const,
  mocked: false,
  lat: 25.6,
  lng: 85.1,
  accuracyM: 15.5,
  bootCount: 3,
  appVersion: '1.0.0',
};
test('what is signed is what the server will check, and it passes the server’s schema', () => {
  const { publicKey, privateKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const body = punchBody(capture, 30000);
  const signature = sign('sha256', Buffer.from(punchToSign(body)), privateKey);
  const sent = JSON.parse(
    JSON.stringify({ ...body, signature: signature.toString('base64') }),
  ) as Record<string, unknown>;
  const parsed = attendancePunchSchema.parse(sent);
  assert.ok(
    verify('sha256', Buffer.from(punchMessage(parsed)), publicKey, signature),
    'the server would refuse this',
  );
});
test('a position with no accuracy, and a scan with no position, also verify', () => {
  const { lat: _a, lng: _b, accuracyM: _c, ...rest } = capture;
  const body = punchBody({ ...rest, location: 'DENIED' }, 0);
  const parsed = attendancePunchSchema.parse(
    JSON.parse(JSON.stringify({ ...body, signature: 'x'.repeat(20) })),
  );
  assert.equal(punchMessage(parsed), punchToSign(body));
});
test('a changed figure no longer matches what was signed', () => {
  const body = punchBody(capture, 30000);
  assert.notEqual(punchToSign(body), punchToSign({ ...body, lat: 25.7 }));
  assert.notEqual(punchToSign(body), punchToSign({ ...body, claimedAgeMs: 1 }));
  assert.notEqual(punchToSign(body), punchToSign({ ...body, mocked: true }));
});
test('each signature says what it is for, so one cannot be used as another', () => {
  assert.equal(linkVerifyToSign('+919000000001', '123456'), 'link-verify|+919000000001|123456');
  assert.equal(linkProofToSign(good), `link|${good}`);
  assert.equal(renewToSign('nonce'), 'renew|nonce');
  assert.equal(
    staffVerifySchema.safeParse({
      phone: '+919000000001',
      code: '123456',
      publicKey: 'k'.repeat(90),
      signature: 's'.repeat(90),
    }).success,
    true,
  );
});
