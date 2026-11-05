// Makes the offline key that signs this program's updates. Run once, on a machine you trust, and keep
// the private half off every server and out of this public repository. Nothing here is uploaded.
// Usage: node make-update-key.mjs <folder outside the repository>
import { generateKeyPairSync } from 'node:crypto';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const folder = process.argv[2];
if (!folder) {
  console.error('Give a folder outside the repository to keep the key in.');
  process.exit(2);
}
mkdirSync(folder, { recursive: true, mode: 0o700 });
const privatePath = join(folder, 'update-key.pem');
if (existsSync(privatePath)) {
  console.error(
    `${privatePath} already exists. Every PC trusts that key: it is not replaced here.`,
  );
  process.exit(1);
}
const { privateKey, publicKey } = generateKeyPairSync('ed25519');
writeFileSync(privatePath, privateKey.export({ format: 'pem', type: 'pkcs8' }), { mode: 0o600 });
writeFileSync(join(folder, 'update-key.pub'), publicKey.export({ format: 'pem', type: 'spki' }));
console.log(`Keep ${privatePath} offline. Build with ${join(folder, 'update-key.pub')}.`);
