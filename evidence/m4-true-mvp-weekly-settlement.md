# M4 True-MVP weekly settlement evidence

Milestone 4 adds automatic weekly `Met` or `Missed` settlement from each member-week's
locked target and self-reported workout check-in count. Settlement starts only at the
accountability week's end, updates only active member-weeks, and leaves terminal or
departure-cleaned outcomes unchanged. Current Group members can read basic finalized
history without receiving access to another Group.
History begins with weeks overlapping the viewer's current membership; fully
pre-membership history remains hidden after a late join or return.

Gate 1 automated evidence:

- `tests/weekly-settlement.test.ts`: target attainment and miss calculation; exact-boundary
  close; pre-boundary rejection; idempotent replay; terminal-outcome immutability;
  `ended_without_result` departure preservation; finalized history shape; and nonmember and
  cross-Group denial; current-membership cutoff with overlapping-week inclusion.
- `tests/migrations.test.ts`: schema version 6 applies forward while previous public surface
  remains compatible.

Settlement and history use existing member-week, membership, accountability-week, and
check-in records. No peer review, Exception, Proof/media, streak, consequence, notification,
or new product abstraction enters this slice. PGlite supplies deterministic
PostgreSQL-compatible evidence. Real PostgreSQL smoke remains available through
`pnpm db:test:postgres` with an empty disposable `DATABASE_URL`.
