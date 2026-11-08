import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { colorNames, contrast, cssName, cssVariables, dark, light, type Palette } from './index';

// Naksha 2 contrast (WCAG 2.2 AA): text 4.5:1, non-text boundaries 3:1. Checked in both themes, so
// a changed value cannot quietly make a page unreadable in one of them.
const themes: [string, Palette][] = [
  ['light', light],
  ['dark', dark],
];

describe('every colour exists in both themes', () => {
  it('has the same names, all set', () => {
    for (const [, palette] of themes)
      for (const name of colorNames) assert.ok(palette[name], `missing ${name}`);
  });
});

describe('text is readable in both themes', () => {
  for (const [theme, c] of themes) {
    it(`${theme}: ink, secondary and muted text on the ground and on paper`, () => {
      for (const text of [
        'ink',
        'ink2',
        'ink3',
        'accentInk',
        'ok',
        'warn',
        'danger',
        'info',
      ] as const)
        for (const ground of ['bg', 'surface', 'card'] as const)
          assert.ok(
            contrast(c[text], c[ground]) >= 4.5,
            `${theme} ${text} on ${ground}: ${contrast(c[text], c[ground]).toFixed(2)}`,
          );
    });
    it(`${theme}: status text on its own soft fill, and text on the amber and solid fills`, () => {
      for (const [text, fill] of [
        ['ok', 'okSoft'],
        ['warn', 'warnSoft'],
        ['danger', 'dangerSoft'],
        ['onAccent', 'accent'],
        ['onAccent', 'accentPress'],
        ['onSolid', 'danger'],
        ['railInk', 'rail'],
        ['railMuted', 'rail'],
        ['onRamp1', 'ramp1'],
        ['onRamp2', 'ramp2'],
        ['onRamp3', 'ramp3'],
        ['onRamp4', 'ramp4'],
      ] as const)
        assert.ok(contrast(c[text], c[fill]) >= 4.5, `${theme} ${text} on ${fill}`);
    });
    it(`${theme}: input borders and the focus ring stand out (3:1)`, () => {
      for (const line of ['ruleStrong', 'focus'] as const)
        for (const ground of ['bg', 'card'] as const)
          assert.ok(contrast(c[line], c[ground]) >= 3, `${theme} ${line} on ${ground}`);
    });
  }
  it('amber itself is never text on paper (why accentInk exists)', () => {
    assert.ok(contrast(light.accent, light.card) < 3);
  });
});

describe('the generated CSS', () => {
  const css = cssVariables();
  it('names every colour for light, dark, auto-dark and print', () => {
    for (const name of colorNames) {
      const count = css.split(`${cssName(name)}:`).length - 1;
      assert.equal(count, 4, `${cssName(name)} appears ${count} times`);
    }
  });
  it('keeps the old desk names pointing at the new tokens', () => {
    assert.match(css, /--shiv-paper: var\(--bg\);/);
    assert.match(css, /--shiv-brand: var\(--accent\);/);
  });
  it('turns names into CSS names', () => {
    assert.equal(cssName('ink2'), '--ink-2');
    assert.equal(cssName('ruleStrong'), '--rule-strong');
    assert.equal(cssName('chart1'), '--chart-1');
  });
});

// Chart steps (plan v4 B3b): each step stands out from the next and the faintest still shows on
// the card and the surface, in both themes. The full check is the dataviz validator, run when
// these values change.
it('chart steps are ordered and the faintest still shows', () => {
  for (const [theme, c] of [
    ['light', light],
    ['dark', dark],
  ] as const) {
    const steps = [c.chart1, c.chart2, c.chart3, c.chart4, c.chart5];
    const onCard = steps.map((step) => contrast(step, c.card));
    for (let index = 1; index < onCard.length; index++)
      assert.ok(
        onCard[index]! < onCard[index - 1]!,
        `${theme} chart${index + 1} is fainter than chart${index}`,
      );
    for (const ground of ['card', 'surface'] as const)
      assert.ok(contrast(c.chart5, c[ground]) >= 2, `${theme} chart5 on ${ground}`);
    assert.ok(contrast(c.chart1, c.card) >= 4.5, `${theme} chart1 reads like ink`);
  }
});
