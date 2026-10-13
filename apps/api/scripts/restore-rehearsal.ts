import { strict as assert } from 'node:assert';
import { randomBytes } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { loadEnvFile } from 'node:process';
import { Db } from '../src/db';

process.umask(0o077);
loadEnvFile('.env.test');
const source = new URL(process.env.TEST_DATABASE_URL || '');
if (
  !['localhost', '127.0.0.1', '::1'].includes(source.hostname) ||
  !source.pathname.endsWith('_test')
)
  throw new Error('Restore rehearsal requires loopback TEST_DATABASE_URL ending in _test');
const pg =
  process.env.PG_BIN ||
  ['/opt/homebrew/opt/postgresql@16/bin', '/usr/local/opt/postgresql@16/bin'].find((dir) =>
    existsSync(`${dir}/pg_dump`),
  );
if (!pg) throw new Error('Set PG_BIN to PostgreSQL 16 tools');
const suffix = randomBytes(8).toString('hex');
const name = `shiv_restore_${suffix}_test`,
  role = `shiv_runtime_${suffix}`;
const target = new URL(source);
target.pathname = `/${name}`;
const adminUrl = new URL(source);
adminUrl.pathname = '/postgres';
const admin = new Db({ datasourceUrl: adminUrl.href }),
  original = new Db({ datasourceUrl: source.href }),
  restored = new Db({ datasourceUrl: target.href });
const directory = resolve('../../.local/security-hardening');
mkdirSync(directory, { recursive: true, mode: 0o700 });
const dump = resolve(directory, 'disposable-restore.dump');
async function fingerprint(db: Db) {
  const tables = await db.$queryRaw<
    { tablename: string }[]
  >`SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename`;
  const values: Record<string, unknown> = {};
  for (const { tablename } of tables) {
    assert(/^[A-Za-z_][A-Za-z0-9_]*$/.test(tablename));
    const [result] = await db.$queryRawUnsafe<{ count: number; digest: string }[]>(
      `SELECT count(*)::int AS count, md5(COALESCE(string_agg(row_to_json(t)::text, '' ORDER BY row_to_json(t)::text), '')) AS digest FROM "${tablename}" t`,
    );
    values[tablename] = result;
  }
  return values;
}
async function main() {
  let created = false,
    roleCreated = false;
  let runtime: Db | undefined;
  try {
    const before = await fingerprint(original);
    // Credentials travel in the child environment, never argv/logs.
    const env = {
      ...process.env,
      PGHOST: source.hostname,
      PGPORT: source.port,
      PGUSER: decodeURIComponent(source.username),
      PGPASSWORD: decodeURIComponent(source.password),
    };
    execFileSync(
      `${pg}/pg_dump`,
      [
        '--format=custom',
        '--no-owner',
        '--no-privileges',
        '--file',
        dump,
        source.pathname.slice(1),
      ],
      { env, stdio: 'pipe' },
    );
    await admin.$executeRawUnsafe(`CREATE DATABASE "${name}"`);
    created = true;
    execFileSync(
      `${pg}/pg_restore`,
      ['--exit-on-error', '--no-owner', '--no-privileges', '--dbname', name, dump],
      { env, stdio: 'pipe' },
    );
    assert.deepEqual(await fingerprint(restored), before);
    await assert.rejects(restored.assertRuntimeRole(), /restricted runtime/);
    const password = randomBytes(32).toString('hex');
    await admin.$executeRawUnsafe(
      `CREATE ROLE "${role}" LOGIN PASSWORD '${password}' NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS`,
    );
    roleCreated = true;
    for (const sql of [
      'REVOKE CREATE ON SCHEMA public FROM PUBLIC',
      `GRANT CONNECT ON DATABASE "${name}" TO "${role}"`,
      `GRANT USAGE ON SCHEMA public TO "${role}"`,
      `GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO "${role}"`,
      `GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO "${role}"`,
      `REVOKE ALL ON TABLE "_prisma_migrations" FROM "${role}"`,
    ])
      await restored.$executeRawUnsafe(sql);
    const runtimeUrl = new URL(target);
    runtimeUrl.username = role;
    runtimeUrl.password = password;
    runtime = new Db({ datasourceUrl: runtimeUrl.href });
    await runtime.assertRuntimeRole();
    assert((await runtime.product.count()) > 0);
    await assert.rejects(runtime.$executeRawUnsafe('CREATE TABLE "ForbiddenDDL" (id integer)'));
    await assert.rejects(runtime.$queryRawUnsafe('SELECT * FROM "_prisma_migrations"'));
    await assert.rejects(runtime.$executeRawUnsafe('UPDATE "InventoryMovement" SET note = note'));
    const user = await runtime.user.findFirstOrThrow();
    await runtime.user.update({ where: { id: user.id }, data: { name: user.name } });
    writeFileSync(
      resolve(directory, 'restore-result.json'),
      JSON.stringify(
        {
          result: 'PASS',
          syntheticDataOnly: true,
          tables: Object.keys(before).length,
          fingerprintsMatched: true,
          restrictedRuntimeCrud: true,
          ddlDenied: true,
          migrationTableDenied: true,
          immutableLedgerPreserved: true,
        },
        null,
        2,
      ),
    );
    console.log(
      'PASS: disposable dump/restore matches every table; restricted runtime CRUD works; DDL, migration metadata and ledger mutation denied.',
    );
  } finally {
    await runtime?.$disconnect();
    await restored.$disconnect();
    await original.$disconnect();
    if (created) await admin.$executeRawUnsafe(`DROP DATABASE "${name}" WITH (FORCE)`);
    if (roleCreated) await admin.$executeRawUnsafe(`DROP ROLE "${role}"`);
    await admin.$disconnect();
  }
}
void main().catch((error) => {
  console.error(error instanceof Error ? error.message : 'Restore rehearsal failed');
  process.exitCode = 1;
});
