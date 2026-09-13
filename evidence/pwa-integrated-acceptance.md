# PWA candidate acceptance record

Issue #158. Base commit: `0abf453`. Validated candidate: uncommitted working tree on `codex/pwa-integrated-acceptance`, 2026-09-12. Active True MVP: iPhone/Android browser PWA. No hosted service or release deployment included.

## Verified automated scope

- `pnpm check`: pass (36 test files, 196 tests). Includes format, generated contracts, TypeScript, unit tests, secrets, and dependency policy.
- `pnpm web:test:browser`: pass (42 tests, Chromium and WebKit). Exact local URL: `http://127.0.0.1:4174/`. Playwright projects use `Desktop Chrome` and `Desktop Safari`; individual specs set compact and enlarged viewports where stated. Tests cover shell routes, manifest/icons, keyboard, 200% text, reduced motion, axe, OTP and Group UI, and weekly target/check-in/history flow.
- WebKit weekly axe regression: initial 200% run found transient `.lead` contrast below 3:1 while `.hero` faded in. Removed opacity tween; retained short transform reveal. Focused WebKit weekly test and full 42-test browser suite pass after repair.
- Browser specs assert page errors, console errors, and failed requests. Screenshots: `apps/web/test-results/**/verdict.png` and `apps/web/test-results/**/weekly-verdict.png` (local, ignored test artifacts). Expected simulated API error responses are part of failure-state tests.

Browser tests route Supabase Auth and `/v1/**` API requests to fixtures. Their pass proves client behavior against contract-shaped responses, not live OTP delivery, API routing, PostgreSQL authorization, or local-Supabase integration. Docker is available, but repository has no runnable API server command connecting PWA requests to local Supabase. Do not infer integration from `pnpm db:start` alone.

## Release gates still open

- Real iPhone Safari and Android Chrome: browser use, installation, standalone launch, session restoration after OTP and relaunch, keyboard/safe-area layout, 200% text, reduced motion, screen-reader and alternative-input paths. Use [device record](pwa-real-device-template.md).
- Confirm pilot support floor on actual devices: iOS/Safari 16.4+ and Chrome/Android 111+ per ADR 0005, or open compatibility ticket with observed OS/browser and failing behavior.
- End-to-end client → runnable API → local Supabase with real Auth and authoritative DB state. Missing API server command blocks this check.

Status: **automated browser candidate passed; integrated/device release acceptance blocked**. No hosting, provisioning, or spending performed.
