# Operator checklist: what only Aman (and the family) can do

17 October 2026. Do these in order. Code cannot do them. Each step costs money, needs an
account, or needs a real phone or a family decision. Details: [MANUAL_SETUP.md](MANUAL_SETUP.md),
[P5_STAGING_SETUP.md](P5_STAGING_SETUP.md), [STAGING_RUNBOOK.md](STAGING_RUNBOOK.md).

⏳ = you can do it now · ⛔ = waiting on a step above, the family or a provider.
Never paste a key, password or code into Git, a screenshot or a chat.

| #   | Step                                                                                                                                                                                       | Status   | Done when                                                                                                 |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------- | --------------------------------------------------------------------------------------------------------- |
| 1   | Review and merge the launch-prep PR (`codex/p10-launch-prep` → `main`). `render.yaml` deploys from `main`.                                                                                 | ⏳       | GitHub shows the PR merged and the `Verify` check green on `main`                                         |
| 2   | Family content decisions C1–C10 in [FAMILY_CONTENT_CHECKLIST.md](FAMILY_CONTENT_CHECKLIST.md) (story, phone, privacy identity, photos, brands, address, delivery pincodes and fees, terms) | ⛔       | Each row has a name and date in its Sign-off; at least C2, C3, C9, C10 before testers                     |
| 3   | Buy the domain (about ₹800–1,200/year) with DNS access                                                                                                                                     | ⏳       | You can add DNS records for `api.staging.`, `shop.staging.`, `admin.staging.<domain>`                     |
| 4   | Twilio: account, **Verify** service for India, spend limit, Fraud Guard, your + Papa's + Chacha's numbers as verified callers                                                              | ⏳       | Twilio console shows a Verify Service SID (starts `VA`) and the three numbers                             |
| 5   | Render: account with billing, approve 3 Starter services + small Postgres in Singapore (about ₹1,500–2,500/month). Import the Blueprint from `main`. **Import creates paid resources.**    | ⛔ (1)   | Render dashboard lists `shiv-staging-api`, `-admin`, `-shop`, `shiv-staging-db`                           |
| 6   | Database: migrate with the owner login, create `shiv_runtime`, apply grants (runbook §5)                                                                                                   | ⛔ (5)   | `prisma migrate status` prints "Database schema is up to date!"; grants script ends without ERROR         |
| 7   | Fill Render secrets: `DATABASE_URL` (runtime login, `sslmode=require`), `CORS_ORIGINS`, three `TWILIO_*`, `RELEASE_SHA` = merged `main` SHA; desk and shop `NEXT_PUBLIC_API_URL`           | ⛔ (4–6) | Render API log shows `API_STARTED` with your SHA                                                          |
| 8   | Staff accounts, one per person (passphrase typed only in the terminal)                                                                                                                     | ⛔ (6)   | Prints "Store admin access granted…"; then `https://api.staging.<domain>/api/v1/health/ready` returns 200 |
| 9   | Read-only staging gate (commands below)                                                                                                                                                    | ⛔ (7)   | Prints `"status": "passed"`                                                                               |
| 10  | Set `OTP_PAUSED=false` and `DEMAND_PAUSED=false` in Render, redeploy, sign in with a real SMS code on the desk and the website                                                             | ⛔ (9)   | A real SMS arrives; you reach the desk after the passphrase                                               |
| 11  | Expo/EAS: account, `npx eas-cli init` in `apps/mobile`, set `EXPO_PUBLIC_API_URL` and `EXPO_PUBLIC_PRIVACY_URL` in the EAS **preview** environment, build the APK                          | ⛔ (7)   | EAS build page shows a finished APK; it installs on your phone                                            |
| 12  | Physical-phone tests P1–P8 and D1–D9 in [RELEASE_CHECKLIST.md](RELEASE_CHECKLIST.md) (Papa's, Chacha's, a 2–3 GB budget Android, yours)                                                    | ⛔ (11)  | Each row has device, date and result; no P0/P1 bug open                                                   |
| 13  | Family demo with the demo kit (`DEMO_TARGET=staging`, three approved `DEMO_PHONES`)                                                                                                        | ⛔ (12)  | `demo:preflight` prints `PASS: ready for the demo.`                                                       |
| 14  | Google Play Console (personal, about ₹2,100 once): identity, listing, privacy, Data safety, 12+ testers for 14 days, then the closed-test AAB                                              | ⛔ (12)  | Console shows the closed test with ≥12 opted-in testers; 14 days counted                                  |

Not now (family decides later): Razorpay, WhatsApp Business, Firebase push, R2 photos, AI
keys. Online payments stay off.

## Commands

Step 6, in a clean checkout with the migration login in `DATABASE_URL` (runbook §5 and §6):

```bash
npm ci --include=dev --workspace @shiv/api --workspace @shiv/shared --include-workspace-root
npm run db:generate && npm run build -w @shiv/shared
npm exec -w @shiv/api -- prisma migrate status
npm run db:migrate
```

Step 8, once per staff member (set `ADMIN_BOOTSTRAP_PASSWORD`, `STAFF_PHONE`, `STAFF_NAME` in
the shell first, not on the command line):

```bash
npm exec -w @shiv/api -- tsx scripts/grant-admin.ts "$STAFF_PHONE" "$STAFF_NAME"
```

Step 9, with your domain in place of `<domain>`:

```bash
export STAGING_API_ORIGIN='https://api.staging.<domain>'
export STAGING_SHOP_ORIGIN='https://shop.staging.<domain>'
export STAGING_ADMIN_ORIGIN='https://admin.staging.<domain>'
npm run staging:smoke
```

Step 11, from `apps/mobile`:

```bash
npx eas-cli build --profile preview --platform android
```

Step 13 (staging database, owner login, `DEMO_TARGET=staging`, `DEMO_PHONES` set):

```bash
npm run demo -- snapshot .local/demo-before.dump
npm run demo -- prepare
npm run demo:preflight -- https://api.staging.<domain>/api/v1 --site https://shop.staging.<domain> --desk https://admin.staging.<domain>
```

After every deploy: re-run `scripts/runtime-grants.sql` (MANUAL_SETUP D4).
