# Phase 9: Teko in the Android app and Direction A rate cards

17 October 2026. Branch `codex/p9-teko-ratecards` (draft PR #15), commits `2612c15..beefb65`
(2 commits, 32 files, +371/−145). Written on 17 October from `git log` and the code; nothing
here was deployed.

## What changed

- **App font.** The Android app embeds Teko 600 (Latin and Devanagari, 155 KB) through
  `expo-font` (`apps/mobile/src/fonts.ts`, `fonts.native.ts`, `app.config.ts`).
- **Large text.** Teko headings stop growing at 1.5× the phone's font scale, so at 2× on a
  1080×1920 emulator, Home, Materials, Product and Basket keep their main button on screen.
  Evidence: `docs/screenshots/p9-teko/` (emulator, not a physical phone).
- **Rate cards.** Rate Studio's shareable SVG/PNG cards use the theme tokens, Teko and a शिव
  stamp (`apps/api/src/rate-studio/cards.ts`). `rate-studio/fonts.ts` writes its own
  fontconfig file so the PNG renderer finds Teko on Linux and macOS. See
  [RATE_STUDIO.md](RATE_STUDIO.md).

## Tests

`apps/api/test/rate-cards.test.ts` (+1) and `apps/mobile/test/release-config.test.mjs` (+1).

## Evidence

GitHub Actions on `beefb65`: Verify run 38957327500 ✅ and Android app journeys run
38957327569 ✅. PR #15 reports an arm64-only release APK of 25.64 MB (budget 30 MB; P2
measured about 25.2 MB) and a universal four-ABI APK of 66.2 MB. That measurement was not
repeated for this report.
