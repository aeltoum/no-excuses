# True-MVP Group command evidence

This slice exposes authenticated version 1 commands for Group creation, invitation issuance,
invitation revocation, invitation acceptance, voluntary departure, and admin removal. Every
command has a strict-schema-bound delivery entrypoint using the shared handler's required
UUID idempotency key and command-bound request hash. PostgreSQL command wrappers durably claim
and complete that envelope, replay stored results, and reject changed-request reuse. Existing
PostgreSQL Group creation, invitation acceptance, and membership cleanup remain authoritative.

Gate 1 automated evidence:

- `tests/true-mvp-api-contracts.test.ts`: every Group command publishes bearer authentication,
  `Idempotency-Key`, conflict responses, strict bounded runtime requests, and bounded results;
  shared handler tests prove authentication, stable replay, and changed-body conflict behavior.
- `tests/group-command-delivery.test.ts`: each concrete Group command entrypoint requires
  authentication and idempotency, executes one logical write on same-body replay, and rejects
  changed-body reuse where request fields exist.
- `tests/true-mvp-group-commands.test.ts`: only current Group admins issue and revoke invitations;
  stored invitation data contains normalized email plus token digest, expires exactly seven days
  after issuance, and uses existing single-use acceptance state. Voluntary leave resolves only
  caller's current membership. Admin removal accepts only current non-admin peers in caller's
  Group and returns one neutral denial for cross-Group, admin, or otherwise unavailable targets.
  Durable command-wrapper coverage proves stored replay and changed-hash conflict without a
  duplicate invitation mutation.
- `tests/identity-group-calendar.test.ts`: invitation acceptance retains email, adult, consent,
  one-current-Group, capacity, atomic activation, last-admin, cutoff, unfinished-week cleanup,
  return, and below-capacity behavior.
- `packages/contracts/openapi.yaml` and generated `packages/contracts/src/generated.ts`:
  reusable OpenAPI 3.1 and TypeScript command contracts.

No router, hosted service, dependency, mobile UI, Group settings, role management, or deferred
feature enters this slice.
