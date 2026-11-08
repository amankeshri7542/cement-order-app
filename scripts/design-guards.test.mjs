// Naksha 2 guards (plan v4 B1, DESIGN.md "Don't add a colour, spacing step or font size outside the
// tokens"). Every colour comes from packages/tokens, so a page cannot look right in light and wrong
// in dark, and every font size from the type scale, so "Bada akshar" scales all of it.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(import.meta.url), '../..');
const skipDirs = new Set(['node_modules', '.next', '.next-e2e', 'dist', '.expo', 'android', 'ios']);

function files(dir, test) {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (skipDirs.has(name) || name.startsWith('.next')) return [];
    return statSync(path).isDirectory() ? files(path, test) : test(path) ? [path] : [];
  });
}
const where = (path) => relative(root, path);
const lineOf = (text, index) => text.slice(0, index).split('\n').length;

// Generated from packages/tokens: the one place raw values belong.
const tokenFiles = new Set([resolve(root, 'packages/design/src/tokens.css')]);
const cssColour = /#[0-9a-fA-F]{3,8}\b|\brgba?\(|\bhsla?\(/g;
const pxFont = /font-size:\s*[0-9.]+px/g;
// A colour written into code: '#1f2322', "#fff" and the like. Anchors like '#panel-tally' do not match.
const codeColour = /['"`]#[0-9a-fA-F]{3}(?:[0-9a-fA-F]{3})?(?:[0-9a-fA-F]{2})?['"`]/g;

function offences(paths, patterns) {
  const found = [];
  for (const path of paths) {
    const text = readFileSync(path, 'utf8').replace(/\/\*[\s\S]*?\*\//g, (m) =>
      m.replace(/[^\n]/g, ' '),
    );
    for (const pattern of patterns)
      for (const match of text.matchAll(pattern))
        found.push(`${where(path)}:${lineOf(text, match.index)} ${match[0]}`);
  }
  return found;
}

describe('the desk takes every colour and font size from the tokens', () => {
  const css = [
    ...files(resolve(root, 'apps/admin'), (p) => p.endsWith('.css')),
    ...files(resolve(root, 'packages/design/src'), (p) => p.endsWith('.css')),
  ].filter((p) => !tokenFiles.has(p));
  it('finds the stylesheets', () => assert.ok(css.length > 10));
  it('has no raw colour in any stylesheet', () => {
    assert.deepEqual(offences(css, [cssColour]), []);
  });
  it('has no font size in px (rem scales with "Bada akshar")', () => {
    assert.deepEqual(offences(css, [pxFont]), []);
  });
  it('has no colour written into a component', () => {
    const code = [
      ...files(resolve(root, 'apps/admin'), (p) => /\.(tsx?|jsx?)$/.test(p) && !/\.test\./.test(p)),
      ...files(resolve(root, 'packages/design/src'), (p) => /\.tsx?$/.test(p)),
    ].filter((p) => !p.includes('/public/'));
    assert.deepEqual(offences(code, [codeColour]), []);
  });
});

describe('the Expo apps take every colour from the tokens', () => {
  for (const app of ['mobile', 'staff'])
    it(`${app}: no colour literal outside ui/tokens.ts`, () => {
      const code = files(
        resolve(root, `apps/${app}/src`),
        (p) => /\.(tsx?|jsx?)$/.test(p) && !/\.test\./.test(p) && !p.endsWith('ui/tokens.ts'),
      );
      assert.ok(code.length > 5);
      assert.deepEqual(offences(code, [codeColour, /\brgba?\(/g]), []);
    });
});
