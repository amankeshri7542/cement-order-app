import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { en, hinglish } from './index';

const root = join(__dirname, '../../..');
const hindiScript = new RegExp('[\\u0900-\\u097F]');
function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    if (name === 'node_modules' || name.startsWith('.next')) return [];
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sources(path);
    return /\.(tsx?|css|js)$/.test(name) && !name.includes('.test.') ? [path] : [];
  });
}

test('the desk’s own screens hold no Hindi script', () => {
  const found = ['apps/admin/app', 'apps/admin/components', 'apps/admin/lib', 'apps/admin/public']
    .flatMap((dir) => sources(join(root, dir)))
    .filter((file) => hindiScript.test(readFileSync(file, 'utf8')));
  assert.deepEqual(found, []);
});
test('the desk never asks a browser to print Hindi dates', () => {
  const found = ['apps/admin/app', 'apps/admin/components', 'apps/admin/lib']
    .flatMap((dir) => sources(join(root, dir)))
    .filter((file) => readFileSync(file, 'utf8').includes('hi-IN'));
  assert.deepEqual(found, []);
});
test('no screen falls back on the old pair of words', () => {
  const found = ['apps/admin/components', 'apps/admin/lib', 'apps/admin/app']
    .flatMap((dir) => sources(join(root, dir)))
    .filter((file) => /\bt\('[^']*',\s*'[^']*'\)/.test(readFileSync(file, 'utf8')));
  assert.deepEqual(found, []);
});
test('every desk word exists in Hinglish, in Roman script', () => {
  const words = hinglish as Record<string, string>;
  for (const key of Object.keys(en)) {
    assert.ok(words[key], `missing: ${key}`);
    if (key.startsWith('owner.')) assert.ok(!hindiScript.test(words[key]!), key);
  }
  assert.deepEqual(
    Object.keys(hinglish).filter((key) => !(key in en)),
    [],
  );
});
test('none of the old hashed words remain', () => {
  assert.deepEqual(
    Object.keys(en).filter((key) => key.startsWith('owner.legacy')),
    [],
  );
});
test('fixed spellings', () => {
  const banned = /\b(udhar|baki|paka|dukan|nahin|maal-|kripya)\b/i;
  const found = Object.entries(hinglish as Record<string, string>)
    .filter(([key, value]) => key.startsWith('owner.') && banned.test(value))
    .map(([key]) => key);
  assert.deepEqual(found, []);
});
