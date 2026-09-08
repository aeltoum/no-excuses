# M1 shared-kernel impact and evidence

Milestone 1 establishes only domain-neutral primitives and delivery/navigation shells. It
does not implement any requirement's product behavior or claim a passing requirement.

Automated evidence:

- `tests/shared-kernel.test.ts`: opaque IDs, UTC instants, Group-zone facts, and aggregate versions.
- `tests/delivery-shells.test.ts`: environment config, API delegation/authentication boundary,
  queue delivery delegation, and transaction use.
- `tests/navigation-shells.test.ts`: exact member/operator top-level destinations and route separation.
- `tests/contracts.test.ts`: continued contract-version 0/1 runtime compatibility.
- `tests/migrations.test.ts`: forward/previous migration compatibility, same-key replay,
  changed-hash rejection, failed-command retry with one effect and a stable completed response,
  event/outbox commit, and failure rollback in PGlite. PGlite is
  PostgreSQL-compatible test evidence, not real-PostgreSQL evidence.
- `scripts/test-real-postgres.sh`: explicit disposable real-PostgreSQL smoke path for the same
  transaction and idempotency foundations.

Affected ledger rows remain `in-progress`: ACCESS-01 gains navigation/semantic shell evidence;
OPS-01 gains physical operator/member separation evidence. Neither can pass before its planned
milestone supplies the complete authorization, accessibility, device, and rehearsal evidence.
