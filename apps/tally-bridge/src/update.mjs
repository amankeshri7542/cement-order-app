// The program's own signed updates (decision 57). There is no Windows code signature for now, so this
// is what stands between a hacked API and the shop PC: a manifest signed with an offline Ed25519 key
// that the server never holds. The launcher rolls back a version that fails to report healthy.
import { createHash, createPublicKey, verify } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

export class UpdateRefused extends Error {}
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
const VERSION = /^\d{1,4}\.\d{1,4}\.\d{1,4}$/;
const FILE = /^[a-z0-9-]{1,60}\.mjs$/;

/** Negative if a is older than b. */
export function compareVersions(a, b) {
  const left = a.split('.').map(Number);
  const right = b.split('.').map(Number);
  for (let index = 0; index < 3; index++) {
    if ((left[index] ?? 0) !== (right[index] ?? 0)) return (left[index] ?? 0) - (right[index] ?? 0);
  }
  return 0;
}

/** Everything about a release is proved here before one byte of it is written to disk. */
export function checkRelease({ release, version, currentVersion, publicKeyPem }) {
  if (!publicKeyPem) throw new UpdateRefused('NO_KEY');
  if (!release || release.version !== version || !VERSION.test(version))
    throw new UpdateRefused('WRONG_VERSION');
  let good = false;
  try {
    good = verify(
      null,
      Buffer.from(release.manifest),
      createPublicKey(publicKeyPem),
      Buffer.from(release.signature, 'base64'),
    );
  } catch {
    good = false;
  }
  if (!good) throw new UpdateRefused('BAD_SIGNATURE');
  const manifest = JSON.parse(release.manifest);
  if (manifest.version !== version) throw new UpdateRefused('WRONG_VERSION');
  // An old release, even a properly signed one, must never be put back by whoever controls the API.
  if (compareVersions(version, currentVersion) <= 0) throw new UpdateRefused('NOT_NEWER');
  const names = Object.keys(manifest.files ?? {});
  if (!names.includes('main.mjs')) throw new UpdateRefused('NO_MAIN');
  const given = Object.keys(release.files ?? {});
  if (given.length !== names.length || given.some((name) => !names.includes(name)))
    throw new UpdateRefused('FILES_DIFFER');
  const files = new Map();
  for (const name of names) {
    if (!FILE.test(name)) throw new UpdateRefused('BAD_FILE_NAME');
    const bytes = Buffer.from(release.files[name], 'base64');
    if (sha256(bytes) !== manifest.files[name]) throw new UpdateRefused('FILE_CHANGED');
    files.set(name, bytes);
  }
  return files;
}

export class Updater {
  constructor({ dataDir, currentVersion, publicKeyPem, log = () => {}, onReady = () => {} }) {
    Object.assign(this, { dataDir, currentVersion, publicKeyPem, log, onReady });
    this.refused = new Set();
  }
  /** Asks for one version, proves it, unpacks it beside the others, and hands over to the launcher. */
  async take(version, api) {
    if (this.refused.has(version)) return false;
    try {
      const release = await api.release(version);
      const files = checkRelease({
        release,
        version,
        currentVersion: this.currentVersion,
        publicKeyPem: this.publicKeyPem,
      });
      const finalDir = join(this.dataDir, 'versions', version);
      const temporary = `${finalDir}.tmp`;
      await rm(temporary, { recursive: true, force: true });
      await mkdir(temporary, { recursive: true, mode: 0o700 });
      for (const [name, bytes] of files)
        await writeFile(join(temporary, name), bytes, { mode: 0o600 });
      await rm(finalDir, { recursive: true, force: true });
      await rename(temporary, finalDir);
      await writeFile(join(this.dataDir, 'pending.json'), JSON.stringify({ version }));
      this.log('update_ready', { version });
      this.onReady();
      return true;
    } catch (error) {
      if (error instanceof UpdateRefused) {
        this.refused.add(version);
        this.log('update_refused', { version, why: error.message });
        return false;
      }
      this.log('update_failed', { version, code: error.code ?? 'NETWORK' });
      return false;
    }
  }
  /** The launcher takes this as proof the running version works. */
  markHealthy() {
    if (this.markedHealthy) return;
    this.markedHealthy = true;
    writeFile(join(this.dataDir, `healthy-${this.currentVersion}`), '').catch(() => undefined);
  }
  failedVersion() {
    const path = join(this.dataDir, 'update-failed.txt');
    return existsSync(path) ? this.failedText : undefined;
  }
  async load() {
    try {
      this.failedText = (await readFile(join(this.dataDir, 'update-failed.txt'), 'utf8'))
        .trim()
        .slice(0, 40);
    } catch {
      this.failedText = undefined;
    }
  }
}
