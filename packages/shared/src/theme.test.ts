import assert from 'node:assert/strict';
import test from 'node:test';
import { colors, cssVariableName, cssVariables, palette, radius, textSize } from './theme';

test('cssVariables renders every palette colour as a custom property', () => {
  const css = cssVariables();
  assert.match(css, /^:root \{\n[\s\S]*\n\}\n$/);
  for (const [key, value] of Object.entries(palette)) {
    const name = cssVariableName(key as keyof typeof palette);
    assert.ok(css.includes(`  ${name}: ${value};\n`), `${name}: ${value} is missing`);
  }
});

test('cssVariables names follow the design tokens', () => {
  const css = cssVariables();
  for (const name of [
    '--ground',
    '--surface',
    '--paper',
    '--ink',
    '--ink-2',
    '--on-ink',
    '--on-ink-muted',
    '--accent',
    '--accent-press',
    '--danger-soft',
    '--rule',
    '--tab-1',
    '--tab-4',
    '--m-kraft',
    '--t-display',
    '--t-head',
    '--t-lead',
    '--t-body',
    '--t-small',
    '--r',
    '--ease',
    '--display',
    '--text',
    '--hand',
  ])
    assert.ok(css.includes(`  ${name}: `), `${name} is missing`);
  assert.ok(css.includes('  --r: 4px;'));
  assert.ok(css.includes('  --t-body: 1.0625rem;'));
  assert.ok(css.includes('  --ease: cubic-bezier(0.2, 0.7, 0.2, 1);'));
  assert.ok(css.includes('var(--font-teko'));
  assert.ok(css.includes('var(--font-kalam'));
});

test('errors stay distinct from the sindoor accent', () => {
  assert.notEqual(palette.danger, palette.accent);
  assert.notEqual(palette.danger, palette.accentPress);
});

test('old colour names point at the Direction A tokens', () => {
  assert.equal(colors.clay, palette.accent);
  assert.equal(colors.line, palette.rule);
  assert.equal(colors.green, palette.ok);
});

test('one control radius and no type below 14', () => {
  assert.equal(radius.sm, radius.control);
  assert.equal(radius.md, radius.control);
  assert.equal(radius.lg, radius.control);
  for (const size of Object.values(textSize)) assert.ok(size >= 14);
});
