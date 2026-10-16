# Manual setup: accounts, keys and family content

This page lists everything a person has to create, buy, approve or type in by hand. Code
cannot do these steps. Each item says who does it, when, roughly what it costs, and which
setting it fills in. Never put a key in Git, in a screenshot or in a chat message. Paste it
only into the hosting provider's secret settings.

All prices are **estimates** from October 2026. Check them on the day you sign up.

Setting names below are the exact names the code reads: `apps/api/src/config.ts` (API),
`apps/*/.env.example`, `render.yaml`, `apps/mobile/eas.json` and `apps/mobile/app.config.ts`.

## 1. Needed for the family review on staging

| #   | What                                                                             | Who    | Cost (estimate)                                                        | Fills in                                                                  |
| --- | -------------------------------------------------------------------------------- | ------ | ---------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| 1   | A domain, for example `shivcement.in`, with DNS access                           | You    | about ₹800–1,200 a year                                                | `api.staging.<domain>`, `shop.staging.<domain>`, `admin.staging.<domain>` |
| 2   | Render account with billing on, region Singapore                                 | You    | about ₹1,500–2,500 a month for 3 Starter services and a small Postgres | Hosts the API, the website and the owner desk (`render.yaml`)             |
| 3   | Twilio account with **Verify** enabled for India, plus a spending limit          | You    | about ₹0.5–4 per SMS code                                              | `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_VERIFY_SERVICE_SID`    |
| 4   | Expo account, with the project linked once (`npx eas-cli init` in `apps/mobile`) | You    | Free tier is enough for a few builds                                   | Builds the Android APK (`preview` profile) for Papa's and Chacha's phones |
| 5   | Two or three approved phone numbers for testing (yours, Papa's, Chacha's)        | Family | —                                                                      | Twilio "Verified Caller IDs" while the account is in trial                |

## 2. Secrets I generate with you (no account needed)

| Setting                                                           | How                                                                                                     | Where it goes                                                                               |
| ----------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| `OTP_HASH_SECRET`                                                 | Render generates it (`generateValue` in `render.yaml`), or `openssl rand -base64 48`                    | Render API secret                                                                           |
| Runtime database login `shiv_runtime` and its password            | `psql` session in [STAGING_RUNBOOK.md](STAGING_RUNBOOK.md) section 5, then `scripts/runtime-grants.sql` | Render API secret `DATABASE_URL` (runtime role, `sslmode=require`)                          |
| `WEB_PUSH_PUBLIC_KEY`, `WEB_PUSH_PRIVATE_KEY`, `WEB_PUSH_SUBJECT` | `npx web-push generate-vapid-keys`; subject is `mailto:` or `https://`                                  | Render API secrets (desk alerts with sound). Set both keys or neither                       |
| Staff passphrases                                                 | Each person chooses 12–200 characters; typed into the terminal only                                     | `ADMIN_BOOTSTRAP_PASSWORD` for one `npm run admin:grant -w @shiv/api` command, then removed |

## 3. Settings that are not secret (I fill these in)

| Service           | Setting                                                             | Value                                                                  |
| ----------------- | ------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| API               | `NODE_ENV`                                                          | `production` (required: the API refuses to start without it)           |
| API               | `CORS_ORIGINS`                                                      | `https://shop.staging.<domain>,https://admin.staging.<domain>`         |
| API               | `TRUST_PROXY_HOPS`                                                  | `1` (verify against Render's real proxy chain before inviting testers) |
| API               | `OTP_PROVIDER`                                                      | `twilio`                                                               |
| API               | `ASSISTANT_PROVIDER`                                                | `fallback`                                                             |
| API               | `WHATSAPP_PROVIDER`, `WHATSAPP_CUSTOMER_UPDATES`                    | `fake`, `false` (until Meta approval, section 5)                       |
| API               | `OTP_PAUSED`, `DEMAND_PAUSED`                                       | `true` until the smoke test passes, then `false`                       |
| API               | `RELEASE_SHA`                                                       | the exact commit that passed CI (logged in `API_STARTED`)              |
| API               | `EVENT_STREAMS_PER_IP`, `EVENT_STREAMS_TOTAL`                       | leave unset (defaults 20 and 2000)                                     |
| Website, desk     | `NEXT_PUBLIC_API_URL`                                               | `https://api.staging.<domain>/api/v1`                                  |
| App (EAS preview) | `EXPO_PUBLIC_API_URL`                                               | `https://api.staging.<domain>/api/v1`                                  |
| App (EAS preview) | `EXPO_PUBLIC_PRIVACY_URL`                                           | `https://admin.staging.<domain>/privacy`                               |
| App (EAS preview) | `EXPO_PUBLIC_APP_ENV`                                               | `staging` (already set by `eas.json`; shows the TEST mark)             |
| Your shell        | `STAGING_API_ORIGIN`, `STAGING_SHOP_ORIGIN`, `STAGING_ADMIN_ORIGIN` | the three `https://…` origins, for `npm run staging:smoke`             |

The app's release build refuses to build if `EXPO_PUBLIC_API_URL` or `EXPO_PUBLIC_PRIVACY_URL` is
not a real HTTPS address. Put them in the EAS **preview** environment, not in `eas.json`.

## 4. Recommended, free tiers

| What                             | Why                                                      | Fills in                                                                                                           |
| -------------------------------- | -------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| Sentry (one project for the app) | See app crashes instead of guessing                      | `EXPO_PUBLIC_SENTRY_DSN` (app); `SENTRY_AUTH_TOKEN`, `SENTRY_ORG`, `SENTRY_PROJECT` as EAS secrets for source maps |
| UptimeRobot or Better Stack      | A phone or WhatsApp alert when the site or API goes down | Monitors on `/api/v1/health/ready`, the website and the desk                                                       |

The API, website and desk have no Sentry setting yet. Their errors go to Render's logs as JSON
events (`API_STARTUP_FAILED`, `HTTP_REQUEST` with status, and so on). Read them there.

## 5. Later, only when the family decides

| What                                          | Needed for                                               | Fills in, and notes                                                                                                                                                                                                                                                                    |
| --------------------------------------------- | -------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Google Play Console (personal)                | Play Store closed test, then public launch               | about ₹2,100 one time (US$25); 12 testers for 14 days before production                                                                                                                                                                                                                |
| Meta WhatsApp Business number and 4 templates | WhatsApp alerts to owners                                | `WHATSAPP_PROVIDER=meta`, `WHATSAPP_ACCESS_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID`. Templates are listed in [P4_OWNER_DESK.md](P4_OWNER_DESK.md) and `apps/api/src/alerts.ts`                                                                                                               |
| Firebase project and `google-services.json`   | App push notifications                                   | API: `FIREBASE_PROJECT_ID`, `FIREBASE_CLIENT_EMAIL`, `FIREBASE_PRIVATE_KEY`. App: `GOOGLE_SERVICES_JSON` (EAS file variable). Order status already shows inside the app without it                                                                                                     |
| Cloudflare R2 (2 buckets)                     | Real product photos and Rate Studio sheets               | `R2_ENDPOINT`, `R2_BUCKET`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_PUBLIC_URL`, `RATE_SOURCE_BUCKET`; website and desk `NEXT_PUBLIC_ASSET_ORIGIN`, app `EXPO_PUBLIC_ASSET_ORIGIN`. Keep photos and private sheets in separate buckets                                         |
| OpenAI and Google Vision keys                 | AI reading of supplier rate sheets, and the AI assistant | Rate Studio: `OPENAI_API_KEY`, `RATE_OPENAI_MODEL`, `GOOGLE_VISION_API_KEY`. Assistant: `ASSISTANT_PROVIDER=openai`, `ASSISTANT_OPENAI_API_KEY`, `ASSISTANT_MODEL`, `ASSISTANT_INPUT_MICRO_USD_PER_MILLION`, `ASSISTANT_OUTPUT_MICRO_USD_PER_MILLION`. Manual entry works without them |
| Razorpay                                      | Online payment                                           | `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`, `RAZORPAY_WEBHOOK_SECRET`. Keep unset until the COD pilot has run cleanly                                                                                                                                                                    |

## 6. Family content (decisions only the family can make)

| #   | Content                                                                                                           | Who                                  |
| --- | ----------------------------------------------------------------------------------------------------------------- | ------------------------------------ |
| C1  | Real catalogue: names in Hindi and English, units, pack sizes, minimum and step quantities, prices, opening stock | Papa                                 |
| C2  | Delivery pincodes, fee, minimum order, free-delivery limit, delivery days, unloading and floor terms              | Chacha                               |
| C3  | Confirmed phone and WhatsApp number shown to customers, address and opening hours                                 | Papa                                 |
| C4  | Shop photographs: counter, rate board, godown, stock, delivery tractor; family photos only with consent           | Family                               |
| C5  | Rule for a quote accepted before its expiry date (the app now honours it by default)                              | Chacha                               |
| C6  | Booking limits: pending COD orders per customer and store-wide, the ₹ caps (`PENDING_COD_*`, `PENDING_QUOTES_*`)  | Papa and Chacha                      |
| C7  | Refund and cancellation wording, and the privacy page's business identity and retention period                    | Family, with an accountant if needed |
| C8  | Brand names and logos: written permission before using any manufacturer logo                                      | Family                               |

## 7. Decisions and release rules from the wave 1 review

| #   | Topic                                                        | What to know                                                                                                                                                                                                                                                                                    | Default                                                               |
| --- | ------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| D1  | Daily SMS budget (`OTP_SENDS_PER_DAY`, `OTP_CHECKS_PER_DAY`) | It caps SMS spend, but a determined attacker rotating numbers and addresses can use it up and pause sign-in for the rest of the day. Raising it raises the possible bill. Set a Twilio spend limit and Fraud Guard either way.                                                                  | 200 sends, 1000 checks a day; review after the first week of real use |
| D2  | Raising the minimum app version                              | The app compares its version **name** (`app.json` `version`). EAS only raises the build number. Before setting `ANDROID_MINIMUM_VERSION` or `ANDROID_LATEST_VERSION` higher, bump `apps/mobile/app.json` `version` in that release, or every install (including the new one) is told to update. | Leave both at the shipped version name (`1.0.0`)                      |
| D3  | Staff passphrase lockout                                     | 10 wrong passphrases for one staff account from one network address lock that account's sign-in from that address for an hour. Another address (mobile data instead of shop Wi-Fi) still works, and signed-in desks are not affected.                                                           | As shipped                                                            |
| D4  | Runtime database grants                                      | This release changes `scripts/runtime-grants.sql` (no broad `DELETE`). Re-run it on staging after deploying, even if no migration ran.                                                                                                                                                          | Re-run every release                                                  |
