# Rate Studio

## Implementation plan

Keep the current Expo / Next.js / NestJS / PostgreSQL architecture. Add private image sources, versioned price batches and rows, confirmed product aliases, and immutable rate-card snapshots. OCR/interpretation and artwork generation run outside financial transactions. Manual entry and explicit selected-product adjustments always work without AI.

Vision `DOCUMENT_TEXT_DETECTION` extracts text/layout; a separately configured OpenAI Responses model returns strict structured JSON. Persist OCR before interpretation so a failed model call does not purchase OCR again. Sources and extracted values are evidence, never authority to change product prices. All selected rows require human review, and deterministic duplicate/unit/confidence/change warnings must be resolved or explicitly acknowledged. A persisted processing lease makes interrupted attempts retryable.

Publication revalidates batch and product versions inside the existing Serializable transaction, writes actual monetary history and audits, and marks the batch published atomically. A single SSE invalidation follows commit. Existing checkout remains authoritative. Unit/config changes still invalidate reviews without fabricating equal-price monetary history.

Rate-card snapshots use approved database values, store contact, exact units/specifications and publication date. SVG and PNG rendering are deterministic, use no generative image model, and split long lists into readable pages. A failed rendering request cannot change published prices. Staff explicitly download/share; no third-party posting automation.

Visual direction: a materials-counter worksheet, graphite #252C2B, off-white #F7F6F1, concrete #E7E6E1, sand #D9C9A8, amber #E9AD32, safety green #386451. Existing condensed display headings, readable body text and monospaced monetary/specification labels. Source and proposed-price comparison are the signature, with quiet controls and clear financial confirmation. Desktop source/review split becomes mobile cards.

## Research, 3 October 2026

- [Google Vision handwriting](https://cloud.google.com/vision/docs/handwriting): document text detection supports handwriting and returns page/block/paragraph/word layout. Accuracy still requires real samples.
- [Vision REST annotate](https://cloud.google.com/vision/docs/reference/rest/v1/images/annotate): fixed backend endpoint, bounded image content, document-text feature.
- [OpenAI structured outputs](https://developers.openai.com/api/docs/guides/structured-outputs): Responses `text.format` strict JSON schema, no model tools or autonomous mutations.
- [OpenAI model lookup](https://developers.openai.com/api/reference/resources/models/methods/retrieve): verify the configured model against the owner's account. The exact GPT-5.6 Luna/Terra identifiers were not verified in the public catalogue, so no speculative default is hard-coded.
- [JSW current prices](https://www.jswneosteel.in/solutions/know-current-prices): material/location context and explicit commercial terms. Original Shiv design; no manufacturer layout or branding copied. Canva's requested status-template page returned 404 and was not treated as a usable reference.
- Find-skills leaderboard: installed Vercel React best practices (765.5K installs), verified Vercel repository (31,845 stars). Reuse installed guidance; no extra skill installation needed.

## Data and financial authority

`RateSource` stores image metadata, SHA-256 digest and OCR evidence; storage keys are private. `PriceUpdateBatch` tracks source, version, stage, bounded extraction attempts and approval. `PriceUpdateBatchItem` preserves extracted evidence, product mapping, reviewed values and product-version baseline. `ProductAlias` remembers explicitly confirmed normalized names. `RateCard` stores immutable artwork content. `ProductPriceHistory.batchId` links actual monetary changes to a batch; `kind` distinguishes historical configuration entries.

Migrations include constraints preventing mutation of published batches/items/cards and replacement of original source metadata or completed OCR evidence. Publication runs inside the existing serializable transaction with retry handling. It checks every included row, product version, active state, duplicate mapping and warning acknowledgement, then writes product changes, history, alias decisions and audit records together. Repeated publication returns the existing result. A successful new publication emits one catalogue invalidation after commit. Checkout still calculates prices and validates price versions from PostgreSQL. Unit/pack/minimum/step changes invalidate checkout without adding equal-price monetary history.

## Provider configuration

Manual entry and fixed/percentage previews work without any external providers. For extraction, add these **only to the API environment**, using `.env.example` as the template:

- `GOOGLE_VISION_API_KEY`: enable Cloud Vision in a Google Cloud project with billing; restrict the key to Cloud Vision API and, where possible, the API server's egress addresses. Configure project quotas and billing alerts.
- `OPENAI_API_KEY`: a project key with access to the configured model. Set project budget alerts and provider limits.
- `RATE_OPENAI_MODEL`: the exact account-available model identifier supporting Responses strict structured outputs. Verify it using the official model retrieval endpoint and a staged schema request. There is intentionally **no default model**. GPT-5.6 Luna/Terra identifiers were not verified in the public documentation; do not guess them. If those models become available to the account, configure their verified identifiers here.
- `RATE_SOURCE_BUCKET`: a separate private R2-compatible bucket; it must differ from the public product-image `R2_BUCKET`. Reuse `R2_ENDPOINT`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`. The endpoint must use HTTPS. Restrict the storage credentials to required object read/write operations for the configured buckets. Disable public access and public/custom-domain exposure for the source bucket.

The adapter (`RateProviders`) exposes OCR and interpretation separately. Vision receives inline image bytes using `DOCUMENT_TEXT_DETECTION`; only extracted text/layout goes to OpenAI. Responses uses `store: false`, strict JSON Schema, no tools, and an untrusted-source instruction. Model availability is verified and cached for five minutes. Changing providers only requires replacing the adapter's methods while preserving the validated contract.

Source upload validates file signatures and full image decoding, not filename extensions alone. Allowed inputs: single-frame JPEG, PNG or WebP, up to 5 MiB and 20 megapixels. PDFs and multi-page uploads are outside this slice; export each page to an image. Development uses private `.local/rate-sources` files; production requires object storage. Do not put this directory under a static web root.

## Human review and failure recovery

OCR digits, handwritten text, sizes, units and regional language text can be wrong. A model confidence score is a warning signal, not calibrated proof. Staff must check each included product, unit and price. Matching prefers confirmed aliases, normalized exact matches and unique brand/specification matches. Ambiguous rows stay unmatched. Changes of at least 25%, low confidence below 85%, unchanged values and unit mismatches require acknowledgement; missing/inactive products, duplicate mappings, invalid prices and stale versions block publication.

Edits reset the affected row's approval. Refreshing a stale baseline requires a new review. Concurrent draft edits fail rather than overwrite newer work. An interrupted process has a persisted lease and recovers into a reviewable state after expiry; it does not automatically publish or silently repeat paid work. If Vision succeeds and interpretation fails, a retry reuses saved OCR. Source evidence remains available for manual entry. Rendering errors happen after publication and never roll back prices.

## Cards and sharing

Counter and Bulletin templates support WhatsApp Status (1080 × 1920), Square Social (1080 × 1080) and portrait rate sheets (1240 × 1754). SVG preserves exact integer-paise prices, names, specification, units, store contact and publication date in Asia/Kolkata. Sharp rasterizes SVG into PNG. Overflow creates readable additional pages instead of reducing prices to tiny text. Docker includes DejaVu and Noto fonts; renderer fonts can differ on a developer machine.

Only approved snapshots supply financial fields. Safe marketing fields are heading, delivery message, contact label and optional copy, with explicit human confirmation. No automatic copy claims or AI image generation. Card creation rejects prices or commercial terms changed since publication; make a fresh reviewed batch. Previously saved cards remain historical records and can become outdated. Staff download each page or explicitly invoke the native browser share sheet where supported; sharing falls back to download. There is no automated WhatsApp posting.

## Privacy, costs and operations

All Rate Studio routes, including image reads, extraction, history and card downloads, require the existing ADMIN session and browser-origin checks. Source responses are authenticated and non-cacheable. Images use content-addressed keys, digest verification and deduplication. OCR evidence uses first-writer-wins persistence and cannot later be overwritten. Concurrent first imports may still incur duplicate OCR calls before the cache is populated; this is bounded by two active extraction jobs per store.

Provider calls have 45-second timeouts and one retry for transient failure; responses and OCR/layout input sizes are bounded. Each batch permits five attempts; each staff account is limited to 20 extraction starts per hour. Logs contain usage counts, timings and safe error codes, not full documents, provider responses, keys or image bytes. Source text/layout is sensitive supplier data: inform staff that extraction sends it to configured external providers. `store:false` does not replace provider-specific retention agreements. Review provider data controls and data-processing terms before enabling real imports.

This release retains source/audit evidence and saved cards; there is no automatic retention deletion job. Document a retention period and a staff access policy before live imports. Coordinate any future deletion process with legal/accounting obligations and immutable record constraints. Back up PostgreSQL and the private source bucket, test restoration together, and monitor failed extractions, stale leases and provider spend. Single-process background extraction is sufficient for the initial 50–100-user pilot; process restarts require manual retry after lease recovery. No queue, Redis or new service is required.

## Verification and manual acceptance

Automated provider tests use local mocked responses; browser tests replace the adapter only in a test-only entry point guarded by `NODE_ENV=test` and a database name ending `_test`. The production entry point never imports those fixtures. No paid provider calls are needed in CI.

Recommended acceptance flow:

1. Sign in as staff, create a manual sheet, select a product, set a new price and check the review box. Save, inspect the difference, then publish. Confirm the customer catalogue refreshes and an accepted checkout asks for review again.
2. Upload a permitted sample in a staging environment with provider credentials. Compare source/OCR with every extracted digit, product, size and unit. Correct uncertain rows, acknowledge warnings and publish only after review.
3. Change a product from another staff session while a sheet is open. Confirm publication rejects the stale sheet without partial updates; refresh the baseline and review again.
4. Simulate a provider failure, then complete the draft manually with its original source retained.
5. Create each card format, check all pages, exact prices/contact/date and legibility on a phone. Download and open PNG/SVG; try native sharing on the actual staff phone.

Live Google Vision, OpenAI and handwriting accuracy have **not** been verified: real credentials and representative supplier samples remain required. Browser sharing support also depends on device/browser and a secure origin. Native app export builds do not constitute signed-device installation tests.

## Local verification record — 3 October 2026

- All migrations applied successfully to a fresh disposable PostgreSQL database.
- ESLint and TypeScript checks pass across the workspaces.
- 40 unit/provider/renderer tests and 52 HTTP/database integration tests pass.
- All nine browser journeys pass, including mocked image extraction, low-confidence correction, manual fallback, percentage preview, customer SSE/checkout re-review, mobile navigation protection and exact PNG download.
- Shared package, NestJS API and Next.js admin production builds pass; Expo exports succeed for Android, iOS and web.
- Desktop/mobile review screens and a full generated PNG were visually inspected. Published history uses its original approved product snapshot; later catalogue edits do not invent stale-review warnings in that historical record.
- Docker is unavailable locally. The PR workflow performs the Linux Docker build; consult its latest check before merging.

These checks use mocked provider traffic. They do not certify live handwriting extraction, native device installation or production deployment.
