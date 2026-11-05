import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

const root = join(__dirname, '..', '..');
function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? files(path) : [path];
  });
}
/** Bundles the JavaScript as a real production Android build would, with no bytecode to read past. */
function bundle(env: Record<string, string>) {
  const out = mkdtempSync(join(tmpdir(), 'staff-bundle-'));
  const built = spawnSync(
    process.execPath,
    [
      require.resolve('expo/bin/cli'),
      'export',
      '--platform',
      'android',
      '--no-bytecode',
      '--output-dir',
      out,
      '--clear',
    ],
    {
      cwd: root,
      encoding: 'utf8',
      env: {
        PATH: process.env.PATH ?? '',
        HOME: process.env.HOME ?? '',
        CI: '1',
        NODE_ENV: 'production',
        ...env,
      },
    },
  );
  assert.equal(built.status, 0, built.stderr);
  const code = files(out)
    .filter((file) => file.endsWith('.hbc') || file.endsWith('.js'))
    .map((file) => readFileSync(file, 'utf8'))
    .join('\n');
  rmSync(out, { recursive: true, force: true });
  assert.ok(code.length > 100000, 'expected a real bundle');
  return code;
}
const backDoors = [
  'paste-code',
  'paste-go',
  '__staffScan',
  '__staffFix',
  '__staffCamera',
  'camera-stub',
  'photo-stub',
  'Browser test',
  '__staffOpened',
];

test('a production Android bundle holds no back door', () => {
  const code = bundle({
    EXPO_PUBLIC_APP_ENV: 'production',
    EXPO_PUBLIC_API_URL: 'https://api.shivcement.in/api/v1',
  });
  for (const marker of backDoors) assert.ok(!code.includes(marker), `found ${marker}`);
  // It really is the native build that was checked.
  assert.ok(code.includes('DeviceKey'));
  assert.ok(code.includes('https://api.shivcement.in/api/v1'));
});

test('the check can see a back door when there is one', () => {
  const code = bundle({ APP_VARIANT: 'local', EXPO_PUBLIC_STAFF_PASTE: '1' });
  assert.ok(code.includes('paste-code'));
  // Even then, nothing for the browser tests gets into an Android build.
  for (const marker of backDoors.filter((name) => !name.startsWith('paste-')))
    assert.ok(!code.includes(marker), `found ${marker}`);
});
