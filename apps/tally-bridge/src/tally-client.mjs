// Talks to Tally on this PC, and only this PC. The address is fixed here and takes no setting.
import http from 'node:http';
import { createWriteStream } from 'node:fs';
import { encodeRequest, requestHeaders } from './templates.mjs';

const LOOPBACK = '127.0.0.1';

export class TallyError extends Error {
  /** CLOSED: nothing listening. BUSY: too slow or stalled. TOO_BIG: over the cap. BAD_STATUS: not 200. */
  constructor(code, message) {
    super(message ?? code);
    this.code = code;
  }
}

export class TallyClient {
  /**
   * One request at a time, always. requestMs bounds a whole answer; idleMs a stalled one, which is
   * how a sleeping or stuck Tally looks. maxBytes stops an answer that never ends.
   */
  constructor({
    port = 9000,
    requestMs = 600000,
    idleMs = 30000,
    maxBytes = 512 * 1024 * 1024,
  } = {}) {
    if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Bad Tally port');
    this.port = port;
    this.requestMs = requestMs;
    this.idleMs = idleMs;
    this.maxBytes = maxBytes;
    this.queue = Promise.resolve();
  }

  /** The bare port's one-line answer, for the version detector. Sends no XML at all. */
  async bare(timeoutMs = 3000) {
    return new Promise((resolve) => {
      const req = http.get(
        { host: LOOPBACK, port: this.port, path: '/', timeout: timeoutMs, agent: false },
        (res) => {
          let text = '';
          res.setEncoding('utf8');
          res.on('data', (piece) => {
            if (text.length < 500) text += piece;
          });
          res.on('end', () => resolve({ open: true, text: text.slice(0, 500) }));
          res.on('error', () => resolve({ open: true, text: '' }));
        },
      );
      req.on('timeout', () => {
        req.destroy();
        resolve({ open: true, text: '' });
      });
      req.on('error', () => resolve({ open: false, text: '' }));
    });
  }

  /** Runs after whatever is already running: Tally is asked one thing at a time. */
  exclusive(work) {
    const run = this.queue.then(work, work);
    this.queue = run.catch(() => undefined);
    return run;
  }

  /** A small answer, into memory. Used for marks and counts. */
  small(xml, maxBytes = 256 * 1024) {
    return this.exclusive(async () => {
      const pieces = [];
      const started = Date.now();
      const bytes = await this.send(xml, maxBytes, (piece) => pieces.push(piece));
      return { body: Buffer.concat(pieces), bytes, tookMs: Date.now() - started };
    });
  }

  /** A big answer, straight to a file, so a large day book never sits in memory. */
  toFile(xml, path) {
    return this.exclusive(async () => {
      const started = Date.now();
      const file = createWriteStream(path, { flags: 'w', mode: 0o600 });
      let last = Buffer.alloc(0);
      let failed = null;
      file.on('error', (error) => {
        failed = error;
      });
      try {
        const bytes = await this.send(xml, this.maxBytes, (piece) => {
          last = Buffer.concat([last, piece]).subarray(-64);
          file.write(piece);
        });
        await new Promise((resolve, reject) => {
          file.end((error) => (error ? reject(error) : resolve()));
        });
        if (failed) throw failed;
        return { bytes, tail: last, tookMs: Date.now() - started };
      } catch (error) {
        file.destroy();
        throw error;
      }
    });
  }

  send(xml, maxBytes, onData) {
    const body = encodeRequest(xml);
    return new Promise((resolve, reject) => {
      let bytes = 0;
      let settled = false;
      let idle;
      const finish = (error, value) => {
        if (settled) return;
        settled = true;
        clearTimeout(idle);
        clearTimeout(whole);
        if (error) reject(error);
        else resolve(value);
      };
      const req = http.request(
        {
          host: LOOPBACK,
          port: this.port,
          path: '/',
          method: 'POST',
          agent: false,
          headers: { ...requestHeaders, 'Content-Length': body.length },
        },
        (res) => {
          if (res.statusCode !== 200) {
            res.resume();
            finish(new TallyError('BAD_STATUS'));
            req.destroy();
            return;
          }
          touch();
          res.on('data', (piece) => {
            bytes += piece.length;
            if (bytes > maxBytes) {
              finish(new TallyError('TOO_BIG'));
              req.destroy();
              return;
            }
            touch();
            onData(piece);
          });
          res.on('end', () => finish(null, bytes));
          res.on('error', () => finish(new TallyError('BUSY')));
          res.on('aborted', () => finish(new TallyError('BUSY')));
        },
      );
      const touch = () => {
        clearTimeout(idle);
        idle = setTimeout(() => {
          finish(new TallyError('BUSY'));
          req.destroy();
        }, this.idleMs);
      };
      const whole = setTimeout(() => {
        finish(new TallyError('BUSY'));
        req.destroy();
      }, this.requestMs);
      req.on('error', (error) => {
        if (error.code === 'ECONNREFUSED') finish(new TallyError('CLOSED'));
        else finish(new TallyError('BUSY'));
      });
      touch();
      req.end(body);
    });
  }
}

/** Ends with </ENVELOPE>, in either encoding, or the answer was cut short. */
export function endsCleanly(tail) {
  const utf16 = Buffer.from('</ENVELOPE>', 'utf16le');
  const ascii = Buffer.from('</ENVELOPE>', 'utf8');
  let end = tail.length;
  // Trailing white space, in one byte or two.
  while (end > 0 && [0x0a, 0x0d, 0x20, 0x09, 0x00].includes(tail[end - 1])) end--;
  const asUtf8 = tail.subarray(0, end);
  if (asUtf8.length >= ascii.length && asUtf8.subarray(-ascii.length).equals(ascii)) return true;
  // In UTF-16 the last ">" is followed by a zero, which the loop above stepped over.
  const asUtf16 = tail.subarray(0, Math.min(end + 1, tail.length));
  return asUtf16.length >= utf16.length && asUtf16.subarray(-utf16.length).equals(utf16);
}
