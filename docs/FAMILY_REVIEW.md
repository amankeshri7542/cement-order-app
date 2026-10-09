# Family review and staging handoff

Nothing is deployed. First complete [local testing](LOCAL_TESTING.md), then explicitly request staging deployment. Feature-branch publication for source review is authorized; see [REVIEW_HANDOFF.md](REVIEW_HANDOFF.md). Application deployment still requires a separate request.

## पापा और चाचा के साथ 15 मिनट

Use separate browser profiles and the local test identities. Say: **“यह अभ्यास है। असली पैसे या सामान नहीं भेजना है।”**

1. **पापा:** “आज” खोलिए। नया ऑर्डर आने पर खोलिए, ग्राहक का नाम/इलाका/माल/रकम पढ़िए। “ज़िम्मेदारी लें” दबाइए। किसका काम है, स्पष्ट दिखना चाहिए।
2. **पापा:** ग्राहक को फ़ोन/WhatsApp करने का बटन खोजिए; वास्तविक संदेश भेजे बिना रुकिए। “तैयार करें”, फिर “भेजें” करके स्थिति देखिए। अभ्यास में नकद मिला दर्ज करके डिलीवरी पूरी कीजिए।
3. **पापा:** दूसरे टेस्ट ऑर्डर पर ग्राहक ने मना किया चुनिए। नई तारीख पर फिर भेजने और दुकान में वापस आए सामान की सही गिनती दर्ज करने का रास्ता खोजिए। खराब बोरी को बेचने लायक स्टॉक में न जोड़ें।
4. **चाचा:** “और → Bulk quotes” में टेस्ट अनुरोध खोलिए। भाव, ढुलाई, तारीख और वैधता भरिए; गाड़ी/रास्ता संभव है, यह पुष्टि कीजिए। ग्राहक की मंज़ूरी के बाद ऑर्डर बनाइए। भाव बदलने पर दोबारा मंज़ूरी चाहिए।
5. **दोनों:** भाव और स्टॉक में नया माल, काउंटर बिक्री और भाव बदलाव करके देखिए। Hindi/English बदलकर वापस आइए। जिस बटन का मतलब समझ न आए, उसका नाम लिखिए।

Ask each person to complete tasks without coaching. Record: task, where they hesitated, mistaken action, unclear Hindi, text too small, and whether recovery was understandable. Do not treat “looks good” as workflow acceptance.

## Separate staging plan (not executed)

Use a **new database, new provider test credentials, separate storage buckets and distinct named staff**. Prefix every review product/order note with TEST. Apply migrations first; run the migration-only smoke test; grant staff explicitly. Do not copy production customer data, use development fixtures on production, or enable online payments for this family review.

A free **Render web-service tier** is a possible short review host; a free **Render Postgres** database is suitable only for a deliberately temporary review. Current documentation says free web services sleep after 15 idle minutes, wake in roughly a minute, share 750 instance hours/month, and lose local filesystem changes. Free PostgreSQL expires after 30 days. These are review limits, not dependable shop-operation guarantees. Check limits again before provisioning. Sources: [free services](https://render.com/docs/free), [FAQ](https://render.com/docs/faq). No paid resource has been provisioned.

| Concern             | Prepared decision / prerequisite before deployment                                                                                                                                                                                                                                                                                       |
| ------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Origins/cookies     | Use HTTPS sibling subdomains on an already owned domain (shop, admin, api). Provider-owned unrelated origins may break SameSite=Lax cookies. Otherwise first implement and test a same-origin proxy; do not “solve” it by weakening cookies/CORS. A new domain may cost money.                                                           |
| API proxy/SSE       | Proxy `/api/v1` without buffering SSE; forward exact permitted Origin and cookies, set correct trusted proxy hop count. Public catalogue events contain only invalidations. `/admin/events` requires staff authentication. Verify reconnect and 15-second queue polling through the actual proxy.                                        |
| Migrations          | Run `npm ci`, shared build, Prisma generate and `db:migrate` as a controlled release job against staging only. The API runtime image has no Prisma CLI; use the build/release environment, not a blind runtime startup seed. Required `pg_trgm` must be permitted.                                                                       |
| Safe bootstrap      | Migrations create only safe StoreSettings. `admin:grant` is idempotent, names each owner, rotates credentials deliberately, and creates no stock/coverage. Configure TEST products and agreed review pincodes before taking review orders.                                                                                               |
| SMS                 | Production mode requires Twilio, real credentials and provider-approved India delivery setup. Free hosting does **not** make SMS free. Verify costs/limits and approved test recipients; local mock OTP must never be a public production fallback.                                                                                      |
| Payments            | Keep StoreSettings online payments disabled and omit production Razorpay secrets. Payment/refund simulation is not live verification. Later use provider test mode, signed callbacks/webhooks, and a named technical operator; no real-money action is part of this work.                                                                |
| Storage             | Product photos are public assets on a separate asset origin. Supplier source images are private, with short-lived authenticated access. Never store private uploads on a sleeping host’s ephemeral disk. Manual Rate Studio works without AI credentials. Public/private object storage must be configured and cost-reviewed separately. |
| Backups             | Export staging PostgreSQL before migration and before free-database expiry; keep encrypted local backups, test restore, set deletion date after family review. No production backup/retention guarantee is claimed.                                                                                                                      |
| Sleeping API        | Owner work is durable; worker resumes after wake. An idle sleeping server cannot promise prompt closed-app alerts or timely reservation expiry. Warm it by opening the actual app before a supervised review; do not use synthetic keepalive traffic to pretend it is always-on.                                                         |
| Versions/advisories | API production audit currently has zero advisories. Expo/toolchain advisories remain without compatible fixes; see progress record. Do not force a downgrade to Expo 44 or independent React Native upgrade.                                                                                                                             |
| Devices             | Run the Hindi review on father’s/uncle’s actual phones. Check keyboard, 200% text, back navigation, calls/WhatsApp, intermittent mobile data. Native SMS/payment/push SDK checks require real devices/provider test mode.                                                                                                                |

Suggested temporary environment values (fill with staging-specific values, never commit secrets):

```dotenv
NODE_ENV=production
PORT=4000
DATABASE_URL=postgresql://STAGING_USER:STAGING_PASSWORD@STAGING_HOST/STAGING_DB?sslmode=require
OTP_PROVIDER=twilio
OTP_HASH_SECRET=GENERATE_A_NEW_RANDOM_SECRET_AT_LEAST_32_CHARACTERS
TWILIO_ACCOUNT_SID=STAGING_VALUE
TWILIO_AUTH_TOKEN=STAGING_SECRET
TWILIO_VERIFY_SERVICE_SID=STAGING_VALUE
CORS_ORIGINS=https://admin.YOUR_DOMAIN,https://shop.YOUR_DOMAIN
# Set only after verifying the actual proxy topology; do not copy a guessed hop count.
TRUST_PROXY_HOPS=0
# Omit Razorpay/AI/storage credentials until their independent checks are planned.
```

Set both frontend API build variables to the actual staging API URL. Use a separate customer privacy URL. Supply bootstrap secrets only to the one-off grant command. Confirm health, login/cookies, SSE/fallback, migration state, test-order labels and rollback/backups before inviting family. Outstanding decisions: owned domain or tested same-origin proxy, test SMS recipients/provider setup, private storage if upload review is needed, review date and data deletion date.

## Security handoff update — 8–9 October 2026

Use [SECURITY_HARDENING_REPORT.md](SECURITY_HARDENING_REPORT.md) as the current security evidence and staging gate list. Local controls now include pending-demand limits with Hindi recovery and audited owner exceptions, persistent budgets and pause switches, validated product photos, live session rechecks and actual frontend CSP. The family must agree business defaults and review old unacknowledged work; no order is auto-cancelled.

The API and owner production audits report zero advisories; the full workspace currently reports 32 advisory entries (21 high, 11 moderate), chiefly Expo/Metro/React Native tooling. npm offers no compatible dry-run update. A supported remediation, container scan remain outstanding. A maintained Secretlint source/local-history scan found only reviewed fixtures/placeholders; CI integration and unavailable remote history still need attention. Local restore/least-privilege rehearsal passed with synthetic data; managed backups, real storage/provider permissions, cost limits, TLS/proxy and alert delivery remain unverified. Never expose a development server for staging.
