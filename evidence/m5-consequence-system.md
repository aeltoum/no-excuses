# M5 Consequence system evidence

Scope: deferred `Consequence system` slice explicitly scheduled by owner on 2026-09-10.

- `supabase/migrations/20260910010000_consequence_system.sql`: versioned 14-card catalog,
  permanent milestone unlocks, current-peer pool contribution, snapshotted offers and unique
  provenance, one redraw, capped source-deduplicated obligations, one active attempt, Safety
  pause/readiness, media-free structured claims, immutable review audience, threshold closure,
  expiry/reoffer, timeout, departure cleanup, and exactly-one obligation completion.
- `tests/consequence-system.test.ts`: deterministic catalog/property coverage; unique offer and
  redraw coverage; backlog cap/source replay; Safety pause; expiry replay; review threshold;
  timeout; departure; and forbidden media/video/free-text schema inspection.
- PostgreSQL-compatible validation: PGlite applies every forward migration and runs focused
  state/property tests. Real PostgreSQL validation uses `pnpm db:test:postgres` against an empty,
  disposable database before merge.

## Independent Codex validation

Iteration 4 reviewed commit `f7d2c42` independently. Focused PGlite validation passed 17 tests;
full `pnpm check` passed 26 test files and 144 tests plus formatting, generated-contract,
type, secret, and dependency checks. No actionable M5 code defect remained. Verdict stays
`BLOCKED`, not `PASS`: validator had neither an empty disposable `DATABASE_URL` nor Docker, so
real-PostgreSQL row-lock behavior and smoke coverage remain unexecuted.

Current accepted M4 uses immediate self-reported Workout check-ins and contains no
Verified-report or Rejected-report aggregate. M5 consumes that accepted settlement source and
provides unique `rejected_report` obligation intake; automatic Verified/Rejected integration
must be revalidated when deferred peer-review M4 behavior is separately activated.

Gate 1 boundaries: no hosted service, new dependency, client route, Proof-video route, field,
processor, stored media, or user-authored Card content. Card copy remains app-authored,
equipment-free, adaptable, low/medium effort, and no more than five minutes.
