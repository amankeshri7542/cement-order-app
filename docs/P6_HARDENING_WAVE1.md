# Phase 6: wave 1 hardening (audit fixes)

16 October 2026. Branch `codex/p6-hardening` (draft PR #12), commits `129f969..6cda358`
(15 commits, 71 files, +3,778/−458). Written on 17 October from `git log` and the code; nothing
here was deployed.

## What changed

Fixes for the read-only audit in [AUDIT_2026-10-15.md](AUDIT_2026-10-15.md) (findings F01–F38).

| Area            | Change                                                                                                                                                                                                                                                                                                                                                            |
| --------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| API sign-in     | OTP daily budgets are charged only after the IP and phone checks pass (F01); one `INVALID_CREDENTIALS` reply for every wrong staff sign-in; 10 wrong passphrases lock that account from that network address for an hour (F07); staff phone numbers hidden from customers (F02); refresh-token grace of 5 minutes (F20, migration `20261016090000_refresh_grace`) |
| API money/stock | Stock movements no longer bump `Product.version` (F10); replays with a different body get 409 `IDEMPOTENCY_CONFLICT` (F12, F13); quotes accepted before expiry can still convert (F11); 409 `ORDER_TOO_LARGE` (F33); COD refunds record the channel (F37)                                                                                                         |
| API limits      | Unauthenticated uploads refused before the 5 MB body is read (F09); `NODE_ENV` required and test mode needs a `_test` database (F25); live-update streams capped (`EVENT_STREAMS_PER_IP`=20, `EVENT_STREAMS_TOTAL`=2000) (F31)                                                                                                                                    |
| Infra           | Safer 5xx logs (F06); worker steps fail independently and push is marked sent per device (F23, F38); runtime database role loses broad `DELETE` (`scripts/runtime-grants.sql`, F08); CI gets a schema-drift check, read-only permissions and a non-blocking app/desk audit (F24, F27)                                                                             |
| Android app     | Offline launch keeps the session (F05); late-401 retry (F20); sign-out clears tokens first (F21); live-update backoff and watchdog in `src/live.ts` (F17, F18); error boundary with Sentry (F22); no cookies on native requests (F32)                                                                                                                             |
| Owner desk      | Order search debounced (F03); "could not check sign-in" state during outages (F15); money-report sequence guard (F16); `app/error.tsx` (F22); the code field stays after a wrong code                                                                                                                                                                             |
| Website         | Checkout review clears only on catalogue/price/store changes (F14); guest double-tap adds one pack, default delivery date is tomorrow in IST (F36)                                                                                                                                                                                                                |

## Tests added

About 53 new cases: `apps/api/test/config-guards`, `hardening-auth`, `hardening-infra`,
`hardening-money`; `apps/mobile/test/live.test.mjs`; `tests/desk-hardening.spec.ts`;
`tests/storefront-hardening.spec.ts`.

## Evidence

GitHub Actions on `6cda358`: Verify run 38940017682 ✅ and Android app journeys run
38940017651 ✅.

## Owner decisions shipped as defaults

Quotes accepted before expiry convert (C5); staff lockout per account plus address (D3);
refresh grace 5 minutes. See [MANUAL_SETUP.md §7](MANUAL_SETUP.md).
