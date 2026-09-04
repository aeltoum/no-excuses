# Implementation handoff plan

This is the execution plan for one developer working with Codex and one Private-pilot operator to build, rehearse, and admit No Excuses to the Validation pilot. It orders the accepted product and technical decisions into dependency-aware milestones, identifies evidence and approval gates, and gives effort and cost ranges. It does not authorize application work, service provisioning, trial activation, payment, participant enrollment, or spending.

Source contracts remain authoritative. This plan is an index and sequence, not a replacement for:

- [`CONTEXT.md`](../../CONTEXT.md) for product language and behavior;
- the [implementation requirements and acceptance matrix](requirements-and-acceptance-matrix.md) for the 40 implementation contracts;
- the [screen, state, and accessibility contracts](screen-state-accessibility-contracts.md) for member and operator behavior;
- the [private-pilot technical quality bar](private-pilot-technical-quality-bar.md) for non-waivable thresholds;
- the [verification and pilot-readiness test strategy](verification-and-pilot-readiness-test-strategy.md) for evidence layers and release gates; and
- the accepted architecture decisions for [React Native and Expo](../adr/0001-use-react-native-and-expo-for-the-mobile-client.md), [Supabase](../adr/0002-use-supabase-for-the-private-pilot-backend.md), and [email OTP with live database authorization](../adr/0003-use-email-otp-and-live-database-authorization.md).

## Planning assumptions

- Effort is focused developer time, including implementation, tests, documentation, review, and defect repair. A developer-week means roughly five focused working days; it is not a promise of elapsed delivery time.
- Ranges assume one experienced full-time developer using Codex, a responsive project owner, and scheduled access to the Private-pilot operator and representative physical iOS and Android devices.
- Every milestone ships through small reviewed pull requests. Each vertical slice crosses mobile, versioned contract, module interface, PostgreSQL, worker or adapter where applicable, and evidence ledger without bypassing module ownership.
- Automated evidence starts with the first change. Security, privacy, accessibility, failure handling, and migration compatibility are acceptance work inside each milestone, not a final hardening phase.
- Local development and automated tests use synthetic data and remain at $0 infrastructure spend. Hosted services, store accounts, processors, paid recovery, and participant enrollment stay behind named approval gates.
- Current and immediately previous approved mobile/API/worker contracts remain compatible during release and rollback. Database changes use expand, migrate, verify, then contract.
- Estimates include expected repair inside the named scope. They exclude product changes, a second backend, public launch, localization, multi-region operation, high-fidelity design for every screen, reintroduction of Proof video, and paid independent security or legal work.

## Release and evidence cadence

Create the evidence ledger in the first milestone. Give each accepted contract, scenario, migration, release, environment, and manual review a stable identifier. Every pull request records affected ledger rows and passes Gate 1 from the verification strategy. A milestone closes only when its listed exit evidence is current and inspectable.

At each milestone boundary:

1. reconcile behavior against the requirements matrix and screen/state contract;
2. run deterministic module, PostgreSQL, authorization, adapter, and cross-module scenarios affected by the change;
3. run focused accessibility, privacy, threat, deletion, concurrency, and failure-path review;
4. verify current and previous contract compatibility plus forward-safe migration behavior;
5. record defects, evidence freshness, invalidation impact, and residual risks; and
6. obtain separate Codex scope, standards, threat, failure-path, and test-adequacy review.

Missing, expired, invalidated, flaky, ambiguous, or inaccessible evidence fails its gate. Coverage percentages and vendor claims never replace named outcome evidence.

## Ordered implementation milestones

| Milestone | Work packages | Depends on | Exit evidence | Developer effort |
| --- | --- | --- | --- | ---: |
| 0. Execution baseline | Repository/package layout; local Supabase stack; React Native/Expo development build; pinned toolchain; typed contract generation and runtime validation; migration/test harness; synthetic fixture vocabulary; evidence ledger; secret/dependency checks | Approved plan and fresh authorization to begin implementation | Reproducible clean setup; no hosted dependency; first migration forward/compatibility proof; Gate 1 template; evidence ledger traces all 40 contracts | 1–2 weeks |
| 1. Shared kernel and delivery skeleton | Opaque identifiers; clocks and persisted Group-zone facts; request/actor/idempotency envelopes; transaction/outbox primitives; typed results; API entrypoint; queue/Cron worker shell; environment-bound config; navigation and member/operator shell skeletons | 0 | Real local PostgreSQL transaction and outbox tests; current/previous contract test; failed/retried work remains idempotent; no business rules in delivery shells | 2–3 weeks |
| 2. Identity, Group authority, and accountability calendar | Invitation-gated email OTP seam; Account, consent, Group, Membership, Group-admin, staff assignment, access cutoff; invitations; Group setup/activation; Accountability weeks, Seasons, Member-weeks, locked Targets, pause intervals; live authorization and default-deny RLS | 1 | Positive/negative current, pre-join, departed, returned, admin, peer, operator, service, and stale-session tests; concurrent invitation/capacity/one-Group tests; DST/cutoff fixtures; atomic activation and departure cleanup | 4–6 weeks |
| 3. Device-private capture, media lifecycle, and Workout Proof | Workout sessions; private app storage; exactly two Proof photos; media-bound descriptions; plain-language media-sharing consent and submission gate; durable drafts/upload journal; immutable object reservations; signed transfer seams; report submission; screening state; active-review and Wall visibility; exact 90-day Verified retention; consent withdrawal/re-consent; moderation quarantine on the same object; early-trigger deletion; deletion tombstones | 2 | Interrupted/retried/duplicate upload tests; acknowledgement only after durable object and authoritative commit; no camera-roll or metadata leakage; current-member Wall reads and structured detail allowlist including late join/return; consent withdrawal hides and blocks submission while re-consent restores no deleted media; moderation clearance preserves the original deadline; every parent/description/derivative deletion path; processor fail-closed contract tests | 4–6 weeks |
| 4. Workout review, Exception, and Member-week settlement | Verification/question/withdrawal; immutable review audiences; Group decisions and recusal; Exception request privacy and sealed ballots; provisional credit; cutoff claiming; exactly-once terminal outcomes; missed-target settlement | 2–3 | Boundary-ordering and concurrency matrix across submission, questioning, departure, votes, cutoff, retry, and finalization; no early/double finalization; private Exception details expire; finalized history remains immutable | 3–5 weeks |
| 5. Consequence system | Versioned Card catalog; unlocks; Card pools/offers/redraw; bounded backlog; Safety pause; media-free Consequence completion claim and peer review; expiry/reoffer behavior | 4 | Property and PostgreSQL tests for catalog fairness, unique provenance, backlog cap, review thresholds, departure, timeout, idempotency, and exactly one obligation effect; no Proof-video route, field, processor, or stored media | 2–3 weeks |
| 6. Activity ingestion, Competition, and Seasons | App-owned HealthKit/Health Connect aggregate interfaces and fakes; permission/source state; immutable interval snapshots; Top Steps, Load Progression, Cardio Leap; private baselines; eligibility; Crown finalization; standings and Season summaries | 2, 4 | Hand-calculated golden fixtures; missing/partial/late/duplicate/source-change cases; post-join boundaries; rounded ties; first-result ineligibility; no zero for missing data; exactly-once Crown and Season finalization | 3–5 weeks |
| 7. Read models, member tasks, social delivery, and notifications | Rebuildable member/Group/Season views; task-first home; dedicated Wall routes and newest-first week read model; authorized filters, counts, and opaque pagination; reactions/messages; social budgets/digest; in-app authority; push/email adapters; typed deep links; due-work scheduling, cancellation, bundling, retries, and stale-route recovery | 2–6 | Projection rebuild equals authoritative facts; Wall filters, counts, and cursors reveal no inaccessible or cross-Group item; permission-denied/offline/late/duplicate push cannot alter outcomes; daily caps and bundling pass; stale links recover safely; all applicable member screens expose loading, empty, denied, failure, conflict, and pending states | 3–4 weeks |
| 8. Safety, moderation, operator shell, and Account lifecycle | Group conduct acceptance; bidirectional historical-Wall Safety-block suppression; Content report; Moderation case/hold/appeal without a second media copy; scoped operator commands and views; support; export; Account deletion and Group-closure workflows; Auth/Storage/processor/cache/derivative deletion; audit pseudonymization | 2–7 | Cross-role and cross-Group denial; active-review evidence remains available while blocked historical media is suppressed; operator TOTP/purpose/reason/audit checks; no broad Group or infrastructure access; synchronous cutoffs; seven-day active/processor deletion after early triggers; 30-day backup expiry model; 90-day restricted audit expiry; outstanding-JWT deletion case | 4–6 weeks |
| 9. Integrated candidate and device acceptance | Complete 66-screen/state inventory including Wall; responsive layouts; current-major iOS/Android device integrations; screen reader, roughly 200% text, reduced motion, alternative input; camera, OTP, links, SecureStore, push, activity sources, offline/restart; release manifest | 1–8 | Gates 2 and 3 pass for immutable candidate; zero authoritative mismatch; Wall chronology, filters, progressive loading, announcements, and structured comparison work in every required accessibility mode; every core flow works on one representative physical device per platform; recorded p95 performance thresholds pass | 3–5 weeks |
| 10. Hosted operations and synthetic rehearsal | Four-environment isolation; deploy/forward-fix/migration runbooks; five-minute internal supervisory checks and independent external health check; alerting; PITR; exact 90-day and early-trigger retention jobs; restore-safe deletion and tombstone replay; vendor exit; secret rotation; staff handoff; rare/failure-injected operator workflows | 9 plus approval A1 | Gate 4 passes in production-shaped hosted rehearsal; human alert within 15 minutes; structured RPO at most 15 minutes; core RTO at most four hours; every parent/derivative/cache/processor copy follows its deadline; deleted Proof/identity never reappear; no live data or participant credentials | 2–4 weeks |
| 11. Participant admission and guided rehearsal | Current vendor/country/privacy/cost review; exact candidate/config audit; support and break-glass verification; recruited participant onboarding and media-sharing consent; guided non-scoring week; ordinary Wall comparison, journey, accessibility, and support observation | 10 plus approvals A2–A3 | Gate 5 passes before enrollment; guided week reconciles Accounts, Groups, tasks, Wall counts/cursors, media, outcomes, notifications, operator actions, audits, and pilot measures; rare/destructive events remain synthetic | 2–3 weeks plus one rehearsal week |
| 12. Controlled reset and scored-pilot activation | One-time developer-authored reset; bounded manifest; operator witness; before/after reconciliation; remove rehearsal accountability state while retaining only required consent/audit records; rerun affected checks | 11 plus approval A4 | Gate 6 passes; no reset command, fixture loader, test bypass, or rehearsal route exists in live pilot; developer signs exact release/environment/ledger; owner separately authorizes scored activation | 1–2 weeks |

Expected focused implementation total: **32–50 developer-weeks**. Add **3–7 calendar weeks** for store review, vendor/account setup, scheduled operator work, physical-device sessions, guided rehearsal, and approval latency; some can overlap development. Do not compress by deferring evidence or collapsing environment boundaries.

### Critical path

`baseline -> shared kernel -> identity/Group/calendar -> Workout media -> review/Exception settlement -> Consequence and Competition -> read models/notifications -> safety/operator/deletion -> integrated device candidate -> hosted rehearsal -> participant rehearsal -> controlled reset -> scored activation`

Activity adapters can start after identity/calendar contracts stabilize. Safety/operator UI can overlap Competition after live authority and audit primitives exist. UI shells and accessibility component work can advance alongside domain slices. None bypasses integration points on the critical path: authoritative settlement, media durability/deletion, Account deletion, physical-device acceptance, hosted restore, and final reconciliation.

Largest estimate risks:

- React Native native-module behavior across current iOS and Android releases;
- private capture, interrupted transfer, screening, signed-read revocation, and restore-safe media deletion;
- concurrency around deadlines, departures, review audiences, and exactly-once finalization;
- app-store review, permission disclosures, country availability, and processor/transfer clearance;
- measured PITR/restore duration and deleted-object reconciliation;
- manual accessibility repair discovered on physical devices; and
- fitness-context false positives/negatives from any approved photo/text safety processor.

If one risk adds more than two developer-weeks, requires a product change, adds a processor, exceeds approved spend, or breaks a non-waivable gate, stop that work package and escalate with evidence. Do not silently absorb it through weaker behavior.

## Service-cost model

Refresh every price, quota, tax, region, DPA, subprocessor, retention term, and cancellation condition in the activation sheet immediately before approval. Prices below are planning snapshots, not purchase authorization.

### Zero-spend implementation

| Item | Planned cost | Boundary |
| --- | ---: | --- |
| Local Supabase and local development builds | $0 | Synthetic data only; never expose local Supabase publicly |
| Disposable Supabase Free project | $0 | Optional, synthetic-only, separately approved provisioning; not recovery or rehearsal evidence |
| Expo EAS Free | $0 | Use only while current build quotas suffice; paid Starter is excluded without approval |
| Checkly Hobby | $0 | Do not provision before processor/privacy approval; capability is not alert-delivery evidence |
| Azure AI Content Safety F0 | $0 candidate | Photo/text evaluation only after provisioning/terms approval; selection depends on region/privacy/calibration/failure evidence |

### Hosted rehearsal and live-pilot planning floor

| Item | Planning snapshot | Model |
| --- | ---: | --- |
| Supabase Pro organization | $25/month | Includes one Micro project's $10 compute credit |
| Small compute for rehearsal and pilot | About $15/project/month | Two concurrent compatible projects; apply included compute credit once |
| Seven-day PITR | About $100/project/month | Required to prove at-most-15-minute structured-data RPO |
| Two concurrent Supabase projects | **About $245/month** | `$25 + (2 × $15) - $10 + (2 × $100)` before tax and overage |
| Checkly Hobby | $0 | Up to current free quota; one content-free five-minute check plus tested alert path |
| Expo EAS Free | $0 | Current planning snapshot: 15 Android and 15 iOS builds/month; Starter about $19/month only if approved |
| Apple Developer Program | $99/year | Store/distribution prerequisite; refresh terms and tax |
| Google Play Console | $25 one time | Store/distribution prerequisite; refresh terms and tax |
| Proof Storage/egress overages | Usage-based | Current planning snapshot: $0.0213/GB-month over included Storage, $0.09/GB standard egress, $0.03/GB cached egress |
| Email OTP, push, domain/DNS, and photo/text screening | $0 expected at bounded pilot volume, not guaranteed | Confirm quotas, deliverability, ownership, region, privacy, and overage behavior before approval |

Budget model for approval: reserve **$350/month recurring plus tax**, **$150 initial/annual store and domain allowance**, and no automatic overage. This is a ceiling recommendation, not authorization. It provides roughly $105/month headroom above the $245 Supabase floor for a separately approved Expo upgrade, email/domain charges, or measured usage. Any processor, paid monitor, log drain, support plan, security review, legal review, or quota increase receives its own line and fresh approval; unused headroom does not authorize it.

Illustrative infrastructure exposure after approval:

- two hosted months: about $490 Supabase floor, plus store fees, tax, and measured usage;
- three hosted months: about $735 Supabase floor, plus store fees, tax, and measured usage; and
- every delay after hosted activation: about $245 per additional month before variable cost.

Keep hosted activation as late as evidence permits, but maintain qualifying rehearsal and pilot projects concurrently once Gate 4 begins. If two compatible projects plus required recovery do not fit the approved budget, stop; do not weaken isolation, PITR, deletion, or recovery gates.

Cost controls: environment-tag every charge; enable vendor spend caps and quota alerts where supported; prohibit Supabase Log Drains, analytics warehouse, session replay, paid monitoring, custom domains, branches, replicas, second Proof store, and self-hosted production unless separately justified and approved; review forecast weekly during hosted rehearsal and pilot; export required evidence and cancel unneeded resources at closeout.

## Human approval and hold points

Routine implementation choices use the accepted defaults. Following approval points remain mandatory and non-transferable:

### A0 — begin implementation

Project owner confirms this code-free plan may hand off into implementation. Approval authorizes repository changes within accepted scope only. It does not authorize service accounts, trials, payment, hosting, processors, store enrollment, or participants.

### A1 — hosted synthetic rehearsal activation

Before any hosted account, trial, payment method, or expense, project owner approves one written activation sheet: current prices/taxes and maximum spend; two-project topology; region/country register; DPA/subprocessors/transfers; retention/deletion; quotas/overages; owner and recovery identities; alert routes; processor list; export/cancellation; expected structured/media volume and egress. Approval names each service and plan. Unnamed services remain prohibited.

### A2 — distribution and processor readiness

Before store submission or any processor receives content, project owner approves current Apple/Google accounts and agreements, distribution countries, disclosures, permissions, privacy policy, Data safety answers, support/deletion paths, Supabase terms, Checkly controls, transactional email, and any photo/text safety processor. Azure F0 is selected only after synthetic/consented fitness-corpus calibration, fail-closed tests, regional/privacy review, and explicit provisioning approval.

### A3 — recruited participant admission

After Gates 1–4 pass, project owner approves exact release/environment, current costs and maximum spend, cleared country list, participant cohort, consent/research material, support contacts, incident path, and guided non-scoring rehearsal. Developer separately signs technical readiness for Gate 5. Operator cannot waive either decision.

### A4 — scored Validation-pilot activation

After guided rehearsal and controlled reset evidence, developer signs Gate 6 technical readiness. Project owner separately approves scored activation. Any material release, config, processor, country, privacy, cost, cohort, restore, incident, or reconciliation change invalidates mapped evidence and returns to the applicable prior gate.

Fresh explicit product approval is also required before changing any accepted product behavior, including reintroducing Proof video. Paid independent expertise is required only if threat modeling exposes an unresolved High-risk specialty outside developer/Codex competence; any purchase remains separately approved.

## Operator and owner participation

Plan **8–12 operator-days** across implementation, scheduled rather than continuous:

- 1–2 days reviewing operator shell language, support, moderation, deletion, and handoff flows;
- 3–4 days executing or witnessing rare synthetic workflows, alerts, restore, repair, staff handoff, and runbooks;
- 2–3 days supporting guided participant rehearsal and recording receipts; and
- 2–3 days for controlled reset, final checks, pilot onboarding, and contingency reserve.

Private-pilot operator receives only purpose-built application access. They do not receive infrastructure, billing, source-control, database, Supabase, Checkly, Expo, app-store, DNS, service-key, or broad Group access. Developer owns infrastructure, recovery, repairs, ledger, and technical sign-off. Project owner owns legal/billing identities, provisioning, spend, processors, participant admission, and activation approval.

## Required rehearsal and completion record

Hosted rehearsal uses synthetic personas only and covers every requirement plus rare, destructive, moderation, outage, deletion, recovery, vendor-exit, and failure-injection path. Outbound effects stay disabled until explicitly exercised. Rehearsal must prove environment isolation; least privilege; immutable release and migration compatibility; secret rotation; five-minute supervisory and external checks; alert receipt within 15 minutes; queue/outbox recovery; every retention clock; isolated PITR restore; deleted Proof and identity non-reappearance; operator handoff; and full PostgreSQL-to-pilot-measure reconciliation.

Participant rehearsal uses recruited participant Accounts in the live pilot environment for one guided non-scoring week. It exercises ordinary onboarding, accessibility, support, Workout reporting/review, Exceptions, Consequence claims, activity-source gaps, notifications, and participant understanding. Never manufacture rare, destructive, safety, moderation, recovery, or failure scenarios among participants.

Before scored activation, run one bounded developer-authored reset with operator witness. Reconcile every rehearsal Account, Group, Member-week, target, Workout report, Proof object and derivative, Wall item/count/cursor, decision, streak, Card, Crown, standing, notification, queue/outbox item, operator action, audit receipt, and Validation-pilot measure before and after. Failure or unexplained residue blocks scored weeks.

Final completion record contains exact immutable release and environment fingerprints; ledger revision and pass/fail/block/expiry counts; defects/workarounds; device, OS, network, region, vendor, processor, country, cohort, cost, and distribution review dates; measured performance, alert, RPO, RTO, deletion, retention, and support results; rehearsal, restore, vendor-exit, reset, operator-handoff, accessibility, security/privacy, and analytics artifacts; and developer identity, time, decision, and conditions.

## Handoff exit condition

Planning is complete when this document, its source contracts, and accepted ADRs are on `main`. Implementation may begin only after A0. Validation-pilot participant enrollment and scored activation remain blocked until their named approvals and all six verification gates pass for the exact release and environment.

This plan introduces no new product term or product behavior, selects no new hard-to-reverse architecture, provisions nothing, and authorizes no spending. Implementation discoveries return to planning only when evidence exposes a genuine product conflict, an ADR-level architecture reversal, an unapproved processor or cost, or a non-waivable gate that cannot be met within accepted scope.
