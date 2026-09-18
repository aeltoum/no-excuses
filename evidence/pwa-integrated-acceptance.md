# PWA integrated acceptance record

Issue #158 continuation. Base branch candidate combines `codex/pwa-integrated-acceptance` at `2e2d66f` with approved PWA runtime `05f4093`; validation covers the current uncommitted merge working tree. Date: 2026-09-14. No hosted service or deployment included.

## Automated candidate evidence

- `pnpm check`: pass (36 test files, 197 tests). Covers formatting, generated OpenAPI, TypeScript, unit tests, secrets, and dependency policy.
- `pnpm web:test:browser`: pass (48 passed, 2 opt-in live tests skipped). Baseline browser specs use fixture routes and cover shell routes, direct refresh, manifest/icons, keyboard access, 200% text, reduced motion, axe, OTP/Group UI, retry behavior, weekly target/check-in/history, and account deletion. Exact URL: `http://127.0.0.1:4174/`.
- Real local integration: `LIVE_PWA_INTEGRATION=1` test passed sequentially in Chromium and WebKit at 390 × 844 against local Supabase Auth, PostgreSQL schema version 15, and the deployable `packages/delivery/src/server.ts` runtime. No browser route interception or fixture API was used.
- Live journey: private operator seeded a unique synthetic organizer; six-digit OTP sign-in; explicit 18+, pilot, and product consent; Group creation; real application invitation; invited member enrollment before Auth creation; member OTP and consent; Group join; organizer target update; self-reported check-in; authoritative peer progress; empty finalized-history read; direct History refresh with restored session; unauthenticated API 401; ended member progress/history 403 with no Group name in response.
- Browser observers found no uncaught page errors, console errors, failed requests, or unexpected HTTP responses during successful live paths. Screenshots are under `evidence/pwa-local-browser/{chromium,webkit}/`: `owner-group.png`, `peer-joined.png`, `target.png`, `home-after.png`, and `history.png`. Selected screenshots contain no OTP, invitation token, or email.
- Every live pass uses unique `example.test` users and cleans its Group, invitations, check-ins, weekly rows, idempotency rows, consents, Accounts, and Auth identities in `finally`. Existing local data is not reset or selected for cleanup.

## Boundaries and open gates

The baseline fixture suite covers deterministic 503 retry with retained input and stable idempotency key. The deployable runtime has no test-only failure switch, so the combined live journey does not inject a 503. `pnpm db:test:pwa-settlement` passed against a disposable local database and dropped it afterward: pre-boundary no-op, Met and Missed outcomes at the exact boundary, idempotent replay, and finalized-history count. The broader `db:test:postgres` script cannot run inside the local Supabase cluster because its cluster-wide `anon`, `authenticated`, and `service_role` roles already exist; it requires a separate empty PostgreSQL cluster.

Android Chrome physical-device scope passed on Pixel 10 Pro XL, Android 17, Chrome 152.0.7977.83; see [Android evidence](pwa-real-device/android-pixel-10-pro-xl.md). After the favicon repair, direct CDP reload of the browser-tab target found zero page errors, console errors, request failures, or relevant local HTTP responses at status 400 or higher. The browser target reported `displayModeStandalone=false`; installed standalone mode is independently proven by `SameTaskWebApkActivity` and its screenshot. Issue #165 records the nonblocking one-member setup UX defect.

Real iPhone Safari remains **NOT RUN**: browser use, installation, standalone launch, OTP/session restoration after relaunch, keyboard/safe-area layout, 200% text, reduced motion, VoiceOver, and alternative input. Use [real-device template](pwa-real-device-template.md). Confirm iOS/Safari 16.4+ support floor or open a compatibility ticket.

Finalized Met/Missed browser presentation on a naturally elapsed live week is not run. A [local synthetic week](pwa-natural-week-boundary.md) is active and awaiting its actual 2026-09-20 10:00 UTC boundary; pre-boundary PostgreSQL and API facts are recorded there. Hosted service, production provisioning, release deployment, and spending are outside this candidate and were not performed.

Status: **automated local integration and Android physical-device scope pass; iPhone physical-device evidence remains a release gate**.
