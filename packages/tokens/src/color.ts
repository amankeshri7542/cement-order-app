/**
 * Naksha 2 colours (plan v4, design system section 4.1; DESIGN.md). One source for the desk (CSS
 * variables, generated) and both Expo apps (these objects). Light is paper and ink; dark is the
 * "night ledger": the same paper at night, warm near-black and cream ink, never blue-black.
 *
 * Contrast was checked on 7 Nov 2026 (WCAG text on the page ground and on cards); color.test.ts
 * checks it again, so a changed value cannot quietly fall below AA.
 */
export const colorNames = [
  'bg',
  'surface',
  'card',
  'ink',
  'ink2',
  'ink3',
  'rule',
  'ruleStrong',
  'rail',
  'railInk',
  'railMuted',
  'accent',
  'accentPress',
  'accentInk',
  'onAccent',
  'ok',
  'okSoft',
  'warn',
  'warnSoft',
  'danger',
  'dangerSoft',
  'info',
  'focus',
  'onSolid',
  'scrim',
  'chart1',
  'chart2',
  'chart3',
  'chart4',
  'chart5',
  'ramp1',
  'ramp2',
  'ramp3',
  'ramp4',
  'onRamp1',
  'onRamp2',
  'onRamp3',
  'onRamp4',
] as const;
export type ColorName = (typeof colorNames)[number];
export type Palette = Record<ColorName, string>;

export const light: Palette = {
  /** Page ground. */
  bg: '#F6F4EE',
  /** Toolbars, table headers, the second layer. */
  surface: '#FBFAF6',
  /** Paper: cards, sheets, the ledger, drawers. */
  card: '#FFFFFF',
  /** Main text and every number. */
  ink: '#1F2322',
  ink2: '#4A4F4C',
  /** Muted text and placeholders; still readable. */
  ink3: '#5B605D',
  /** Hairlines and column rules: decorative only. */
  rule: '#D9D5C8',
  /** Input borders and the ledger double rule (3:1 for a non-text boundary). */
  ruleStrong: '#8C877A',
  rail: '#243331',
  railInk: '#E9E6DC',
  railMuted: '#AEB8B4',
  /** The one main action and the current selection. Never text on paper: use accentInk. */
  accent: '#E0A42B',
  accentPress: '#C98C14',
  accentInk: '#7A4E00',
  onAccent: '#1F2322',
  ok: '#1F7A4D',
  okSoft: '#E8F4EC',
  warn: '#8A5A00',
  warnSoft: '#FBF1DC',
  danger: '#B23A2F',
  dangerSoft: '#F8E6E3',
  info: '#2F6DB5',
  focus: '#2F6DB5',
  /** Text on a saturated solid fill (danger red). */
  onSolid: '#FFFFFF',
  scrim: 'rgba(31, 35, 34, 0.45)',
  /**
   * Charts: one kraft hue, from ink-brown to light kraft, for one series (chart1) or ordered parts
   * of a whole. Checked with the dataviz validator (ordinal): one hue, even steps, and the lightest
   * step at least 2:1 on the card. Charts always carry a legend and a table view as well.
   */
  chart1: '#352C20',
  chart2: '#5D4D37',
  chart3: '#856D4D',
  chart4: '#A78A62',
  chart5: '#C2A276',
  /** Udhaar by age: quieter to louder as it gets older, each with its own readable text. */
  ramp1: '#D9D5C8',
  ramp2: '#B09B6E',
  ramp3: '#5B605D',
  ramp4: '#1F2322',
  onRamp1: '#1F2322',
  onRamp2: '#1F2322',
  onRamp3: '#FFFFFF',
  onRamp4: '#FFFFFF',
};

export const dark: Palette = {
  bg: '#141512',
  surface: '#1A1C18',
  card: '#20221E',
  ink: '#ECE8DE',
  ink2: '#C9C4B8',
  ink3: '#A39E92',
  rule: '#33352F',
  ruleStrong: '#73766C',
  rail: '#0E0F0D',
  railInk: '#E6E2D8',
  railMuted: '#9C978C',
  accent: '#E8B04A',
  accentPress: '#D49A2E',
  accentInk: '#F0C26A',
  onAccent: '#141512',
  ok: '#6CC596',
  okSoft: '#1D2B22',
  warn: '#E9B85C',
  warnSoft: '#2E2615',
  danger: '#EE8A7C',
  dangerSoft: '#331D1A',
  info: '#8DB3EA',
  focus: '#8DB3EA',
  onSolid: '#141512',
  scrim: 'rgba(0, 0, 0, 0.6)',
  chart1: '#F2E6D6',
  chart2: '#D7C4AB',
  chart3: '#BCA381',
  chart4: '#A4875F',
  chart5: '#8B6F48',
  ramp1: '#33352F',
  ramp2: '#9C8A62',
  ramp3: '#C9B68A',
  ramp4: '#ECE8DE',
  onRamp1: '#ECE8DE',
  onRamp2: '#141512',
  onRamp3: '#141512',
  onRamp4: '#141512',
};

/**
 * Print, receipts and QR codes are black on white in both themes (DESIGN.md, the Black-On-White
 * Print Rule). Drawings keep their material colours in both themes.
 */
export const print = { paper: '#FFFFFF', ink: '#000000' } as const;
export const material = {
  kraft: '#CDBF9E',
  steel: '#5B6670',
  brick: '#A9442C',
  sand: '#C9A35B',
  stone: '#8E9196',
} as const;

/** WCAG relative luminance of a #RRGGBB colour. */
export function luminance(hex: string) {
  const channel = (index: number) => {
    const value = parseInt(hex.slice(index, index + 2), 16) / 255;
    return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(1) + 0.7152 * channel(3) + 0.0722 * channel(5);
}

/** WCAG contrast ratio between two #RRGGBB colours. */
export function contrast(a: string, b: string) {
  const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p) as [number, number];
  return (x + 0.05) / (y + 0.05);
}
