// One visual identity for the app, the website, the owner desk and the WhatsApp rate cards:
// mineral ivory paper, blueprint ink, clay for actions. Values match the website's CSS
// variables (apps/storefront/app/globals.css :root) so every surface reads as the same shop.
export const colors = {
  paper: '#F5F3ED',
  surface: '#FFFFFF',
  ink: '#173345',
  inkSoft: '#3D5A69',
  muted: '#55646C',
  line: '#CDD3CE',
  stone: '#E5E8E2',
  kraft: '#DDD5BA',
  clay: '#B45438',
  clayDeep: '#8D422E',
  clayOnInk: '#F2B49C',
  green: '#276047',
  greenSoft: '#E2EEE6',
  danger: '#9E3324',
  dangerSoft: '#F6E4D8',
} as const;

/** 4-point spacing scale. */
export const space = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32 } as const;
export const radius = { sm: 6, md: 10, lg: 16, pill: 999 } as const;
/** Minimum text sizes keep Devanagari readable on budget phones. */
export const textSize = {
  caption: 14,
  body: 16,
  lead: 18,
  title: 22,
  heading: 30,
  display: 40,
} as const;
/** Smallest comfortable touch target (Android guidance is 48dp). */
export const touch = 48;
/** One easing curve and three durations, matching the website's motion tokens. */
export const motion = {
  quick: 160,
  base: 220,
  enter: 420,
  easing: [0.2, 0.7, 0.2, 1] as const,
};
