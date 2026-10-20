# True MVP scope and deferred product roadmap

Status: accepted product boundary on 2026-09-08.

Delivery amendment accepted 2026-09-12: an installable Progressive Web App is the active
True MVP client and distribution target for iPhone and Android browsers. Native iOS and
Android applications and app-store distribution are deferred without deleting existing
React Native/Expo work. This amendment selects no web framework, host, paid service, or
deployment configuration.

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
- Responsive installable PWA delivery across supported iPhone and Android browsers.

Self-reported check-ins count immediately. True MVP does not claim independent verification.
Product copy must say that plainly.

### Excluded behavior

- Video, proof descriptions, drafts, timed Workout sessions, and automated screening
  (Proof photos and peer verification are active; see Activated deferred slices).
- Exceptions, Technical pauses, or provisional results. (Consequence safety pauses are
  active.)
- Crowns, performance baselines, activity-source ingestion, Seasons, standings, summaries,
  or leaderboards.
- Target streaks and Workout streaks.
- Reactions, messages, digests, or email reminders. (Push notifications are active.)
- User-authored text, Safety blocks, moderation cases, appeals, or content-screening
  operations. (Photo Content reports with Group-admin restore or removal are active.)
- Offline-first behavior, app-store distribution, native-device integrations, and advanced
  PWA lifecycle behavior beyond an installable shell and the included flows.
- Scored Validation-pilot operations, research analytics, automated operator dashboards,
  and production-shaped rehearsal machinery.

Excluded means deferred, not rejected.

## Activated deferred slices

Owner approval on 2026-10-13 activated three deferred slices, approval on 2026-10-15
activated lightweight reactions and nudges, and approval on 2026-10-20 activated every
remaining slice the PWA can deliver (rows below). Still deferred: Top Steps and activity-source
sync, native apps and app-store distribution, and Validation-pilot operations. Their
behavior is now active scope; the excluded list below applies only to what these slices
leave out.

| Slice | Active behavior | Owner decisions and recorded differences | Shipped in |
| --- | --- | --- | --- |
| Notifications | Web Push for a friend's check-in or proof to review, a last-24-hours reminder when under target, weekly Met/Missed, questioned-report votes and outcomes, new Card offers, 12 hours left on a card, and friends' card claims. | Push only; no digests, email, or in-app notification center. iPhone delivery requires a Home Screen install, so Home shows an install tip on iPhone Safari. | #215 |
| Proof photos and peer verification (lean v1) | Every check-in carries one camera Activity photo and one Member-presence photo with media-sharing consent. Verified after one other member verifies or 24 unquestioned hours; Questioned goes to a 48-hour strict-majority Group decision; Rejected owes a Consequence card; Unsupported does not count. Only Verified completions settle a week, and settlement waits for open reviews. Home is the proof feed; Verified proof stays 90 days. | Photo required on every check-in; live camera capture, re-encoded on device to strip metadata. Report-only moderation: a report hides the pair until the Group admin restores or removes it; no automated screening. Timed Workout sessions, multi-capture selection, descriptions, and appeals remain deferred. | #216 |
| Consequence system | Missed weeks and Rejected reports owe cards (backlog cap 5). The member is dealt three cards, may reroll the hand once, has 48 hours after locking one in, and two other members approve the claim. Missed deadlines owe another card; a safety pause stops the deadline. Owed counts are Group-visible. | Catalog release 2: 14 heavy physical cards with no lower-impact variant. Obligations recorded before cards were playable were waived at launch. | #215, #217 |
| Group governance | Group admins rename the Group, promote and demote admins (one always remains), and set the start day and time zone from the next week. Members see Membership events from their own membership onward. | A first week under a new schedule starts where the last one ended; a remainder under three days joins the following week. | Owner approval 2026-10-20 |
| Post deletion and review completeness | Authors delete their own pending, Verified, or Questioned post while its week runs; it stops counting at once so a replacement keeps them on track. Voters may record Cannot assess. Members may remove every shared Proof photo, or the photos of any one of their Verified posts at any time; the post stays Verified, so its week's count and outcome do not change. | Rejected reports cannot be deleted. | Owner approval 2026-10-20 |
| Exceptions | As in `CONTEXT.md`: six categories, optional 280-character note, sealed 48-hour Approve/Deny/Abstain ballots, strict majority, tie or timeout denies, settlement waits, approved weeks settle as Excepted and freeze both streaks. | Requests cover this week or next. | Owner approval 2026-10-20 |
| Week recap | For the first day after a week ends, Home shows each settled member week, met or missed. Each member may leave one changeable reaction of any emoji; the affected member gets a push per reactor. Replaces the five-day missed-week note with preset responses. | No free-text responses. | Owner approval 2026-10-20 |
| Streaks and Workout details | Target and Workout streaks (#247). Optional catalog lifts and cardio distance/time on posts, added within an hour. | Catalog values only. | #247; owner approval 2026-10-20 |
| Crowns and Seasons | Load Progression and Cardio Leap Crowns per settled week against each member's previous eight weeks; Seasons of four weeks with standings and champions. | Top Steps stays deferred: browsers have no step source. | Owner approval 2026-10-20 |
| Card unlock visibility | Members see the progression cards their streaks unlocked; one push per unlock. | Unlocks themselves were already active. | Owner approval 2026-10-20 |
| Notification center and digest | Every notification is listed in the app for 30 days; Immediate social pushes can be muted; optional daily digest at a chosen hour. | Reverses the earlier "no in-app notification center" decision. | Owner approval 2026-10-20 |
| Safety and member text | Group conduct rules, 140-character captions, 200-character messages on posts, Safety block, message and member reports opening operator Moderation cases. | Report-only moderation; no automated screening. | Owner approval 2026-10-20 |
| Operator console, export, sessions, PWA lifecycle | Operator queue and actions, Moderation holds, Technical and Service pauses; Account data export; timed Workout sessions with on-device photo picks; durable offline workout queue, app-icon badge, and update prompt. | Operators are assigned in `app_private.staff_assignments`. | Owner approval 2026-10-20 |
| Lightweight reactions and nudges | Members react to other members' proof with one of strong, fire, or cheer (one changeable reaction per member per post; counts are Group-visible) and nudge a member who is behind their current weekly target, once per sender, recipient, and UTC day. Each sends an Immediate social push to the recipient only: the first at once, later ones within 15 minutes bundled, at most three social pushes per rolling day; extra items stay in-app. | Reactions do not verify proof. Free-text motivational messages, playful responses, the daily Social and competition digest, separate social push controls, and Blocking remain deferred. | Slice 1 |

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
| Native delivery, app-store distribution, offline operation, and advanced PWA lifecycle | ADRs under `docs/adr/`; `docs/implementation/implementation-handoff-plan.md`; PWA research attached to roadmap issues | #36, #40, #67, #95–#106, #150 |
| Validation analytics, pilot operations, rehearsal, recovery, and activation | `CONTEXT.md`; all files under `docs/implementation/`; `docs/research/validation-observability-options.md` | #10, #34, #35, #39, #47, #49–#51, #85–#88 |

`CONTEXT.md` retains full definitions for Account, Group governance, competition, Proof,
verification, Consequences, safety, moderation, deletion, pauses, Exceptions, and Validation
pilot concepts. Existing closed GitHub issues retain discussion and resolution history.
Existing open issues retain implementation sequencing. No deferred detail should be deleted
when simplifying active code or tests; move obsolete active requirements behind explicit
deferred labels or references instead.

## Incremental reintroduction

Likely slices, ordered by learning value rather than commitment:

1. Lightweight reactions/reminders. (Active: reactions and nudges.)
2. Streaks and richer weekly history.
3. Exceptions.
4. Proof photos and Wall, with required safety/privacy/media lifecycle. (Active, lean v1.)
5. Peer verification and settlement. (Active.)
6. Consequence system. (Active.)
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
