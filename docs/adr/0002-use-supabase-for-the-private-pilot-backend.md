---
status: accepted
---

# Use Supabase for the private-pilot backend

No Excuses will use managed Supabase as the backend foundation for the private-pilot architecture: PostgreSQL is the authoritative system of record, Supabase Auth is the identity foundation, private Supabase Storage holds submitted Proof, and TypeScript/Deno Edge Functions expose the application API and run queued work. This consolidates the pilot around one managed platform, fits the relational and transactional domain, and preserves a clearer data exit through standard PostgreSQL and S3-compatible object access than the considered Firebase/Firestore and AWS-native alternatives.

## Consequences

- The React Native client consumes versioned JSON commands and queries over HTTPS. It may use Supabase Auth and narrowly scoped signed media transfers directly, but it does not mutate database tables through generated APIs, consume GraphQL, or treat Realtime subscriptions as authoritative state.
- Database-backed API functions and queue workers execute in the single primary database region selected from the actual pilot geography and measured latency. Multi-region writes, read replicas, and a second Proof store are excluded from the pilot unless later evidence requires them.
- Consequential work uses a transactional outbox, durable PostgreSQL queues, Cron, at-least-once delivery, and idempotent workers. SQL functions remain narrow atomic operations rather than the main application layer.
- Proof uses immutable unique object keys in private Storage. Submission is acknowledged only after the server verifies durable object storage and authoritative state; scheduled deletion is performed only by the retention workflow.
- Schema migrations, standard PostgreSQL structures, versioned application contracts, and exportable objects preserve an explicit migration path, while Supabase Auth, Storage, and Edge Functions remain acknowledged vendor-coupled components.
- Development remains at zero infrastructure spend through the local Supabase stack and, only when useful, a disposable hosted Free project containing synthetic data. This decision authorizes no account, subscription, trial, payment method, or provisioned service.
- A paid managed configuration is only a future rehearsal requirement under the approved recovery and availability gates. Enabling Pro, Small compute, seven-day point-in-time recovery, observability spending, or any other paid capability requires fresh explicit approval; Team, Enterprise, replicas, branching, custom domains, image transformations, and self-hosted production are not part of the pilot architecture.
