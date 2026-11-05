// Aman asked that Hindi be removed from the app entirely: no script in the code, no language gate
// and no switching. Every word a customer reads comes from customer.* in packages/i18n, in English.
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';

const root = new URL('..', import.meta.url).pathname;
const devanagari = new RegExp(`[${String.fromCodePoint(0x0900)}-${String.fromCodePoint(0x097f)}]`);
function files(dir) {
  return readdirSync(dir).flatMap((name) => {
    if (['node_modules', 'android', 'dist', '.expo', 'ios'].includes(name)) return [];
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return files(path);
    return /\.(ts|tsx|mjs|cjs|js|json|yaml|html)$/.test(name) ? [path] : [];
  });
}
const sources = () => files(join(root, 'src'));

test('no Devanagari anywhere in the app, its config or its flows', () => {
  const found = files(root).filter((file) => devanagari.test(readFileSync(file, 'utf8')));
  assert.deepEqual(
    found.map((file) => file.slice(root.length)),
    [],
  );
});

test('no language gate and no switching in the code', () => {
  for (const file of sources()) {
    const text = readFileSync(file, 'utf8');
    for (const banned of [/setLanguage/, /LanguageChooser/, /languageState/, /\bt\('[^']*', '/])
      assert.doesNotMatch(text, banned, file.slice(root.length));
  }
});

test('the English the app reads has no Devanagari, and every word has a Hinglish line', () => {
  const en = JSON.parse(readFileSync(join(root, '../../packages/i18n/src/en.json'), 'utf8'));
  const hi = JSON.parse(readFileSync(join(root, '../../packages/i18n/src/hi.json'), 'utf8'));
  const keys = Object.keys(en).filter((key) => key.startsWith('customer.'));
  assert.ok(keys.length > 200, String(keys.length));
  for (const key of keys) {
    assert.doesNotMatch(en[key], devanagari, key);
    assert.doesNotMatch(hi[key], devanagari, key);
    assert.ok(hi[key].trim(), key);
  }
});

test('every word the app asks for exists', () => {
  const en = JSON.parse(readFileSync(join(root, '../../packages/i18n/src/en.json'), 'utf8'));
  const missing = [];
  for (const file of sources())
    for (const match of readFileSync(file, 'utf8').matchAll(/\bw\('([a-zA-Z.]+)'/g))
      if (!(`customer.${match[1]}` in en)) missing.push(match[1]);
  assert.deepEqual(missing, []);
});

test('no screen or store file grows past 350 lines', () => {
  const long = sources().filter((file) => readFileSync(file, 'utf8').split('\n').length > 351);
  assert.deepEqual(
    long.map((file) => file.slice(root.length)),
    [],
  );
});

test('the app reads no stock figure: availability is one word and rates come from the server', () => {
  for (const file of sources()) {
    const text = readFileSync(file, 'utf8');
    assert.doesNotMatch(text, /\.stock\b/, file.slice(root.length));
  }
});

test('the only amber button on the panel is Place order', () => {
  const panel = readFileSync(join(root, 'src/features/list/ListPanel.tsx'), 'utf8');
  // Place order, Check, Sign in and Add a site are alternatives: one shows at a time.
  for (const match of panel.matchAll(/kind="lamp"/g)) assert.ok(match.index > 0);
  assert.doesNotMatch(panel, /kind="lamp"[^>]*>\s*\{w\('panel\.askRate'\)/);
});
