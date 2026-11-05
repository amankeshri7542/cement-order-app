// Web build, used only for browser tests. A real P-256 key through WebCrypto, so the server checks
// real signatures. Android holds its key in Keystore (see device.native.ts); nothing here ships.
const keyName = 'staff:webkey';
type Stored = { publicJwk: JsonWebKey; privateJwk: JsonWebKey };
const algorithm = { name: 'ECDSA', namedCurve: 'P-256' };
const base64 = (bytes: ArrayBuffer) => {
  let text = '';
  for (const byte of new Uint8Array(bytes)) text += String.fromCharCode(byte);
  return btoa(text);
};
async function keys(): Promise<Stored> {
  const saved = localStorage.getItem(keyName);
  if (saved) return JSON.parse(saved) as Stored;
  const pair = await crypto.subtle.generateKey(algorithm, true, ['sign', 'verify']);
  const stored = {
    publicJwk: await crypto.subtle.exportKey('jwk', pair.publicKey),
    privateJwk: await crypto.subtle.exportKey('jwk', pair.privateKey),
  };
  localStorage.setItem(keyName, JSON.stringify(stored));
  return stored;
}
export async function publicKey() {
  const { publicJwk } = await keys();
  const key = await crypto.subtle.importKey('jwk', publicJwk, algorithm, true, ['verify']);
  return base64(await crypto.subtle.exportKey('spki', key));
}
export async function signText(message: string) {
  const { privateJwk } = await keys();
  const key = await crypto.subtle.importKey('jwk', privateJwk, algorithm, false, ['sign']);
  const signed = await crypto.subtle.sign(
    { name: 'ECDSA', hash: 'SHA-256' },
    key,
    new TextEncoder().encode(message),
  );
  return base64(signed);
}
// Survives a page reload, as Android's does an app restart. Browser tests use this stand-in only.
export const mono = () => Date.now();
export const bootCount = () => 1;
export const modelInfo = () => ({ model: 'Browser test', sdk: 0 });
