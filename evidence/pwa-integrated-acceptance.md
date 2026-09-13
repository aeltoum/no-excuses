# PWA candidate acceptance record

Issue #158 continuation. Base commit: `23af944`. Validated candidate: working tree on `codex/pwa-integrated-acceptance`, 2026-09-12/13. Active True MVP: iPhone/Android browser PWA. No hosted service or release deployment included.

## Verified automated scope

- `pnpm check`: pass (36 test files, 196 tests). Includes format, generated contracts, TypeScript, unit tests, secrets, and dependency policy.
- `pnpm web:test:browser`: pass (42 baseline tests, 2 opt-in live tests skipped). Exact local URL: `http://127.0.0.1:4174/`. Playwright projects use `Desktop Chrome` and `Desktop Safari`; individual specs set compact and enlarged viewports where stated. Tests cover shell routes, manifest/icons, keyboard, 200% text, reduced motion, axe, OTP and Group UI, and weekly target/check-in/history flow.
- WebKit weekly axe regression: initial 200% run found transient `.lead` contrast below 3:1 while `.hero` faded in. Removed opacity tween; retained short transform reveal. Focused WebKit weekly test and full 42-test browser suite pass after repair.
- Browser specs assert page errors, console errors, and failed requests. Screenshots: `apps/web/test-results/**/verdict.png` and `apps/web/test-results/**/weekly-verdict.png` (local, ignored test artifacts). Expected simulated API error responses are part of failure-state tests.

Baseline browser tests route Supabase Auth and `/v1/**` API requests to fixtures. Their pass proves client behavior against contract-shaped responses. Separate `live-local.spec.ts` makes no fixture routes. It passed in Chromium and WebKit at 390 × 844 against local Supabase Auth, a loopback-only Node/psql API adapter, and PostgreSQL schema version 14: real six-digit OTP from Mailpit; Auth session restoration on reload; Group create, invitation issue/accept, Weekly-target change, self-reported check-in, authoritative current count, and empty finalized-history read. Browser page/console errors, failed requests, and relevant HTTP error responses were empty. Captured verdict screenshots: [Chromium](pwa-local-browser/chromium/) and [WebKit](pwa-local-browser/webkit/), each covering Group, peer joined, Home before/after, Target, and History. Invitation token, OTP, and email are absent from these selected screenshots. Local OTP email template changed from default magic link to a six-digit code; non-reset Supabase stop/start retained prior 3 Auth users, 2 app Accounts, and schema version 14.

## Release gates still open

- Real iPhone Safari and Android Chrome: browser use, installation, standalone launch, session restoration after OTP and relaunch, keyboard/safe-area layout, 200% text, reduced motion, screen-reader and alternative-input paths. Use [device record](pwa-real-device-template.md).
- Confirm pilot support floor on actual devices: iOS/Safari 16.4+ and Chrome/Android 111+ per ADR 0005, or open compatibility ticket with observed OS/browser and failing behavior.
- Finalized Met/Missed history on live clock, negative authorization matrix, hosted service, and release deployment remain unverified. The local adapter covers only routes exercised by the active weekly loop and is not a production API server.

Status: **local browser integration passed for named flow; physical-device and remaining release gates open**. No hosting, provisioning, or spending performed.
