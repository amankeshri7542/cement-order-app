import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  openSync,
  closeSync,
  unlinkSync,
  renameSync,
} from 'node:fs';
import { spawn, spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseEnv } from 'node:util';
import { createRequire } from 'node:module';
import {
  localPorts,
  assertPortFree,
  processInfo,
  isManaged,
  listenerPids,
  stopManaged,
  applicationIdentity,
} from './local-services.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
process.chdir(root);
const local = resolve('.local');
mkdirSync(local, { recursive: true, mode: 0o700 });
const command = process.argv[2] || 'status';
const require = createRequire(import.meta.url);
const ports = ['start', 'serve', 'status'].includes(command)
  ? localPorts(
      process.env,
      existsSync('.local/ports.env') ? parseEnv(readFileSync('.local/ports.env', 'utf8')) : {},
    )
  : {};
const savedServices = () =>
  existsSync('.local/services.json')
    ? JSON.parse(readFileSync('.local/services.json', 'utf8'))
    : [];
const saveServices = (services) => {
  writeFileSync('.local/services.json.tmp', JSON.stringify(services, null, 2), { mode: 0o600 });
  renameSync('.local/services.json.tmp', '.local/services.json');
};
if (['start', 'stop'].includes(command)) {
  let lock;
  try {
    lock = openSync('.local/launcher.lock', 'wx', 0o600);
  } catch (error) {
    if (error.code === 'EEXIST')
      throw new Error(
        'Another launcher operation holds .local/launcher.lock. Wait for it to finish; after a crash, remove the lock only after checking no local start/stop command is running.',
      );
    throw error;
  }
  closeSync(lock);
  process.on('exit', () => unlinkSync('.local/launcher.lock'));
}
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
} else if (command === 'serve') {
  const name = process.argv[3];
  const specs = {
    api: ['apps/api', [require.resolve('tsx/cli'), 'watch', '--env-file=.env', 'src/main.ts']],
    admin: [
      'apps/admin',
      [
        require.resolve('next/dist/bin/next'),
        'dev',
        '--port',
        String(ports.admin),
        '--hostname',
        '127.0.0.1',
      ],
    ],
    customer: [
      'apps/mobile',
      [resolve('scripts/customer-web.mjs'), '--port', String(ports.customer)],
    ],
    storefront: [
      'apps/storefront',
      [
        require.resolve('next/dist/bin/next'),
        'dev',
        '--port',
        String(ports.storefront),
        '--hostname',
        '127.0.0.1',
      ],
    ],
  };
  if (!specs[name]) throw new Error('Unknown local service.');
  const [cwd, args] = specs[name];
  const child = spawn(process.execPath, args, { cwd, stdio: 'inherit' });
  // The launcher signals the whole group; retain the group leader until children exit.
  process.on('SIGTERM', () => child.kill('SIGTERM'));
  process.on('SIGINT', () => child.kill('SIGINT'));
  child.on('error', (error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
  child.on('exit', (code) => {
    process.exitCode = code || 0;
  });
} else if (command === 'start') {
  const previous = savedServices();
  if (previous.some((record) => processInfo(record.pid)))
    throw new Error(
      'Recorded services are still running or their PIDs have been reused. Run local:status, then local:stop before starting.',
    );
  const { env: apiEnv } = config();
  for (const port of [...Object.values(ports), ports.customer + 10]) await assertPortFree(port);
  const apiUrl = `http://localhost:${ports.api}/api/v1`;
  const environments = {
    api: {
      ...apiEnv,
      PORT: String(ports.api),
      CORS_ORIGINS: [ports.admin, ports.customer, ports.storefront]
        .map((port) => `http://localhost:${port}`)
        .join(','),
    },
    admin: { NEXT_PUBLIC_API_URL: apiUrl },
    customer: { EXPO_PUBLIC_API_URL: apiUrl },
    storefront: { NEXT_PUBLIC_API_URL: apiUrl },
  };
  const cleanEnv = Object.fromEntries(
    Object.entries(process.env).filter(
      ([key]) =>
        !/^(DATABASE_URL|TEST_DATABASE_URL|NODE_ENV|PORT|OTP_|CORS_|TRUST_PROXY_|TWILIO_|RAZORPAY_|R2_|FIREBASE_|GOOGLE_VISION_|OPENAI_|RATE_|NEXT_PUBLIC_|EXPO_PUBLIC_|NEXT_DIST_DIR)/.test(
          key,
        ),
    ),
  );
  const portEnv = Object.fromEntries(
    Object.entries(ports).map(([name, port]) => [`LOCAL_${name.toUpperCase()}_PORT`, String(port)]),
  );
  database();
  writeFileSync(
    '.local/ports.env',
    Object.entries(portEnv)
      .map(([key, value]) => `${key}=${value}`)
      .join('\n') + '\n',
    { mode: 0o600 },
  );
  const processes = [];
  try {
    for (const name of Object.keys(ports)) {
      const fd = openSync(`.local/${name}.log`, 'a', 0o600);
      const child = spawn(process.execPath, [fileURLToPath(import.meta.url), 'serve', name], {
        detached: true,
        stdio: ['ignore', fd, fd],
        env: { ...cleanEnv, ...environments[name], ...portEnv, CI: '1' },
      });
      closeSync(fd);
      await new Promise((ok, reject) => {
        child.once('spawn', ok);
        child.once('error', reject);
      });
      let info;
      try {
        info = processInfo(child.pid);
        if (!isManaged({ name, pid: child.pid, root, ...info }, root, info))
          throw new Error(`${name} exited or its process identity could not be verified.`);
      } catch (error) {
        try {
          process.kill(-child.pid, 'SIGTERM');
        } catch (signalError) {
          if (signalError.code !== 'ESRCH') throw signalError;
        }
        throw error;
      }
      processes.push({ name, port: ports[name], pid: child.pid, root, ...info });
      saveServices(processes);
      child.unref();
    }
  } catch (error) {
    for (const record of processes) stopManaged(record, root);
    throw error;
  }
  console.log('Started managed processes. Run npm run local:status to verify readiness:');
  for (const [name, port] of Object.entries(ports))
    console.log(`${name}: http://localhost:${port}${name === 'api' ? '/api/v1/health' : ''}`);
  console.log(
    'Logs: .local/{api,admin,customer,storefront}.log. Port choices saved in .local/ports.env.',
  );
} else if (command === 'stop') {
  const retained = [];
  for (const record of savedServices()) {
    if (!processInfo(record.pid)) continue;
    if (stopManaged(record, root)) {
      const deadline = Date.now() + 8000;
      while (processInfo(record.pid) && Date.now() < deadline)
        await new Promise((resolve) => setTimeout(resolve, 100));
      if (processInfo(record.pid)) {
        retained.push(record);
        console.log(`${record.name} is still shutting down; its ownership record was retained.`);
      } else console.log(`Stopped ${record.name} (managed group ${record.pid}).`);
    } else {
      retained.push(record);
      console.log(
        `Preserved ${record.name} PID ${record.pid}: ownership could not be verified. Inspect it manually; no signal sent.`,
      );
    }
  }
  saveServices(retained);
  if (retained.length) process.exitCode = 1;
  console.log(
    'Database retained. Stop it separately with node scripts/local.mjs db-stop when no tests/services use it.',
  );
} else if (command === 'db-stop') {
  pgRun('pg_ctl', ['-D', '.local/postgres', '-m', 'fast', 'stop']);
} else if (command === 'status') {
  const records = savedServices();
  for (const [name, configuredPort] of Object.entries(ports)) {
    const record = records.find((service) => service.name === name);
    const port = record?.port || configuredPort;
    const listeners = listenerPids(port);
    const owned =
      !!record &&
      isManaged(record, root) &&
      listeners.length > 0 &&
      listeners.every((pid) => processInfo(pid)?.group === record.pid);
    const identities = await Promise.all(
      ['127.0.0.1', '[::1]'].map(async (host) => ({
        host,
        ...(await applicationIdentity(name, `http://${host}:${port}`)),
      })),
    );
    const ready =
      owned &&
      identities.some((identity) => identity.matches) &&
      !identities.some(
        (identity) => !identity.matches && identity.description.startsWith('wrong application'),
      );
    console.log(
      `${name}: ${ready ? 'ready (verified, managed)' : listeners.length ? 'NOT READY / unverified or unrelated listener' : 'not listening'} http://localhost:${port}${name === 'api' ? '/api/v1/health' : ''}`,
    );
    console.log(
      `  ${identities.map(({ host, description }) => `${host}: ${description}`).join(' · ')}; listener PIDs: ${listeners.join(', ') || 'none'}`,
    );
    if (!ready) process.exitCode = 1;
  }
} else throw new Error('Use setup, start, stop, db-stop or status.');
