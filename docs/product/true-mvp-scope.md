# True MVP scope and deferred product roadmap

Status: accepted product boundary on 2026-09-08.

## Purpose

The True MVP tests one hypothesis:

> Does visible weekly progress among existing friends improve workout consistency?

This document selects the smallest coherent product loop needed to test that hypothesis. It
does not replace `CONTEXT.md`, erase earlier decisions, or reject deferred features.

Scope precedence for new work:

1. This document decides whether behavior is active now or deferred.
2. `CONTEXT.md` preserves canonical product language and accepted target-product behavior.
3. Existing implementation, design, research, ADR, issue, and prototype artifacts preserve
   detailed decisions and evidence.

Words such as "MVP" in older artifacts describe the previously approved, larger pilot
baseline. They do not move a feature into True MVP unless this document says it is active.

## Active True MVP

Only this loop ships:

`join Group -> set Weekly target -> log workouts -> friends see progress -> week closes met or missed -> repeat`

### Included behavior

- Private invitation-only Groups of 2–10 existing friends.
- Account access plus create, invite, join, leave, remove, and Account-deletion paths needed
  to keep membership private and voluntary.
- One Group per Account.
- One individual Weekly target per member.
- Structured self-reported workout check-ins with no media or free text.
- Current-week target and completed-workout count visible to current Group members.
- Automatic weekly `Met` or `Missed` outcome from self-reported workout count versus target.
- Basic Group-visible history containing weekly outcome and workout count.
- Accessible loading, empty, failure, denied, and success states for included flows.

Self-reported check-ins count immediately. True MVP does not claim independent verification.
Product copy must say that plainly.

### Excluded behavior

- Photos, video, descriptions, Proof, Wall, drafts, uploads, screening, and media retention.
- Peer review, questioning, voting, Verified/Rejected/Unsupported outcomes, or settlement
  windows.
- Exceptions, Safety pauses, Technical pauses, or provisional results.
- Consequence cards, unlocks, offers, redraws, backlogs, or completion review.
- Crowns, performance baselines, activity-source ingestion, Seasons, standings, summaries,
  or leaderboards.
- Target streaks and Workout streaks.
- Reactions, messages, digests, email reminders, or push notifications.
- User-authored content, Content reports, Safety blocks, moderation cases, moderation holds,
  or content-screening operations.
- Offline-first behavior, install prompts, app-store distribution, and advanced PWA lifecycle
  behavior beyond what included flows require.
- Scored Validation-pilot operations, research analytics, automated operator dashboards,
  and production-shaped rehearsal machinery.

Excluded means deferred, not rejected.

## Deferred-feature preservation rule

Earlier accepted decisions remain accepted target-product decisions. Implementing them later
must begin from their recorded contracts; do not restart discovery or ask the owner to choose
them again merely because they were deferred.

Reopen a recorded decision only when at least one trigger exists:

- a concrete conflict with True-MVP evidence or another accepted decision;
- a changed external constraint such as platform, law, vendor, safety, privacy, or cost;
- an implementation finding that makes recorded behavior infeasible; or
- an explicit owner request to reconsider it.

Any reopening must name the exact decision, source, new evidence, and smallest required
change. Unaffected decisions stay closed.

Deferred work enters active scope incrementally through a separately scheduled slice. That
checkpoint approves timing, resources, and implementation boundaries; it does not reopen
accepted product behavior. Adding one slice does not implicitly activate neighboring systems.

## Deferred roadmap and source index

The detailed feature record remains in version control. Use these sources instead of
reconstructing decisions from chat.

| Deferred capability | Preserved source of truth | Existing GitHub decisions/work |
| --- | --- | --- |
| Workout Proof, private capture, consent, media lifecycle, and Wall | `CONTEXT.md`; `docs/research/proof-media-safety-screening.md`; `docs/research/supabase-storage-proof-deletion-and-restore.md`; `docs/design/no-excuses-visual-system.md` | #32, #44, #55, #65, #66, #71, #79, #89, #103 |
| Peer verification, Group decisions, settlement, and trust integrity | `CONTEXT.md`; `docs/implementation/requirements-and-acceptance-matrix.md`; `docs/implementation/verification-and-pilot-readiness-test-strategy.md` | #5, #43, #49, #80, #105 |
| Exceptions and pause behavior | `CONTEXT.md`; `docs/implementation/screen-state-accessibility-contracts.md` | #4, #45, #56, #80 |
| Consequence cards and progression | `CONTEXT.md`; `docs/implementation/requirements-and-acceptance-matrix.md` | #7, #12, #43, #81 |
| Crowns, activity integrations, performance baselines, and Seasons | `CONTEXT.md`; `docs/implementation/implementation-handoff-plan.md` | #15, #20, #21, #23, #38, #46, #82 |
| Streaks and richer accountability history | `CONTEXT.md`; `docs/implementation/screen-state-accessibility-contracts.md` | #3, #4, #8, #48, #83 |
| Reactions, messages, digests, and notifications | `CONTEXT.md`; `docs/implementation/screen-state-accessibility-contracts.md` | #26, #45, #83, #97, #104 |
| Safety, UGC policy, blocking, moderation, and operator controls | `CONTEXT.md`; `docs/implementation/private-pilot-technical-quality-bar.md`; `docs/research/proof-media-safety-screening.md` | #7, #39, #47, #54, #65, #84 |
| Full Account lifecycle, deletion, export, and retained-history rules | `CONTEXT.md`; `docs/implementation/requirements-and-acceptance-matrix.md`; `docs/research/supabase-storage-proof-deletion-and-restore.md` | #42, #44, #66, #84 |
| Advanced native/PWA delivery, offline operation, installation, and browser readiness | ADRs under `docs/adr/`; `docs/implementation/implementation-handoff-plan.md`; PWA research attached to roadmap issues | #36, #40, #67, #95–#106 |
| Validation analytics, pilot operations, rehearsal, recovery, and activation | `CONTEXT.md`; all files under `docs/implementation/`; `docs/research/validation-observability-options.md` | #10, #34, #35, #39, #47, #49–#51, #85–#88 |

`CONTEXT.md` retains full definitions for Account, Group governance, competition, Proof,
verification, Consequences, safety, moderation, deletion, pauses, Exceptions, and Validation
pilot concepts. Existing closed GitHub issues retain discussion and resolution history.
Existing open issues retain implementation sequencing. No deferred detail should be deleted
when simplifying active code or tests; move obsolete active requirements behind explicit
deferred labels or references instead.

## Incremental reintroduction

Likely slices, ordered by learning value rather than commitment:

1. Lightweight reactions/reminders.
2. Streaks and richer weekly history.
3. Exceptions.
4. Proof photos and Wall, with required safety/privacy/media lifecycle.
5. Peer verification and settlement.
6. Consequence system.
7. Activity ingestion, Crowns, and Seasons.
8. Full pilot operations and research instrumentation.

Order is provisional. Each slice requires scheduling, dependency review, and acceptance
criteria. Preserved product behavior inside each slice remains the starting point; no product
redecision is required without a reopening trigger above.

## Change control

Every product ticket and implementation PR must state one of:

- `True MVP: active` and cite an included behavior above; or
- `Deferred slice: <name>` and cite explicit approval activating that slice.

If neither applies, work is out of scope. Architecture already merged may remain when harmless,
but it does not authorize deferred product behavior or expand True MVP.
