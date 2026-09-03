# Validation analytics and observability options for the private pilot

Research snapshot: 2026-09-03. This note checks current first-party documentation against the project's requirement that core synthetic checks run every five minutes, qualifying alerts reach the responsible human within 15 minutes of detection, diagnostic telemetry remain available for 14 days, and telemetry exclude sensitive product data. It does not authorize an account, subscription, processor, dependency, or implementation.

## Recommendation

Use PostgreSQL application records as the sole authority for Validation-pilot measures and operational state, including an application-owned diagnostic store that expires event-level telemetry after exactly 14 days. Treat Sentry only as a candidate independent alert transport: its advertised 30-day Developer-plan lookback does not meet the project's 14-day privacy boundary unless implementation proves enforceable processor-side deletion by day 14.

A small pilot can plausibly meet the application-diagnostic gate with managed Supabase and no Supabase Log Drain:

- keep versioned measure inputs, queue/outbox state, deletion deadlines, reconciliation results, and restricted audit evidence in PostgreSQL;
- expose one content-free health endpoint and run one five-minute supervisory job that checks the authoritative operational records;
- retain only allow-listed error classes, release/build, service, region, opaque execution or correlation identifiers, severity, and numeric timings/counts in the 14-day application store;
- select an independent external availability and alert path in the downstream environments-and-operations decision, with Sentry eligible only if the retention conflict is resolved explicitly;
- keep Session Replay, screenshots, view hierarchy, attachments, user feedback, default PII, request bodies, query/mutation data, and automatic user identity collection off; and
- give the Private-pilot operator only purpose-built aggregate and case-specific application views. Do not give that role Supabase or Sentry dashboard access.

This is an architectural boundary, not readiness evidence. A production-like rehearsal still has to prove five-minute detection, alert delivery within 15 minutes, day-14 retrieval followed by deletion, outage behavior, processor deletion, and the absence of prohibited fields on physical iOS and Android devices and in Edge Functions.

## Supabase facts and limits

### Logs and retention

Supabase's Logs Explorer covers API gateway, Auth, Storage, Edge Functions, Postgres, Realtime, and other platform sources. Published hosted retention is one day on Free, seven days on Pro, 28 days on Team, and 90 days on Enterprise ([Logging](https://supabase.com/docs/guides/monitoring-and-debugging/logs), [pricing plan comparison](https://supabase.com/pricing)). None of those standard periods implements the project's exact 14-day lifecycle: Free and Pro expire too early, while Team and Enterprise retain event-level logs past the privacy boundary. Native logs remain supplemental, and the selected architecture requires the application-owned 14-day diagnostic store unless a processor proves an exact equivalent.

Edge Function logging includes uncaught exceptions and custom console messages. The Dashboard's invocation view includes request/response metadata including headers and bodies; a function can emit at most 100 log events in 10 seconds, and a custom message can contain up to 10,000 characters ([Edge Function logging](https://supabase.com/docs/guides/functions/logging)). Those capabilities are useful for debugging, but they make raw export inappropriate as the default privacy boundary: request bodies, authored text, email addresses, tokens, Proof references, and health inputs must never be deliberately logged.

### Log Drains and cost boundary

Log Drains export all Supabase stack logs and support Sentry Logs, OTLP, Datadog, Loki, S3, Axiom, Last9, Syslog, or a custom endpoint. HTTP delivery batches at most 250 events or flushes after one second. The Sentry destination attaches all log-event fields as Sentry log attributes; it does **not** turn Supabase logs into Sentry error events ([Log Drains](https://supabase.com/docs/guides/monitoring-and-debugging/log-drains)).

Drains are available only to Pro, Team, and Enterprise organizations. Each configured drain costs $0.0822 per hour, documented as $60/month, plus $0.20 for each started package of one million events and egress; the public pricing page currently lists egress at $0.09/GB. Drain charges are outside the Supabase Spend Cap ([Log Drain usage](https://supabase.com/docs/guides/platform/manage-your-usage/log-drains), [pricing](https://supabase.com/pricing)). This is additional to the Supabase plan, compute, recovery, and destination costs.

Because a drain exports the platform's full log stream and Sentry receives every field, server-side scrubbing is a defense in depth, not enough to prove the project's allow-list. Do not enable a drain for the pilot unless a rehearsal shows that curated SDK events and authoritative operational records cannot diagnose required failures, and then only after a sampled field inventory plus destination-side rejection tests prove that prohibited data cannot arrive.

### Cron, Queues, and Edge Functions

- Supabase Cron is backed by `pg_cron`; definitions live in `cron.job`, and each run and status is recorded in `cron.job_run_details`. Supabase recommends no more than eight concurrent jobs and no job longer than ten minutes ([Cron](https://supabase.com/docs/guides/cron)). These records can support a watchdog for missed or failed schedules.
- Supabase Queues is Postgres-native and dashboard-visible. `pgmq.metrics()` and `pgmq.metrics_all()` expose queue length, newest and oldest message age, total messages, and scrape time ([Queues](https://supabase.com/docs/guides/queues), [`pgmq` metrics](https://supabase.com/docs/guides/queues/pgmq)). These are sufficient inputs for content-free backlog and staleness checks; queue payloads do not belong in telemetry.
- Edge Functions emit invocation logs and metrics to the dashboard. Supabase publishes a Sentry example using `@sentry/deno`, manual exception capture, `defaultIntegrations: false`, and an awaited flush. The same page warns that its documented SDK setup does not provide automatic `Deno.serve` request-scope separation, so it requires per-request `withScope` or direct event context to prevent breadcrumbs/context leaking across reused workers ([Monitoring with Sentry](https://supabase.com/docs/guides/functions/examples/sentry-monitoring)). This limitation must be tested against the exact pinned SDK and hosted Edge Runtime.

Supabase's built-in experience provides reports, a Logs Explorer, and health dashboards. Its current alerting documentation routes customer-defined alert rules through downstream systems such as Grafana or a log-drain destination; the Prometheus-compatible Metrics API is beta and focused on roughly 200 Postgres infrastructure series ([Monitoring and debugging](https://supabase.com/docs/guides/monitoring-and-debugging), [Metrics API](https://supabase.com/docs/guides/monitoring-and-debugging/metrics), [Grafana integration](https://supabase.com/docs/guides/monitoring-and-debugging/metrics/grafana-cloud)). It does not replace application checks for deletion deadlines, access anomalies, outbox/queue age, media lifecycle, or reconciliation integrity.

## Sentry facts and limits

### React Native, Expo, and Deno support

The official Sentry React Native SDK lists Expo support and includes automatic JavaScript error tracking, native crash tracking, offline event storage, Hermes, and React Native New Architecture support ([React Native SDK](https://github.com/getsentry/sentry-react-native)). Expo's first-party guide configures `@sentry/react-native` with the Sentry wizard, supports EAS Build and EAS Update source maps, and instructs teams to verify with a release build ([Expo Sentry guide](https://docs.expo.dev/guides/using-sentry/)). Because the SDK includes native components, the project's selected Expo development-build workflow is the appropriate integration environment; both representative physical platforms still require verification.

Sentry maintains an official `@sentry/deno` package, and Supabase documents it for Edge Functions ([Sentry JavaScript SDKs](https://github.com/getsentry/sentry-javascript), [Supabase Edge Function example](https://supabase.com/docs/guides/functions/examples/sentry-monitoring)). The Supabase-specific request-scope caveat above means compatibility should be treated as supported but not zero-configuration.

### Privacy controls

Sentry recommends not sending PII. Its hosted service offers default server-side filtering, project-defined sensitive fields, advanced scrubbing rules, and an option to prevent storing IP addresses; Sentry also recommends SDK-side proactive scrubbing before transmission ([Sentry security and privacy](https://sentry.io/security/), [organization privacy controls API](https://docs.sentry.io/api/organizations/update-an-organization/)). Supabase's Sentry integration redacts query filters and mutation bodies by default and exposes explicit options that would turn that operation data back on ([Supabase Sentry integration](https://supabase.com/docs/guides/monitoring-and-debugging/sentry-monitoring)). Those opt-ins must remain off.

For this pilot, configure collection as an explicit allow-list and reject the event if an unexpected field appears. In particular:

- no Account, Membership, Group, Auth-user, email, IP address, session, invitation, object path, or device advertising identifier;
- no Proof or other media, screenshot, view hierarchy, attachment, replay, authored text, Exception explanation, transcript, health input, location, token, secret, header, request/response body, SQL parameter, or queue payload;
- no stable cross-service member identifier; if event correlation is required, use short-lived opaque execution/request identifiers that cannot identify a participant; and
- scrub twice: before send in the mobile/Edge SDK and again in Sentry's project settings, then inspect accepted events and intentional canaries during rehearsal.

Session Replay is not required for error monitoring. Do not add the replay integration or non-zero replay sampling, and do not connect Expo's optional Sentry dashboard integration for replay viewing. This is stronger and easier to verify than relying on replay masking.

### Regions, retention, alerts, and pricing

Sentry SaaS offers US and Germany storage regions; the EU/Germany option is available to organizations on the free Developer plan as well as paid plans ([Germany region GA](https://sentry.io/changelog/data-storage-location-in-germany-is-generally-available/), [region-specific API domains](https://docs.sentry.io/api/)). It does not offer a distinct APAC storage region in the cited documentation. Region selection therefore needs to follow the pilot's actual geography, consent, processor, and transfer review rather than an assumption that worldwide ingestion means worldwide storage.

Current public pricing shows:

| Plan | Displayed base price | Relevant included capability |
| --- | ---: | --- |
| Developer | $0 | One user, 5,000 errors, 5 GB Logs, 5 GB Application Metrics, five million spans, one uptime monitor, one cron monitor, 20 metric monitors, email alerts, and 30-day lookback. |
| Team | $26/month | Unlimited users, API and third-party integrations, 50,000 errors, the same base Logs/Metrics/spans/uptime/cron quotas, paid overages, and up to 90-day lookback. |
| Business | $80/month | Team features plus advanced controls, 1,000 metric monitors, and up to 90-day lookback with additional sampled retention. |

The displayed prices depend on the site's monthly/annual selector and are estimates; checkout is authoritative. Logs and Application Metrics over the included 5 GB are listed at $0.50/GB on paid plans. Additional uptime monitors are listed at $1/month and additional cron monitors at $0.78/month on paid plans ([Sentry pricing](https://sentry.io/pricing/)).

Sentry's generally available Monitors and Alerts separate what is watched from notification routing; monitors can cover logs, metrics, spans, uptime, and cron state, while alerts can route by email and, on applicable plans, integrated tools ([Monitors and Alerts GA](https://sentry.io/changelog/monitors--alerts--now-generally-available/)). Sentry documents uptime checks as externally issued checks and has documented one-minute checking; its Developer plan includes one uptime monitor ([Uptime Monitoring](https://sentry.io/changelog/uptime-monitoring-now-in-open-beta/), [pricing](https://sentry.io/pricing/)). The free plan's email alert plus a phone-configured email notification can be rehearsed without adding a collaboration integration.

Sentry does not publish an alert-delivery latency guarantee on the cited plan pages. Its inclusion of alerting makes the 15-minute gate plausible, but only an end-to-end timed rehearsal can pass it.

## Candidate coverage against the project gates

| Project need | Candidate signal and authority | Alert/diagnostic path | Residual proof required |
| --- | --- | --- | --- |
| Core synthetic check every five minutes | Content-free endpoint checks API reachability plus bounded database and critical-workflow health; detailed state remains in PostgreSQL. | Sentry uptime monitor for external reachability; a five-minute supervisory Cron run records and reports application invariants. | Demonstrate the external check cadence and that a total Supabase outage is detected independently of Supabase-hosted code. |
| Deletion failure | Authoritative deletion job, deadline, retry, and verification records in PostgreSQL. | Supervisory job emits only failure class, age, attempt count, and opaque job correlation. | Force Storage, Auth, and downstream deletion failures; prove alert delivery and processor deletion within the project's clock. |
| Access anomaly | Denied cross-role/cross-Group operation and rate/invariant counters; restricted audit record remains in PostgreSQL. | Threshold or first-severe-event Sentry monitor with no identity or request data. | Canary tests for every forbidden field and controlled anomalous-access rehearsal. |
| Integrity/reconciliation failure | Versioned reconciliation result and affected record counts in PostgreSQL. | One sanitized error or metric event keyed by reconciliation version and execution ID. | Inject missing, duplicate, late, and contradictory facts; prove deterministic reproduction from PostgreSQL. |
| Cron/queue/outbox stall | `cron.job_run_details`, `pgmq.metrics*`, outbox age, and worker lease/retry records. | Supervisory check plus the included Sentry cron monitor for a single aggregate heartbeat. | Prove missing execution, stuck visibility lease, retry exhaustion, and a failed supervisory job itself. |
| Mobile/Edge regression | Release, platform, runtime, safe error class, stack trace/source map, and short-lived correlation only. | Sentry React Native and Deno error events with email alert. | Physical-device iOS/Android tests, reused Edge worker scope-isolation test, offline/rate-limit behavior, and source-map secrecy review. |
| Fourteen-day diagnosis | PostgreSQL operational facts and application diagnostics expire on the exact 14-day schedule; Supabase Pro native logs remain a seven-day supplemental source. | Query by release, service, safe error class, execution, and time. | Retrieve a seeded incident through day 14, prove it absent afterward and after restore, and reject any processor whose minimum retention exceeds the boundary. |

## Validation analytics and operator boundary

Observability must not become a second facts system:

- Calculate Target attainment, Pilot retention, Trust integrity, Critical safety incidents, Crown correctness, and other settled measures from versioned PostgreSQL facts. Treat missing survey data as unknown and preserve the settled exclusions. Sentry counts, client events, push delivery, and Supabase log volume are diagnostic only.
- Use a random pilot-participant research identifier only inside the restricted research dataset. Do not put it in Sentry. Keep the identity mapping separate, and link optional interview/survey material to product behavior only under separate permission.
- The routine Private-pilot operator view contains aggregate system health, due-work backlogs, alert status, deletion compliance, and de-identified pilot progress. A member-specific support/moderation case opens only a named, purpose-limited application view with a reason code and timestamped audit.
- Supabase's Free and Pro dashboard roles are Owner, Admin, and Developer; Team adds project-scoped and read-only access ([Supabase pricing](https://supabase.com/pricing)). Those platform roles are broader and differently scoped than the product's Private-pilot operator, so they are not a substitute for application authorization. Sentry's Developer plan is one-user. Keep both vendor dashboards developer-only for the pilot.

## Uncertainties and decision checkpoints

1. **Alert latency:** capability is documented, but delivery within 15 minutes is not contractually established. Time controlled failures through detection, Sentry issue creation, email receipt, and responsible-human device notification.
2. **Deno request isolation:** Supabase's current example still documents a scope-separation limitation. Pin exact SDK/runtime versions and test repeated concurrent requests for breadcrumb/context crossover before live data.
3. **Data shape drift:** vendor SDKs and Supabase log schemas change. Lock configuration, snapshot representative accepted event schemas, and fail closed on unexpected context where possible.
4. **Region and transfer:** US and Germany are the documented Sentry choices. Make one explicit selection after the intended-country register and processor terms are reviewed.
5. **Free-plan sufficiency:** the stated pilot volume appears far below current included quotas, but this is an inference, not measured usage. Rehearsal must record accepted, filtered, dropped, and rate-limited events and show that spend caps or quotas cannot silently remove critical alerts.
6. **Log Drain:** do not authorize it now. Revisit only if incident drills show a specific failure that cannot be diagnosed from PostgreSQL facts, curated Sentry events, and the seven-day native Supabase window. Any later enablement needs separate spending and privacy approval.

## Bottom line

The minimum credible observability shape is **managed Supabase as authority plus an application-owned 14-day diagnostic store and a separately selected independent availability/alert path**, with no full-stack drain and no replay. Sentry remains a technically plausible alerting candidate, but its current free-tier 30-day lookback does not satisfy the exact retention boundary without additional verified deletion capability or a fresh decision changing that boundary. The 15-minute alert gate passes only after the five-minute synthetic/supervisory design and responsible-human delivery path succeed in a timed rehearsal.
