import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const strip = require('./build/strip-devanagari.cjs') as (source: string) => string;

const hi = 'शिव';
test('string literals holding Hindi script are emptied, in any quote', () => {
  assert.equal(strip(`a = { hi: '${hi}', en: 'Shiv' };`), "a = { hi: '', en: 'Shiv' };");
  assert.equal(strip(`a = "${hi}";`), "a = '';");
  assert.equal(strip('a = `${x} ' + hi + '`;'), "a = '';");
  assert.equal(strip(`a = 'it\\'s ${hi}';`), "a = '';");
});
test('code with no Hindi script is untouched', () => {
  const source =
    "const a = 'don\\'t'; // it's fine\nconst b = `x${1}y`; const c = /[\\u0900-\\u097F]/;";
  assert.equal(strip(source), source);
});
test('a template with nested code ends where it really ends', () => {
  const out = strip(
    `const k = (id) => \`key_\${id}\`;\nconst t = { hi: \`\${a ? 'x' : \`y\${b}\`} ${hi}\`, en: 'Shiv' };`,
  );
  assert.equal(out, "const k = (id) => `key_${id}`;\nconst t = { hi: '', en: 'Shiv' };");
});
test('a regular expression keeps its meaning, in escapes', () => {
  const out = strip(
    `const has = (e) => /[\u0900-\u097F]/.test(e); const w = '${hi}';`
      .replace('\\u0900', '\u0900')
      .replace('\\u097F', '\u097F'),
  );
  assert.ok(!/[\u0900-\u097F]/.test(out), out);
  const has = new Function(`${out}; return has;`)() as (text: string) => boolean;
  assert.equal(has(hi), true);
  assert.equal(has('Shiv'), false);
});
test('comments are dropped when a file is rewritten, apostrophes and all', () => {
  assert.equal(strip(`// don't ${hi}\nconst a = '${hi}';`), "\nconst a = '';");
});
test('real shared code still parses after stripping', () => {
  const out = strip(
    `exports.keys = { nameAsked: (userId) => \`shiv_name_asked_\${userId}\` };\nexports.steps = [{ title: { en: 'One', hi: '${hi}' } }];`,
  );
  assert.doesNotThrow(() => new Function('exports', out)({}));
  assert.ok(!/[\u0900-\u097F]/.test(out));
  assert.ok(out.includes('shiv_name_asked_'));
});
test('a line with an apostrophe before a Hindi string still leaves good code', () => {
  const out = strip(`const a = 'x'; const b = '${hi}'; const c = 'y';`);
  assert.equal(out, "const a = 'x'; const b = ''; const c = 'y';");
});
