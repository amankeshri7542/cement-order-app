// Signs a new version of the program with the offline key, and writes what the desk's release route
// takes. The launcher itself never updates this way: it stays as it was installed.
// Usage: node sign-release.mjs <version> <update-key.pem> [out.json]
import { createHash, createPrivateKey, sign } from 'node:crypto';
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export function makeRelease({ version, keyPem, sourceDir }) {
  if (!/^\d{1,4}\.\d{1,4}\.\d{1,4}$/.test(version)) throw new Error('A version looks like 1.2.3');
  const stated = /AGENT_VERSION = '(.*?)'/.exec(
    readFileSync(join(sourceDir, 'version.mjs'), 'utf8'),
  )?.[1];
  // The launcher waits for this exact version to report healthy, or it rolls back.
  if (stated !== version) throw new Error(`src/version.mjs says ${stated}, not ${version}`);
  const files = {};
  const hashes = {};
  for (const name of readdirSync(sourceDir).filter(
    (file) => file.endsWith('.mjs') && file !== 'launcher.mjs',
  )) {
    const bytes = readFileSync(join(sourceDir, name));
    files[name] = bytes.toString('base64');
    hashes[name] = createHash('sha256').update(bytes).digest('hex');
  }
  // main.mjs reads the launcher's exit codes, so it travels as an ordinary file too.
  const launcher = readFileSync(join(sourceDir, 'launcher.mjs'));
  files['launcher.mjs'] = launcher.toString('base64');
  hashes['launcher.mjs'] = createHash('sha256').update(launcher).digest('hex');
  const manifest = JSON.stringify({ version, files: hashes });
  const signature = sign(null, Buffer.from(manifest), createPrivateKey(keyPem)).toString('base64');
  return { version, manifest, signature, files };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const [version, keyPath, out] = process.argv.slice(2);
  if (!version || !keyPath) {
    console.error('Use: sign-release.mjs <version> <update-key.pem> [out.json]');
    process.exit(2);
  }
  const sourceDir = join(dirname(fileURLToPath(import.meta.url)), '../src');
  const release = makeRelease({ version, keyPem: readFileSync(keyPath, 'utf8'), sourceDir });
  const path = out ?? `release-${version}.json`;
  writeFileSync(path, JSON.stringify(release));
  console.log(`${path}: POST it to admin/tally/releases, then choose it for one PC first.`);
}
