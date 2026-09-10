# M2 mobile email OTP and session evidence

Issue 129 adds local-development mobile Supabase Auth wiring. It provisions no hosted
service and adds no participant, Group, workout, deep-link, or distribution UI.

Gate 1 automated evidence:

- `tests/mobile-auth.test.ts`: required public runtime configuration; privileged-key
  rejection; SecureStore delegation; React Native-safe persistent client construction;
  bounded normalized email and six-digit OTP input; `shouldCreateUser: false`; authenticated
  session return; sanitized request failures; launch restore and auth-change outcomes for
  checking, signed out, signed in, revoked, service unavailable, and failure.

Gate 1 limits:

- Tests use controlled Supabase Auth and SecureStore seams. Local-stack delivery and physical
  device secure-storage behavior remain integration/device evidence before pilot readiness.
- Current Account and Membership authority stays PostgreSQL-owned. Caller-supplied
  `resolveAccess` must use an authenticated API boundary; JWT metadata is never accepted as
  current authority.
