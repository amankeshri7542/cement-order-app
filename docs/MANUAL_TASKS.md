# Things only you can do

Everything here needs an account, a signature, a phone in your hand or a real fact about the shop. The code for the rest is done and tested. Each phase adds its own section; tick items off as you go. Times are rough.

Order of work: **Start with "Facts about the shop"**, because the website and the app show nothing about the shop until you supply them. Then the accounts. Then the phone tests.

## Facts about the shop (blocks the website and the app's call buttons)

Nothing below is invented anywhere in the code. Until a fact is filled in, the app and website simply leave it out (and show a "review note" box in development only).

- [ ] **Shop phone and WhatsApp numbers, address, opening hours, a Google Maps link.** Put them in `apps/api/src/public-content.ts` (`phone`, `whatsapp`, `address`, `hours`, `directionsUrl`), set `contactApproved: true`, and commit. Only then does the app show "Prefer to order by phone?" and the website show Call/WhatsApp. (10 min, once the family agrees on the numbers.)
- [ ] **Shop name spelling in Hindi, and the year the shop started.** The old website said both "Since 2000" and "25+ years". Pick one, tell me, and it goes on the About page. Until then the page says nothing about years. (Question Q7.)
- [ ] **Shop photos** (outside the shop, the counter, a few products). Square, plain background, taken in daylight. Put the files in `apps/storefront/public/shop/` and list them under `gallery` in `public-content.ts`. Stock photos are never used.
- [ ] **Certificates or awards**, if you want them shown. Publish only the exact wording on the certificate (`credentials` in `public-content.ts`).

## Phase 3: customer app

- [ ] **Look at the new colours.** Screenshots: `docs/screenshots/phase3/` (the app, the website and the owner desk in the new palette). If any colour bothers you, change it in `packages/shared/src/theme.ts`, run `npm run theme:css` and `node scripts/make-app-icons.mjs`, and everything follows. (5 min)
- [ ] **Expo account.** `npx eas login`, then `cd apps/mobile && npx eas init` (adds the project id to the app config; commit that).
- [ ] **EAS environment variables** (Expo dashboard > the project > Environment variables), once the API has its real address. Create these in both the `preview` and `production` environments:
  - `EXPO_PUBLIC_API_URL` = `https://api.<your domain>/api/v1`
  - `EXPO_PUBLIC_PRIVACY_URL` = `https://<your domain>/privacy`
  - optional: `SENTRY_AUTH_TOKEN`, `SENTRY_ORG`, `SENTRY_PROJECT` (crash reports with readable line numbers).
    The app refuses to build a release without real HTTPS addresses, on purpose.
- [ ] **Firebase** (free): create a project, add an Android app with package `in.shivcement.store`, download `google-services.json`, then `npx eas secret:create --scope project --name GOOGLE_SERVICES_JSON --type file --value ./google-services.json` (never commit the file). Create a service account key for the API and set `FIREBASE_*` in the API's environment (see `apps/api/.env.example`). Without this, order notifications are silently off and the app still works.
- [ ] **Google Play Console** ($25 once): create the app "Shiv Cement Store" with package `in.shivcement.store`; keep Play App Signing on. In Setup > API access create a service account with release permission, download its JSON key and save it as `apps/mobile/play-service-account.json` (git ignores it; never commit it).
- [ ] **Store listing**: text from `docs/play-store/LISTING.md` (English and Hindi), icon `apps/mobile/assets/icon.png`, feature graphic `docs/play-store/feature-graphic.png`, the privacy policy and account-deletion web addresses (the website's `/privacy` and `/delete-account`, live once the site is deployed, Phase 4), the Data safety answers in `LISTING.md`, and the content rating questionnaire. **The screenshots in `docs/play-store/screenshots/{hi,en}/` are a draft taken on the demo build** (they show a TEST mark and the demo delivery zone). Once the real catalogue is loaded on staging, re-take them: start the local or staging stack, `adb reverse tcp:4000 tcp:4000` on a 1080×1920 emulator, then `maestro test --test-output-dir /tmp/shots apps/mobile/.maestro/screenshots/store.yaml` (the header of that file says how), and upload the eight Hindi or English files the listing needs. (30 min)
- [ ] **Closed test**: Play Console > Testing > Closed testing. Add at least 12 testers' Google accounts; each must opt in and stay for 14 days in a row before you can publish. Skip this only if your Play account was created before 13 Nov 2023 or is an organisation account (question Q2: which is it?).
- [ ] **Build and submit**: `cd apps/mobile && npx eas build --profile closed-test --platform android`, then `npx eas submit --profile closed-test --platform android --latest` (it stays a draft until you press publish in the console).
- [ ] **Try it on a real cheap phone** (a Redmi/Realme with 3 GB RAM, on Jio 4G): install the preview APK (`npx eas build --profile preview --platform android`), then check: opens in under 3 seconds, the Materials list scrolls smoothly (if it judders, tell me: the list in `Catalogue` and `Orders` is the one place to change, see `docs/MASTER_PLAN_PHASE3.md`), an order can be placed with the data switched off and then on, prices still show after turning data off and reopening the app (with "saved … ago" on them), and the sign-in code arrives and is read by the app by itself. Also try it with a VPN or a data-saver app switched on: the app must not say "cannot reach the store" while pages load. (1 hour)
- [ ] **SMS code auto-fill** (after the SMS provider is live, see Phase 5): the sign-in SMS must start with `<#>` and end with an 11-character app hash. Get the hash with `node scripts/sms-app-hash.mjs <certificate>` using the "App signing key certificate" you can download in Play Console > App integrity. The app works without this; it just asks the customer to type the code.
