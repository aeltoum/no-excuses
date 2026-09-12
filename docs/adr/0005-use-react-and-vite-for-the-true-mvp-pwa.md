---
status: accepted
---

# Use React and Vite for the True MVP PWA

No Excuses will implement the active True MVP client as a client-rendered React and
TypeScript single-page application built with Vite under `apps/web`. It will reuse the
existing versioned API, runtime-validated contracts, Supabase email OTP, PostgreSQL authority,
privacy boundaries, and accessibility contracts.

This choice keeps the web client thin and its static build portable. Next.js was considered
but its server rendering, cookie, runtime, and static-export choices add surface that no active
True MVP requirement needs. A different UI ecosystem would discard existing React familiarity
without reducing PWA work.

## Consequences

- `apps/web` owns browser presentation, navigation, Supabase session handling, and a thin API
  adapter; it does not create a second backend or bypass server and database authorization.
- First delivery includes a web app manifest, install icons, HTTPS requirements, responsive
  browser use, and platform-specific installation help.
- First delivery has no service worker, offline cache, push, background sync, server rendering,
  framework middleware, or deferred product behavior.
- Initial support floor is iOS/Safari 16.4+ and Chrome/Android 111+, subject to confirmation
  against actual pilot devices before release.
- Vitest covers pure logic. Playwright covers Chromium and WebKit browser behavior with axe
  checks. Real iPhone Safari and Android Chrome remain required for installation, standalone,
  session, layout, and accessibility release evidence.
- Hosting, deployment configuration, service accounts, provisioning, and spending remain
  separate approval gates.
- Route-library selection is deferred to the first implementation ticket. It must either show
  value over browser primitives or remain absent; this ADR does not authorize it implicitly.

Research: `docs/research/true-mvp-pwa-architecture-options.md`.
Approved by owner on 2026-09-12 in issue #154 planning.
