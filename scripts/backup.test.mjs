// Runs the real backup and restore scripts against a real Postgres. Nothing here is mocked except
// the upload tool, which is replaced to prove what happens when an upload fails.
//   TEST_DATABASE_URL must be a loopback database ending in _test. PG_BIN may name PostgreSQL 16.
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const backupScript = join(root, 'infra/backup.sh');
const drillScript = join(root, 'infra/restore-drill.sh');
const source = new URL(process.env.TEST_DATABASE_URL ?? '');
assert.ok(
  ['localhost', '127.0.0.1'].includes(source.hostname) && source.pathname.endsWith('_test'),
  'Backup tests need a loopback TEST_DATABASE_URL ending in _test',
);
const pgBin =
  process.env.PG_BIN ??
  ['/opt/homebrew/opt/postgresql@16/bin', '/usr/lib/postgresql/16/bin'].find((dir) =>
    existsSync(`${dir}/pg_dump`),
  );
assert.ok(pgBin, 'Set PG_BIN to PostgreSQL 16 tools');

const work = mkdtempSync(join(tmpdir(), 'shiv-backup-test-'));
const database = `shiv_backup_${process.pid}_test`;
const phone = '+919999123456';
const pg = {
  PGHOST: source.hostname,
  PGPORT: source.port || '5432',
  PGUSER: decodeURIComponent(source.username),
  PGPASSWORD: decodeURIComponent(source.password),
};
const base = {
  ...process.env,
  ...pg,
  PATH: `${pgBin}:${process.env.PATH}`,
  TMPDIR: work,
};
const key = join(work, 'key.pem');
const cert = join(work, 'cert.pem');
const makeKey = (keyFile, certFile) =>
  execFileSync(
    'openssl',
    ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', keyFile, '-out', certFile, '-days', '1', '-subj', '/CN=backup-test'],
    { stdio: 'pipe' },
  );
const sql = (query, db = database) =>
  execFileSync('psql', ['--no-psqlrc', '-qtA', '-v', 'ON_ERROR_STOP=1', '-d', db, '-c', query], {
    env: base,
    encoding: 'utf8',
  }).trim();
const folder = (name) => {
  const dir = join(work, name);
  mkdirSync(dir, { recursive: true });
  return dir;
};
const drillRole = `shiv_drill_${process.pid}`;
const run = (script, args, env = {}) => {
  const result = spawnSync('bash', [script, ...args], {
    env: {
      ...base,
      // A drill never runs as a superuser, as a false backup would be SQL running with that power.
      ...(script === drillScript ? { PGUSER: drillRole } : {}),
      PGDATABASE: database,
      BACKUP_CERT: cert,
      BACKUP_KEY: key,
      ...env,
    },
    encoding: 'utf8',
  });
  return { status: result.status, output: `${result.stdout}${result.stderr}` };
};
const dumps = (dir) =>
  readdirSync(dir)
    .filter((name) => name.endsWith('.dump.cms'))
    .sort();
const leftoverDatabases = () =>
  sql(`SELECT count(*) FROM pg_database WHERE datname LIKE 'shiv_restore_%'`, 'postgres');

before(() => {
  makeKey(key, cert);
  sql(`CREATE ROLE ${drillRole} LOGIN CREATEDB`, 'postgres');
  execFileSync('createdb', [database], { env: base });
  execFileSync('npx', ['prisma', 'migrate', 'deploy'], {
    cwd: join(root, 'apps/api'),
    env: {
      ...base,
      DATABASE_URL: `postgresql://${source.username}${source.password ? `:${source.password}` : ''}@${source.host}/${database}`,
    },
    stdio: 'pipe',
  });
  sql(`INSERT INTO "User" (id, phone, name, role, "updatedAt")
       VALUES ('backup-person', '${phone}', 'Backup Person', 'CUSTOMER', now())`);
  sql(`INSERT INTO "Category" (id, name, slug) VALUES ('backup-cat', 'Cement', 'backup-cement')`);
  sql(`INSERT INTO "Product" (id, name, brand, "categoryId", type, grade, unit, "pricePaise", stock,
         description, "recommendedUse", images, "updatedAt")
       VALUES ('backup-product', 'Cement', 'Test', 'backup-cat', 'PPC', 'PPC', 'bag', 100, 42,
         'x', 'x', '{}', now())`);
});
after(() => {
  spawnSync('dropdb', ['--if-exists', '--force', database], { env: base });
  spawnSync('psql', ['-d', 'postgres', '-c', `DROP ROLE IF EXISTS ${drillRole}`], { env: base });
  rmSync(work, { recursive: true, force: true });
});

test('a nightly backup restores, and every check passes', () => {
  const dir = folder('good');
  const made = run(backupScript, ['nightly'], { BACKUP_DIR: dir });
  assert.equal(made.status, 0, made.output);
  assert.match(made.output, /BACKUP OK/);
  const drill = run(drillScript, ['dump'], { BACKUP_DIR: dir });
  assert.equal(drill.status, 0, drill.output);
  assert.match(drill.output, /DRILL OK/);
  assert.match(readFileSync(join(dir, 'restore-drills.log'), 'utf8'), /PASS shiv-/);
  assert.equal(leftoverDatabases(), '0');
});

test('the backup cannot be read without the key, and only its owner can open the file', () => {
  const dir = folder('private');
  assert.equal(run(backupScript, ['nightly'], { BACKUP_DIR: dir }).status, 0);
  for (const name of readdirSync(dir).filter((file) => file.endsWith('.cms'))) {
    const bytes = readFileSync(join(dir, name));
    assert.equal(bytes.includes(phone), false, 'phone number readable in the file');
    assert.equal(bytes.includes('Backup Person'), false, 'name readable in the file');
    assert.equal(statSync(join(dir, name)).mode & 0o077, 0, 'file open to other users');
  }
});

test('a password never appears in the output', () => {
  const dir = folder('secret');
  const made = run(backupScript, ['nightly'], {
    BACKUP_DIR: dir,
    PGPASSWORD: 'a-very-secret-password',
  });
  assert.equal(made.output.includes('a-very-secret-password'), false);
});

test('a damaged backup is refused, and no restore database is left behind', () => {
  const dir = folder('damaged');
  assert.equal(run(backupScript, ['nightly'], { BACKUP_DIR: dir }).status, 0);
  const file = join(dir, dumps(dir)[0]);
  const bytes = readFileSync(file);
  bytes[Math.floor(bytes.length / 2)] ^= 1;
  writeFileSync(file, bytes);
  const drill = run(drillScript, ['dump'], { BACKUP_DIR: dir });
  assert.notEqual(drill.status, 0);
  assert.match(drill.output, /could not be decrypted/);
  assert.equal(leftoverDatabases(), '0');
});

test('the wrong key is refused', () => {
  const dir = folder('wrong-key');
  assert.equal(run(backupScript, ['nightly'], { BACKUP_DIR: dir }).status, 0);
  const otherKey = join(work, 'other-key.pem');
  const otherCert = join(work, 'other-cert.pem');
  makeKey(otherKey, otherCert);
  const drill = run(drillScript, ['dump'], {
    BACKUP_DIR: dir,
    BACKUP_KEY: otherKey,
    BACKUP_CERT: otherCert,
  });
  assert.notEqual(drill.status, 0);
  assert.match(drill.output, /could not be decrypted/);
});

test('a drill can never run against another machine', () => {
  const dir = folder('remote');
  assert.equal(run(backupScript, ['nightly'], { BACKUP_DIR: dir }).status, 0);
  const drill = run(drillScript, ['dump'], { BACKUP_DIR: dir, PGHOST: 'db.example.test' });
  assert.notEqual(drill.status, 0);
  assert.match(drill.output, /must be this machine/);
});

test('a drill refuses to run as a superuser', () => {
  const dir = folder('superuser');
  assert.equal(run(backupScript, ['nightly'], { BACKUP_DIR: dir }).status, 0);
  const drill = run(drillScript, ['dump'], { BACKUP_DIR: dir, PGUSER: pg.PGUSER });
  assert.notEqual(drill.status, 0);
  assert.match(drill.output, /not a superuser/);
  assert.equal(leftoverDatabases(), '0');
});

/** Replaces a backup's row counts, as someone holding the server's public certificate could. */
function forgeCounts(dir, text) {
  const counts = join(dir, dumps(dir)[0].replace('.dump.cms', '.counts.cms'));
  const plain = join(work, 'forged.txt');
  writeFileSync(plain, text);
  execFileSync('openssl', ['cms', '-encrypt', '-binary', '-aes-256-gcm', '-outform', 'DER', '-in', plain, '-out', counts, cert]);
}

test('a forged row count cannot run commands on the key holder’s computer', () => {
  const dir = folder('forged');
  const proof = join(work, 'forged-proof');
  assert.equal(run(backupScript, ['nightly'], { BACKUP_DIR: dir }).status, 0);
  forgeCounts(dir, `Order=a[$(touch ${proof})]\n`);
  const drill = run(drillScript, ['dump'], { BACKUP_DIR: dir });
  assert.notEqual(drill.status, 0);
  assert.match(drill.output, /not a number/);
  assert.equal(existsSync(proof), false, 'a command inside the backup ran');
});

test('a forged table name cannot reach the database', () => {
  const dir = folder('forged-table');
  assert.equal(run(backupScript, ['nightly'], { BACKUP_DIR: dir }).status, 0);
  forgeCounts(dir, 'User"; DROP TABLE "Order"; --=1\n');
  const drill = run(drillScript, ['dump'], { BACKUP_DIR: dir });
  assert.notEqual(drill.status, 0);
  assert.match(drill.output, /unknown table/);
});

test('rows lost between backup and restore fail the drill', () => {
  const dir = folder('lost-rows');
  assert.equal(run(backupScript, ['nightly'], { BACKUP_DIR: dir }).status, 0);
  forgeCounts(dir, 'Order=999\n');
  const drill = run(drillScript, ['dump'], { BACKUP_DIR: dir });
  assert.notEqual(drill.status, 0);
  assert.match(drill.output, /Order has 0 rows, and the backup held 999/);
  assert.equal(leftoverDatabases(), '0');
});

test('stock that does not add up fails the drill', () => {
  const dir = folder('bad-stock');
  sql(`SELECT set_config('shiv.stock_direct', 'on', false);
       UPDATE "Product" SET stock = 43 WHERE id = 'backup-product';`);
  try {
    assert.equal(run(backupScript, ['nightly'], { BACKUP_DIR: dir }).status, 0);
    // The bridge keeps a direct write in step, so this forces the two apart in a dump's data.
    sql(`ALTER TABLE "Product" DISABLE TRIGGER product_stock_bridge;
         UPDATE "Product" SET stock = 99 WHERE id = 'backup-product';`);
    assert.equal(run(backupScript, ['nightly'], { BACKUP_DIR: dir }).status, 0);
    const drill = run(drillScript, ['dump'], { BACKUP_DIR: dir });
    assert.notEqual(drill.status, 0);
    assert.match(drill.output, /stock does not add up: backup-product/);
  } finally {
    sql(`UPDATE "Product" SET stock = 42 WHERE id = 'backup-product';
         ALTER TABLE "Product" ENABLE TRIGGER product_stock_bridge;
         UPDATE "StockLevel" SET quantity = 42 WHERE "productId" = 'backup-product';`);
  }
});

test('a database that cannot be reached leaves no half-made file', () => {
  const dir = folder('down');
  const made = run(backupScript, ['nightly'], { BACKUP_DIR: dir, PGPORT: '1' });
  assert.notEqual(made.status, 0);
  assert.deepEqual(readdirSync(dir), []);
  assert.equal(existsSync(join(dir, 'last-nightly')), false);
});

test('a missing certificate stops before anything is written', () => {
  const dir = folder('no-cert');
  const made = run(backupScript, ['nightly'], { BACKUP_DIR: dir, BACKUP_CERT: join(work, 'none.pem') });
  assert.notEqual(made.status, 0);
  assert.match(made.output, /cannot read the certificate/);
  assert.deepEqual(readdirSync(dir), []);
});

test('only the newest dumps stay on the server', () => {
  const dir = folder('keep');
  for (const old of ['20200101T000000Z', '20200102T000000Z', '20200103T000000Z'])
    for (const kind of ['dump', 'counts'])
      writeFileSync(join(dir, `shiv-${old}.${kind}.cms`), 'old');
  assert.equal(run(backupScript, ['nightly'], { BACKUP_DIR: dir, BACKUP_KEEP: '2' }).status, 0);
  const left = dumps(dir);
  assert.equal(left.length, 2);
  assert.equal(left[0], 'shiv-20200103T000000Z.dump.cms');
  assert.equal(existsSync(join(dir, 'shiv-20200101T000000Z.counts.cms')), false);
});

/** A stand-in for rclone that records what it was given, or fails on request. */
function fakeRclone(name, fails) {
  const bin = folder(`${name}-bin`);
  const log = join(bin, 'calls.log');
  writeFileSync(
    join(bin, 'rclone'),
    `#!/usr/bin/env bash\necho "$4" >> "${log}"\n${fails ? 'exit 1' : 'exit 0'}\n`,
  );
  chmodSync(join(bin, 'rclone'), 0o755);
  return { bin, log };
}

test('a backup is sent to the remote', () => {
  const dir = folder('remote-ok');
  const fake = fakeRclone('ok', false);
  const made = run(backupScript, ['nightly'], {
    BACKUP_DIR: dir,
    BACKUP_REMOTE: 'r2:shiv',
    PATH: `${fake.bin}:${base.PATH}`,
  });
  assert.equal(made.status, 0, made.output);
  const calls = readFileSync(fake.log, 'utf8');
  assert.match(calls, /r2:shiv\/shiv-.*\.dump\.cms/);
  assert.match(calls, /r2:shiv\/shiv-.*\.counts\.cms/);
});

test('a failed upload is a failed backup, and the file is kept', () => {
  const dir = folder('remote-bad');
  const fake = fakeRclone('bad', true);
  const made = run(backupScript, ['nightly'], {
    BACKUP_DIR: dir,
    BACKUP_REMOTE: 'r2:shiv',
    PATH: `${fake.bin}:${base.PATH}`,
  });
  assert.notEqual(made.status, 0);
  assert.match(made.output, /could not upload/);
  assert.equal(dumps(dir).length, 1);
  assert.equal(existsSync(join(dir, 'last-nightly')), false);
});

test('a log file is removed only after it is safely sent', () => {
  const dir = folder('logs-bad');
  const wal = folder('wal-bad');
  writeFileSync(join(wal, '000000010000000000000001'), 'log contents');
  writeFileSync(join(wal, '000000010000000000000002.tmp'), 'still being written');
  const fake = fakeRclone('logs-bad', true);
  const failed = run(backupScript, ['logs'], {
    BACKUP_DIR: dir,
    WAL_DIR: wal,
    BACKUP_REMOTE: 'r2:shiv',
    PATH: `${fake.bin}:${base.PATH}`,
  });
  assert.notEqual(failed.status, 0);
  assert.equal(existsSync(join(wal, '000000010000000000000001')), true);
  const good = fakeRclone('logs-ok', false);
  const sent = run(backupScript, ['logs'], {
    BACKUP_DIR: dir,
    WAL_DIR: wal,
    BACKUP_REMOTE: 'r2:shiv',
    PATH: `${good.bin}:${base.PATH}`,
  });
  assert.equal(sent.status, 0, sent.output);
  assert.equal(existsSync(join(wal, '000000010000000000000001')), false);
  // Once it is on the remote, no copy stays to fill the disk Postgres needs.
  assert.deepEqual(readdirSync(join(dir, 'wal')), []);
  assert.match(readFileSync(good.log, 'utf8'), /r2:shiv\/wal\/000000010000000000000001\.gz\.cms/);
  // A log still being written by Postgres is left alone.
  assert.equal(existsSync(join(wal, '000000010000000000000002.tmp')), true);
  assert.match(sent.output, /1 log files/);
});

test('a quiet log is shrunk before it is stored', () => {
  const dir = folder('logs-small');
  const wal = folder('wal-small');
  writeFileSync(join(wal, '000000010000000000000009'), Buffer.alloc(16 * 1024 * 1024));
  assert.equal(run(backupScript, ['logs'], { BACKUP_DIR: dir, WAL_DIR: wal }).status, 0);
  const stored = statSync(join(dir, 'wal', '000000010000000000000009.gz.cms')).size;
  assert.ok(stored < 200 * 1024, `a mostly empty log took ${stored} bytes`);
});

test('only the newest base copy stays on the server once it is uploaded', () => {
  const dir = folder('base-keep');
  mkdirSync(join(dir, 'base'), { recursive: true });
  writeFileSync(join(dir, 'base', 'base-20200101T000000Z.tar.cms'), 'old');
  const bin = folder('base-keep-bin');
  writeFileSync(join(bin, 'pg_basebackup'), '#!/usr/bin/env bash\nhead -c 5000 /dev/urandom\n');
  writeFileSync(join(bin, 'rclone'), '#!/usr/bin/env bash\nexit 0\n');
  chmodSync(join(bin, 'pg_basebackup'), 0o755);
  chmodSync(join(bin, 'rclone'), 0o755);
  const made = run(backupScript, ['base'], {
    BACKUP_DIR: dir,
    BACKUP_REMOTE: 'r2:shiv',
    PATH: `${bin}:${base.PATH}`,
  });
  assert.equal(made.status, 0, made.output);
  const left = readdirSync(join(dir, 'base'));
  assert.equal(left.length, 1);
  assert.notEqual(left[0], 'base-20200101T000000Z.tar.cms');
});

test('the base copy can run inside the database container', () => {
  const dir = folder('base-container');
  const bin = folder('base-container-bin');
  const log = join(bin, 'docker.log');
  writeFileSync(join(bin, 'docker'), `#!/usr/bin/env bash\necho "$@" > "${log}"\nhead -c 5000 /dev/urandom\n`);
  chmodSync(join(bin, 'docker'), 0o755);
  const made = run(backupScript, ['base'], {
    BACKUP_DIR: dir,
    BASEBACKUP_CONTAINER: 'shiv-db-1',
    PGUSER: 'shiv_owner',
    PATH: `${bin}:${base.PATH}`,
  });
  assert.equal(made.status, 0, made.output);
  assert.match(readFileSync(log, 'utf8'), /exec -u postgres shiv-db-1 pg_basebackup .* -U shiv_owner/);
});

test('a monitor can tell when any kind of backup has stopped', () => {
  const dir = folder('status');
  const now = Math.floor(Date.now() / 1000);
  const stamp = (kind, hoursAgo = 0) =>
    writeFileSync(join(dir, `last-${kind}`), String(now - hoursAgo * 3600));
  assert.notEqual(run(backupScript, ['status'], { BACKUP_DIR: dir }).status, 0);
  stamp('nightly');
  stamp('logs');
  assert.match(run(backupScript, ['status'], { BACKUP_DIR: dir }).output, /no base backup/);
  stamp('base');
  assert.equal(run(backupScript, ['status'], { BACKUP_DIR: dir }).status, 0);
  stamp('nightly', 27);
  assert.match(run(backupScript, ['status'], { BACKUP_DIR: dir }).output, /last nightly backup is 27 hours old/);
  stamp('nightly');
  stamp('logs', 3);
  assert.match(run(backupScript, ['status'], { BACKUP_DIR: dir }).output, /last logs backup is 3 hours old/);
  stamp('logs');
  stamp('base', 200);
  assert.match(run(backupScript, ['status'], { BACKUP_DIR: dir }).output, /last base backup is 200 hours old/);
});

test('a base copy plus logs brings back what happened after the last dump', () => {
  // A separate small Postgres, as a real server has logging on and the shared test one does not.
  const cluster = folder('cluster');
  const wal = folder('cluster-wal');
  const dir = folder('cluster-backups');
  const port = String(55000 + (process.pid % 400));
  execFileSync('initdb', ['-D', cluster, '-U', 'shiv', '-A', 'trust', '-E', 'UTF8'], {
    env: { ...base, LC_ALL: 'en_US.UTF-8' },
    stdio: 'pipe',
  });
  writeFileSync(
    join(cluster, 'postgresql.auto.conf'),
    [
      `port = ${port}`,
      `listen_addresses = '127.0.0.1'`,
      `unix_socket_directories = ''`,
      `wal_level = replica`,
      `archive_mode = on`,
      `archive_timeout = 60`,
      `archive_command = 'test ! -f ${wal}/%f && cp %p ${wal}/%f.tmp && mv ${wal}/%f.tmp ${wal}/%f'`,
    ].join('\n') + '\n',
  );
  const clusterEnv = { ...base, PGHOST: '127.0.0.1', PGPORT: port, PGUSER: 'shiv', PGPASSWORD: '', PGDATABASE: 'postgres' };
  const query = (text) =>
    execFileSync('psql', ['--no-psqlrc', '-qtA', '-v', 'ON_ERROR_STOP=1', '-c', text], {
      env: clusterEnv,
      encoding: 'utf8',
    }).trim();
  execFileSync('pg_ctl', ['-D', cluster, '-w', '-l', join(work, 'cluster.log'), 'start'], {
    env: clusterEnv,
    stdio: 'ignore',
  });
  try {
    query(`CREATE TABLE sales (note text); INSERT INTO sales VALUES ('before the base copy')`);
    const baseCopy = run(backupScript, ['base'], { ...clusterEnv, BACKUP_DIR: dir });
    assert.equal(baseCopy.status, 0, baseCopy.output);
    query(`INSERT INTO sales VALUES ('after the base copy')`);
    const lastLog = query(`SELECT pg_walfile_name(pg_switch_wal())`);
    // Postgres archives a finished log on its own, within moments.
    const waitUntil = Date.now() + 30000;
    while (Date.now() < waitUntil && !existsSync(join(wal, lastLog))) spawnSync('sleep', ['1']);
    assert.equal(existsSync(join(wal, lastLog)), true, 'Postgres did not archive the log');
    const logs = run(backupScript, ['logs'], { ...clusterEnv, BACKUP_DIR: dir, WAL_DIR: wal });
    assert.equal(logs.status, 0, logs.output);
    const baseFile = join(dir, 'base', readdirSync(join(dir, 'base'))[0]);
    const replay = run(drillScript, ['logs', baseFile, join(dir, 'wal')], {
      ...clusterEnv,
      PG_BIN: pgBin,
      DRILL_SQL: 'SELECT note FROM sales ORDER BY note',
    });
    assert.equal(replay.status, 0, replay.output);
    assert.match(replay.output, /after the base copy/);
    assert.match(replay.output, /before the base copy/);
    assert.match(replay.output, /DRILL OK/);

    // Without the later logs, the copy stops at the base backup. So the logs really did the work.
    rmSync(join(dir, 'wal', `${lastLog}.gz.cms`));
    const shorter = run(drillScript, ['logs', baseFile, join(dir, 'wal')], {
      ...clusterEnv,
      PG_BIN: pgBin,
      DRILL_SQL: 'SELECT note FROM sales ORDER BY note',
    });
    assert.doesNotMatch(shorter.output, /after the base copy/);
  } finally {
    spawnSync('pg_ctl', ['-D', cluster, '-m', 'immediate', 'stop'], { env: clusterEnv, stdio: 'ignore' });
  }
});
