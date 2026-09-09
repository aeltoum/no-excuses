# M3 True-MVP workout check-in evidence

Milestone 3 adds the active True-MVP structured self-report path. An active member with an
active assigned member-week can submit activity type, completion time, duration, perceived
intensity, and an explicit attestation. The check-in counts immediately and an idempotency
key replays the stable result without another count.

Gate 1 automated evidence:

- `tests/workout-checkins.test.ts`: structured attested submission; immediate count;
  idempotent replay; no media, free-text, verification, competition, or consequence columns;
  future, pre-membership, pre-activation, cross-week, and post-departure rejection; current
  Group member progress visibility; and nonmember/cross-Group denial.
- `tests/migrations.test.ts`: schema version 4 applies forward while the previous public
  surface remains compatible.

The PostgreSQL function owns membership, assigned-week, time-boundary, attestation, insert,
count, and idempotency transitions in one transaction. PGlite supplies deterministic
PostgreSQL-compatible evidence. A real PostgreSQL smoke remains available through
`pnpm db:test:postgres` when an empty disposable `DATABASE_URL` is provided.
