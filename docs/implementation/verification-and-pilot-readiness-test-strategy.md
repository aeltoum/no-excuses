# Verification and pilot-readiness test strategy

This document defines the evidence required before the No Excuses MVP may enter its Validation pilot. It turns the [implementation requirements and acceptance matrix](requirements-and-acceptance-matrix.md), [private-pilot technical quality bar](private-pilot-technical-quality-bar.md), and [screen, state, and accessibility contracts](screen-state-accessibility-contracts.md) into one release-gating strategy for a single developer working with Codex and a Private-pilot operator.

It does not select test libraries, CI products, device-cloud services, monitoring vendors, or security vendors. It does not provision a service, authorize spending, weaken a product contract, or replace current vendor, country, privacy, cost, and distribution reviews required before hosted rehearsal and pilot activation.

## Readiness rule

The developer alone signs technical readiness. A release is ready only when:

- every contract in the implementation requirements and acceptance matrix has current, inspectable evidence from every required layer;
- every applicable gate in this strategy passes for the exact release candidate and environment configuration;
- no Critical or High security, privacy, authorization, or data-integrity finding remains open;
- no defect prevents a core flow in any required accessibility mode;
- every authoritative-state reconciliation reports zero unexplained mismatch;
- every required physical-device, operator, notification, retention, recovery, analytics, and end-to-end rehearsal passes; and
- every permitted non-core Medium defect has an owner, workable member or operator workaround, expiry date, and scheduled retest.

Evidence absence, expiry, invalidation, ambiguity, or inaccessible storage is a failed gate. Vendor claims, screenshots without traceability, code coverage alone, and a lower-layer pass do not substitute for required outcome evidence.

## Evidence ledger

Maintain one version-controlled readiness ledger as the index for all verification evidence. Give every evidence item a stable identifier and record:

- requirement ID and exact acceptance obligation;
- scenario and expected invariant or observable outcome;
- verification layer and risk class;
- test, review, or runbook identifier and version;
- source commit, immutable release identifier, schema version, mobile build, server artifact, and configuration fingerprint;
- environment, region, device model, OS version, app permission state, assistive mode, and network profile where applicable;
- synthetic persona and membership era, never reusable live participant credentials or member content;
- result, execution time, duration, responsible developer, operator witness when required, and artifact link;
- open defect or exception link, owner, expiry, workaround, and retest date where the quality bar permits one; and
- evidence freshness, invalidation reason, replacement evidence, and final developer sign-off.

Artifacts may include structured test reports, sanitized logs, reconciliation manifests, screenshots, recordings, accessibility notes, performance samples, alert receipts, runbook records, restore manifests, deletion proofs, and signed checklists. Store no Proof, descriptions, messages, email addresses, health/activity detail, tokens, keys, session identifiers, unrestricted database exports, or live participant data in evidence artifacts.

The ledger is an index, not a duplicate evidence store. Artifact retention must cover implementation review, pilot activation, and incident learning without exceeding the underlying data's approved retention period. If an artifact cannot remain that long without retaining prohibited data, retain a sanitized result and cryptographic or count-based reconciliation record instead.

## Verification layers

Use the cheapest deterministic layer that proves each narrow behavior, then add every higher layer needed to prove integration, platform, human, or operational behavior. A higher-layer pass does not excuse missing focused tests; a lower-layer pass cannot prove a device, vendor, or runbook outcome.

### 1. Static and supply-chain checks

Run formatting, type, lint, generated-contract consistency, migration-policy, secret, credential, dependency, license, native-permission, privacy-manifest, entitlement, network-security, and prohibited-configuration checks. Fail on committed secrets, broad transport exceptions, unexpected mobile permissions, pilot reset routes, live environment identifiers in non-live builds, privileged keys in client-readable artifacts, or unreviewed dependency and processor changes.

### 2. Pure unit, state-machine, and clock tests

Test formulas, validation, transitions, deadlines, time-zone and daylight-saving boundaries, majority thresholds, eligibility, target and streak behavior, Season behavior, retention clocks, notification ladders and caps, analytics derivations, and idempotency decisions with deterministic clocks and seeded randomness.

Use golden fixtures for every terminal state and every boundary immediately before, at, and after a cutoff. Property-based or generated tests supplement named examples for invariant-heavy rules; they do not replace readable fixtures for accepted product behavior.

### 3. PostgreSQL, API, queue, and authorization tests

Run against fresh isolated local infrastructure. Verify constraints, transactions, row ownership, membership-era visibility, live authorization, stale-session cutoffs, invitation races, finalization locks, outbox atomicity, queue retry and deduplication, deletion tombstones, audit receipts, and versioned API compatibility.

Authorization suites require positive and negative cases for current, pre-join, departed, returned, blocked, suspended, admin, peer, operator, developer, service, and stale-session actors. Cross-Group identifiers, guessed object identifiers, changed roles, expired assignments, and client-supplied authority assertions must reveal neither hidden object existence nor private data.

### 4. Adapter and service integration tests

Exercise real app-owned interfaces against controlled local fakes, provider sandboxes where approved, and contract fixtures for Supabase Auth, PostgreSQL, Storage, Edge Functions, email OTP, Expo notifications, HealthKit, Health Connect, safety screening, and external checks. Verify timeouts, rate limits, malformed responses, partial success, delayed callbacks, duplicated delivery, provider outage, revoked permission, quota exhaustion, and recovery.

Provider emulation proves application behavior, not provider suitability. Hosted rehearsal must separately prove selected provider configuration and observed outcomes.

### 5. Emulator and simulator end-to-end tests

Automate broad route, state, deep-link, offline, restart, process-death, conflict, and visual-layout coverage on supported iOS and Android configurations. Verify that every screen inventory row is reachable for an authorized actor and every listed state has a deterministic fixture.

Emulator and simulator results accelerate regression detection but do not satisfy physical camera, private storage, secure credentials, push delivery, activity permission, performance, or manual accessibility obligations.

### 6. Physical-device acceptance

Use one recorded representative physical device on the current major iOS release and one on the current major Android release. Exercise release builds under a recorded constrained-network profile and all required permission states.

Required evidence includes camera capture and metadata removal; device-private and backup-excluded storage; restart and process-death recovery; secure session behavior; verified invitation links and email OTP; foreground activity synchronization; push receipt, bundling, cancellation, generic lock-screen copy, and denied-notification recovery; interrupted and resumed media transfer; app backgrounding; current/previous server compatibility; and measured performance percentiles.

### 7. Manual accessibility review

On both representative physical devices, complete every core flow with VoiceOver or TalkBack, roughly 200-percent text, reduced motion, and supported Voice Control, Voice Access, Switch Control, Switch Access, or keyboard-style input. Review focus, headings, announcements, error summaries, modal restoration, target size, color-independent state, orientation, reflow, permission recovery, camera cues, media descriptions, offline status, safe retry, and receipt semantics.

Automated accessibility checks and screenshot diffs are supplemental. A blocked core flow is non-waivable.

### 8. Hosted rehearsal and operational proof

Use production-shaped hosted rehearsal with synthetic scenario personas only. Prove environment isolation, release and migration procedures, service configuration, least privilege, secret rotation, alerts, support handoff, operator purpose gates, retention workflows, restore, vendor exit, processor failure behavior, and reset isolation. Rehearsal evidence belongs to the exact candidate; it cannot be carried forward after material invalidation.

## Risk classes and coverage depth

Classify each scenario by its highest consequence:

1. **Authority, privacy, safety, deletion, and authoritative integrity:** exhaustive named positive and negative boundary coverage plus adversarial review and hosted rehearsal where infrastructure participates.
2. **Finalization, deadlines, concurrency, recovery, notifications, and Validation-pilot measures:** boundary, failure-injection, reconciliation, and end-to-end coverage across every meaningful ordering and terminal state.
3. **Core member and operator journeys:** deterministic happy, empty, denied, stale, offline, retry, conflict, interrupted, and failure paths on both platforms.
4. **Non-core presentation and low-risk preference behavior:** representative equivalence classes and pairwise combinations, with full accessibility obligations where the behavior is user-facing.

Coverage percentage is diagnostic, never a readiness target. Unexecuted code, mutation survivors in invariant-heavy logic, flaky scenarios, and untested error branches require disposition even when aggregate coverage appears high.

## Canonical scenario catalog

Build scenario fixtures from domain transitions rather than screens alone. Each fixture names actors, Account and Membership eras, Group state, authoritative clock, pending work, permissions, network state, expected visible state, expected hidden state, audit effect, analytics effect, and cleanup obligations.

At minimum, compose scenarios across:

- Group setup, activation, capacity, pause below two, midweek join, departure, removal, return, last-admin protection, and closure;
- invitation issue, revoke, expiry, normalization, concurrent acceptance, one-Group conflict, and preview without acceptance;
- Workout-session start, capture, end, expiry, draft deletion, reporting cutoff, submission, questioning, verification, withdrawal, rejection, Unsupported outcome, and finalization;
- two-photo Proof selection, normalization, reservation, interruption, retry, duplicate upload, unfinalized object cleanup, screening result, quarantine, live audience loss, terminal deletion, and restore reconciliation;
- Exception, Questioned-report, and Consequence decisions across thresholds, recusal, departure, timeout, stale ballot, Safety block, moderation interruption, and all terminal outcomes;
- Weekly target, Target streak, Workout streak, Missed-target event, Card unlock, offer, redraw, backlog, safe-decline, claim, review, and expiry boundaries;
- Top Steps, Load Progression, Cardio Leap, Performance baseline, missing/partial/late activity, tie, first-result ineligibility, Season pause, rollover, and provisional/final standings;
- notification creation, priority, bundling, separate daily caps, cancellation, rescheduling, denied permission, provider delay, duplicate delivery, stale deep link, and in-app authority;
- consent, conduct acceptance, Content report, Safety block, Moderation case, Technical pause, Service pause, underage suspension, support, export, global sign-out, and Account deletion;
- operator assignment, MFA, purpose gate, named command, forbidden accountability action, expiry, handoff, failed action, repair witness, and audit lookup; and
- country hold, distribution failure, dependency outage, queue delay, secret rotation, schema migration, rollback or forward repair, backup, restore, vendor exit, and rehearsal reset.

For concurrent consequential commands, execute all relevant orderings at, before, and after the authoritative cutoff. Duplicate, delayed, reordered, offline, retried, and simultaneous inputs must produce exactly one authorized visible outcome. Reconcile database state, Storage objects, queues, outbox, notifications, audit evidence, and Validation-pilot measures after each run.

## Release gates

### Gate 1: pull request

Required before review completion:

- affected static, unit, state, clock, database, API, authorization, adapter, and migration tests pass from a clean environment;
- changed requirements and scenarios have ledger entries or explicit impact records;
- secret, dependency, permission, privacy, and generated-contract checks pass;
- migrations dry-run forward and compatibility checks cover current and immediately previous supported clients/workers;
- focused accessibility semantics and layout automation passes for changed UI; and
- Codex performs a separate scope, standards, threat, failure-path, and test adequacy review.

### Gate 2: main and immutable candidate

Required before producing a rehearsal candidate:

- full deterministic automated suite passes without unexplained flake or retry masking;
- all authoritative-state and analytics golden-fixture reconciliations report zero mismatch;
- release manifest binds source, dependencies, mobile artifacts, API, Edge Functions, schema, configuration, runbooks, and feature flags;
- environment and secret scans prove no rehearsal reset or development bypass can reach pilot; and
- current and immediately previous mobile builds remain contract-compatible through rollout and rollback.

### Gate 3: rehearsal-candidate device acceptance

Required before hosted operational rehearsal:

- physical-device member and operator journeys pass on current-major iOS and Android;
- manual accessibility review passes every core flow in every required mode;
- camera, private media, secure credentials, OTP, verified links, activity access, push, offline/restart, and interrupted-transfer evidence passes;
- p95 cold start is at most three seconds, visible response/progress begins within one second, ordinary acknowledgement is at most two seconds, and non-media completion is at most five seconds under the recorded profile; and
- store metadata, permissions, privacy disclosures, support/deletion paths, conduct controls, country eligibility, and private-track eligibility have current evidence.

### Gate 4: hosted rehearsal

Required before pilot activation review:

- environment isolation, least privilege, staff MFA, secret rotation, deployment, rollback/forward fix, migration compatibility, quota, and spend controls pass;
- five-minute core and supervisory checks work and human alert receipt occurs within 15 minutes;
- every rare operator workflow, failure recovery, staff handoff, Service pause, Technical pause, moderation, deletion, export, research withdrawal, and authoritative repair witness is rehearsed;
- clock-controlled retention proves all terminal Proof paths, processor deletion, audit pseudonymization, diagnostic expiry, retries, escalation, and backup expiry;
- isolated point-in-time restore measures structured-data RPO of at most 15 minutes and core RTO of at most four hours, reconciles all invariants, and proves deleted Proof and deleted identity do not reappear;
- vendor-exit rehearsal proves an encrypted, short-lived, secret-free export plus import and reconciliation using synthetic data;
- push, email OTP, activity sync, safety screening, monitoring, and provider-outage fallbacks pass without inventing outcomes;
- all end-to-end pilot measures reconcile exactly to authoritative PostgreSQL facts and meet the separate usable-event completeness rule; and
- rehearsal reset removes rehearsal accountability state and media, preserves required receipts, and proves reset capability cannot execute against pilot.

### Gate 5: participant-rehearsal admission

Immediately before enrollment:

- repeat current vendor prices, approved maximum spend, taxes, quotas, service availability, country register, processor/subprocessor, DPA, transfer, privacy, retention, distribution, and support-route reviews;
- confirm project-owner approval for any account, trial, payment, or spend separately from this strategy;
- confirm exact rehearsal-tested release and materially equivalent region/configuration;
- review every ledger row for freshness, blockers, allowed Medium defects, expiring evidence, and linked artifacts;
- verify support primary, developer backup, operator assignment, alert routes, recovery codes, break-glass access, and incident contacts;
- record final member/device/network cohort assumptions and any resulting evidence impact; and
- obtain developer technical-readiness sign-off admitting recruited participants only to the required guided, non-scoring rehearsal week.

Any post-sign-off change follows the invalidation rules below. Participant enrollment does not begin while revalidation is incomplete. Admission at this gate does not begin scored Validation-pilot weeks.

### Gate 6: scored Validation-pilot activation

After the guided participant rehearsal:

- confirm every original participant completed the required consent and onboarding path and remained separated from synthetic rehearsal personas;
- reconcile every rehearsal Account, Group, target, activity item, streak, Card, Crown, standing, notification, media object, operator action, audit receipt, and Validation-pilot measure before reset;
- execute the versioned, one-time developer-authored participant-rehearsal reset under the authoritative-repair controls, with operator witness, bounded target manifest, safe stop, and before-and-after reconciliation;
- prove rehearsal targets, activity, streaks, Cards, Crowns, standings, media, derived measures, queued side effects, and cached views cannot enter scored weeks while retaining only records whose product, consent, audit, or legal purpose requires retention;
- prove no general reset command, fixture loader, test bypass, or destructive rehearsal route is deployed or callable in the live pilot environment;
- repeat affected core, authorization, accessibility, notification, analytics, retention, and operator checks after reset; and
- obtain developer sign-off on reset completeness and scored-week readiness.

Failure or unexplained residue blocks scored weeks. Repair and repeat reset verification; never relabel rehearsal outcomes as live results.

## Specialized evidence

### Security and privacy

Maintain a threat model covering Group isolation, membership-era visibility, operator separation, media, activity sources, notifications, diagnostics, backups, restore, exports, processors, and deletion. Map applicable OWASP MASVS mobile and ASVS server/API controls to evidence.

Perform automated dependency and secret checks, static review, negative authorization tests, abuse-case review, mobile build inspection, transport and storage verification, signed-capability tests, log/telemetry inspection, and adversarial API testing. Developer owns remediation; Codex performs a separate adversarial review. Paid external audit is not mandatory for the private pilot. If the threat model exposes an unresolved High-risk area requiring expertise unavailable to the developer and Codex, qualified independent review becomes a pilot-activation blocker and requires separate spend approval if paid.

### Retention and deletion

Use a controllable authoritative clock plus object and processor inventories. Prove every lifecycle trigger: draft deletion, cutoff, membership end, terminal report state, expiry, quarantine, withdrawal, rejection, Unsupported outcome, Account deletion, processor deletion, audit pseudonymization, diagnostic expiry, backup expiry, failed deletion, retry, escalation, and restore.

Evidence must show immediate loss of access, active-system and processor deletion within seven days, direct-identity pseudonymization within seven days for restricted audit evidence, backup expiry within 30 days, restricted-audit expiry within 90 days, object absence after provider/CDN windows, raw-digest removal, and no reappearance after restore. An API success response without inventory reconciliation is insufficient.

### Recovery and authoritative repair

Run isolated recovery with outbound email, push, screening, monitoring, and workers disabled until verification completes. Preserve backup-independent deletion tombstones and object inventory; restore PostgreSQL; replay access cutoffs and tombstones; reconcile schema, records, Storage, queues, outbox, audits, retention clocks, and analytics; rotate credentials; then reopen only after developer sign-off.

Every authoritative repair uses a versioned developer-authored script, dry run, bounded target manifest, operator witness, before-and-after reconciliation, safe stop, rollback or forward-repair plan, and immutable pseudonymous receipt. Neither operator nor script may override peer decisions or silently rewrite finalized outcomes.

### Notifications and time

Use deterministic clock tests for Group-zone boundaries, daylight-saving gaps and repeats, deferred schedule changes, settlement windows, pause intervals, retries, due-work claiming, cancellation, bundling, priorities, and separate daily caps. Hosted and physical-device evidence must measure creation, provider handoff, device receipt, tap routing, cancellation, stale-route recovery, permission denial, offline behavior, and generic lock-screen presentation.

Notification failure never changes authoritative in-app work. Tests must prove a late, missing, or duplicate notification cannot extend a deadline, cast a vote, finalize an outcome, or create duplicate work.

### Analytics and Validation-pilot measures

Generate each Validation-pilot measure from authoritative PostgreSQL fixtures, then compare raw domain outcomes, metric inputs, exclusions, numerator, denominator, missingness, and export values. Test duplicate, delayed, corrected, deleted, departed, returned, paused, ineligible, provisional, and late data.

Product-event completeness is measured separately from authoritative correctness. At least 95 percent usable product-event data for evaluable member-weeks remains required, but no completeness percentage permits an authoritative mismatch. Raw counts accompany percentages. Trust integrity uses disputes, withdrawals, anonymous disclosures, and interviews; low dispute count alone never passes it.

### End-to-end rehearsals

First run production-shaped hosted technical rehearsals using synthetic scenario personas only. Cover at least one complete path for every requirement and every rare operator workflow, plus failure-injected paths for authority, media, deadlines, notifications, deletion, recovery, and analytics. No recruited participant or copied live data enters this environment.

After Gate 5, run the product-required guided non-scoring rehearsal week with real recruited participant Accounts in the live pilot environment. It confirms onboarding, ordinary core journeys, support, accessibility, notifications, and participant understanding; it does not manufacture rare events or count toward Validation-pilot measures. Reset it through the controlled Gate 6 procedure before scored weeks.

Across the two rehearsals, include representative multi-member Groups, setup and activation, midweek join, Workout reporting and two-photo Proof, report review and dispute, Exception, missed target, Consequence cycle, Safety block, Content report, Season/Crown outcomes, activity-source gaps, accessibility modes, support, pause, departure, export, deletion, incident, repair witness, alert handoff, backup/restore, and reset. Rare, destructive, safety, moderation, recovery, and failure-injection scenarios stay in synthetic hosted rehearsal; they are never induced among recruited participants. Natural participant behavior is not required to manufacture rare live-pilot evidence; separate consented rehearsal scenarios remain distinct from live Validation-pilot results.

## Evidence freshness and invalidation

Evidence is valid only for the bound release and material operating conditions. Re-run affected evidence after any change to:

- application code, schema, migration, API or wire contract, queue/worker behavior, native module, or feature flag;
- environment configuration, secret, signing identity, permission, entitlement, build profile, region, quota, or infrastructure plan;
- dependency, SDK, OS major version, representative device, network profile, store rule, distribution track, or support path;
- processor, subprocessor, DPA, transfer location, privacy terms, retention behavior, pricing, or service capability;
- domain contract, screen/state/accessibility contract, threat model, runbook, operator responsibility, country status, or pilot cohort assumption; or
- failed rehearsal, incident, restored environment, data repair, environment contamination, unexplained flake, or reconciliation mismatch.

Record an impact analysis identifying invalidated requirements, scenarios, layers, and gates. Re-run focused evidence when isolation is demonstrable; re-run the whole gate when shared infrastructure, authority, recovery, privacy, platform, or release identity changed. A full hosted rehearsal and current review are always required before first pilot activation, regardless of earlier focused passes.

During the pilot, use the same impact rule for every change. Emergency containment may stop affected work or apply a scoped Service pause; it does not waive revalidation before resumption.

## Ownership and review

- **Developer:** owns test design, automated suites, threat model, release manifests, defects, recovery, repairs, evidence ledger, impact analysis, and final readiness signature.
- **Codex:** performs a separate adversarial review of changed scope, implementation standards, security/privacy boundaries, failure paths, concurrency, test sufficiency, and traceability. Codex review assists but does not become readiness authority.
- **Private-pilot operator:** executes or witnesses named rehearsal workflows, validates operator usability and handoff, records receipts, and witnesses authoritative repair and recovery where required. The operator has no infrastructure, billing, readiness-veto, or peer-accountability authority.
- **Project owner:** separately approves provisioning, trials, payment, spend, legal/billing identities, regions, processors, and activation sheet. Approval of this strategy authorizes none of those actions.

If independence is materially impaired—for example, the same defect author cannot credibly evaluate a High-risk specialty outside available competence—the developer must obtain a qualified independent review or keep pilot activation blocked. Record reviewer scope, evidence, findings, and remediation without granting broad data access.

## Flake, failure, and defect handling

A flaky test is a failed test until its cause is understood. Do not hide instability through automatic retries. A diagnostic rerun may classify failure, but the ledger retains the first result and investigation link. Quarantining a test invalidates its mapped evidence unless equivalent current evidence exists.

Classify defects by consequence, not implementation size. Critical and High security, privacy, authorization, data-integrity, deletion, and inaccessible-core-flow defects block readiness. Unresolved defects affecting authoritative accountability, access, deletion, or Validation-pilot measures also block readiness. Only non-core Medium defects may use the quality bar's owned, expiring workaround rule.

Every failure record identifies affected requirements, release, environment, scenario, observed result, sanitized diagnostics, containment, owner, repair, regression evidence, and whether prior evidence became invalid.

## Completion record

Pilot-readiness sign-off records:

- exact immutable release and environment fingerprints;
- ledger revision and counts of passed, failed, blocked, expired, and not-applicable obligations;
- every open defect and permitted workaround;
- device, OS, network, region, vendor, processor, country, cohort, cost, and distribution review dates;
- measured performance, alert, recovery point, recovery time, deletion, retention, and support-response results;
- rehearsal, restore, vendor-exit, reset, operator-handoff, accessibility, security/privacy, and analytics artifact links; and
- developer identity, time, decision, and conditions.

No percentage roll-up can override one failed mandatory obligation. Final sign-off means evidence supports beginning the Validation pilot; it does not predict pilot outcomes or authorize broader launch.

## Domain and architecture impact

This strategy adds no product term to `CONTEXT.md` and changes no accepted product behavior. It operationalizes the existing Validation pilot, Private-pilot operator, Technical pause, Service pause, Account deletion, Trust integrity, Target attainment, Pilot retention, and Critical safety incident contracts.

It introduces no new ADR. Verification layers, ledger shape, scenario organization, and review mechanics are reversible implementation-process choices. React Native with Expo, managed Supabase, PostgreSQL authority, invitation-gated email OTP, live authorization, private Storage, durable queues, app-owned native adapters, and four isolated environment classes remain the accepted technical baseline.
