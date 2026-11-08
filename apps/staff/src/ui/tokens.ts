import { dark, light } from '@shiv/tokens';

/**
 * Naksha 2 colours from packages/tokens (plan v4 B1), under this app's older names. Light values;
 * screens move to useStyles(theme => …) from ./theme as phase G1 rebuilds them, and then follow dark.
 */
export const colors = {
  /** The ground: paper. */
  paper: light.card,
  /** Wells and quiet buttons: one tone step, never a shadow. */
  well: light.rule,
  /** A well while it is pressed. */
  wellPress: light.ruleStrong,
  ink: light.ink,
  ink2: light.ink2,
  rule: light.rule,
  night: dark.bg,
  nightUp: dark.card,
  onNight: dark.ink,
  onNight2: dark.ink2,
  /** The one bright button on a screen. Never text: too faint on paper. */
  diya: light.accent,
  diyaPress: light.accentPress,
  onDiya: light.onAccent,
  diyaInk: light.accentInk,
  ok: light.ok,
  okSoft: light.okSoft,
  warn: light.warn,
  warnSoft: light.warnSoft,
  danger: light.danger,
  dangerSoft: light.dangerSoft,
  onSolid: light.onSolid,
} as const;

/**
 * Sizes in dp, Medium weight only. Plan 02's small step is 16, but this app's own rule is that no
 * text is under 18, so small differs from body only by colour.
 */
export const staffType = { number: 40, head: 28, body: 18, small: 18 } as const;
export const minTextSize = 18;
export const touchStaff = 64;
export const space = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32 } as const;
export const radiusControl = 2;
/** The green flood: 400 ms, and the only movement in the app. */
export const floodMs = 400;
export const floodEasing = [0.22, 1, 0.36, 1] as const;
/** A flood's buttons wake after this, so a second tap meant for what was under it does nothing. */
export const floodArmMs = 600;
/** Green goes back by itself after this, if nobody taps. */
export const floodHoldMs = 6000;
