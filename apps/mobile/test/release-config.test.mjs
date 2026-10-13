import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import test from 'node:test';
import ts from 'typescript';

const compiled = ts.transpileModule(readFileSync('app.config.ts', 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
function config(env) {
  const exports = {};
  runInNewContext(compiled, { exports, process: { env }, URL });
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
  assert.ok(config({ APP_VARIANT: 'local' }).plugins.includes('./plugins/local-cleartext'));
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
