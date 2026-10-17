import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';
import { customerFeatures } from './features';

const root = resolve(import.meta.dirname, '../../..');

/** A reference is a file, optionally followed by " › " and a test title found in that file. */
function check(reference: string) {
  const [file, title] = reference.split(' › ');
  const path = resolve(root, file!);
  assert.ok(existsSync(path), `${reference}: ${file} does not exist`);
  if (title)
    assert.ok(
      readFileSync(path, 'utf8').includes(`'${title}'`),
      `${reference}: no test with this title in ${file}`,
    );
}

test('every customer feature is tested on both the app and the website', () => {
  const ids = new Set<string>();
  for (const feature of customerFeatures) {
    assert.ok(!ids.has(feature.id), `duplicate feature ${feature.id}`);
    ids.add(feature.id);
    assert.ok(feature.app.length, `${feature.id} has no app test`);
    assert.ok(feature.web.length, `${feature.id} has no website test`);
    for (const reference of [...feature.app, ...feature.web]) check(reference);
  }
});
