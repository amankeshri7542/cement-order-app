import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { test } from 'node:test';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import en from '../../../packages/i18n/src/en.json';
import hi from '../../../packages/i18n/src/hi.json';
import { colors, minTextSize, staffType, touchStaff } from '../src/ui/tokens';

const root = join(__dirname, '..');
const compiled = ts.transpileModule(readFileSync(join(root, 'app.config.ts'), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
function config(env: Record<string, string> = {}) {
  const exports: { default?: (arg: { config: unknown }) => Record<string, never> } = {};
  runInNewContext(compiled, {
    exports,
    process: { env },
    URL,
    require: createRequire(join(root, 'app.config.ts')),
  });
  return exports.default!({
    config: JSON.parse(readFileSync(join(root, 'app.json'), 'utf8')).expo,
  }) as unknown as {
    name: string;
    plugins: (string | [string, Record<string, unknown>])[];
    android: {
      package: string;
      allowBackup: boolean;
      permissions?: string[];
      blockedPermissions: string[];
    };
    extra: { appEnv: string };
  };
}
const release = {
  EXPO_PUBLIC_APP_ENV: 'production',
  EXPO_PUBLIC_API_URL: 'https://api.shivcement.in/api/v1',
};

test('the package, and no backup of what is on the phone', () => {
  const app = config();
  assert.equal(app.android.package, 'in.shivcement.staff');
  assert.equal(app.android.allowBackup, false);
});
test('background location and audio are never asked for, and are blocked outright', () => {
  const app = config();
  for (const permission of [
    'android.permission.ACCESS_BACKGROUND_LOCATION',
    'android.permission.RECORD_AUDIO',
  ]) {
    assert.ok(!(app.android.permissions ?? []).includes(permission), permission);
    assert.ok(app.android.blockedPermissions.includes(permission), permission);
  }
  const options = (name: string) =>
    (
      app.plugins.find((plugin) => Array.isArray(plugin) && plugin[0] === name) as [
        string,
        Record<string, unknown>,
      ]
    )[1];
  assert.equal(options('expo-camera').recordAudioAndroid, false);
  assert.equal(options('expo-camera').microphonePermission, false);
  assert.equal(options('expo-location').isAndroidBackgroundLocationEnabled, false);
  assert.equal(options('expo-location').isAndroidForegroundServiceEnabled, false);
  assert.equal(options('expo-location').locationAlwaysAndWhenInUsePermission, undefined);
  assert.equal(options('expo-location').locationAlwaysPermission, undefined);
});
test('no fingerprint: a friend in on a cheat knows the PIN, and dusty fingers fail', () => {
  const app = config();
  for (const permission of [
    'android.permission.USE_BIOMETRIC',
    'android.permission.USE_FINGERPRINT',
  ])
    assert.ok(app.android.blockedPermissions.includes(permission), permission);
});
test('the test would notice if a permission were asked for', () => {
  const app = JSON.parse(readFileSync(join(root, 'app.json'), 'utf8')).expo;
  assert.deepEqual(app.android.permissions ?? [], []);
});
test('a release needs a real HTTPS address', () => {
  assert.equal(config(release).extra.appEnv, 'production');
  for (const url of [
    '',
    'not a url',
    'http://api.shivcement.in/api/v1',
    'https://localhost/api/v1',
    'https://127.0.0.1/api/v1',
    'https://api.example.com/api/v1',
    'https://api.shivcement.in/',
    'https://u:p@api.shivcement.in/api/v1',
    'https://api.shivcement.in:8443/api/v1',
    'https://api.shivcement.in/api/v1?x=1',
  ])
    assert.throws(
      () => config({ ...release, EXPO_PUBLIC_API_URL: url }),
      /EXPO_PUBLIC_API_URL/,
      url,
    );
  assert.throws(() => config({ ...release, EXPO_PUBLIC_APP_ENV: 'prod' }), /APP_ENV/);
});
test('a back door for testing cannot go into a release', () => {
  assert.throws(() => config({ ...release, APP_VARIANT: 'local' }), /development builds/);
  assert.throws(() => config({ ...release, EXPO_PUBLIC_STAFF_PASTE: '1' }), /development builds/);
  assert.throws(() => config({ ...release, EXPO_PUBLIC_STAFF_TEST: '1' }), /development builds/);
  assert.throws(() => config({ EXPO_PUBLIC_STAFF_PASTE: '1' }), /APP_VARIANT=local/);
  assert.ok(config({ APP_VARIANT: 'local', EXPO_PUBLIC_STAFF_PASTE: '1' }));
});
test('no build profile switches on a back door', () => {
  const profiles = JSON.parse(readFileSync(join(root, 'eas.json'), 'utf8')).build as Record<
    string,
    { env?: Record<string, string> }
  >;
  for (const [name, profile] of Object.entries(profiles))
    for (const key of ['APP_VARIANT', 'EXPO_PUBLIC_STAFF_PASTE', 'EXPO_PUBLIC_STAFF_TEST'])
      assert.equal(profile.env?.[key], undefined, `${name} sets ${key}`);
});
test('plain HTTP only for a local build', () => {
  assert.ok(config({ APP_VARIANT: 'local' }).plugins.includes('./plugins/local-cleartext'));
  assert.ok(!config(release).plugins.includes('./plugins/local-cleartext'));
  assert.ok(!config().plugins.includes('./plugins/local-cleartext'));
});

const hindiScript = new RegExp('[\\u0900-\\u097F]');
function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    if (['node_modules', 'android', 'ios', 'dist', '.expo'].includes(name)) return [];
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sources(path);
    return /\.(tsx?|json|kt)$/.test(name) ? [path] : [];
  });
}
const staffWords = (from: Record<string, string>) =>
  Object.entries(from).filter(([key]) => key.startsWith('staff.'));

test('no Devanagari anywhere in the app', () => {
  const found = sources(root).filter(
    (file) => !file.endsWith('config.test.ts') && hindiScript.test(readFileSync(file, 'utf8')),
  );
  assert.deepEqual(found, []);
});
test('no Devanagari in any staff word, and both catalogues hold each one', () => {
  const words = hi as Record<string, string>;
  for (const [key, value] of staffWords(hi)) assert.ok(!hindiScript.test(value), key);
  for (const [key] of staffWords(en)) assert.ok(words[key], `missing in hi: ${key}`);
  assert.ok(staffWords(hi).length > 300);
});
test('the spellings the shop uses', () => {
  const banned = /\b(udhar|baki|paka|dukan|nahin|kripya|hisab)\b/i;
  const found = staffWords(hi).filter(([, value]) => banned.test(value));
  assert.deepEqual(found, []);
});
test('every word a screen names exists', () => {
  const words = en as Record<string, string>;
  const missing = new Set<string>();
  for (const file of sources(join(root, 'src')))
    for (const match of readFileSync(file, 'utf8').matchAll(/'(staff\.[a-zA-Z.]+)'/g))
      if (!words[match[1]!]) missing.add(match[1]!);
  assert.deepEqual([...missing], []);
});
test('a screen uses only the staff words', () => {
  for (const file of sources(join(root, 'src')))
    assert.doesNotMatch(readFileSync(file, 'utf8'), /tr\('(?!staff\.)/, file);
});

test('the phone’s clock is never read', () => {
  // The browser test build's stand-in for the boot clock is the one exception, and never ships.
  const allowed = new Set([join(root, 'src', 'platform', 'device.ts')]);
  const found = sources(join(root, 'src')).filter(
    (file) => !allowed.has(file) && /Date\.now\(|new Date\(\)/.test(readFileSync(file, 'utf8')),
  );
  assert.deepEqual(found, []);
});

const luminance = (hex: string) => {
  const part = (index: number) => {
    const value = parseInt(hex.slice(index, index + 2), 16) / 255;
    return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * part(1) + 0.7152 * part(3) + 0.0722 * part(5);
};
const contrast = (a: string, b: string) => {
  const [hi_, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi_ + 0.05) / (lo + 0.05);
};
test('readable in the sun: each pair the screens use', () => {
  for (const [text, ground, least] of [
    [colors.ink, colors.paper, 7],
    [colors.ink2, colors.paper, 4.5],
    [colors.ink, colors.well, 7],
    [colors.ink2, colors.well, 4.5],
    [colors.onDiya, colors.diya, 4.5],
    [colors.onSolid, colors.ok, 4.5],
    [colors.onSolid, colors.danger, 4.5],
    [colors.ink, colors.warnSoft, 7],
    [colors.warn, colors.warnSoft, 4.5],
    [colors.ink, colors.dangerSoft, 7],
    [colors.onNight, colors.night, 7],
    [colors.danger, colors.paper, 4.5],
  ] as const)
    assert.ok(contrast(text, ground) >= least, `${text} on ${ground}: ${contrast(text, ground)}`);
});
test('the size rules', () => {
  assert.equal(minTextSize, 18);
  assert.equal(touchStaff, 64);
  for (const size of Object.values(staffType)) assert.ok(size >= minTextSize);
});
