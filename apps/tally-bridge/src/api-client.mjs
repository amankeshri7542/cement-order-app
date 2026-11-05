/* global AbortSignal */
// Talks to our API over HTTPS, outbound only. Every call is signed. Nothing here listens.
import {
  createHash,
  createPrivateKey,
  createPublicKey,
  generateKeyPairSync,
  sign,
} from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const PROTOCOL = '1';

export class ApiError extends Error {
  constructor(status, code, body) {
    super(code);
    this.status = status;
    this.code = code;
    this.body = body;
  }
}
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');

/** Plain http only ever goes to this PC, and only when a test asks. A shop never has that setting. */
export function checkedBase(base, { allowLoopbackHttp = false } = {}) {
  const url = new URL(base);
  const local = url.hostname === '127.0.0.1' || url.hostname === 'localhost';
  if (url.protocol !== 'https:' && !(allowLoopbackHttp && local && url.protocol === 'http:'))
    throw new Error('The API address must be https');
  if (url.username || url.password) throw new Error('The API address must hold no password');
  return url.origin;
}

export const newIdentity = () => generateKeyPairSync('ed25519').privateKey;
export async function saveIdentity(dataDir, privateKey) {
  await mkdir(dataDir, { recursive: true, mode: 0o700 });
  const path = join(dataDir, 'identity.pem');
  const temporary = `${path}.tmp`;
  await writeFile(temporary, privateKey.export({ format: 'pem', type: 'pkcs8' }), { mode: 0o600 });
  await rename(temporary, path);
}
/** A key made on this PC, for this PC. The private half never leaves it. */
export async function loadIdentity(dataDir) {
  try {
    return createPrivateKey(await readFile(join(dataDir, 'identity.pem'), 'utf8'));
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  const privateKey = newIdentity();
  await saveIdentity(dataDir, privateKey);
  return privateKey;
}
export const publicKeyOf = (privateKey) =>
  createPublicKey(privateKey).export({ format: 'der', type: 'spki' }).toString('base64');

export class BridgeApi {
  constructor({
    base,
    privateKey,
    state,
    saveState,
    allowLoopbackHttp = false,
    fetchImpl = fetch,
    now = Date.now,
    timeoutMs = 120000,
  }) {
    this.timeoutMs = timeoutMs;
    this.base = checkedBase(base, { allowLoopbackHttp });
    this.privateKey = privateKey;
    this.state = state;
    this.saveState = saveState;
    this.fetch = fetchImpl;
    this.now = now;
    this.offsetMs = state.offsetMs ?? 0;
  }
  /** The server's time, as this PC best knows it. A PC's own clock is never believed. */
  serverNow() {
    return this.now() + this.offsetMs;
  }
  learnTime(res) {
    const told = Number(res.headers.get('x-bridge-server-time'));
    if (Number.isFinite(told) && told > 0) {
      this.offsetMs = told - this.now();
      this.state.offsetMs = this.offsetMs;
    }
  }
  /** The next number: always rising, even after this file is lost, as it starts from the clock. */
  async nextSeq() {
    const floor = this.serverNow() * 1000;
    const seq = Math.max((this.state.seq ?? 0) + 1, floor);
    this.state.seq = seq;
    await this.saveState(this.state);
    return String(seq);
  }
  async call(method, path, { body, contentType = 'application/json', tries = 2 } = {}) {
    const bytes =
      body === undefined
        ? Buffer.alloc(0)
        : Buffer.isBuffer(body)
          ? body
          : Buffer.from(JSON.stringify(body));
    for (let attempt = 0; ; attempt++) {
      const time = String(this.serverNow());
      const seq = await this.nextSeq();
      const digest = sha256(bytes);
      const message = [method, path, time, seq, digest].join('\n');
      const res = await this.fetch(`${this.base}${path}`, {
        method,
        // A redirect must never carry a signed request somewhere else.
        redirect: 'error',
        signal: AbortSignal.timeout(this.timeoutMs),
        headers: {
          ...(bytes.length ? { 'Content-Type': contentType } : {}),
          'X-Bridge-Protocol': PROTOCOL,
          'X-Bridge-Device': this.state.deviceId,
          'X-Bridge-Time': time,
          'X-Bridge-Seq': seq,
          'X-Bridge-Body-Sha256': digest,
          'X-Bridge-Signature': sign(null, Buffer.from(message), this.privateKey).toString(
            'base64',
          ),
        },
        body: bytes.length ? bytes : undefined,
      });
      this.learnTime(res);
      const text = await res.text();
      let parsed = null;
      try {
        parsed = text ? JSON.parse(text) : null;
      } catch {
        parsed = null;
      }
      if (res.ok) return parsed;
      const code = parsed?.error?.code ?? `HTTP_${res.status}`;
      // A wrong clock or a lost counter corrects itself from the reply, once, without a person.
      if (attempt < tries && code === 'BRIDGE_CLOCK') continue;
      if (attempt < tries && code === 'BRIDGE_REPLAY' && parsed?.error?.details?.lastSeq) {
        this.state.seq = Number(parsed.error.details.lastSeq);
        continue;
      }
      throw new ApiError(res.status, code, parsed);
    }
  }
  heartbeat(body) {
    return this.call('POST', '/api/v1/bridge/heartbeat', { body });
  }
  chunk(jobId, seq, bytes) {
    return this.call('PUT', `/api/v1/bridge/jobs/${jobId}/chunks/${seq}`, {
      body: bytes,
      contentType: 'application/gzip',
    });
  }
  finish(jobId, body) {
    return this.call('POST', `/api/v1/bridge/jobs/${jobId}/finish`, { body });
  }
  release(version) {
    return this.call('GET', `/api/v1/bridge/releases/${version}`);
  }
}

/** One time only, with the code a person read from the desk. Proves it holds the key it registers. */
export async function pair({
  base,
  code,
  privateKey,
  version,
  os,
  allowLoopbackHttp = false,
  fetchImpl = fetch,
}) {
  const origin = checkedBase(base, { allowLoopbackHttp });
  const publicKey = publicKeyOf(privateKey);
  const proof = sign(null, Buffer.from(`bridge-pair|${code}|${publicKey}`), privateKey).toString(
    'base64',
  );
  const res = await fetchImpl(`${origin}/api/v1/bridge/pair`, {
    method: 'POST',
    redirect: 'error',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ code, publicKey, proof, version, os }),
  });
  const parsed = await res.json().catch(() => null);
  if (!res.ok) throw new ApiError(res.status, parsed?.error?.code ?? `HTTP_${res.status}`, parsed);
  return parsed;
}
