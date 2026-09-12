# True MVP PWA implementation plan

Status: approved architecture; implementation slices proposed by issue #154.

True MVP: active. Scope source: `docs/product/true-mvp-scope.md`. This plan implements only
the included friend-Group loop. Existing React Native/Expo work remains preserved and deferred.

## Architecture boundary

- `apps/web`: React/TypeScript/Vite browser client.
- `packages/contracts`: generated OpenAPI types and runtime Zod response validation.
- `packages/delivery`: existing versioned HTTPS API and authorization boundary.
- Supabase Auth: email OTP request, six-digit verification, session refresh, and sign-out.
- PostgreSQL: authoritative membership, target, check-in, outcome, and history facts.
- Static deployment: future adapter; requires HTTPS and SPA fallback. No host is selected.

No service worker, offline data, push, SSR, client-side direct table mutation, privileged
browser key, hosted provisioning, or deferred feature activation.

## Active routes

| Route | Purpose | Required states |
| --- | --- | --- |
| `/` | Session-aware entry | checking, signed out, signed in, revoked, unavailable, failure |
| `/sign-in` | Request and verify email OTP | idle, submitting, code sent, invalid, rejected, unavailable, success |
| `/group` | Create, join, invite, leave, remove | choice, form, submitting, success, denied, conflict, failure |
| `/home` | Current target, count, Group progress, log check-in | loading, empty, ready, submitting, success, denied, failure |
| `/target` | Set next/current allowed Weekly target | loading, unchanged, warning, submitting, success, boundary conflict, failure |
| `/history` | Basic finalized weekly outcome/count history | loading, empty, ready, denied, failure |
| `/account` | Sign out and Account deletion | ready, confirming, submitting, deleted, denied, failure |

Routes must survive direct load and refresh through a host fallback. If browser primitives keep
this route set clear and testable, add no router dependency. Otherwise first implementation
ticket must present the exact router dependency for owner approval before installation.

## Cross-cutting contracts

- Semantic HTML, visible labels/status, logical heading and focus order, 48px targets, safe-area
  insets, reduced motion, keyboard access, and no horizontal overflow at 200% text.
- Person-triggered results receive deterministic focus or announcement; background refresh
  never steals focus.
- Network/API failures expose safe retry and retain permitted input. Denied responses disclose
  no cross-Group facts.
- Browser session presence never proves authorization. API and PostgreSQL checks remain live.
- Client configuration permits only public API URL, Supabase URL, and publishable anonymous key.
- Install is optional: every flow works in ordinary browser mode.

## Serial slices

1. **Shell and verification harness**: create `apps/web`; establish route behavior, visual
   tokens, manifest/icons, environment validation, Vitest, Playwright Chromium/WebKit, axe,
   responsive fixtures, and documented local command.
2. **Authentication and Group entry**: OTP request/verify/session/revocation plus create, join,
   invite, leave, remove, and Account deletion entry paths.
3. **Weekly accountability loop**: Weekly target, structured workout check-in, current member
   and Group counts, automatic Met/Missed display, and basic finalized history.
4. **Integrated browser acceptance**: full local-Supabase journey, direct-route refresh,
   failure/denied states, install metadata, responsive/accessibility matrix, and real-device
   evidence template. Hosted deployment remains separately gated.

Every slice uses `docs/agents/implementation-loop.md`: one worker, then one independent
validator; failed validation returns to the same worker. Browser validation records exact URL,
viewport, console/network failures, and screenshots.

## Release evidence

- `pnpm check` and focused package checks pass.
- No secret or dependency-policy regression.
- Playwright Chromium and WebKit pass supported flows and adverse states.
- Axe results contain no unexplained serious or critical findings; manual checks remain required.
- Real iPhone Safari and Android Chrome records cover browser use, installation, standalone
  launch, OTP/session restoration, keyboard/safe-area layout, 200% text, reduced motion, and
  screen-reader completion.
- Actual pilot devices fit support floor or cause an explicit compatibility revision.
- Hosting, domain, deployment, monitoring, processor, and spending decisions remain open until
  separately approved.
