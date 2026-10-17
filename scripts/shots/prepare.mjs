// Builds a throwaway database for review screenshots (playwright.shots.config.ts).
//
//   node scripts/shots/prepare.mjs demo    shiv_shots_test: migrations + demo kit + a desk owner
//   node scripts/shots/prepare.mjs empty   shiv_empty_test: migrations + a desk owner (a new store)
//
// The database is dropped and created again each time, on the same loopback server and login as
// TEST_DATABASE_URL in apps/api/.env.test. It never touches shiv_cement_test (the suites' database)
// or the local practice database. Prints the database name only, never the login.
// PG_BIN points at PostgreSQL 16 tools if psql is not found.
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { parseEnv } from 'node:util';

const set = process.argv[2];
if (!['demo', 'empty'].includes(set)) throw new Error('Usage: prepare.mjs demo|empty');
const name = set === 'demo' ? 'shiv_shots_test' : 'shiv_empty_test';
const base = new URL(parseEnv(readFileSync('apps/api/.env.test', 'utf8')).TEST_DATABASE_URL);
if (!['localhost', '127.0.0.1', '[::1]'].includes(base.hostname))
  throw new Error('TEST_DATABASE_URL must point at a loopback server.');
const target = new URL(base);
target.pathname = `/${name}`;

const run = (command, args, env = {}) => {
  const result = spawnSync(command, args, { stdio: 'inherit', env: { ...process.env, ...env } });
  if (result.error || result.status !== 0) throw new Error(`${command} failed`);
};
const psqlDir =
  process.env.PG_BIN ||
  ['/opt/homebrew/opt/postgresql@16/bin', '/usr/local/opt/postgresql@16/bin'].find((path) =>
    existsSync(`${path}/psql`),
  );
const psql = (statement) =>
  run(
    psqlDir ? `${psqlDir}/psql` : 'psql',
    ['-X', '-q', '-v', 'ON_ERROR_STOP=1', '-d', 'postgres', '-c', statement],
    {
      PGHOST: base.hostname.replace(/^\[|\]$/g, ''),
      PGPORT: base.port || '5432',
      PGUSER: decodeURIComponent(base.username),
      PGPASSWORD: decodeURIComponent(base.password),
    },
  );

psql(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);
psql(`CREATE DATABASE "${name}"`);
run('npm', ['run', 'db:migrate', '-w', '@shiv/api'], { DATABASE_URL: target.toString() });
if (set === 'demo')
  run('node', ['scripts/demo.mjs', 'prepare'], { DATABASE_URL: target.toString() });

// One desk owner without a passphrase: test mode lets staff in with the shown code only.
const { PrismaClient } = await import('@prisma/client');
const db = new PrismaClient({ datasourceUrl: target.toString() });
await db.user.create({ data: { phone: '+919900090199', name: 'Screenshot owner', role: 'ADMIN' } });
await db.$disconnect();
console.log(`Prepared ${name} (${set}).`);
