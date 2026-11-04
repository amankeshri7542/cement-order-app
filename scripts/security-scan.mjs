import { execFileSync } from 'node:child_process';
import { readFileSync, statSync } from 'node:fs';
import assert from 'node:assert/strict';

// Local pattern scan, not a substitute for a maintained scanner or history/provider review.
const patterns = [
  /-----BEGIN (?:RSA |EC |OPENSSH |ENCRYPTED )?PRIVATE KEY-----/,
  /\bAKIA[0-9A-Z]{16}\b/,
  /\b(?:ghp|github_pat)_[A-Za-z0-9_]{30,}\b/,
  /\bsk-(?:proj-)?[A-Za-z0-9_-]{40,}\b/,
  /\bAIza[0-9A-Za-z_-]{35}\b/,
  /\brzp_live_[A-Za-z0-9]{14}/, // Razorpay live key id
  /\bsntrys_[A-Za-z0-9_=-]{20,}/, // Sentry auth token
  /\bEAA[A-Za-z0-9]{100,}/, // Meta / WhatsApp Cloud API access token
  /\bSK[0-9a-fA-F]{32}\b/, // Twilio API key
];
const found = (text) => patterns.some((p) => p.test(text));
// Samples are assembled at run time so this file never matches its own patterns.
for (const sample of [
  `AKIA${'A'.repeat(16)}`,
  `-----BEGIN ${'ENCRYPTED'} PRIVATE KEY-----`,
  `RAZORPAY_KEY_ID=rzp_live_${'A1b2C3d4E5f6G7'}`,
  `SENTRY_AUTH_TOKEN=sntrys_${'eyJpYXQiOjE3'.repeat(3)}`,
  `WHATSAPP_ACCESS_TOKEN=EAA${'Bz9'.repeat(40)}`,
  `TWILIO_API_KEY=SK${'0123456789abcdef'.repeat(2)}`,
])
  assert(found(sample), 'security scan self-test missed a credential sample');
for (const safe of [
  'STAGING_SECRET_FROM_SECRET_MANAGER',
  'RAZORPAY_KEY_ID=rzp_test_local',
  `SKIP${'0123456789abcdef'.repeat(2)}`,
])
  assert(!found(safe), 'security scan self-test flagged a safe value');
const files = execFileSync(
  'git',
  ['ls-files', '--cached', '--others', '--exclude-standard', '-z'],
  { encoding: 'utf8' },
)
  .split('\0')
  .filter(Boolean);
const findings = [];
for (const file of files) {
  if (!statSync(file).isFile()) continue;
  if (/(^|\/)\.env(?:\.|$)/.test(file) && !file.endsWith('.env.example'))
    findings.push(`${file}: secret-bearing environment file included`);
  const bytes = readFileSync(file);
  if (bytes.includes(0)) continue;
  if (found(bytes.toString())) findings.push(`${file}: potential credential (value redacted)`);
}
console.log(JSON.stringify({ scanned: files.length, findings }, null, 2));
if (findings.length) process.exitCode = 1;
