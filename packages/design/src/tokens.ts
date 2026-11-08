import { light, radius as radii, space as steps } from '@shiv/tokens';

export { dark, light, palettes, textScale, type TextSize, type ThemeChoice } from '@shiv/tokens';

/**
 * The desk's older token names, now read from packages/tokens (Naksha 2, light). New code imports
 * from @shiv/tokens; these stay until every page has moved.
 */
export const color = {
  paper: light.bg,
  card: light.card,
  line: light.rule,
  ink: light.ink,
  ink2: light.ink2,
  ink3: light.ink3,
  brand: light.accent,
  brandInk: light.onAccent,
  green: light.ok,
  red: light.danger,
  blue: light.info,
  navy: light.rail,
};
export const radius = { sm: radii.control, md: radii.control, lg: radii.control, pill: radii.pill };
export const space = [0, ...steps.filter((step) => step >= 4)];
export const font = {
  display: '"Hanken Grotesk", "Noto Sans Devanagari", system-ui',
  body: '"Hanken Grotesk", "Noto Sans Devanagari", system-ui',
  mono: 'ui-monospace, Menlo, monospace',
};
export const type = { display: 1.5, h1: 1.5, h2: 1.25, body: 1, small: 0.875, money: 1.75 };
