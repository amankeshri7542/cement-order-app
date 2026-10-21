import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { appHash, certificateBytes } from './sms-app-hash.mjs';

// Expected values come from Google's AppSignatureHelper steps run in Java (SHA-256 of
// "<package> <certificate hex>", first 9 bytes, base64 without padding, 11 characters).
const vectors = [
  ['616263', 'EMeFWXfVzDw'],
  ['3082010a0282010100c1e5a9', '2o6RZATo9tO'],
  ['deadbeef00112233', '9S713yj78a3'],
];

test('matches the hash Android computes for the same package and certificate', () => {
  for (const [hex, expected] of vectors)
    assert.equal(appHash('in.shivcement.store', Buffer.from(hex, 'hex')), expected);
});

test('is eleven characters and depends on the package name', () => {
  const certificate = Buffer.from('deadbeef00112233', 'hex');
  assert.match(appHash('in.shivcement.store', certificate), /^[A-Za-z0-9+/]{11}$/);
  assert.notEqual(
    appHash('in.shivcement.store', certificate),
    appHash('in.shivcement.other', certificate),
  );
});

test('reads a certificate file as DER or as PEM with the same result', () => {
  const der = Buffer.from('3082010a0282010100c1e5a9', 'hex');
  const folder = mkdtempSync(join(tmpdir(), 'sms-hash-'));
  const derFile = join(folder, 'cert.der');
  const pemFile = join(folder, 'cert.pem');
  writeFileSync(derFile, der);
  writeFileSync(
    pemFile,
    `-----BEGIN CERTIFICATE-----\n${der.toString('base64')}\n-----END CERTIFICATE-----\n`,
  );
  assert.deepEqual(certificateBytes(pemFile), der);
  assert.deepEqual(certificateBytes(derFile), der);
});
