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
- Those contract and delivery surfaces also expose `POST /v1/social-interactions` as an
  authenticated idempotent command. Its strict discriminated body accepts an opaque UUID,
  recipient Membership UUID, the three database reaction values, or a canonical motivational
  message without surrounding whitespace whose length is 1 through 280 characters. Success returns only the opaque
  interaction UUID.
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
- `apps/mobile/src/notification-cache.ts` and AsyncStorage `2.2.0`: contract-validated,
  Account-scoped last-success notification cache. Network failure alone may render cached
  generic in-app items with an explicit saved-at stale label and retry; denied, conflict,
  malformed-response, and server failures never fall back to cache. Notification opening
  remains live-authorized and recovers safely when offline.
- `apps/mobile/src/home-cache.ts` and `apps/mobile/app/(member)/home.tsx`: contract-validated,
  Account-scoped last-success Home cache using existing AsyncStorage. Network failure alone
  may render cached task-first Home data with explicit offline saved-at status and retry;
  missing session, authorization denial, conflict, malformed response, and server/API failure
  never fall back to cache. Cache persistence is nonblocking and storage failure is nonfatal.
- Home friend rows now expose text-labeled strong-reaction and fixed motivational-message
  actions through the typed mobile client. Per-row loading, prolonged-pending, success,
  retryable failure, conflict, and denied-safe status copy is announced politely; visible copy
  does not expose Membership or interaction identifiers. Ambiguous failures retain the
  command's interaction and idempotency UUIDs for safe replay; definitive outcomes clear them.
  No free-form composer or offline command draft was introduced.
- `tests/read-models-notifications.test.ts`: authoritative rebuild equivalence, cross-Group
  denial, departure cleanup, active-Season zero-Crown standings, composite Home-read outcome
  non-interference, idempotent social writes, bundle and separate-cap behavior, denied-push
  suppression, canonical in-app persistence, and stale-link recovery.
- `tests/http-routing.test.ts` and `tests/mobile-api-client.test.ts`: exact Home route dispatch,
  bearer-only GET behavior, runtime response validation, and typed mobile-client coverage.
- `tests/mobile-member-read-state.test.ts`: required degraded states and route fallback.
- `tests/social-interaction-contracts.test.ts`, `tests/group-command-delivery.test.ts`,
  `tests/http-routing.test.ts`, and `tests/mobile-api-client.test.ts`: strict reaction/message
  bodies, bounded response, scoped idempotent replay/conflict, exact HTTP dispatch, typed mobile
  command transport, and accessible private-copy-safe Home controls.
- Notification-center migration, routing, contract, and mobile-client tests cover live-only
  deterministic reads, cross-Account denial, read immutability, terminal/malformed route
  recovery, exact HTTP dispatch, bearer-only GETs, and runtime response validation.

## Gate 1

PostgreSQL facts remain authoritative. Projections are deleted and deterministically rebuilt
from existing facts. Social writes and push receipt state never mutate Member-week, Crown,
Season, Consequence, or other authoritative outcomes. Push is optional transport; denied or
missing permission suppresses only delivery while canonical in-app items remain unread.
External copy uses template keys and opaque identifiers; no private content enters delivery
records. Owner-approved AsyncStorage is pinned for local cache persistence. No hosted service,
account, processor, payment, or provisioning added.

Remaining M7 work is explicit: complete authoritative task sources, actual Proof feed and
historical Wall projection after Proof/retained-media activation, delivery/runtime adapter
binding, provider delivery, command-draft offline behavior, and
physical-device accessibility/push validation. Hosted services
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
format, generated-contract, TypeScript, secret, dependency, and `git diff --check` checks. M7
real-PostgreSQL smoke passed on PostgreSQL 17.11, applying every migration and asserting rebuild equivalence,
live same-Group/current-membership authorization, active-Season zero-Crown Home standings,
separate social/action caps plus bundling, denied-push canonical persistence, stale/terminal
route recovery, deterministic caller-owned notification-center ordering, and authoritative
Member-week/Crown/Consequence non-interference. Physical-device, provider, hosted-service,
and deployment-adapter results remain unclaimed. Notification offline-cache focused tests
cover Account separation, contract validation, malformed-entry deletion, and unavailable
device storage. Independent read-only validator iteration 2 passed 20 of 20 focused tests,
format, TypeScript, dependency-policy, and diff checks. Physical-device persistence remains
unclaimed. Home offline-cache worker coverage adds Account isolation, contract-valid round
trip, malformed-entry removal, unavailable-storage behavior, and source invariants for
task-first ordering plus network-only fallback. Independent read-only validator iteration 2
passed the original Home cache acceptance and strict canonical UTC ISO saved-timestamp repair:
29 of 29 focused tests across 4 files and the full 182-of-182-test `pnpm check` passed.
Physical-device persistence/accessibility, provider, hosted-service, and deployment-adapter
results remain unclaimed. Current social-command worker checks passed 24 of 24 focused tests
and full `pnpm check` passed 186 of 186 tests plus format, generated-contract, TypeScript,
secret, and dependency checks. Independent validator iteration 2 passed the same 24 focused
tests and 186-test full check, verifying OpenAPI/runtime/PostgreSQL message parity and stable
interaction and idempotency UUID reuse after ambiguous failure.
