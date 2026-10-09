import { strict as assert } from 'node:assert';
import { randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { loadEnvFile } from 'node:process';
import { PrismaClient } from '@prisma/client';

const apiRoot = resolve(__dirname, '..');
const envPath = resolve(apiRoot, '.env.test');
if (existsSync(envPath)) loadEnvFile(envPath);
if (!process.env.TEST_DATABASE_URL)
  throw new Error(
    'Set TEST_DATABASE_URL to a local disposable PostgreSQL database ending in _test.',
  );
const source = new URL(process.env.TEST_DATABASE_URL);
if (
  !source.pathname.endsWith('_test') ||
  !['localhost', '127.0.0.1', '::1'].includes(source.hostname)
)
  throw new Error('Bootstrap smoke is restricted to a local TEST_DATABASE_URL ending in _test.');
const database = `shiv_bootstrap_${randomUUID().replaceAll('-', '')}_test`;
const adminUrl = new URL(source);
adminUrl.pathname = '/postgres';
const smokeUrl = new URL(source);
smokeUrl.pathname = `/${database}`;
const admin = new PrismaClient({ datasourceUrl: adminUrl.href });
const db = new PrismaClient({ datasourceUrl: smokeUrl.href });
const env = {
  ...process.env,
  NODE_ENV: 'test',
  DATABASE_URL: smokeUrl.href,
  ADMIN_BOOTSTRAP_PASSWORD: 'local-bootstrap-smoke-only-passphrase',
};

async function main() {
  let created = false;
  try {
    await admin.$executeRawUnsafe(`CREATE DATABASE "${database}"`);
    created = true;
    execFileSync(
      process.execPath,
      [require.resolve('prisma/build/index.js'), 'migrate', 'deploy'],
      {
        cwd: apiRoot,
        env,
        stdio: 'pipe',
      },
    );
    const settings = await db.storeSettings.findUniqueOrThrow({ where: { id: 'store' } });
    assert.equal(settings.onlinePaymentsEnabled, false);
    assert.equal(settings.deliveryFeePaise, 0);
    assert.equal(await db.product.count(), 0);
    assert.equal(await db.deliveryZone.count(), 0);
    assert.equal(await db.user.count(), 0);
    for (let invocation = 0; invocation < 2; invocation++) {
      execFileSync(
        process.execPath,
        [
          require.resolve('tsx/cli'),
          'scripts/grant-admin.ts',
          '+919999999989',
          'Bootstrap test owner',
        ],
        { cwd: apiRoot, env, stdio: 'pipe' },
      );
      assert.equal(await db.storeSettings.count(), 1);
      assert.equal(await db.user.count({ where: { role: 'ADMIN' } }), 1);
      assert.equal(await db.adminCredential.count(), 1);
      assert.equal(await db.product.count(), 0);
      assert.equal(await db.deliveryZone.count(), 0);
      const after = await db.storeSettings.findUniqueOrThrow({ where: { id: 'store' } });
      assert.equal(after.onlinePaymentsEnabled, false);
      assert.equal(after.deliveryFeePaise, 0);
    }
    console.log(
      'PASS: migrations alone bootstrap safe settings; repeated staff setup is idempotent; no fixtures created.',
    );
  } finally {
    await db.$disconnect();
    if (created) await admin.$executeRawUnsafe(`DROP DATABASE "${database}" WITH (FORCE)`);
    await admin.$disconnect();
  }
}

void main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : 'Bootstrap smoke failed.');
  process.exitCode = 1;
});
