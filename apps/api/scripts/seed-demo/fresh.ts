import { spawnSync } from 'node:child_process';
import { PrismaClient } from '@prisma/client';
import { seedTarget } from './guard';

/**
 * Drops and recreates the target database, then applies every migration. Rows in append-only tables
 * cannot be deleted, so this is the only way to reseed. The guard runs first, so only a database
 * ending in _dev, _demo or _test can be dropped.
 */
export async function recreateDatabase(env: Record<string, string | undefined>) {
  const target = seedTarget(env);
  // Dropping a database on another machine (a shared staging or demo server) needs a second yes.
  if (
    !['127.0.0.1', 'localhost', '::1', '[::1]'].includes(target.host) &&
    env.SEED_DEMO_REMOTE_DROP !== 'yes'
  )
    throw new Error(
      `Refusing to drop ${target.label}: it is not on this machine. Set SEED_DEMO_REMOTE_DROP=yes if you mean it.`,
    );
  const admin = new URL(target.url.toString());
  admin.pathname = '/postgres';
  const db = new PrismaClient({ datasources: { db: { url: admin.toString() } } });
  try {
    // The name passed the guard's strict pattern, so quoting it is safe.
    await db.$executeRawUnsafe(`DROP DATABASE IF EXISTS "${target.database}" WITH (FORCE)`);
    await db.$executeRawUnsafe(`CREATE DATABASE "${target.database}"`);
  } finally {
    await db.$disconnect();
  }
  const migrate = spawnSync('npx', ['prisma', 'migrate', 'deploy'], {
    cwd: `${__dirname}/../..`,
    env: { ...process.env, DATABASE_URL: target.url.toString() },
    encoding: 'utf8',
  });
  if (migrate.status !== 0)
    throw new Error(`Migrations failed on ${target.label}:\n${migrate.stderr || migrate.stdout}`);
  return target;
}
