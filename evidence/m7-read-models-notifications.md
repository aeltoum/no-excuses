# M7 read models, member tasks, social delivery, and notifications evidence

Scope: deferred `M7 read models, member tasks, social delivery, and notifications` slice
explicitly scheduled by owner on 2026-09-10. Latest accepted notification decision is push
only; no email adapter was added.

- `supabase/migrations/20260910030000_read_models_notifications.sql`: rebuildable member,
  Group, and Season projections; same-Group reactions and motivational messages; canonical
  in-app notification items; Account-level preferences; push-subscription health; durable
  delivery work; independent civil-date social/action budgets; bundled delivery records;
  live-authorized typed deep-link recovery.
- `apps/mobile/src/member-read-state.ts`: explicit loading, empty, denied, failure, conflict,
  pending, ready/stale states plus typed member routes and safe malformed-link fallback.
- `tests/read-models-notifications.test.ts`: authoritative rebuild equivalence, cross-Group
  denial, departure cleanup, idempotent social writes, outcome non-interference, bundle and
  separate-cap behavior, denied-push suppression, canonical in-app persistence, and stale-link
  recovery.
- `tests/mobile-member-read-state.test.ts`: required degraded states and route fallback.

## Gate 1

PostgreSQL facts remain authoritative. Projections are deleted and deterministically rebuilt
from existing facts. Social writes and push receipt state never mutate Member-week, Crown,
Season, Consequence, or other authoritative outcomes. Push is optional transport; denied or
missing permission suppresses only delivery while canonical in-app items remain unread.
External copy uses template keys and opaque identifiers; no private content enters delivery
records. No hosted service, dependency, account, processor, payment, or provisioning added.

Historical Wall projection remains deferred because merged M3 provides no authoritative Proof
or retained-media source. Adding a surrogate Wall over self-reported check-ins would contradict
the accepted Wall definition and module boundary. Implement after Proof/Wall source activation.

## Validation status

Independent read-only Codex validator iteration 1 passed: focused migration, read-model,
notification, route, mobile-state, and forward-migration suites passed 14 of 14 tests;
TypeScript and `git diff --check` passed. Worker full repository check passed 164 of 164 tests
plus format, generated-contract, TypeScript, secret, and dependency checks. PGlite is
PostgreSQL-compatible migration/domain evidence; real PostgreSQL and physical-device push
delivery remain pending.
