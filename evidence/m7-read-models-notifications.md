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
- `supabase/migrations/20260910040000_member_home_view.sql`: live-authorized composite Home
  read over rebuilt personal progress, friend activity, and current active-Season Crown totals;
  current members with zero Crowns remain visible and tied ranks share rank.
- `packages/contracts/openapi.yaml`, generated/runtime contract exports,
  `packages/delivery/src/api.ts`, and `packages/delivery/src/http.ts`: versioned
  `GET /v1/member-home` contract and existing authenticated read-handler/HTTP seam.
- `apps/mobile/src/api-client.ts` and `apps/mobile/app/(member)/home.tsx`: typed authorized Home
  load and compact task-first render order: Needs you, personal weekly progress, friend
  activity, then Season standings. Charcoal/Safety-yellow treatment follows approved visual
  conventions. Loading, empty, denied, failure, conflict, prolonged pending, ready/stale, and
  safe stale-route notice presentations are explicit.
- `tests/read-models-notifications.test.ts`: authoritative rebuild equivalence, cross-Group
  denial, departure cleanup, active-Season zero-Crown standings, composite Home-read outcome
  non-interference, idempotent social writes, bundle and separate-cap behavior, denied-push
  suppression, canonical in-app persistence, and stale-link recovery.
- `tests/http-routing.test.ts` and `tests/mobile-api-client.test.ts`: exact Home route dispatch,
  bearer-only GET behavior, runtime response validation, and typed mobile-client coverage.
- `tests/mobile-member-read-state.test.ts`: required degraded states and route fallback.

## Gate 1

PostgreSQL facts remain authoritative. Projections are deleted and deterministically rebuilt
from existing facts. Social writes and push receipt state never mutate Member-week, Crown,
Season, Consequence, or other authoritative outcomes. Push is optional transport; denied or
missing permission suppresses only delivery while canonical in-app items remain unread.
External copy uses template keys and opaque identifiers; no private content enters delivery
records. No hosted service, dependency, account, processor, payment, or provisioning added.

Remaining M7 work is explicit: complete authoritative task sources, actual Proof feed and
historical Wall projection after Proof/retained-media activation, notification-center UI,
delivery/runtime adapter binding, provider delivery, offline cache/recovery behavior, real
PostgreSQL verification, and physical-device accessibility/push validation. Hosted services
remain separately gated. Current Home friend activity is structured weekly progress, not a
claim that Proof media/feed or Wall exists.

## Validation status

Independent read-only Codex validator iteration 2 passed connected-Home acceptance after
verifying live authorization, active current-Season standings, task-first semantic order,
reachable pending state, safe stale-route recovery, read immutability, adjacent failure
behavior, and scope containment. Worker full repository check passed 166 of 166 tests plus
format, generated-contract, TypeScript, secret, dependency, and `git diff --check` checks.
PGlite is PostgreSQL-compatible migration/domain evidence; no physical-device, provider,
hosted-service, real PostgreSQL, or deployment-adapter result is claimed.
