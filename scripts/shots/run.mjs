// Captures review screenshots: node scripts/shots/run.mjs <demo|empty> <output folder>
// Run scripts/shots/prepare.mjs first. The login comes from apps/api/.env.test and is never printed.
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { parseEnv } from 'node:util';

const [set, dir] = process.argv.slice(2);
if (!['demo', 'empty'].includes(set) || !dir)
  throw new Error('Usage: run.mjs <demo|empty> <output folder>');
const url = new URL(parseEnv(readFileSync('apps/api/.env.test', 'utf8')).TEST_DATABASE_URL);
url.pathname = set === 'demo' ? '/shiv_shots_test' : '/shiv_empty_test';
const result = spawnSync(
  'npx',
  ['playwright', 'test', '--config=playwright.shots.config.ts', ...process.argv.slice(4)],
  {
    stdio: 'inherit',
    env: { ...process.env, SHOTS_DATABASE_URL: url.toString(), SHOTS_SET: set, SHOTS_DIR: dir },
  },
);
process.exit(result.status ?? 1);
