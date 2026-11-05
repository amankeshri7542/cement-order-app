// The queue on disk. Answers go to a temp file, then into gzip parts of up to 512 KB with an atomic
// rename and a SHA-256. A part is deleted only after the server's reply. Losing all of this costs
// nothing but asking again: Tally stays the source, and the server holds every watermark.
import { createHash } from 'node:crypto';
import { open, mkdir, readFile, readdir, rename, rm, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { gzip } from 'node:zlib';

const pack = promisify(gzip);
// Plan 09 says up to 1 MB. The API takes 30 seconds to receive any one request, so half that leaves
// room for a shop's slow hotspot: 512 KB gets through at about 140 kilobits a second.
const PART_MAX = 512 * 1024;
const FIRST_SLICE = 4 * 1024 * 1024;

export class Spool {
  constructor(dir, { capBytes = 2 * 1024 ** 3 } = {}) {
    this.dir = dir;
    this.capBytes = capBytes;
  }
  async ready() {
    await mkdir(this.dir, { recursive: true, mode: 0o700 });
  }
  jobDir(jobId) {
    if (!/^[A-Za-z0-9_-]{5,64}$/.test(jobId)) throw new Error('Bad job id');
    return join(this.dir, jobId);
  }
  tempFile(jobId, index) {
    return join(this.jobDir(jobId), `answer-${index}.tmp`);
  }
  async open(job) {
    const dir = this.jobDir(job.id);
    await mkdir(dir, { recursive: true, mode: 0o700 });
    try {
      return JSON.parse(await readFile(join(dir, 'manifest.json'), 'utf8'));
    } catch {
      return { id: job.id, reads: {}, uploaded: {}, nextSeq: 0 };
    }
  }
  async save(manifest) {
    const dir = this.jobDir(manifest.id);
    const temporary = join(dir, 'manifest.json.tmp');
    await writeFile(temporary, JSON.stringify(manifest), { mode: 0o600 });
    await rename(temporary, join(dir, 'manifest.json'));
  }
  async pending() {
    const out = [];
    let names = [];
    try {
      names = await readdir(this.dir);
    } catch {
      return out;
    }
    for (const name of names) {
      try {
        out.push(JSON.parse(await readFile(join(this.dir, name, 'manifest.json'), 'utf8')));
      } catch {
        // An answer half written when the power went: it will simply be asked again.
      }
    }
    return out;
  }
  /** A folder with no manifest is an answer the power cut off. Nothing will ever come back for it. */
  async sweepOrphans(olderThanMs) {
    let names = [];
    try {
      names = await readdir(this.dir);
    } catch {
      return;
    }
    for (const name of names) {
      const path = join(this.dir, name);
      try {
        await stat(join(path, 'manifest.json'));
      } catch {
        const info = await stat(path).catch(() => null);
        if (info && info.mtimeMs < olderThanMs) await rm(path, { recursive: true, force: true });
      }
    }
  }
  async remove(jobId) {
    await rm(this.jobDir(jobId), { recursive: true, force: true });
  }
  async wipe() {
    await rm(this.dir, { recursive: true, force: true });
    await this.ready();
  }
  async bytes() {
    let total = 0;
    let names = [];
    try {
      names = await readdir(this.dir);
    } catch {
      return 0;
    }
    for (const name of names) {
      let files = [];
      try {
        files = await readdir(join(this.dir, name));
      } catch {
        continue;
      }
      for (const file of files) {
        try {
          total += (await stat(join(this.dir, name, file))).size;
        } catch {
          // Removed while we counted.
        }
      }
    }
    return total;
  }
  async full() {
    return (await this.bytes()) >= this.capBytes;
  }

  /** Cuts one raw answer into parts, gzipping each. A part that comes out over 1 MB is cut smaller. */
  async split(manifest, tempPath) {
    const dir = this.jobDir(manifest.id);
    const handle = await open(tempPath, 'r');
    const parts = [];
    try {
      const { size } = await handle.stat();
      let at = 0;
      let slice = FIRST_SLICE;
      if (size === 0) throw new Error('Empty answer');
      while (at < size) {
        const buffer = Buffer.allocUnsafe(Math.min(slice, size - at));
        await handle.read(buffer, 0, buffer.length, at);
        const packed = await pack(buffer);
        if (packed.length > PART_MAX && buffer.length > 16 * 1024) {
          slice = Math.floor(buffer.length / 2);
          continue;
        }
        const seq = manifest.nextSeq++;
        const sha256 = createHash('sha256').update(packed).digest('hex');
        const finalPath = join(dir, `part-${seq}.gz`);
        const temporary = `${finalPath}.tmp`;
        await writeFile(temporary, packed, { mode: 0o600 });
        await rename(temporary, finalPath);
        parts.push({ seq, sha256 });
        at += buffer.length;
        slice = FIRST_SLICE;
      }
      return { parts, bytes: size };
    } finally {
      await handle.close();
    }
  }
  part(jobId, seq) {
    return readFile(join(this.jobDir(jobId), `part-${seq}.gz`));
  }
}
