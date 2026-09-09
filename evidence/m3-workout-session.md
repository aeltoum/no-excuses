# M3 Workout-session evidence

This first Milestone 3 slice adds PostgreSQL-authoritative Workout-session start, manual end,
and 12-hour expiry. It does not add Proof media, Workout reports, device drafts, upload
journals, processors, UI, or hosted services.

Gate 1 automated evidence:

- `tests/workout-sessions.test.ts`: current Membership and eligible Member-week assignment;
  pre-membership and pre-activation denial; ended Membership, paused accountability, and
  Target-pending denial; one-active-session database uniqueness; immutable start and
  Member-week assignment; manual end ordering; and exact 12-hour expiry.
- `tests/migrations.test.ts`: schema version 4 applies forward while the previous public
  surface remains compatible.

Concurrency invariant: a PostgreSQL partial unique index on Membership permits at most one
active Workout session, independent of process concurrency. PGlite deterministically proves
the database constraint; a real PostgreSQL race remains a later validation condition.

Gate 1 limits:

- This evidence covers only the authoritative Workout-session lifecycle portion of WORK-01.
- Physical-device, offline, media, report, and hosted evidence remains unimplemented.
- Separate Codex validation is required after worker handoff.
