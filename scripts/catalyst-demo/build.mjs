// Builds Linux bundles for the Zoho Catalyst AppSail demo (managed node22 runtime, no Docker).
// Usage: node scripts/catalyst-demo/build.mjs <api|admin|shop|app|all>
// Frontends need API_ORIGIN plus their own origin (ADMIN_ORIGIN, SHOP_ORIGIN, APP_ORIGIN): each one
// serves the API on its own origin at /api/v1, because the AppSail gateway answers CORS preflights
// itself and never forwards them to the API. Example:
//   API_ORIGIN=https://api-1.development.catalystappsail.in \
//   ADMIN_ORIGIN=https://admin-1.development.catalystappsail.in node scripts/catalyst-demo/build.mjs admin
// Output: .local/demo/build/<service>, each with start.js that binds AppSail's listen port.
import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const out = join(root, '.local/demo/build');
const linux = ['--os=linux', '--cpu=x64', '--libc=glibc'];
// AppSail's base image is not documented; Prisma loads whichever engine matches at runtime.
const prismaTargets = [
  'native',
  'debian-openssl-3.0.x',
  'debian-openssl-1.1.x',
  'rhel-openssl-3.0.x',
  'rhel-openssl-1.1.x',
];

const run = (cmd, args, opts = {}) =>
  execFileSync(cmd, args, {
    cwd: root,
    stdio: 'inherit',
    ...opts,
    env: { ...process.env, ...opts.env },
  });
const fresh = (name) => {
  const dir = join(out, name);
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  return dir;
};
const copy = (from, to) => cpSync(join(root, from), to, { recursive: true });
const origin = (key) => {
  const value = process.env[key];
  if (!value || new URL(value).origin !== value || !value.startsWith('https://'))
    throw new Error(`${key} must be an exact https:// origin`);
  return value;
};
// AppSail hands the port in X_ZOHO_CATALYST_LISTEN_PORT; the apps read PORT.
const starter = (entry, extra = '') =>
  `process.env.PORT = process.env.X_ZOHO_CATALYST_LISTEN_PORT || process.env.PORT || '9000';\n` +
  `process.env.HOSTNAME = '0.0.0.0';\n${extra}require(${JSON.stringify(entry)});\n`;

function api() {
  run('npm', ['run', 'build', '-w', '@shiv/i18n']);
  run('npm', ['run', 'build', '-w', '@shiv/shared']);
  run('npm', ['run', 'build', '-w', '@shiv/api']);
  const dir = fresh('api');
  for (const file of [
    'package.json',
    'package-lock.json',
    'apps/api/package.json',
    'packages/shared/package.json',
    'packages/i18n/package.json',
  ])
    copy(file, join(dir, file));
  run(
    'npm',
    [
      'ci',
      '--omit=dev',
      '--ignore-scripts',
      '--workspace',
      '@shiv/api',
      '--workspace',
      '@shiv/shared',
      '--include-workspace-root=false',
      ...linux,
    ],
    { cwd: dir },
  );
  for (const path of [
    'packages/shared/dist',
    'packages/i18n/dist',
    'apps/api/dist',
    'apps/api/prisma',
  ])
    copy(path, join(dir, path));
  const schema = join(dir, 'apps/api/prisma/schema.prisma');
  writeFileSync(
    schema,
    readFileSync(schema, 'utf8').replace(
      'provider = "prisma-client-js"',
      `provider = "prisma-client-js"\n  binaryTargets = ${JSON.stringify(prismaTargets)}`,
    ),
  );
  run(
    process.execPath,
    [join(root, 'node_modules/prisma/build/index.js'), 'generate', `--schema=${schema}`],
    {
      cwd: dir,
    },
  );
  writeFileSync(join(dir, 'start.js'), starter('./apps/api/dist/main.js'));
}

function next(name, workspace, appDir, self) {
  const api = origin('API_ORIGIN');
  const own = `${origin(self)}/api/v1`;
  const distDir = '.next-catalyst';
  run('npm', ['run', 'build', '-w', '@shiv/i18n']);
  run('npm', ['run', 'build', '-w', '@shiv/shared']);
  if (workspace === '@shiv/admin') run('npm', ['run', 'build', '-w', '@shiv/design']);
  run('npm', ['run', 'build', '-w', workspace], {
    env: {
      NEXT_DIST_DIR: distDir,
      NEXT_PUBLIC_API_URL: own,
      API_PROXY_ORIGIN: api,
      NEXT_TELEMETRY_DISABLED: '1',
    },
  });
  const dir = fresh(name);
  const built = join(root, appDir, distDir);
  cpSync(join(built, 'standalone'), dir, { recursive: true });
  cpSync(join(built, 'static'), join(dir, appDir, distDir, 'static'), { recursive: true });
  if (existsSync(join(root, appDir, 'public')))
    copy(join(appDir, 'public'), join(dir, appDir, 'public'));
  // Next traces this Mac's sharp binary; swap in the Linux build image optimisation needs.
  if (existsSync(join(dir, 'node_modules/sharp'))) {
    const version = JSON.parse(
      readFileSync(join(dir, 'node_modules/sharp/package.json'), 'utf8'),
    ).version;
    rmSync(join(dir, 'node_modules/@img'), { recursive: true, force: true });
    const tmp = fresh(`${name}-sharp`);
    writeFileSync(join(tmp, 'package.json'), '{"private":true}');
    run('npm', ['install', '--no-save', '--ignore-scripts', ...linux, `sharp@${version}`], {
      cwd: tmp,
    });
    cpSync(join(tmp, 'node_modules/@img'), join(dir, 'node_modules/@img'), { recursive: true });
    rmSync(tmp, { recursive: true, force: true });
  }
  writeFileSync(
    join(dir, 'start.js'),
    starter(`./${appDir}/server.js`, `process.env.NEXT_PUBLIC_API_URL = ${JSON.stringify(own)};\n`),
  );
}

function app() {
  const api = origin('API_ORIGIN');
  const shop = origin('SHOP_ORIGIN');
  const own = `${origin('APP_ORIGIN')}/api/v1`;
  const dir = fresh('app');
  // --clear: a warm Metro cache keeps the API URL from apps/mobile/.env (localhost).
  run(
    'npx',
    ['expo', 'export', '--platform', 'web', '--clear', '--output-dir', join(dir, 'dist')],
    {
      cwd: join(root, 'apps/mobile'),
      env: {
        EXPO_PUBLIC_APP_ENV: 'staging',
        EXPO_PUBLIC_API_URL: own,
        EXPO_PUBLIC_PRIVACY_URL: `${shop}/privacy`,
      },
    },
  );
  copy('apps/mobile/web-security.cjs', join(dir, 'web-security.cjs'));
  copy('scripts/catalyst-demo/app-server.mjs', join(dir, 'app-server.mjs'));
  writeFileSync(join(dir, 'package.json'), '{"private":true,"type":"commonjs"}\n');
  writeFileSync(
    join(dir, 'start.js'),
    `process.env.PORT = process.env.X_ZOHO_CATALYST_LISTEN_PORT || process.env.PORT || '9000';\n` +
      `process.env.CUSTOMER_DIST = __dirname + '/dist';\n` +
      `process.env.API_PROXY_ORIGIN = ${JSON.stringify(api)};\n` +
      // web-security.cjs builds the CSP connect-src from this and refuses a non-HTTPS API.
      `process.env.EXPO_PUBLIC_API_URL = ${JSON.stringify(own)};\n` +
      `import('./app-server.mjs');\n`,
  );
}

const target = process.argv[2];
const steps = {
  api,
  admin: () => next('admin', '@shiv/admin', 'apps/admin', 'ADMIN_ORIGIN'),
  shop: () => next('shop', '@shiv/storefront', 'apps/storefront', 'SHOP_ORIGIN'),
  app,
};
if (target === 'all') for (const step of Object.values(steps)) step();
else if (steps[target]) steps[target]();
else throw new Error('Usage: build.mjs <api|admin|shop|app|all>');
