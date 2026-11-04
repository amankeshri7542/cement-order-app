// Every customer-facing string in the app goes through t(english, hindi). This finds each call
// with the TypeScript parser and checks the Hindi side really is Hindi (Devanagari) and the
// English side is not, so an untranslated or swapped string fails the build.
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import ts from 'typescript';

const source = new URL('../src', import.meta.url).pathname;
const devanagari = /[ऀ-ॿ]/;
// Identical in both languages on purpose (brand and service names).
const sameInBoth = new Set(['WhatsApp', 'UPI · Razorpay']);

function text(node) {
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return node.text;
  if (ts.isTemplateExpression(node))
    return node.head.text + node.templateSpans.map((span) => `\${}${span.literal.text}`).join('');
  return null;
}

test('every t(english, hindi) call has real Hindi text', () => {
  const problems = [];
  let calls = 0;
  for (const file of readdirSync(source).filter((name) => /\.tsx?$/.test(name))) {
    const tree = ts.createSourceFile(
      file,
      readFileSync(join(source, file), 'utf8'),
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.TSX,
    );
    const visit = (node) => {
      if (
        ts.isCallExpression(node) &&
        ts.isIdentifier(node.expression) &&
        node.expression.text === 't' &&
        node.arguments.length === 2
      ) {
        const [en, hi] = node.arguments.map(text);
        if (en !== null && hi !== null) {
          calls++;
          const line = tree.getLineAndCharacterOfPosition(node.getStart()).line + 1;
          const where = `${file}:${line}`;
          if (sameInBoth.has(en) && en === hi) return;
          if (!hi.trim() || !devanagari.test(hi)) problems.push(`${where} Hindi missing: "${hi}"`);
          if (devanagari.test(en)) problems.push(`${where} English side is Hindi: "${en}"`);
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(tree);
  }
  assert.ok(calls > 300, `expected the app to be translated throughout, found ${calls} calls`);
  assert.deepEqual(problems, []);
});
