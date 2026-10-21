import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { runInNewContext } from 'node:vm';
import test from 'node:test';
import ts from 'typescript';

const compiled = ts.transpileModule(readFileSync('app.config.ts', 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
function config(env) {
  const exports = {};
  runInNewContext(compiled, {
    exports,
    process: { env },
    URL,
    require: createRequire(import.meta.url),
  });
  return exports.default({ config: JSON.parse(readFileSync('app.json', 'utf8')).expo });
}
const release = {
  EXPO_PUBLIC_APP_ENV: 'staging',
  EXPO_PUBLIC_API_URL: 'https://api.staging.shivcement.in/api/v1',
  EXPO_PUBLIC_PRIVACY_URL: 'https://admin.staging.shivcement.in/privacy',
};

test('release builds require real HTTPS API and privacy URLs, without local cleartext', () => {
  assert.equal(config(release).android.package, 'in.shivcement.store');
  assert.ok(!config(release).plugins.includes('./plugins/local-cleartext'));
  assert.throws(() => config({ ...release, APP_VARIANT: 'local' }), /development builds/);
  assert.throws(() => config({ ...release, EXPO_PUBLIC_APP_ENV: 'stagng' }), /APP_ENV/);
  for (const key of ['EXPO_PUBLIC_API_URL', 'EXPO_PUBLIC_PRIVACY_URL'])
    for (const value of [
      '',
      'not a url',
      'http://api.shivcement.in/api/v1',
      'https://localhost/privacy',
      'https://127.0.0.1/privacy',
      'https://api.staging.example.invalid/api/v1',
      'https://api.example.com/api/v1',
      'https://api.shivcement.test/api/v1',
      'https://user:secret@api.shivcement.in/api/v1',
      'https://api.shivcement.in:8443/api/v1',
      'https://api.shivcement.in/api/v1?key=secret',
      'https://api.shivcement.in/api/v1#fragment',
    ])
      assert.throws(() => config({ ...release, [key]: value }), new RegExp(key));
  assert.throws(
    () => config({ ...release, EXPO_PUBLIC_API_URL: 'https://api.shivcement.in/' }),
    /api\/v1/,
  );
  assert.equal(config({ ...release, EXPO_PUBLIC_APP_ENV: 'production' }).name, 'Shiv Cement Store');
  // Only production hides the header's TEST mark (staging builds share the production package).
  assert.equal(
    config({ ...release, EXPO_PUBLIC_APP_ENV: 'production' }).extra.appEnv,
    'production',
  );
  assert.equal(config(release).extra.appEnv, 'staging');
  assert.equal(config({}).extra.appEnv, 'development');
  assert.ok(config({ APP_VARIANT: 'local' }).plugins.includes('./plugins/local-cleartext'));
});

test('every build embeds Teko 600 for display text and prices', () => {
  const font = config(release).plugins.find((plugin) => plugin[0] === 'expo-font');
  assert.ok(font, 'expo-font plugin is configured');
  // The config runs in another realm, so compare plain strings rather than arrays.
  assert.equal(font[1].fonts.map((file) => file.split('/').at(-1)).join(), 'Teko_600SemiBold.ttf');
  assert.ok(existsSync(font[1].fonts[0]));
});

test('EAS preview APK and closed-test AAB use preview environment; submissions remain drafts', () => {
  const eas = JSON.parse(readFileSync('eas.json', 'utf8'));
  for (const profile of ['preview', 'closed-test', 'production']) {
    const build = eas.build[profile];
    assert.equal(build.environment, profile === 'production' ? 'production' : 'preview');
    assert.equal(
      build.env.EXPO_PUBLIC_APP_ENV,
      profile === 'production' ? 'production' : 'staging',
    );
    assert.equal(build.env.EXPO_PUBLIC_API_URL, undefined);
    assert.equal(build.env.EXPO_PUBLIC_PRIVACY_URL, undefined);
    assert.throws(() => config(build.env), /EXPO_PUBLIC_API_URL/);
  }
  assert.equal(eas.build.preview.android.buildType, 'apk');
  assert.equal(eas.build['closed-test'].android.buildType, 'app-bundle');
  assert.equal(eas.build['closed-test'].distribution, 'store');
  assert.equal(eas.build['closed-test'].autoIncrement, true);
  assert.equal(eas.submit['closed-test'].android.track, 'alpha');
  for (const profile of Object.values(eas.submit))
    assert.equal(profile.android.releaseStatus, 'draft');
});

test('the Android build targets API 36, as Google Play requires of new apps', () => {
  const properties = config(release).plugins.find(
    (plugin) => plugin[0] === 'expo-build-properties',
  );
  assert.ok(properties, 'expo-build-properties plugin is configured');
  assert.ok(properties[1].android.targetSdkVersion >= 36);
  assert.ok(properties[1].android.compileSdkVersion >= properties[1].android.targetSdkVersion);
});

test('release submissions read the Play service account from a file that is never committed', () => {
  const eas = JSON.parse(readFileSync('eas.json', 'utf8'));
  const ignored = readFileSync('../../.gitignore', 'utf8');
  for (const profile of Object.values(eas.submit)) {
    const path = profile.android.serviceAccountKeyPath;
    assert.equal(path, './play-service-account.json');
    assert.ok(ignored.split('\n').includes(`apps/mobile/${path.slice(2)}`));
    assert.ok(!existsSync(path), 'the key file must not be in the repository');
  }
  assert.ok(ignored.split('\n').includes('*.keystore'));
});

test('release builds strip debug logging, so no library can print a sign-in code to the device log', () => {
  const build = config(release).plugins.find(
    (plugin) => Array.isArray(plugin) && plugin[0] === 'expo-build-properties',
  );
  const rules = build[1].android.extraProguardRules;
  assert.match(rules, /-assumenosideeffects class android\.util\.Log/);
  for (const level of ['v', 'd', 'i'])
    assert.match(rules, new RegExp(`int ${level}\\(\\.\\.\\.\\)`));
  assert.doesNotMatch(rules, /\bint e\(\.\.\.\)|\bint w\(\.\.\.\)/);
});
