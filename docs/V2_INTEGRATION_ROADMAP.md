# V2 integration roadmap — 9 October 2026

**Customer experience implementation in progress, 9 October 2026.** The revised
brief authorizes the visual redesign, shared customer commerce and public Shiv
Assistant with optional voice in this milestone. Their code is implemented on
`codex/v2-customer-experience`; final browser, production, visual and exact-commit
CI evidence is still being assembled. Implementation is not release acceptance.

The read-only foundation remains preserved at commit
`8816dd913fcb1b67a9102ea2163953f8959b19a2` on
`codex/v2-storefront-foundation`, [draft PR #2](https://github.com/amankeshri7542/cement-order-app/pull/2).
See [the foundation report](V2_STOREFRONT_FOUNDATION.md),
[source discovery](V2_DISCOVERY_REGISTER.md),
[feature parity](V2_CUSTOMER_FEATURE_PARITY.md),
[design and motion](V2_DESIGN_MOTION.md) and [local review steps](LOCAL_TESTING.md).
Code implementation, feature-branch publication and CI are authorized. Deployment,
merge, domain cutover, production migration, real messages, payment activation and
attendance replacement remain separate actions. Approved content, live-provider
credentials and actual-phone acceptance are pending.

## Evidence inspected read-only

| Project | Verified revision / deployment | What it establishes |
| --- | --- | --- |
| [shiv-cement-app](https://github.com/amankeshri7542/shiv-cement-app) (private) | `main` at [`63714fca7c7dbfbab2c78b6b3ec800edac9a458a`](https://github.com/amankeshri7542/shiv-cement-app/commit/63714fca7c7dbfbab2c78b6b3ec800edac9a458a), 20 March 2026 | Website source is `shiv-cement-website/`; separate Expo admin/staff app includes attendance, products, quotations and chat screens |
| [shiv-cement-backend](https://github.com/amankeshri7542/shiv-cement-backend) (private) | `main` at [`6b0bceaa15ec83dbf425b3063d247681d769c4e6`](https://github.com/amankeshri7542/shiv-cement-backend/commit/6b0bceaa15ec83dbf425b3063d247681d769c4e6), 28 April 2026 | Express/Mongoose routes/models; Mongo product/enquiry/staff/attendance data; OpenAI/Pinecone/Redis RAG and voice/tool features |
| [Vercel project](https://vercel.com/amankeshri7542s-projects/shiv-cement-app) | Production `dpl_EXyPHjFHTGP3rrKeqetKydpH76xh`, **READY**, 28 April 2026; deployment listing maps it to the app commit above | Project and Git/deployment connection verified; configured domains include `shivcementstore.com` and `www.shivcementstore.com`. Dashboard also reports `live: false`; READY is not an uptime or end-to-end provider claim |

Git CLI could not clone the private projects with its current credentials; the explicitly requested GitHub connector successfully read the trees and relevant files at pinned commits. No production database, attendance rows, credentials or customer exports were read. The Vercel deployment metadata—not an assumption from the repository name—identified its source commit.

Source anchors: website `src/components/Products.tsx`, `QuotationBuilder.tsx`, `Hero.tsx`, `About.tsx`, `src/app/page.tsx`; backend `src/models/{Product,Quotation,Admin,Staff,Attendance}.js`, `src/controllers/{auth,quotation,attendance,chat}.controller.js`, `src/services/rag.service.js`, `src/app.js`. These are discovery findings, not a fresh security certification of the legacy systems.

## Selected architecture: one commerce backend, storefront in the ordering monorepo

**`apps/storefront`** is the separate public Next.js frontend. `apps/admin` remains for Father/Uncle, `apps/mobile` remains the customer app, and the existing NestJS/PostgreSQL API is the only authority for products, prices, order ownership, stock and customer history. Reuse reviewed business content/assets from the old website after checking accuracy and image rights. Keep the legacy website deployable during discovery and cutover planning. The alternatives below retain the original decision rationale.

| Choice | Advantages | Costs / failure modes | Best fit |
| --- | --- | --- | --- |
| New `apps/storefront` in `cement-order-app` — **recommended** | Shared contracts/money formatting, one review for API/client changes, unified security/regression gates; separate public and owner experiences | Adds one app/build; configure independent hosting later; workspace CI/toolchain coupling must stay controlled | Family-scale team, frequent commerce changes, minimal contract drift |
| Retain `shiv-cement-website/` in the existing repo | Preserves current deploy pipeline/URL redirects; independent website cadence; smaller initial content move | Versioned API client or generated OpenAPI package needed; cross-repo changes/tests; two sets of auth/CSP/config and duplicated formatting can drift | Separate website team or a firm need to retain independent releases |

Both choices must call the same new commerce API. Do not run two stock masters or dual-write orders to MongoDB and PostgreSQL. Selecting the monorepo does not authorize changing the current Vercel project/root directory/domain. Keep deployment approval as a later, reviewable step.

## Retain, migrate, replace, defer

| Action | Scope | Guardrail |
| --- | --- | --- |
| Retain | Genuine shop/team photos, logo, product descriptions, owned brand/award evidence, useful Hindi FAQs, existing SEO URLs and contact intent | Family verifies rights, contact numbers, opening hours, address, founding year and claims; source currently mixes “24+”, “25+” and “Since 2000” |
| Migrate selectively | Clean product metadata/images, approved categories/units and legacy enquiry archive; verified customer links where consent/ownership can be established | Human mapping and reconciliation; preserve source IDs/snapshots; image bytes pass new validation; no invented stock |
| Replace | Website's client-priced enquiry cart for transactional commerce, legacy price/availability reads, bearer-JWT admin/short-PIN identity for new commerce access | New API review/consent/idempotency, rotating sessions, role/ownership checks and approved origins; do not reuse legacy tokens/PIN hashes |
| Preserve pending usage decision | Staff, attendance, QR/location evidence and old operational records | Do not delete, merge into customers, recompute payroll or expose through public commerce API |
| Restore now | Public Shiv Assistant, contextual material questions, bounded conversation and explicit optional voice input | Separate NestJS public tool allowlist; approved FAQ/catalogue fallback; credentials and conservative persistent cost reservations on backend; provider simulations labelled; editable transcript before sending |
| Defer | Attendance rewrite, online payment activation, multiwarehouse, partial fulfilment, credit/deposits and statutory GST invoicing | Separate business/security acceptance, budget and provider/device proof; no hidden expansion of V1 |

## Contract and data differences

| Topic | Legacy evidence | New commerce contract / V2 decision |
| --- | --- | --- |
| API | `/api/products`, `/api/quotations`; product arrays, quotation `{total,page,quotations}`; Mongo `_id` | `/api/v1`, bounded `{items,nextCursor}`, shared strict schemas and structured errors. Add a typed boundary adapter/client; contract-test success/error/pagination and unknown-field rejection |
| Money | Product `price`, enquiry `unitPrice` and `totalEstimate` are Number values displayed as rupees; website computes sum of `price * qty` and submits it | Integer paise, server totals and review snapshots. Parse decimal text exactly (no binary `value*100` rounding guesses); reject >2 decimals, negatives/overflow or ambiguous units; retain raw legacy value and signed mapping evidence |
| Quotes/orders | Enquiry statuses `pending`, `seen`, `replied`; controller creates a quotation from submitted body | Revisioned offer, expiry, explicit customer/offline evidence, accepted-current revision and transactional conversion. Archive old enquiries as **legacy enquiries**; `replied` never means accepted/paid/dispatched |
| Identity | Admin username/password JWT (7 days), staff phone/PIN JWT (1 day); enquiry phone/name without customer authentication | Verified +91 phone, revocable/rotating sessions, staff passphrase assurance and separate roles. Re-enrol staff; never accept legacy JWTs. An unverified matching phone does not grant access to historical records |
| Units | Labels include per bag/ton/cubic ft/piece/kg/litre/tractor/cubic meter/sheet/block; quantity is a Number | Positive integer selling quantity, explicit unit/pack/minimum/step. Approve each SKU mapping (e.g. 1 bag = stated 50 kg only if verified). Tractor volume varies; no inferred conversion. Fractional legacy quantities require an approved smaller base unit or remain archived |
| Availability | `inStock: Boolean`; no physical stock quantity in the inspected Product model | Available integer balance plus immutable movements. Conduct/approve physical opening stock, units and outstanding reservations; unknown stock stays inactive/unavailable pending count, never fabricated from `true` |
| History | Enquiry line/name/price snapshots; staff/attendance documents and timestamps | Keep immutable provenance; do not retrospectively recalculate old totals or create financial movements from enquiries. Link eligible archives separately from new commerce orders |
| Images | Legacy image URLs/S3 and website assets | Verify rights, retrieve through an operator-controlled allowlist, validate/re-encode bytes, record approved asset URL. Do not enable arbitrary URL fetching or simply paste old URLs into new products |

Website/app consistency comes from one product ID, one current price/version and one inventory ledger in PostgreSQL. Both clients use the same review/order/quote endpoints. Public catalogue pages may cache bounded data, but show a freshness state and invalidate/refetch on changes; checkout always obtains a fresh API review and explicit price consent. Personalized history/cart is never put in a public cache. Guest browsing requires no login; ordering/history requires the existing identity/ownership checks. When an owner publishes rates or records stock, both clients refetch. Idempotency covers lost responses and cross-device retries. Do not manufacture “reserved stock” from a website cart.

For browser identity, propose owned sibling HTTPS domains with host-only API cookies, explicit per-frontend Origins and credentials. If hosting requires a same-origin proxy instead, design and test it before adopting it; never relax SameSite/CORS to make unrelated hosting domains work. Public website calls must not inherit staff privileges or leak owner-only supplier/cost/attendance information.

## One-time migration and rollback proposal

1. **Inventory and freeze plan:** with separate authorization, collect read-only counts/date ranges/schema variants and recent usage from each collection. Agree source owner, data retention, outage window and export boundary. Export encrypted backups with checksums; verify restore into isolated environments first. Retain original Mongo data and legacy deploy revision.
2. **Mapping ledger:** create a migration-only manifest keyed uniquely by `(sourceSystem, collection, legacyId)` with target ID, source digest, mapping version, disposition/reason and batch ID. Keep original timestamps/status/amount/unit separately. Never map on display name alone. Re-running the importer must produce the same mapping without duplicates.
3. **Dry run:** use disposable PostgreSQL and providers disabled. Import product metadata as inactive until approved; import enquiries into a read-only legacy archive, not `Order`. Resolve duplicate phones/SKUs and ambiguous units manually. Do not carry sessions/passwords/PINs. Owner-reviewed verified identity claims can link an archive later with audit evidence.
4. **Opening stock:** family signs a physical count in approved selling units and identifies actual outstanding obligations. Record one explicit opening movement with actor/date/reference per SKU. Do not infer quantities from `inStock`, past enquiries, website carts or AI. Confirm all order/payment history classification before any operational import.
5. **Reconciliation:** compare counts and digests by disposition, every mapping's uniqueness, original enquiry totals/snapshots, referential integrity and separately approved stock/financial invariants. Sample Hindi names, phone normalization, IST dates, decimal amounts and outlier units with Father/Uncle. Acceptance: every source record is mapped or intentionally archived/quarantined with a reason; no silent drop.
6. **Cutover, only after approval:** freeze relevant legacy writes, capture a final delta under the agreed boundary, rerun reconciliation, then switch one client at a time to the single commerce writer. Preserve old routes/redirects and a rollback-capable deployment. Attendance stays on its current system unless its own migration is approved.
7. **Rollback:** before new writes, restore the previous client/config and untouched legacy data. After new orders exist, stop affected writes and reconcile the new PostgreSQL orders/stock/money before any switch; never overwrite with a pre-cutover dump or erase accepted orders. Roll back frontend/API code against a compatible schema where possible; preserve additive tables/audit history. Test this distinction during the rehearsal, name the decision maker and define failure thresholds.

## Staff/attendance usage: unresolved

The source contains real implementations for staff records, QR/location attendance, one record per staff/day, in/out times and admin/staff screens; seed scripts also exist. **Code and seed files do not establish active use.** No live record count, latest attendance date, payroll dependence or user confirmation was available during discovery. Keep both records and the running legacy workflow intact.

Next discovery must ask Father/Uncle which staff use it, who corrects attendance and whether pay depends on it; then, with read-only data authorization, compare recent genuine records/logins against seed data. If active, integrate a separate restricted staff module after documented time-zone/privacy/payroll rules. If historical, keep an access-controlled read-only archive with agreed retention. Do not expose staff location/identity through the public website or AI tools.

## Current customer experience

The selected material sample-board direction uses mineral ivory, deep ink blue and restrained clay accents, a compact bilingual shop sign, distinct retail/bulk routes and category-specific illustrations. Two locally rendered explorations and live reference observations are recorded in [V2_DESIGN_MOTION.md](V2_DESIGN_MOTION.md). Approved product images take precedence; illustrations do not stand in for documentary shop photographs. Family/gallery/credentials and visiting information remain explicitly pending until accurate copy, asset rights, contact numbers and location are approved.

Implemented customer surfaces include discovery/search/filter/sort, product detail, two- or three-material comparison, phone sign-in, guest-cart merge, account/address management, COD review and uncertain-result recovery, order history/tracking/cancellation/reorder, and revisioned quotation request/accept/reject/conversion links. Guest merges and uncertain submissions retain their request keys; carts and orders do not create a second inventory authority. Shared cart reconciliation uses explicit refresh and online/focus/visibility recovery paths. Quotations remain enquiries/offers until the owner converts the accepted current revision to an order.

Shiv Assistant is lazy-loaded on explicit use, with contextual product entry points, bounded session conversation, cancel/retry/reset, accessible focus handling and text input throughout. Optional voice starts only when chosen and requires an editable transcript before sending. The NestJS dispatcher allows only public products, delivery, approved shop content and FAQs; staff, attendance, private quotations and customer records are excluded. Default approved-content/catalogue fallback is useful without AI credentials. Live OpenAI activation requires separately verified backend key/model/pricing configuration; simulated-provider tests are not evidence of live AI. Conservative budget reservations use configured approved pricing rather than provider-invoiced usage.

Foundation fixes cover CLOSED event-stream recovery and stale delivery-result refresh. Production header verification now owns isolated temporary builds/listeners, tests applicable nonce presence/rotation and CSP in Chrome/WebKit, and records lazy assistant script cost separately from the unchanged **450 KiB gzip** core budget. CI includes the storefront production dependency audit. These are implemented verification paths; their final results belong in the customer-experience handoff. The original native WebKit hard-navigation diagnostic remains separately runnable with retained evidence.

Hindi/English acceptance covers form labels, errors, stock/price consent and delivery status, readable Devanagari, persistent language preference, large touch targets, visible focus and polite announcements. Motion is brief and interruptible, with reduced-motion support. Review at 360px, 390px, tablet and desktop widths, enlarged text and real 200% zoom; inspect transactional screens as well as the homepage. Automated browser emulation cannot establish actual-phone keyboard, voice permission, call/WhatsApp or map handoffs. The [local guide](LOCAL_TESTING.md) includes Hindi family tasks and the separate real-device access plan.

## Phases and acceptance criteria

| Priority / phase | Deliverable | Concrete exit criteria | Decision required |
| --- | --- | --- | --- |
| **P0 — close V1 review gates** | Review exact pushed SHA/CI, supervised family COD practice, dependency and infrastructure plan | Chrome/WebKit and backend evidence tied to source; real phones/zoom tested; business defaults signed off; staging TLS/OTP/storage/runtime roles/backups/alerts verified before public access; payments remain off | Approve a technical operator, pending-demand/return rules, test recipients and staging budget; separate staging authorization |
| **P1 — discovery/data agreement** | Legacy usage inventory, source-of-truth contracts, approved real content and unit/contact catalogue | Every collection classified retain/migrate/archive; active attendance usage established; ambiguous amounts/units/phones quarantined; no production writes | Monorepo storefront selected for local prototype; confirm attendance usage, approved content/units and physical-stock owner |
| **P2 — distinctive customer storefront** | Material sample-board redesign, bilingual discovery/detail/comparison, responsive transaction screens and motion implemented; rendered review in progress | Inspected English/Hindi screens at 360/390px, tablet/desktop, enlarged text and reduced motion; fixed visible defects; screenshots/motion evidence; core budget preserved; content/device limitations explicit | Approve authentic shop/family/gallery/contact content and final real-device design acceptance |
| **P3 — shared commerce and Shiv Assistant — current milestone** | Login, durable cart merge, address/review/COD, quotations/history and bounded public assistant/optional voice implemented; verification in progress | Website/app share authoritative commerce; replay/concurrency/consent/session/ownership/security regressions pass; one owner task and stock movement; revised quote acceptance/conversion verified; assistant public-tool isolation, budget/failure/retry/voice cases proved with labelled simulations; exact-SHA CI inspected | Confirm business defaults and real-device acceptance; provide separately approved live OTP/assistant configuration; payments remain off |
| **P4 — migration rehearsal** | Versioned importer/mapping ledger, archive and explicit opening-stock procedure | Two dry runs produce identical mappings; full reconciliation; family signs stock/units; backups restore; pre-write and post-write rollback rehearsed with synthetic data | Approve record dispositions/retention, import boundary and later cutover window |
| **P5 — authorized staged cutover** | Controlled preview, provider/edge/storage/monitoring proof and one-writer rollout | Test recipients complete COD/quote/device cases; no public/dev data mix; observable alarms; rollback threshold/owner confirmed; signed acceptance before any domain switch | Explicit hosting/domain/migration authorization; none is granted by this roadmap |
| **P6 — optional operations** | Staff module/archive if justified; later payment/credit/invoice work as separate proposals | Attendance preserves records/payroll meaning with restricted access; each additional feature has independent acceptance. Public assistant implementation belongs to P3, not this deferred phase | Prioritize based on real usage, costs and legal/accounting needs |

Do not promise migration/cutover dates before P1 establishes data quality and
current staff use. `apps/storefront` with one NestJS/PostgreSQL commerce backend
is selected for this customer-experience milestone. Finish verification, retain
evidence, publish the feature branch and open a draft PR against the preserved
foundation; inspect CI for the exact pushed commit. The next external decisions
are approved shop content, per-SKU units, staging/provider/device acceptance and
attendance/payroll usage. Unanswered questions preserve all legacy records and
workflows. P0 external gates remain open without preventing local implementation.
