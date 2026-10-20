import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { test } from 'node:test';
import ts from 'typescript';

test('owner screens route visible static copy through the message catalogue', () => {
  const root = resolve(import.meta.dirname, '../../..');
  const directory = resolve(root, 'apps/admin/components/owner');
  const files = readdirSync(directory)
    .filter((name) => name.endsWith('.tsx'))
    .map((name) => resolve(directory, name));
  files.push(resolve(root, 'apps/admin/lib/owner.tsx'));
  const violations: string[] = [];
  for (const file of files) {
    const source = ts.createSourceFile(
      file,
      readFileSync(file, 'utf8'),
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.TSX,
    );
    const inspect = (node: ts.Node) => {
      const literal = ts.isJsxText(node)
        ? node.text.trim()
        : ts.isJsxAttribute(node) &&
            ['title', 'alt', 'aria-label', 'placeholder'].includes(node.name.getText(source)) &&
            node.initializer &&
            ts.isStringLiteral(node.initializer)
          ? node.initializer.text
          : '';
      if (/[\p{L}]/u.test(literal)) {
        const { line } = source.getLineAndCharacterOfPosition(node.getStart(source));
        violations.push(`${file}:${line + 1}: ${literal}`);
      }
      ts.forEachChild(node, inspect);
    };
    inspect(source);
  }
  assert.deepEqual(violations, []);
});
