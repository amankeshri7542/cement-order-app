import type { TextStyle } from 'react-native';
import { fonts } from '../platform/fonts';

import { dark as nightLedger, light as paper } from '@shiv/tokens';

/**
 * Naksha 2 colours from packages/tokens (plan v4 B1), under this app's older names so its screens
 * keep compiling. These are the light values; screens move to useStyles(theme => …) from ./theme as
 * the native kit rebuilds them (phase B5), and then follow dark too.
 */
export const C = {
  /** The page. */
  ground: paper.bg,
  /** Panels, rows that hold money, inputs. A step in tone, never a shadow. */
  up: paper.card,
  /** Wells and quiet buttons. */
  down: paper.rule,
  ink: paper.ink,
  ink2: paper.ink2,
  rule: paper.rule,
  /** The dark surfaces the light theme still has (toasts, solid buttons): the night ledger's. */
  night: nightLedger.bg,
  nightUp: nightLedger.card,
  onNight: nightLedger.ink,
  onNight2: nightLedger.ink2,
  ruleNight: nightLedger.rule,
  /** Added, the list and Place order. At most one on a screen. Never text on paper. */
  diya: paper.accent,
  diyaPress: paper.accentPress,
  onDiya: paper.onAccent,
  diyaInk: paper.accentInk,
  ok: paper.ok,
  okSoft: paper.okSoft,
  warn: paper.warn,
  warnSoft: paper.warnSoft,
  danger: paper.danger,
  dangerSoft: paper.dangerSoft,
  scrim: paper.scrim,
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
