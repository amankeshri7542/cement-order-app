import { execFileSync } from 'node:child_process';
import { readFileSync, statSync } from 'node:fs';
import assert from 'node:assert/strict';

// Local pattern scan, not a substitute for a maintained scanner or history/provider review.
const patterns = [
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,
  /\bAKIA[0-9A-Z]{16}\b/,
  /\b(?:ghp|github_pat)_[A-Za-z0-9_]{30,}\b/,
  /\bsk-(?:proj-)?[A-Za-z0-9_-]{40,}\b/,
  /\bAIza[0-9A-Za-z_-]{35}\b/,
];
assert(patterns[1].test(`AKIA${'A'.repeat(16)}`));
assert(!patterns.some((p) => p.test('STAGING_SECRET_FROM_SECRET_MANAGER')));
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
  if (patterns.some((p) => p.test(bytes.toString())))
    findings.push(`${file}: potential credential (value redacted)`);
}
console.log(JSON.stringify({ scanned: files.length, findings }, null, 2));
if (findings.length) process.exitCode = 1;
