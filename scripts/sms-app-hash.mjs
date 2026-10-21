#!/usr/bin/env node
// Prints the 11-character app hash that Android's SMS Retriever looks for at the end of the
// sign-in SMS, so the customer app can read the code without asking for any SMS permission.
//
//   node scripts/sms-app-hash.mjs <certificate.der|.pem|.crt> [package]
//
// Use the certificate of the key that SIGNS the installed app. For a Play Store install that is
// the Play app signing key: Play Console > the app > Test and release > App integrity > App
// signing > "Download certificate". (An upload key or a debug key gives a different hash, which
// is right for builds signed with it.) The package defaults to the shop's: in.shivcement.store.
//
// The SMS must then be worded like this, with the hash as the last thing in the message:
//   <#> Your Shiv Cement Store code is 123456. Do not share it.
//   Ab1Cd2Ef3Gh
// The same steps as Google's AppSignatureHelper: SHA-256 of "<package> <certificate as hex>",
// the first 9 bytes, base64, 11 characters.
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

/** The hash for a package and its signing certificate (DER bytes). */
export function appHash(packageName, certificate) {
  const hex = Buffer.from(certificate).toString('hex');
  return createHash('sha256')
    .update(`${packageName} ${hex}`)
    .digest()
    .subarray(0, 9)
    .toString('base64')
    .slice(0, 11);
}

/** DER bytes from a certificate file that is either DER or PEM. */
export function certificateBytes(file) {
  const raw = readFileSync(file);
  const text = raw.toString('latin1');
  if (!text.includes('-----BEGIN CERTIFICATE-----')) return raw;
  const body = text.replace(/-----(BEGIN|END) CERTIFICATE-----|\s+/g, '');
  return Buffer.from(body, 'base64');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [file, packageName = 'in.shivcement.store'] = process.argv.slice(2);
  if (!file) {
    console.error('Usage: node scripts/sms-app-hash.mjs <certificate.der|.pem|.crt> [package]');
    process.exit(1);
  }
  console.log(appHash(packageName, certificateBytes(file)));
}
