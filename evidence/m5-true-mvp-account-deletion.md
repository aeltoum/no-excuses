# True-MVP Account deletion evidence

This DB-only slice adds one authenticated, explicitly confirmed Account deletion command.
It reuses durable request idempotency, ordinary membership cleanup, and Group governance state.
The transaction marks only caller's active Account deleted, replaces contact email with a
non-routable Former-member value, ends any current membership with `account_deleted`, revokes
issued invitations from that membership, revokes and anonymizes outstanding invitations sent to
the deleted contact, promotes longest-tenured remaining member when needed, and closes an emptied
Group. Finalized weekly outcomes remain unchanged.

Gate 1 automated evidence:

- `tests/true-mvp-account-deletion.test.ts`: authentication and confirmation denial; caller-only
  deletion; contact anonymization and immediate cutoff; membership cleanup; invitation revocation;
  deterministic admin promotion; empty-Group closure; finalized-history preservation; stable
  replay after deletion; changed-body conflict; least-privilege command and table access.
- `tests/migrations.test.ts`: forward-only schema version 9 migration applies from empty state.

Hosted Auth/provider deletion, media and processor cleanup, backup and audit expiry, UI, and API
delivery remain outside this DB-only slice.
