import type { TextStyle } from 'react-native';
import { fonts } from '../platform/fonts';

/**
 * Plan 02's token values, "Naksha": paper, ink and one lamp. packages/shared/src/theme.ts still
 * holds the older palette; when it moves to these names, this file becomes an import. Keep the
 * values the same as apps/staff/src/ui/tokens.ts.
 */
export const C = {
  /** The page. */
  ground: '#EAE7DE',
  /** Panels, rows that hold money, inputs. A step in tone, never a shadow. */
  up: '#F3F1EA',
  /** Wells and quiet buttons. */
  down: '#DEDACE',
  ink: '#191D1B',
  ink2: '#4A4F4B',
  rule: 'rgba(25,29,27,0.16)',
  night: '#121513',
  nightUp: '#1D211E',
  onNight: '#EAE7DE',
  onNight2: '#B6B8AE',
  ruleNight: 'rgba(234,231,222,0.16)',
  /** Added, the list and Place order. At most one on a screen. Never text on paper. */
  diya: '#F2A33A',
  diyaPress: '#DC8C22',
  onDiya: '#191D1B',
  diyaInk: '#7A4E00',
  ok: '#1B6C44',
  okSoft: '#DFECE2',
  warn: '#7A4E00',
  warnSoft: '#F4E6C8',
  danger: '#B23A2F',
  dangerSoft: '#F4E0DA',
  scrim: 'rgba(18,21,19,0.45)',
} as const;

export const space = { 1: 4, 2: 8, 3: 12, 4: 16, 5: 24, 6: 32, 7: 48 } as const;
export const touch = 48;
export const radius = { control: 2, sheet: 8 } as const;
export const motion = {
  press: 140,
  ui: 240,
  sheet: 320,
  confirm: 400,
  springPress: { damping: 22, stiffness: 420, mass: 0.6 },
} as const;

const line = (size: number, height: number): TextStyle => ({ fontSize: size, lineHeight: height });
const light: TextStyle = { fontFamily: fonts.light, fontWeight: 'normal', letterSpacing: -0.4 };
const regular: TextStyle = { fontFamily: fonts.regular, fontWeight: 'normal' };
const medium: TextStyle = { fontFamily: fonts.medium, fontWeight: 'normal' };

/**
 * Type in dp. Light only at 20 and above; prices use Regular, never Light, because rates are read
 * outdoors (decision 28). A single face carries its own weight, so no fontWeight is asked for:
 * Android would thicken it a second time.
 */
export const T = {
  display: { ...light, ...line(34, 38) },
  head: { ...light, ...line(26, 30) },
  title: { ...regular, ...line(20, 25), letterSpacing: -0.2 },
  titleLight: { ...light, ...line(20, 25) },
  titleStrong: { ...medium, ...line(20, 25), letterSpacing: -0.2 },
  body: { ...regular, ...line(17, 24) },
  bodyStrong: { ...medium, ...line(17, 24) },
  small: { ...regular, ...line(15, 20) },
  smallStrong: { ...medium, ...line(15, 20) },
  /** A rate: Regular, even figures. */
  rate: { ...regular, ...line(20, 25), fontVariant: ['tabular-nums'] },
  rateSmall: { ...regular, ...line(17, 24), fontVariant: ['tabular-nums'] },
  rateBig: { ...regular, ...line(30, 36), fontVariant: ['tabular-nums'], letterSpacing: -0.5 },
} satisfies Record<string, TextStyle>;

/** Headings grow with the phone's text size, but never fill the screen. */
export const headingScale = 1.5;
