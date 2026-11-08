import { colorNames, dark, light, material, print, type ColorName, type Palette } from './color';

export * from './color';

/**
 * Type steps (DESIGN.md, Typography). The desk uses rem (14 px body on a laptop; a phone and the
 * "Bada akshar" switch scale the root); the apps use dp. Weights 400, 500, 600 only.
 */
export const deskType = {
  micro: 0.75,
  meta: 0.8125,
  body: 0.875,
  lead: 1,
  title: 1.25,
  head: 1.5,
  figure: 1.75,
} as const;
export const phoneType = {
  micro: 12,
  meta: 13,
  body: 15,
  lead: 17,
  title: 20,
  head: 26,
  figure: 30,
} as const;
/** Line height: 1.35 for Latin, 1.5 when Hindi is shown (vowel marks clip at 1.35). */
export const lineHeight = { latin: 1.35, devanagari: 1.5 } as const;
/** Short labels (bottom tabs, chips): tight in Latin, opened up for Devanagari's vowel marks. */
export const lineHeightTight = { latin: 1.2, devanagari: 1.45 } as const;
export const fontFamily = {
  /** Hanken Grotesk for Latin, Noto Sans Devanagari for Hindi. */
  sans: 'Hanken Grotesk',
  devanagari: 'Noto Sans Devanagari',
} as const;

/** Spacing steps in px (or dp). Nothing else. */
export const space = [2, 4, 8, 12, 16, 20, 24, 32, 40, 48, 64] as const;
export const radius = { none: 0, control: 4, sheet: 12, pill: 999 } as const;
export const motion = { fast: 120, sheet: 180, ease: 'cubic-bezier(0.2, 0, 0, 1)' } as const;
export const zIndex = {
  base: 0,
  sticky: 10,
  drawer: 20,
  popover: 30,
  toast: 40,
  modal: 50,
} as const;
/** Touch targets and rows on a phone (DESIGN.md, Layout). */
export const touch = 48;
/** Widths where the layout changes (DESIGN.md, Layout). */
export const breakpoints = { tablet: 600, laptop: 1024, wide: 1440 } as const;
/** The "Bada akshar" steps: normal, large and larger. */
export const textScale = { normal: 1, large: 1.125, larger: 1.25 } as const;
export type TextSize = keyof typeof textScale;
export type ThemeChoice = 'auto' | 'light' | 'dark';
export type Scheme = 'light' | 'dark';

export const palettes: Record<Scheme, Palette> = { light, dark };

/** `ink2` becomes `ink-2`, `ruleStrong` becomes `rule-strong`, `chart1` becomes `chart-1`. */
export const cssName = (name: string) =>
  `--${name.replace(/([a-z])([A-Z0-9])/g, '$1-$2').toLowerCase()}`;

const colorBlock = (palette: Palette) =>
  colorNames.map((name: ColorName) => `  ${cssName(name)}: ${palette[name]};`).join('\n');

/**
 * The names the desk's CSS used before Naksha 2. Each now points at a semantic token, so every page
 * follows the theme while it waits to be rebuilt. New CSS uses the semantic names.
 */
export const legacyAliases: Record<string, string> = {
  '--shiv-paper': 'var(--bg)',
  '--shiv-card': 'var(--card)',
  '--shiv-line': 'var(--rule)',
  '--shiv-ink': 'var(--ink)',
  '--shiv-ink2': 'var(--ink-2)',
  '--shiv-ink3': 'var(--ink-3)',
  '--shiv-brand': 'var(--accent)',
  '--shiv-brand-ink': 'var(--on-accent)',
  '--shiv-green': 'var(--ok)',
  '--shiv-red': 'var(--danger)',
  '--shiv-blue': 'var(--info)',
  '--shiv-navy': 'var(--rail)',
  '--shiv-radius-sm': 'var(--radius-control)',
  '--shiv-radius-md': 'var(--radius-control)',
  '--shiv-radius-lg': 'var(--radius-control)',
  '--shiv-radius-pill': 'var(--radius-pill)',
  '--shiv-space-1': '0.25rem',
  '--shiv-space-2': '0.5rem',
  '--shiv-space-3': '0.75rem',
  '--shiv-space-4': '1rem',
  '--shiv-space-5': '1.25rem',
  '--shiv-space-6': '1.5rem',
  '--shiv-space-7': '2rem',
  '--shiv-space-8': '2.5rem',
  '--shiv-space-9': '3rem',
  '--shiv-display': 'var(--text-head)',
  '--shiv-h1': 'var(--text-head)',
  '--shiv-h2': 'var(--text-title)',
  '--shiv-body': 'var(--text-lead)',
  '--shiv-small': 'var(--text-body)',
  '--shiv-money': 'var(--text-figure)',
  '--shiv-font-display': 'var(--font-sans)',
  '--shiv-font-body': 'var(--font-sans)',
  '--shiv-font-mono': "ui-monospace, 'SFMono-Regular', Menlo, monospace",
};

/**
 * The desk's tokens.css: light by default; dark when chosen (data-theme="dark" on <html>) or, with no
 * choice made, when the device asks for dark. Print is always light.
 */
export function cssVariables() {
  const rest = [
    ...Object.entries(deskType).map(([name, size]) => `  --text-${name}: ${size}rem;`),
    `  --leading: ${lineHeight.latin};`,
    `  --leading-tight: ${lineHeightTight.latin};`,
    ...space.map((step) => `  --space-${step}: ${step / 16}rem;`),
    ...Object.entries(radius).map(
      ([name, value]) => `  --radius-${name}: ${value === 999 ? '999px' : `${value}px`};`,
    ),
    `  --motion-fast: ${motion.fast}ms;`,
    `  --motion-sheet: ${motion.sheet}ms;`,
    `  --ease: ${motion.ease};`,
    ...Object.entries(zIndex).map(([name, value]) => `  --z-${name}: ${value};`),
    `  --touch: ${touch / 16}rem;`,
    `  --font-sans: var(--font-hanken, '${fontFamily.sans}'), var(--font-devanagari, '${fontFamily.devanagari}'), system-ui, sans-serif;`,
    `  --shadow-overlay: 0 8px 24px rgba(0, 0, 0, 0.18);`,
    `  --print-paper: ${print.paper};`,
    `  --print-ink: ${print.ink};`,
    ...Object.entries(material).map(([name, value]) => `  --m-${name}: ${value};`),
    ...Object.entries(legacyAliases).map(([name, value]) => `  ${name}: ${value};`),
  ].join('\n');
  return `/* Naksha 2 tokens, generated from packages/tokens by scripts/theme-css.mjs. Do not edit by hand. */
:root,
[data-theme='light'] {
  color-scheme: light;
${colorBlock(light)}
}
[data-theme='dark'] {
  color-scheme: dark;
${colorBlock(dark)}
}
@media (prefers-color-scheme: dark) {
  :root:not([data-theme='light']) {
    color-scheme: dark;
${colorBlock(dark).replace(/^ {2}/gm, '    ')}
  }
}
@media print {
  :root,
  [data-theme] {
    color-scheme: light;
${colorBlock(light).replace(/^ {2}/gm, '    ')}
  }
}
:root {
${rest}
  /* A phone reads at 16 px body text, and "Bada akshar" scales on top (DESIGN.md, Layout). */
  --device-scale: 1;
  --text-scale: 1;
}
/* Hindi in Devanagari: vowel marks above and below clip at Latin line heights (plan v4 B2). */
:root[lang='hi'] {
  --leading: ${lineHeight.devanagari};
  --leading-tight: ${lineHeightTight.devanagari};
}
[data-text='large'] {
  --text-scale: ${textScale.large};
}
[data-text='larger'] {
  --text-scale: ${textScale.larger};
}
@media (max-width: ${breakpoints.tablet - 1}px) {
  :root {
    --device-scale: ${(16 / (deskType.body * 16)).toFixed(4)};
  }
}
html {
  font-size: calc(100% * var(--device-scale) * var(--text-scale));
}
`;
}
