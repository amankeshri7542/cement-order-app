import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  createPublicKey,
  randomBytes,
  timingSafeEqual,
  verify,
} from 'node:crypto';
import { getConfig } from '../config';

// Every secret here comes from one server secret, each for one purpose, so a leak of a shop's code
// or a sealed position tells nothing about the others.
const derive = (purpose: string) =>
  createHmac('sha256', getConfig().STAFF_SECRET ?? getConfig().OTP_HASH_SECRET)
    .update(`staff:${purpose}`)
    .digest();

const base32 = (bytes: Buffer) => {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let bits = 0;
  let value = 0;
  let out = '';
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += alphabet[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
    value &= (1 << bits) - 1;
  }
  return bits ? out + alphabet[(value << (5 - bits)) & 31] : out;
};
const sameText = (a: string, b: string) => {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
};

const qrMac = (screen: { id: string; code: string; epoch: number }, counter: number) =>
  base32(
    createHmac('sha256', derive(`screen:${screen.id}:${screen.epoch}`))
      .update(`${screen.code}.${counter}`)
      .digest()
      .subarray(0, 10),
  );
/** Short and uppercase, so the code is big squares that a budget camera reads from a metre away. */
export const qrText = (screen: { id: string; code: string; epoch: number }, counter: number) =>
  `SHV1.${screen.code}.${counter}.${qrMac(screen, counter)}`;
export function readQr(text: string) {
  const match = /^SHV1\.([A-Z0-9]{4,12})\.(\d{1,12})\.([A-Z2-7]{16})$/.exec(text);
  return match ? { code: match[1]!, counter: Number(match[2]), mac: match[3]! } : null;
}
export const qrGenuine = (
  screen: { id: string; code: string; epoch: number },
  counter: number,
  mac: string,
) => sameText(qrMac(screen, counter), mac);
export const newScreenCode = () => base32(randomBytes(5)).slice(0, 6);
export const secretHash = (value: string) => createHash('sha256').update(value).digest('hex');
export const pairingHash = (code: string) =>
  createHmac('sha256', derive('pairing')).update(code).digest('hex');

/** A position someone must judge is kept sealed, and can be erased later without breaking the chain. */
export function seal(value: unknown) {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', derive('geo'), iv);
  const body = Buffer.concat([cipher.update(JSON.stringify(value), 'utf8'), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), body]).toString('base64url');
}
export function unseal<T>(sealed: string): T | null {
  try {
    const bytes = Buffer.from(sealed, 'base64url');
    const decipher = createDecipheriv('aes-256-gcm', derive('geo'), bytes.subarray(0, 12));
    decipher.setAuthTag(bytes.subarray(12, 28));
    return JSON.parse(
      Buffer.concat([decipher.update(bytes.subarray(28)), decipher.final()]).toString('utf8'),
    ) as T;
  } catch {
    return null;
  }
}

/** A stateless nonce: the phone signs it to renew, so a stolen token is useless without the phone. */
export function makeNonce(now = Date.now()) {
  const at = String(now);
  return `${at}.${createHmac('sha256', derive('nonce')).update(at).digest('base64url')}`;
}
export function nonceFresh(nonce: string, now = Date.now()) {
  const [at, mac] = nonce.split('.');
  if (!at || !mac || !/^\d{10,16}$/.test(at)) return false;
  if (!sameText(createHmac('sha256', derive('nonce')).update(at).digest('base64url'), mac))
    return false;
  return Math.abs(now - Number(at)) <= 5 * 60000;
}

/** Checks a signature from the key inside this person's phone. Android sends DER, a browser raw. */
export function signatureValid(publicKey: string, message: string, signature: string) {
  try {
    const key = createPublicKey({
      key: Buffer.from(publicKey, 'base64'),
      format: 'der',
      type: 'spki',
    });
    if (key.asymmetricKeyType !== 'ec' || key.asymmetricKeyDetails?.namedCurve !== 'prime256v1')
      return false;
    const bytes = Buffer.from(signature, 'base64');
    return bytes.length === 64
      ? verify('sha256', Buffer.from(message), { key, dsaEncoding: 'ieee-p1363' }, bytes)
      : verify('sha256', Buffer.from(message), { key, dsaEncoding: 'der' }, bytes);
  } catch {
    return false;
  }
}
/** A key the server can actually use, so a bad one is refused at linking and not at the first scan. */
export function publicKeyUsable(publicKey: string) {
  try {
    const key = createPublicKey({
      key: Buffer.from(publicKey, 'base64'),
      format: 'der',
      type: 'spki',
    });
    return key.asymmetricKeyType === 'ec' && key.asymmetricKeyDetails?.namedCurve === 'prime256v1';
  } catch {
    return false;
  }
}
