# V2 customer experience handoff

Review snapshot: 9 October 2026. The customer experience is implemented on `codex/v2-customer-experience`. Local verification is recorded below; the draft feature PR and its Actions run record publication and exact-commit CI evidence. Approved business content, live providers and physical devices remain separate acceptance gates.

The foundation remains commit `8816dd913fcb1b67a9102ea2163953f8959b19a2` on `codex/v2-storefront-foundation`, with [draft PR #2](https://github.com/amankeshri7542/cement-order-app/pull/2) preserved. The customer feature PR is stacked on that foundation branch. Publication must compare its remote head with the tested local commit; only CI attached to that exact head counts. Nothing here authorizes deployment, merge, a domain change, a production migration, real messages, online payment activation or attendance replacement.

## Experience delivered

The selected material-board direction replaces the read-only foundation composition with mineral ivory, ink blue, clay accents, large bilingual headings and category-specific material illustrations. It gives retail purchasing and bulk enquiries separate, visible routes. Product rows give names, prices, units, packs, minimums and increments room to remain readable on phones. The homepage mixes material discovery, delivery checking, shop story, visiting information and buying guidance rather than repeating a single card layout.

Two rendered explorations and the choice are recorded in [the design and motion brief](V2_DESIGN_MOTION.md). The references informed composition; their imagery was not copied. Current product illustrations are fallbacks, not purported photographs of the shop or approved product cutouts. The brief specifies 180–220 ms interaction feedback, a short hero entrance, native scrolling and reduced-motion behavior. The assistant loads only when opened; no animation or 3D runtime was added.

Implemented customer capabilities:

- Search, category/brand filters, sorting, stable product details and comparison of two or three materials with units kept distinct.
- Persistent guest basket and sticky summary; account-bound, keyed merge into the shared customer cart; editable quantity controls and recovery after an uncertain merge.
- Phone OTP sign-in, session restoration, sign-out, account isolation and saved-address create/edit/delete.
- COD checkout with a fresh server review, explicit price/delivery consent, saved draft and same-key recovery after an uncertain submission. Confirmed results survive a failed ancillary cart refresh.
- Persisted order confirmation, history, visible-page tracking refresh, supported cancellation and keyed reorder at current terms.
- Multi-material quotation drafts, persisted references, frozen submission recovery, offer prices/freight/expiry, revision-specific accept/reject and a link to the owner-converted order. An accepted quotation remains distinct from a confirmed order.
- Contextual Shiv Assistant with public catalogue cards, bounded conversation continuity, reset, cancel/retry and optional explicit voice input with an editable transcript.
- Approval-aware family/gallery/credential and contact capabilities, with empty pending states where facts or assets are not approved.

All commerce uses the existing NestJS/PostgreSQL authority and owner work queue. The Expo customer app and storefront read the same cart/order records through their documented refresh/focus paths. Online payments remain disabled. The legacy Express/MongoDB app and its staff/attendance tools were inspected as source evidence and were not connected to this website.

## Restored legacy capabilities and corrections

[The parity register](V2_CUSTOMER_FEATURE_PARITY.md) maps every inspected feature to its immutable legacy source and current status. The useful quotation builder, sticky basket, material brands, story/gallery/contact sections and assistant/voice interaction are represented in V2.

The website now uses server quotation references instead of the legacy timestamp-generated reference. Guest intent survives navigation and reload. The assistant has its own public tool dispatcher; it does not share the legacy staff/attendance/quotation executor or Pinecone corpus. Voice never auto-sends its transcript. Catalogue brand lists do not imply authorized dealership, and a first search result is not labelled a best seller. Connection state reflects the actual stream state and recovery attempts.

## Content maintenance and approval gates

The simple structured source is [`apps/api/src/public-content.ts`](../apps/api/src/public-content.ts), served by `GET /api/v1/shop-content` and used by the assistant's public shop/FAQ tools. Edit approved bilingual story/FAQ copy there. No new CMS is required.

For approved family, gallery and credential images, place the real asset under `apps/storefront/public/shop-assets/` and use a URL such as `/shop-assets/shop-front.webp` in the relevant entry. The renderer accepts only `/shop-assets/name.(png|jpg|jpeg|webp)`, with ASCII letters, digits, underscores or hyphens in `name`. Remote image URLs, nested paths and SVG are not accepted by this gallery path. Provide accurate captions and alt text; product photos continue through the separate existing approved-product asset pipeline.

Keep `contactApproved: false` until the family confirms the phone/WhatsApp recipients, exact address, hours and map destination. Once approved, phone values must have the `+91` form accepted by the renderer; directions must be an explicit `https://google.com/maps/…` or `https://www.google.com/maps/…` URL. Call, WhatsApp and directions open only after the visitor chooses them. No map loads in the background, and no message is sent automatically.

Still awaiting business approval:

- Family names/roles/history, founding date and genuine shop/family photographs with consent.
- Award title, recipient, issuer/date and rights to display documentary assets.
- Brand/logo usage, dealership claims and exact product photo/SKU/unit/pack correspondence.
- Contact recipients, visiting details, delivery coverage and commercial wording suitable for public release.

The legacy `store-front.png` is explicitly described as a placeholder in its source; `about-bg.png` is described as AI generated. Neither was copied or represented as real shop photography. No years, award counts, customer testimonials or dealership status were invented.

## Assistant configuration and limits

`ASSISTANT_PROVIDER=fallback` is the default. It returns labelled approved FAQ/catalogue assistance without a live model. `simulation` is a labelled testing mode and is forbidden in production. `openai` requires separately approved live configuration; the rate-studio key/model are not reused.

| Setting                                  | Purpose / current default                                                                                         |
| ---------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `ASSISTANT_OPENAI_API_KEY`               | Backend-only assistant credential; never a public/browser variable.                                               |
| `ASSISTANT_MODEL`                        | Explicit approved model ID; the adapter verifies it against the provider model endpoint, cached for five minutes. |
| `ASSISTANT_INPUT_MICRO_USD_PER_MILLION`  | Approved input pricing, in micro-USD per million tokens. Required for live mode.                                  |
| `ASSISTANT_OUTPUT_MICRO_USD_PER_MILLION` | Approved output pricing in the same unit. Required for live mode.                                                 |
| `ASSISTANT_DAILY_BUDGET_MICRO_USD`       | Separate persistent assistant reservation ceiling; default `1000000` ($1).                                        |
| `ASSISTANT_REQUESTS_PER_HOUR`            | Per-IP request budget; default `30`.                                                                              |
| `ASSISTANT_REQUESTS_PER_DAY`             | Store-wide daily request budget; default `500`.                                                                   |

The public allowlist is only `products`, `delivery`, `shop` and `faq`. Product reads explicitly project public fields and return at most six results; delivery reads expose only approved commercial zone fields. There are no purchase, private customer, staff, attendance, margin or internal quotation tools.

Input is limited to 600 characters, at most eight history messages of 1,200 characters each and validated tool arguments. The provider phase has a 12-second deadline, three concurrent leases, at most four tool calls and two model responses with at most 600 output tokens each. Upstream bodies are limited to 96,000 bytes and the final answer to 2,000 characters. Provider requests set `store: false`. Cancellation ends active provider work; unavailable, timeout and cost-limit results remain explicitly labelled and preserve useful public fallback information.

Cost enforcement reserves a conservative bound before each provider call, using bounded input size and the configured approved prices. Reservations remain charged after an uncertain timeout. This is a protective reservation counter, not an invoice or a measurement of actual billed provider usage. Live credentials, current commercial pricing and real-provider acceptance remain pending.

The browser stores bounded conversation context for navigation continuity. Voice starts only through the microphone button, offers stop/cancel and transcript editing, and cleans up when the panel closes or unmounts. Unsupported browsers keep typed chat. The storefront microphone Permissions-Policy is restricted to `(self)`; the production checker confirmed it in both engines; owner and customer-app microphone access remains disabled.

## Verification ledger

Completed local runs are listed below. The final feature PR must also pass the verification workflow on its exact published head; its Actions result is the durable CI record.

| Area                       | Completed evidence                                                                                                                                                                                                                                                                                                                                                          |
| -------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Lint and TypeScript        | Repository lint, all five workspace typechecks and browser-spec TypeScript passed.                                                                                                                                                                                                                                                                                          |
| Unit tests                 | 85/85 API tests, including 24 assistant/provider simulation cases; storefront unit tests passed.                                                                                                                                                                                                                                                                            |
| API integration            | 73/73, including JSONB merge-receipt replay and cross-account request rejection.                                                                                                                                                                                                                                                                                            |
| API workflows              | 20/20; bootstrap smoke passed; local launcher 10/10 passed with process/port permissions.                                                                                                                                                                                                                                                                                   |
| Combined storefront Chrome | 27/27, zero skipped, flaky or unexpected; `.local/v2-customer/chrome-landmarks.json`. Earlier streaming-buffer assertion failures and traces remain retained.                                                                                                                                                                                                               |
| Combined storefront WebKit | 27/27, zero skipped, flaky or unexpected; `.local/v2-customer/webkit-landmarks.json`.                                                                                                                                                                                                                                                                                |
| Native WebKit diagnostic   | 1/1 passed, zero page errors; `.local/v2-customer/webkit-native.json` and `webkit-native-results/` retain trace, failed-request and console evidence.                                                                                                                                                                                                                       |
| Production security        | All six Chrome/WebKit × owner/customer/storefront checks passed: enforced CSP and injected-script rejection, no-store, Next nonce presence/DOM agreement/rotation, static Expo nonce applicability, and exact microphone policy. Evidence: `.local/security-hardening/production-headers.json` and per-frontend traces. The isolated-port/self-test checker now runs in CI. |
| Builds and dependencies    | API build, owner/storefront production builds and Expo web export passed. Production dependency audit across API/admin/storefront reported zero vulnerabilities. Credential-pattern scan reported zero findings.                                                                                                                                                            |
| Data and migrations        | Before/after development snapshots match: 6 users, 8 products, 0 orders, 0 quotations; online payments disabled. All nine historical migration checksums are unchanged. No migration was added.                                                                                                                                                                             |
| Publication                | Foundation PR #2 remains preserved. The draft feature PR targets `codex/v2-storefront-foundation`; verify its remote SHA and CI head together. No deployment or merge is part of this checkpoint.                                                                                                                                                                           |

Core initial storefront JavaScript measured **294,987 bytes gzip (288.1 KiB)**, below the unchanged **450 KiB** budget. Opening the assistant added **5,036 bytes gzip (4.9 KiB)** / 13,369 raw bytes in both engines. The checker records the exact script sets and retains traces. Its localhost TLS, unthrottled run does not establish mobile-network performance. No budget increase was made.

The original native WebKit hard-navigation diagnostic remains separately runnable without mocked EventSource, a lifecycle wrapper or extra navigation waits:

```sh
RUN_STOREFRONT_WEBKIT_DIAGNOSTIC=1 npm run test:e2e -- --config=playwright.qa.config.ts --project=webkit tests/storefront-webkit-diagnostic.spec.ts --trace=on
```

This diagnostic passed on this run; the foundation's intermittent native SSE teardown failure remains historical evidence, not proof that every real Safari version is fixed. The production checker also initially exposed a WebKit root RSC prefetch error during document reload. Disabling prefetch only on homepage self-links resolved the reproduced case; client navigation remains intact. Chrome assertions now target the rendered main landmark because hidden Next.js streaming buffers can temporarily duplicate text. No browser errors were suppressed and failed traces were retained.

Tests use disposable databases and labelled provider/speech simulations. They cover guest merges, shared cart refresh, multi-digit entry, uncertain COD/quote responses, renewed consent, owner work/inventory effects, quotation revisions/conversion, account changes, public-tool denial, assistant failure/cancellation and voice states. Browser emulation and simulated recognition are not physical-phone, real-microphone or live-provider acceptance.

## Rendered critique and evidence

Inspected API-backed English and Hindi screens at 360, 390, 768 and 1440 px, with enlarged text and reduced motion. The desktop hero has a clear two-column silhouette and a material sample composition; the phone version stacks the actions before a shorter illustration. Wide material rows keep unit, pack and quantity controls readable. Basket, checkout and quote offers use the same typography and restrained palette, with totals separated from their supporting terms.

The review found and corrected enlarged-text navigation overflow, product-price wrapping, narrow detail columns, a detached mobile illustration label, and assistant focus restoration in WebKit. Initial screenshots also caught the hero during its opacity entrance; the final hero captures wait for visible content and completed animation. Product captures wait for usable quantity controls so screenshot caret changes do not race hydration. The final assistant response uses concise delivery guidance without unrelated product cards. The 520 px short-viewport check kept the dialog within view and keyboard focus inside it.

Illustrations are honest category-specific fallbacks. The composition is ready for approved photography, but illustration quality is not proof of actual shop/product appearance. Product names, grades and units retain the authoritative catalogue's commercial labels; additional approved Hindi product translations remain content work. Device-emulated keyboard/focus and recognition simulations do not establish real-phone microphone behavior.

Representative inspected artifacts:

| Screen          | Evidence                                                                                                                                                                                                                                                                |
| --------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Homepage        | [Desktop](screenshots/v2-customer/home-local-desktop.png), [English phone](screenshots/v2-customer/home-local-phone.png), [Hindi phone](screenshots/v2-customer/home-local-hi-phone.png)                                                                                |
| Product details | [Hindi phone](screenshots/v2-customer/product-detail-hi-phone.png), [enlarged Hindi](screenshots/v2-customer/product-enlarged-hindi.png)                                                                                                                                |
| Basket          | [Desktop basket](screenshots/v2-customer/basket-desktop.png)                                                                                                                                                                                                            |
| Checkout review | [Desktop](screenshots/v2-customer/checkout-desktop.png), [English phone](screenshots/v2-customer/checkout-desktop-en-phone.png), [Hindi phone](screenshots/v2-customer/checkout-desktop-hi-phone.png)                                                                   |
| Confirmed order | [Desktop](screenshots/v2-customer/order-confirmation.png), [English phone](screenshots/v2-customer/order-confirmation-en-phone.png), [Hindi phone](screenshots/v2-customer/order-confirmation-hi-phone.png)                                                             |
| Quotation offer | [Desktop](screenshots/v2-customer/quotation-offer.png), [English phone](screenshots/v2-customer/quotation-offer-en-phone.png), [Hindi phone](screenshots/v2-customer/quotation-offer-hi-phone.png)                                                                      |
| Assistant       | [English phone](screenshots/v2-customer/assistant-en-390.png), [Hindi phone](screenshots/v2-customer/assistant-hi-390.png), [short viewport](screenshots/v2-customer/assistant-hi-short-viewport.png), [motion recording](screenshots/v2-customer/assistant-phone.webm) |

The full bilingual viewport matrix is retained locally under `.local/v2-customer/rendered/`; eight assistant viewport/language checks are recorded in `.local/v2-customer/assistant-rendered.json`. Browser traces retain timing and failure details; screenshots alone are not the interaction or security evidence. The local paths are development artifacts, not publicly hosted media. Historical foundation screenshots are preserved separately.

## Local review routes

These URLs refer to the development computer:

| Surface                    | URL                                   |
| -------------------------- | ------------------------------------- |
| Customer storefront        | <http://localhost:3003>               |
| Owner desk                 | <http://localhost:3002>               |
| Existing Expo customer app | <http://localhost:8081>               |
| API health                 | <http://localhost:4000/api/v1/health> |

Use [the local testing guide](LOCAL_TESTING.md) for launcher ownership, fixture setup, full Hindi family tasks and the separate device-access plan. Port 3000 belongs to another local application and is not the storefront.

Suggested review sequence in the local test environment:

1. Open the storefront; switch English/Hindi, browse/filter, inspect a product's unit/pack/minimum/step and compare two differently sold materials.
2. Add materials while signed out, reload, then sign in using the visibly labelled local test-code flow. Confirm the retained selection appears once. Edit a multi-digit quantity and verify the shared customer app after its documented refresh.
3. Add or edit a saved address, check the site pincode, then obtain a fresh COD review. Inspect item quantities, unit prices, address, date, delivery fee and total before giving consent. Submit one local test order; compare its number and status with the owner desk and existing customer app.
4. Build a multi-product quotation, enter delivery/company/site details and submit. Verify the real reference in the owner desk. Review an owner offer, change its revision, and confirm acceptance applies only to the displayed revision. Convert through the existing owner flow and open the resulting order.
5. Open contextual help from a material. Ask about its price/unit, follow a product link, return, cancel/retry an answer and clear the conversation. Verify the displayed fallback/simulation/live mode honestly describes the configured provider.
6. Where speech recognition is available, start it explicitly, stop, edit the transcript and send only by choice. Check denied/unsupported states and close while recording. Keep typed chat usable throughout.
7. Sign out or switch test accounts and confirm addresses, checkout state, order history and assistant context do not carry into the other account. Review phone widths, enlarged text, reduced motion and keyboard focus with the assistant and sticky basket visible.

Lost-response, concurrency and stock/account races should be reviewed from the automated evidence rather than reproduced against real customers or the preserved development records without a disposable fixture.

`localhost` on a phone means that phone, not this development computer. Do not expose the mock-auth local stack through a tunnel or LAN binding for real-device acceptance. Authenticated physical-device testing needs separately approved TLS staging with real OTP/provider setup and appropriately scoped test data. A public-only device preview must keep mock-auth/private endpoints inaccessible and be arranged separately. Real phones, mobile keyboards, microphone permission behavior, real SMS and live model responses remain unverified.

## Remaining acceptance and future work

Obtain family/content approvals and real-provider/device acceptance before a separate release decision. Keep the feature PR in draft for review; deployment, merge, domain cutover and production migration remain separate actions. The maintained [integration roadmap](V2_INTEGRATION_ROADMAP.md) records the later migration, launch and attendance decisions; the assistant is part of this milestone, not deferred optional work.
