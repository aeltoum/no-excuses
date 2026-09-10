# M6 activity, Competition, and Seasons evidence

Scope: deferred `Activity ingestion, Competition, and Seasons` slice explicitly scheduled by
owner on 2026-09-10.

- `apps/mobile/src/activity-source.ts`: app-owned read-only HealthKit/Health Connect aggregate
  contract plus deterministic immutable fake. Missing fixture data returns `null`, never zero.
- `supabase/migrations/20260910020000_activity_competition_seasons.sql`: permission and source
  generations; immutable exact-membership-interval aggregate snapshots; post-close sync;
  Top Steps nearest-100; private previous-eight-week matching baselines; Load Progression and
  Cardio Leap nearest-0.1%; first-result ineligibility; ties; multi-awards; Not-contested,
  Exception, departure, late-data, and exactly-once finalization; four-active-week Group-local
  Season consumption, rollover, standings, cochampions, and membership-era summary audience.
- `tests/activity-source.test.ts`: deterministic aggregate seam, immutability, and null missing
  data.
- `tests/activity-competition-seasons.test.ts`: hand-calculated golden vectors and adjacent
  failure/state coverage for boundaries, source replacement, limited data, post-close sync,
  strict comparison, first result, rounding, ties, all-category awards, Exceptions, departure,
  late writes, idempotency, pause, shortened activation week, midweek departure, four-week
  rollover at the canonical fourth-week boundary despite delayed job execution, delayed summary
  finalization, complete non-null Season-attributed Crown totals, Crown-before-Season job-order
  rejection and retry, provisional overlap, cochampions, source permission/disconnected/changed
  states, pre-join rejection, prior-eight-Accountability-week baselines across long pauses,
  24-hour settlement cutoff, multiple-result best selection, and summary authorization across
  departure and return.

## Gate 1

No hosted service, provisioning, dependency, app route, read model, notification, location,
route, heart-rate, raw-sample, detailed-timestamp, device-detail, or public activity surface.
PostgreSQL remains authoritative. Platform implementations remain deferred until local Expo
modules and physical-device validation are scheduled; this milestone adds only app-owned
interfaces and deterministic fakes.

## Validation status

Independent Codex validator iteration 4 passed PGlite PostgreSQL-compatible migration/domain
validation: focused M6 suite passed 18 of 18 tests, full repository suite passed 156 of 156
tests, and `git diff --check` passed. Real PostgreSQL disposable-database smoke and physical-
device HealthKit/Health Connect E2E remain pending, so affected ledger rows remain `in-progress`.
