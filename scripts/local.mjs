import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  openSync,
  closeSync,
  unlinkSync,
} from 'node:fs';
import { spawn, spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseEnv } from 'node:util';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
process.chdir(root);
const local = resolve('.local');
mkdirSync(local, { recursive: true, mode: 0o700 });
const command = process.argv[2] || 'status';
function run(bin, args, options = {}) {
  const result = spawnSync(bin, args, { stdio: 'inherit', ...options });
  if (result.error || result.status !== 0)
    throw new Error(`${bin} failed (${result.error?.message || result.status}). See output above.`);
}
const pg =
  process.env.PG_BIN ||
  ['/opt/homebrew/opt/postgresql@16/bin', '/usr/local/opt/postgresql@16/bin'].find((path) =>
    existsSync(`${path}/pg_ctl`),
  );
function pgRun(bin, args) {
  if (!pg) throw new Error('Install PostgreSQL 16 with brew install postgresql@16, or set PG_BIN.');
  run(`${pg}/${bin}`, args);
}
function saveIfMissing(path, content) {
  if (!existsSync(path)) writeFileSync(path, content, { mode: 0o600 });
}
function config() {
  if (!existsSync('apps/api/.env')) throw new Error('Run npm run local:setup first.');
  const env = parseEnv(readFileSync('apps/api/.env', 'utf8'));
  const url = new URL(env.DATABASE_URL);
  if (
    !['127.0.0.1', 'localhost'].includes(url.hostname) ||
    env.NODE_ENV === 'production' ||
    env.OTP_PROVIDER !== 'mock'
  )
    throw new Error(
      'Local commands require loopback PostgreSQL, non-production NODE_ENV and mock OTP.',
    );
  return { env, url };
}
function database() {
  const { url } = config();
  if (!pg) throw new Error('PostgreSQL tools missing. Set PG_BIN or install postgresql@16.');
  if (
    spawnSync(`${pg}/pg_isready`, ['-h', url.hostname, '-p', url.port || '5432'], {
      stdio: 'ignore',
    }).status === 0
  )
    return;
  if (!existsSync('.local/postgres/PG_VERSION')) {
    writeFileSync('.local/pg-password', decodeURIComponent(url.password), { mode: 0o600 });
    try {
      pgRun('initdb', [
        '-D',
        '.local/postgres',
        '-U',
        decodeURIComponent(url.username),
        '--auth-host=scram-sha-256',
        '--auth-local=trust',
        '--pwfile=.local/pg-password',
      ]);
    } finally {
      unlinkSync('.local/pg-password');
    }
  }
  pgRun('pg_ctl', [
    '-D',
    '.local/postgres',
    '-l',
    '.local/postgres.log',
    '-o',
    `-h 127.0.0.1 -p ${url.port || '5432'} -k /tmp`,
    'start',
  ]);
}

if (command === 'setup') {
  saveIfMissing(
    'apps/api/.env',
    `NODE_ENV=development\nPORT=4000\nDATABASE_URL=postgresql://shiv:local-development-only@127.0.0.1:55439/shiv_cement\nCORS_ORIGINS=http://localhost:3000,http://localhost:8081\nOTP_PROVIDER=mock\nOTP_HASH_SECRET=${randomBytes(32).toString('hex')}\n`,
  );
  saveIfMissing('apps/admin/.env', 'NEXT_PUBLIC_API_URL=http://localhost:4000/api/v1\n');
  saveIfMissing('apps/mobile/.env', 'EXPO_PUBLIC_API_URL=http://localhost:4000/api/v1\n');
  const { env, url } = config();
  const defaultTestUrl = new URL(url);
  defaultTestUrl.pathname = '/shiv_cement_test';
  saveIfMissing('apps/api/.env.test', `TEST_DATABASE_URL=${defaultTestUrl}\n`);
  const testEnv = parseEnv(readFileSync('apps/api/.env.test', 'utf8'));
  const testUrl = new URL(testEnv.TEST_DATABASE_URL || '');
  if (
    !['postgres:', 'postgresql:'].includes(testUrl.protocol) ||
    !['127.0.0.1', 'localhost'].includes(testUrl.hostname) ||
    (testUrl.port || '5432') !== (url.port || '5432') ||
    testUrl.username !== url.username ||
    testUrl.password !== url.password ||
    !testUrl.pathname.endsWith('_test') ||
    testUrl.pathname === url.pathname
  )
    throw new Error(
      'apps/api/.env.test must use the same local PostgreSQL server and credentials as apps/api/.env, with a separate database name ending in _test. Existing files were preserved; correct TEST_DATABASE_URL before retrying setup.',
    );
  database();
  run('npm', ['run', 'db:generate']);
  run('npm', ['run', 'build', '-w', '@shiv/shared']);
  const { PrismaClient } = await import('@prisma/client');
  const adminUrl = new URL(url);
  adminUrl.pathname = '/postgres';
  const admin = new PrismaClient({ datasourceUrl: adminUrl.toString() });
  try {
    for (const dbName of [url.pathname.slice(1), testUrl.pathname.slice(1)]) {
      if (!/^[a-z][a-z0-9_]*$/.test(dbName)) throw new Error('Use a simple local database name.');
      const rows = await admin.$queryRaw`SELECT datname FROM pg_database WHERE datname = ${dbName}`;
      if (!rows.length) await admin.$executeRawUnsafe(`CREATE DATABASE "${dbName}"`);
    }
  } finally {
    await admin.$disconnect();
  }
  run('npm', ['run', 'db:migrate'], { env: { ...process.env, ...env } });
  run('npm', ['run', 'db:migrate'], { env: { ...process.env, DATABASE_URL: testUrl.toString() } });
  run('npm', ['run', 'local:fixtures', '-w', '@shiv/api'], { env: { ...process.env, ...env } });
  console.log('Ready. npm run local:start; see docs/LOCAL_TESTING.md for local accounts.');
} else if (command === 'start') {
  database();
  const { env: apiEnv } = config();
  if (String(apiEnv.PORT || '4000') !== '4000')
    throw new Error(
      'Local launcher expects API PORT=4000. Use individual service commands for custom ports.',
    );
  const environments = {
    api: apiEnv,
    admin: parseEnv(readFileSync('apps/admin/.env', 'utf8')),
    customer: parseEnv(readFileSync('apps/mobile/.env', 'utf8')),
  };
  for (const [key, value] of [
    ['NEXT_PUBLIC_API_URL', environments.admin.NEXT_PUBLIC_API_URL],
    ['EXPO_PUBLIC_API_URL', environments.customer.EXPO_PUBLIC_API_URL],
  ]) {
    if (value !== 'http://localhost:4000/api/v1')
      throw new Error(`${key} must be http://localhost:4000/api/v1 for the local launcher.`);
  }
  const cleanEnv = Object.fromEntries(
    Object.entries(process.env).filter(
      ([key]) =>
        !/^(DATABASE_URL|TEST_DATABASE_URL|NODE_ENV|PORT|OTP_|CORS_|TRUST_PROXY_|TWILIO_|RAZORPAY_|R2_|FIREBASE_|GOOGLE_VISION_|OPENAI_|RATE_|NEXT_PUBLIC_|EXPO_PUBLIC_|NEXT_DIST_DIR)/.test(
          key,
        ),
    ),
  );
  const { createServer } = await import('node:net');
  for (const port of [4000, 3000, 8081])
    await new Promise((ok, reject) => {
      const server = createServer();
      server.once('error', () =>
        reject(
          new Error(
            `Port ${port} is occupied. Use npm run local:status; stop its existing service before starting.`,
          ),
        ),
      );
      server.listen(port, '127.0.0.1', () => server.close(ok));
    });
  const processes = [];
  for (const [name, script] of [
    ['api', 'dev:api'],
    ['admin', 'dev:admin'],
    ['customer', 'dev:web'],
  ]) {
    const fd = openSync(`.local/${name}.log`, 'a', 0o600);
    const child = spawn('npm', ['run', script], {
      detached: true,
      stdio: ['ignore', fd, fd],
      env: { ...cleanEnv, ...environments[name], CI: '1' },
    });
    child.unref();
    closeSync(fd);
    processes.push({
      name,
      pid: child.pid,
      started: spawnSync('ps', ['-p', String(child.pid), '-o', 'lstart='], {
        encoding: 'utf8',
      }).stdout?.trim(),
    });
  }
  writeFileSync('.local/services.json', JSON.stringify(processes), { mode: 0o600 });
  console.log(
    'Starting: customer http://localhost:8081 · owners http://localhost:3000 · API http://localhost:4000/api/v1/health. Logs: .local/{api,admin,customer}.log',
  );
} else if (command === 'stop') {
  if (existsSync('.local/services.json')) {
    for (const { pid, name, started } of JSON.parse(readFileSync('.local/services.json', 'utf8'))) {
      const args =
        spawnSync('ps', ['-p', String(pid), '-o', 'command='], { encoding: 'utf8' }).stdout || '';
      const sameProcess =
        !started ||
        spawnSync('ps', ['-p', String(pid), '-o', 'lstart='], {
          encoding: 'utf8',
        }).stdout?.trim() === started;
      if (sameProcess && args.includes('npm run dev:')) {
        try {
          process.kill(-pid, 'SIGTERM');
          console.log(`Stopped ${name}.`);
        } catch {
          /* already stopped */
        }
      }
    }
    unlinkSync('.local/services.json');
  }
  console.log(
    'Database retained. Stop it separately with node scripts/local.mjs db-stop when no tests/services use it.',
  );
} else if (command === 'db-stop') {
  pgRun('pg_ctl', ['-D', '.local/postgres', '-m', 'fast', 'stop']);
} else if (command === 'status') {
  for (const [name, url] of [
    ['API', 'http://localhost:4000/api/v1/health'],
    ['Owners', 'http://localhost:3000'],
    ['Customer', 'http://localhost:8081'],
  ]) {
    try {
      const result = await fetch(url, { signal: globalThis.AbortSignal.timeout(5000) });
      console.log(`${name}: ${result.status} ${url}`);
    } catch {
      console.log(`${name}: not responding ${url}`);
    }
  }
} else throw new Error('Use setup, start, stop, db-stop or status.');
