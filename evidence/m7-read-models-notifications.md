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
- `supabase/migrations/20260910050000_notification_center.sql`: caller-owned live unread/read
  canonical notification read with deterministic state, priority, recency, and opaque-ID
  ordering. Reads require current membership, ignore push permission, exclude expired and
  terminal items, and preserve authoritative facts. Route recovery now also handles terminal
  items and stored task routes missing an ID safely.
- `supabase/migrations/20260910040000_member_home_view.sql`: live-authorized composite Home
  read over rebuilt personal progress, friend activity, and current active-Season Crown totals;
  current members with zero Crowns remain visible and tied ranks share rank.
- `packages/contracts/openapi.yaml`, generated/runtime contract exports,
  `packages/delivery/src/api.ts`, and `packages/delivery/src/http.ts`: versioned
  `GET /v1/member-home`, `GET /v1/notifications`, and
  `GET /v1/notifications/{notificationId}/open` contracts using existing authenticated
  read-handler/HTTP seams.
- `apps/mobile/src/api-client.ts` and `apps/mobile/app/(member)/home.tsx`: typed authorized Home
  load and compact task-first render order: Needs you, personal weekly progress, friend
  activity, then Season standings. Charcoal/Safety-yellow treatment follows approved visual
  conventions. Loading, empty, denied, failure, conflict, prolonged pending, ready/stale, and
  safe stale-route notice presentations are explicit.
- `apps/mobile/app/(member)/notifications.tsx`: hidden-stack mobile Notifications route with
  generic-copy unread/read groups, empty, denied, failure/retry, conflict, prolonged-pending,
  and stale/invalid-target notice states. Notification opens use server-authorized recovery;
  failures return safely to Home. Copy states that in-app authority remains available when
  device notifications are off.
- `tests/read-models-notifications.test.ts`: authoritative rebuild equivalence, cross-Group
  denial, departure cleanup, active-Season zero-Crown standings, composite Home-read outcome
  non-interference, idempotent social writes, bundle and separate-cap behavior, denied-push
  suppression, canonical in-app persistence, and stale-link recovery.
- `tests/http-routing.test.ts` and `tests/mobile-api-client.test.ts`: exact Home route dispatch,
  bearer-only GET behavior, runtime response validation, and typed mobile-client coverage.
- `tests/mobile-member-read-state.test.ts`: required degraded states and route fallback.
- Notification-center migration, routing, contract, and mobile-client tests cover live-only
  deterministic reads, cross-Account denial, read immutability, terminal/malformed route
  recovery, exact HTTP dispatch, bearer-only GETs, and runtime response validation.

## Gate 1

PostgreSQL facts remain authoritative. Projections are deleted and deterministically rebuilt
from existing facts. Social writes and push receipt state never mutate Member-week, Crown,
Season, Consequence, or other authoritative outcomes. Push is optional transport; denied or
missing permission suppresses only delivery while canonical in-app items remain unread.
External copy uses template keys and opaque identifiers; no private content enters delivery
records. No hosted service, dependency, account, processor, payment, or provisioning added.

Remaining M7 work is explicit: complete authoritative task sources, actual Proof feed and
historical Wall projection after Proof/retained-media activation, delivery/runtime adapter
binding, provider delivery, offline cache/recovery behavior, real
PostgreSQL verification, and physical-device accessibility/push validation. Hosted services
remain separately gated. Current Home friend activity is structured weekly progress, not a
claim that Proof media/feed or Wall exists.

## Validation status

Prior independent read-only Codex validator iteration 2 passed connected-Home acceptance after
verifying live authorization, active current-Season standings, task-first semantic order,
reachable pending state, safe stale-route recovery, read immutability, adjacent failure
behavior, and scope containment. Worker full repository check passed 166 of 166 tests plus
format, generated-contract, TypeScript, secret, dependency, and `git diff --check` checks.
Current notification-center slice worker focused checks passed 42 of 42 tests. Independent
read-only validator iteration 1 passed 31 of 31 focused tests covering every acceptance item,
adjacent behavior, and failure boundaries. Full repository check passed 170 of 170 tests plus
format, generated-contract, TypeScript, secret, dependency, and `git diff --check` checks.
PGlite is PostgreSQL-compatible migration/domain evidence; no physical-device, provider,
hosted-service, real PostgreSQL, or deployment-adapter result is claimed.
