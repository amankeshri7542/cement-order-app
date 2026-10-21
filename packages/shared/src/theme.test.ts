import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';
import { colors, cssVariableName, cssVariables, palette, radius, textSize } from './theme';

const channel = (value: number) => {
  const c = value / 255;
  return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
};
const luminance = (hex: string) => {
  const [r, g, b] = [1, 3, 5].map((i) => channel(parseInt(hex.slice(i, i + 2), 16)));
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
};
/** WCAG contrast ratio between two #RRGGBB colours. */
const contrast = (a: string, b: string) => {
  const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (light! + 0.05) / (dark! + 0.05);
};

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
    '--accent-ink',
    '--on-accent',
    '--on-solid',
    '--blue',
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

test('errors stay distinct from the amber accent', () => {
  assert.notEqual(palette.danger, palette.accent);
  assert.notEqual(palette.danger, palette.accentPress);
});

test('old colour names point at the current tokens', () => {
  assert.equal(colors.clay, palette.accent);
  assert.equal(colors.line, palette.rule);
  assert.equal(colors.green, palette.ok);
});

test('every text pair is 4.5:1 or better and the focus ring is 3:1 on every ground', () => {
  type Key = keyof typeof palette;
  const pairs: [Key, Key][] = [
    ['ink', 'ground'],
    ['ink', 'surface'],
    ['ink', 'paper'],
    ['muted', 'ground'],
    ['muted', 'surface'],
    ['muted', 'paper'],
    ['ink2', 'ground'],
    ['ink2', 'paper'],
    ['accentInk', 'ground'],
    ['accentInk', 'surface'],
    ['accentInk', 'paper'],
    ['warn', 'ground'],
    ['warn', 'paper'],
    ['ok', 'ground'],
    ['ok', 'paper'],
    ['ok', 'okSoft'],
    ['danger', 'ground'],
    ['danger', 'paper'],
    ['danger', 'dangerSoft'],
    ['ink', 'tab1'],
    ['ink', 'tab4'],
    ['ink2', 'tab1'],
    ['onInk', 'ink'],
    ['onInk', 'ink2'],
    ['onInkMuted', 'ink'],
    ['onAccent', 'accent'],
    ['onAccent', 'accentPress'],
    ['onSolid', 'danger'],
    ['onSolid', 'mBrick'],
  ];
  for (const [fg, bg] of pairs)
    assert.ok(
      contrast(palette[fg], palette[bg]) >= 4.5,
      `${fg} on ${bg} is ${contrast(palette[fg], palette[bg]).toFixed(2)}:1`,
    );
  for (const ground of ['ground', 'surface', 'paper', 'ink'] as const)
    assert.ok(
      contrast(palette.blue, palette[ground]) >= 3,
      `focus ring on ${ground} is ${contrast(palette.blue, palette[ground]).toFixed(2)}:1`,
    );
});

test('the owner desk tokens in packages/design match this palette', () => {
  const source = readFileSync(resolve(import.meta.dirname, '../../design/src/tokens.ts'), 'utf8');
  const design = (key: string) =>
    source.match(new RegExp(`\\b${key}:\\s*'(#[0-9A-Fa-f]{6})'`))?.[1]?.toUpperCase();
  assert.equal(design('paper'), palette.ground);
  assert.equal(design('card'), palette.paper);
  assert.equal(design('ink'), palette.ink);
  assert.equal(design('ink2'), palette.muted);
  assert.equal(design('brand'), palette.accent);
  assert.equal(design('brandInk'), palette.onAccent);
  assert.equal(design('green'), palette.ok);
  assert.equal(design('red'), palette.danger);
  assert.equal(design('blue'), palette.blue);
  assert.equal(design('navy'), palette.ink2);
});

test('one control radius and no type below 14', () => {
  assert.equal(radius.sm, radius.control);
  assert.equal(radius.md, radius.control);
  assert.equal(radius.lg, radius.control);
  for (const size of Object.values(textSize)) assert.ok(size >= 14);
});
