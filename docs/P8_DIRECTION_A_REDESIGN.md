# Phase 8: wave 3, Direction A redesign ("counter and sindoor")

16–17 October 2026. Branch `codex/p8-redesign` (draft PR #14), commits `3b8ee7f..2612c15`
(9 commits, 50 files, +4,706/−4,142). Written on 17 October from `git log` and the code; nothing
here was deployed. Visual only: no API, migration or contract changes.

## What changed

- **One set of design tokens.** `packages/shared/src/theme.ts` holds the colours, one 4 px
  radius and five type sizes. `npm run theme:css` writes `apps/admin/app/theme.css` and
  `apps/storefront/app/theme.css`; `npm run test:local` fails if they are out of date.
- **Fonts.** The website self-hosts Teko 600 and Kalam. The owner desk dropped Google Fonts
  and tightened its Content Security Policy (`apps/admin/proxy.ts`).
- **Owner desk.** "Bahi-khata ledger" look (`styles.css`, `rate-studio.css`).
- **Android app.** Rate folders, parchi basket, COD stamp (`ui.tsx`, `App.tsx`, `catalog.tsx`,
  `checkout.tsx`).
- **Website.** `globals.css` rewritten; one rate board, parchi basket, challan-style review,
  redrawn material art; the assistant button sits in the header at every width.

## Tests

`packages/shared/src/theme.test.ts` (5 cases). Existing journeys were kept; one recovery
spec was adjusted for the new header. Screenshots in `docs/screenshots/` were regenerated.

## Evidence

GitHub Actions on `2612c15`: Verify run 38953378619 ✅ and Android app journeys run
38953378400 ✅. Design judgement by the family is still ⏳.
