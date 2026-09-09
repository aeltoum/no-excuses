# True-MVP workout-loop API contract evidence

This slice exposes existing workout check-in, current-week Group progress, and finalized
Group weekly history behavior through reusable version 1 API contracts. Submission requires
authentication and an idempotency key. Reads require authentication without an idempotency
header. PostgreSQL remains authoritative for membership, Group visibility, current-week
selection, idempotent replay, and pre-membership history filtering.

Gate 1 automated evidence:

- `tests/true-mvp-api-contracts.test.ts`: strict request validation, bounded success and
  error responses, authentication, command-only idempotency, stable duplicate results,
  stateful same-key replay without another logical write, changed-payload conflict, neutral
  failure mapping, both authenticated reads without idempotency, and denied Group reads.
- `tests/contracts.test.ts`: current and previous health endpoints and wire versions remain
  compatible.
- `packages/contracts/openapi.yaml` and generated `packages/contracts/src/generated.ts`:
  OpenAPI 3.1 paths and mobile-reusable TypeScript types for all three operations.

No router, server, DB client, hosted service, UI, peer review, Exception, Proof/media,
streak, consequence, social, or notification behavior enters this slice.
