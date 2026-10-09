# V2 integration proposal — 9 October 2026

**Local foundation implemented, 9 October 2026.** The authorized `apps/storefront`
direction now has a bounded read-only P2 prototype. See current source discovery in
[V2_DISCOVERY_REGISTER.md](V2_DISCOVERY_REGISTER.md) and implementation/verification
in [V2_STOREFRONT_FOUNDATION.md](V2_STOREFRONT_FOUNDATION.md). P1 business decisions and
P2 family/content/device acceptance remain pending. No live migration, provider
setup or hosting/domain change is authorized. V1 COD review remains separate;
[REVIEW_HANDOFF.md](REVIEW_HANDOFF.md) records its baseline.

## Evidence inspected read-only

| Project | Verified revision / deployment | What it establishes |
| --- | --- | --- |
| [shiv-cement-app](https://github.com/amankeshri7542/shiv-cement-app) (private) | `main` at [`63714fca7c7dbfbab2c78b6b3ec800edac9a458a`](https://github.com/amankeshri7542/shiv-cement-app/commit/63714fca7c7dbfbab2c78b6b3ec800edac9a458a), 20 March 2026 | Website source is `shiv-cement-website/`; separate Expo admin/staff app includes attendance, products, quotations and chat screens |
| [shiv-cement-backend](https://github.com/amankeshri7542/shiv-cement-backend) (private) | `main` at [`6b0bceaa15ec83dbf425b3063d247681d769c4e6`](https://github.com/amankeshri7542/shiv-cement-backend/commit/6b0bceaa15ec83dbf425b3063d247681d769c4e6), 28 April 2026 | Express/Mongoose routes/models; Mongo product/enquiry/staff/attendance data; OpenAI/Pinecone/Redis RAG and voice/tool features |
| [Vercel project](https://vercel.com/amankeshri7542s-projects/shiv-cement-app) | Production `dpl_EXyPHjFHTGP3rrKeqetKydpH76xh`, **READY**, 28 April 2026; deployment listing maps it to the app commit above | Project and Git/deployment connection verified; configured domains include `shivcementstore.com` and `www.shivcementstore.com`. Dashboard also reports `live: false`; READY is not an uptime or end-to-end provider claim |

Git CLI could not clone the private projects with its current credentials; the explicitly requested GitHub connector successfully read the trees and relevant files at pinned commits. No production database, attendance rows, credentials or customer exports were read. The Vercel deployment metadata—not an assumption from the repository name—identified its source commit.

Source anchors: website `src/components/Products.tsx`, `QuotationBuilder.tsx`, `Hero.tsx`, `About.tsx`, `src/app/page.tsx`; backend `src/models/{Product,Quotation,Admin,Staff,Attendance}.js`, `src/controllers/{auth,quotation,attendance,chat}.controller.js`, `src/services/rag.service.js`, `src/app.js`. These are discovery findings, not a fresh security certification of the legacy systems.

## Recommendation: one commerce backend, new storefront in the ordering monorepo

Add **`apps/storefront`** as a separate public Next.js frontend when V2 is authorized. Keep `apps/admin` for Father/Uncle, `apps/mobile` for the customer app, and the existing NestJS/PostgreSQL API as the only authority for products, prices, order ownership, stock and customer history. Reuse reviewed business content/assets from the old website after checking accuracy and image rights. Keep the legacy website deployable during discovery and cutover planning.

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
| Defer | Public AI chat/voice, attendance rewrite, online payment activation, multiwarehouse, partial fulfilment, credit/deposits and statutory GST invoicing | Separate business/security acceptance, budget and provider/device proof; no hidden expansion of V1 |

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

## Proposed design: a recognisable local construction shop

Use the real storefront and loading/material photos, an approved location/delivery map, factual opening hours and the family's own explanation of how ordering works. A warm concrete background, charcoal text, construction yellow for primary actions and restrained brick/steel accents fit the existing shop identity. Bold material names and tabular, large ₹ prices should dominate; avoid generic luxury gradients, stock-photo promises and decorative motion around essential tasks.

Suggested page sequence: shop/location and **Browse materials / सामान देखें**, category/material grid, unit/pack/availability explanation, delivery-pincode check, how COD works, **Request bulk rate / थोक भाव पूछें**, verified shop/team/award content, contact/hours and legal terms. Product pages explain bag weight/grade/use, minimum/step, current price and delivery terms. Quote estimates must look different from accepted order totals. Phone/WhatsApp buttons are explicit user actions, not automatic messages.

Hindi/English must cover form labels, errors, stock/price consent and delivery status—not just headings. Use readable Devanagari, persistent language preference, large touch targets, visible focus, semantic buttons/labels, keyboard operation, reduced motion and polite status announcements. Acceptance includes 360px layouts, real 200% zoom, slow/offline recovery and Father/Uncle completing tasks on their actual phones. Verify founding year/contact/address/claims before copywriting; the older site's source and the newer store defaults do not yet establish one approved business profile.

## Phases and acceptance criteria

| Priority / phase | Deliverable | Concrete exit criteria | Decision required |
| --- | --- | --- | --- |
| **P0 — close V1 review gates** | Review exact pushed SHA/CI, supervised family COD practice, dependency and infrastructure plan | Chrome/WebKit and backend evidence tied to source; real phones/zoom tested; business defaults signed off; staging TLS/OTP/storage/runtime roles/backups/alerts verified before public access; payments remain off | Approve a technical operator, pending-demand/return rules, test recipients and staging budget; separate staging authorization |
| **P1 — discovery/data agreement** | Legacy usage inventory, source-of-truth contracts, approved real content and unit/contact catalogue | Every collection classified retain/migrate/archive; active attendance usage established; ambiguous amounts/units/phones quarantined; no production writes | Monorepo storefront selected for local prototype; confirm attendance usage, approved content/units and physical-stock owner |
| **P2 — public storefront prototype** | Bilingual read-only local prototype implemented; see foundation evidence, with family/device approval pending | Family approves real content/design; no public cache of personal data; typed API/pagination/error contracts; keyboard/360px/200% zoom and performance budget measured on actual test devices | Approve theme/content and whether public pages show exact prices or request a reviewed quote |
| **P3 — shared commerce journeys** | Login, cart/review/COD, bulk quotes and customer history in storefront | Website/app see same price/version/history; concurrent last-stock, stale-price consent, idempotent retry, ownership/Origin/session/CSP tests pass across clients; owner receives one task; no live payments | Confirm customer account linking and delivery/wholesale policy |
| **P4 — migration rehearsal** | Versioned importer/mapping ledger, archive and explicit opening-stock procedure | Two dry runs produce identical mappings; full reconciliation; family signs stock/units; backups restore; pre-write and post-write rollback rehearsed with synthetic data | Approve record dispositions/retention, import boundary and later cutover window |
| **P5 — authorized staged cutover** | Controlled preview, provider/edge/storage/monitoring proof and one-writer rollout | Test recipients complete COD/quote/device cases; no public/dev data mix; observable alarms; rollback threshold/owner confirmed; signed acceptance before any domain switch | Explicit hosting/domain/migration authorization; none is granted by this roadmap |
| **P6 — optional operations and AI** | Staff module/archive if justified; bounded AI FAQ assistance; later payment/credit/invoice work as separate proposals | Attendance preserves records/payroll meaning with restricted access; AI is read-only with source citations, no invented stock/rates/order acceptance, cost limits and human escalation; each additional feature has independent acceptance | Prioritize based on real usage, costs and legal/accounting needs |

Do not promise migration/cutover dates before P1 establishes data quality and
current staff use. `apps/storefront` with one NestJS/PostgreSQL commerce backend
is selected for this local phase. The next decisions are approved shop content,
per-SKU units and attendance/payroll usage; unanswered questions preserve all
legacy records and workflows. P0 external gates remain open without preventing
this reversible local prototype.
