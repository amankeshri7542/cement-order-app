/**
 * Plan 02's token values for the staff app. packages/shared/src/theme.ts still holds the older
 * palette; when it moves to these names, this file becomes an import. Keep the values identical.
 */
export const colors = {
  /** The ground: paper. */
  paper: '#F3F1EA',
  /** Wells and quiet buttons: one tone step, never a shadow. */
  well: '#DEDACE',
  ink: '#191D1B',
  ink2: '#4A4F4B',
  rule: 'rgba(25,29,27,0.16)',
  night: '#121513',
  nightUp: '#1D211E',
  onNight: '#EAE7DE',
  onNight2: '#B6B8AE',
  /** The one bright button on a screen. Never text: too faint on paper. */
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
  onSolid: '#FFFFFF',
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
