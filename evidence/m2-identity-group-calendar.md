# M2 identity, Group authority, and accountability-calendar evidence

Milestone 2 adds PostgreSQL-owned identity linkage, separate time-bounded Memberships,
Group administration, invitation acceptance, live session cutoffs, and persisted Group-zone
calendar facts. No hosted Auth or other service was provisioned.

Gate 1 automated evidence:

- `tests/identity-group-calendar.test.ts`: unknown-user OTP denial; invitation preview without
  consumption; current/pre-join/departed/returned/stale-session authority; admin, peer, operator,
  cross-Group, and service-role separation; default-deny grants and RLS; adult/consent gates;
  single-use invitation, capacity, one-current-Group, activation, locked partial-week targets,
  last-admin, threshold-aware departure cleanup, return-era reactivation without Season restart,
  access cutoff, pause, configured ISO-weekday boundaries, first shortened four-week Season, and
  DST gap/fold boundaries.
- `tests/migrations.test.ts`: schema version 3 applies forward while the immediately previous
  public surface remains compatible.
- `scripts/test-real-postgres.sh`: applies all three migrations on an explicitly empty disposable
  PostgreSQL database; races single-use invitation, one-Group, and tenth-seat capacity commands;
  asserts exactly one winner and authoritative state after each; then runs transaction and
  idempotency smoke checks. Worker pass ran against local PostgreSQL 17.11 using an isolated
  temporary cluster.

Concurrency invariants live in PostgreSQL, not process-local checks: invitation rows, Account
rows, and Group rows lock in fixed order during acceptance; the partial unique Membership index
enforces one current Group; the locked Group count enforces capacity; invitation state permits one
acceptance. Activation and departure are single database functions, so any raised error rolls the
whole transition back.

Gate 1 limits:

- PGlite supplies deterministic PostgreSQL-compatible evidence. Real PostgreSQL smoke also passed
  locally; repeat runs require a caller-provided empty disposable `DATABASE_URL`.
- Physical-device OTP delivery and secure-session evidence belongs to later hosted/device gates;
  this milestone implements and verifies the server-side admission seam only.
- Separate Codex review must be recorded after worker handoff.
