// Writes app-config.json for a built demo service from the private .local/demo/secrets.env.
// Usage: ZAID=<zaid> node scripts/catalyst-demo/app-config.mjs <api|admin|shop|app>
// AppSail replaces runtime env vars with env_variables on every deploy, so all of them live here.
// The output sits in the gitignored build folder; never copy it into the repository.
import { readFileSync, writeFileSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const secrets = Object.fromEntries(
  readFileSync(join(root, '.local/demo/secrets.env'), 'utf8')
    .split('\n')
    .filter((line) => /^[A-Z_]+=/.test(line))
    .map((line) => {
      const at = line.indexOf('=');
      return [line.slice(0, at), line.slice(at + 1).replace(/^"|"$/g, '')];
    }),
);
const zaid = process.env.ZAID;
if (!/^\d+$/.test(zaid || '')) throw new Error('ZAID must be the project ZAID (digits)');
// Development-environment AppSail URLs in the IN data center.
export const url = (service) => `https://${service}-${zaid}.development.catalystappsail.in`;

const service = process.argv[2];
const shared = { NODE_ENV: 'production', NEXT_TELEMETRY_DISABLED: '1' };
const env = {
  api: {
    ...shared,
    DATABASE_URL: secrets.RUNTIME_DATABASE_URL,
    CORS_ORIGINS: ['admin', 'shop', 'app'].map(url).join(','),
    OTP_PROVIDER: 'mock',
    DEMO_MODE: 'true',
    DEMO_DATABASE_HOST: new URL(secrets.RUNTIME_DATABASE_URL).hostname,
    DEMO_STAFF_CODE: secrets.DEMO_STAFF_CODE,
    OTP_HASH_SECRET: secrets.OTP_HASH_SECRET,
    TRUST_PROXY_HOPS: process.env.TRUST_PROXY_HOPS || '1',
    WHATSAPP_PROVIDER: 'fake',
    ASSISTANT_PROVIDER: 'fallback',
    UPLOADS_PAUSED: 'true',
    EXTRACTION_PAUSED: 'true',
    RELEASE_SHA: process.env.RELEASE_SHA || 'demo',
  },
  admin: shared,
  shop: { ...shared, SITE_URL: url('shop') },
  app: {},
}[service];
if (!env) throw new Error('Usage: app-config.mjs <api|admin|shop|app>');
for (const [key, value] of Object.entries(env))
  if (!value) throw new Error(`${key} is missing from .local/demo/secrets.env`);

const file = join(root, '.local/demo/build', service, 'app-config.json');
writeFileSync(
  file,
  `${JSON.stringify(
    {
      command: 'node start.js',
      build_path: '.',
      stack: 'node22',
      memory: service === 'api' ? 1024 : 512,
      env_variables: env,
      scripts: {},
    },
    null,
    2,
  )}\n`,
  { mode: 0o600 },
);
console.log(`wrote ${service}/app-config.json (${Object.keys(env).length} variables)`);
