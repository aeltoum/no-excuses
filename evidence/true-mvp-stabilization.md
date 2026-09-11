# True-MVP stabilization evidence

Scope: issue #148, active True-MVP loop.

## Implemented surface

- Member tabs: Home, Group, You. Wall, Season, Notifications remain unlinked.
- Home: active Weekly-target edit; structured, attested self-reported workout command;
  authoritative current Group progress; finalized weekly Met/Missed history.
- You: Account-deletion review, prolonged-pending message, retry-safe ambiguous failure,
  definitive-failure reset, authoritative receipt.
- Existing versioned API client and idempotent backend commands reused. Deferred backend
  contracts and durable architecture remain intact.

## Automated evidence

- `tests/navigation-shells.test.ts`: shipping member destination boundary.
- `tests/mobile-member-read-state.test.ts`: task-first ordering, active controls, read seams,
  degraded states, deferred-copy absence.
- `tests/account-deletion-delivery.test.ts`: deletion UI state sequence and API contract.
- `tests/social-interaction-contracts.test.ts`: deferred social contract preserved while Home
  controls are unreachable.

Physical-device accessibility and end-to-end local-Supabase smoke remain unverified.
