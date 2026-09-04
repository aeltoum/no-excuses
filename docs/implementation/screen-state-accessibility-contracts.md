# Screen, state, and accessibility contracts

This document is the implementation contract resolved by [Define screen, state, and accessibility contracts](https://github.com/aeltoum/no-excuses/issues/48). It translates the product glossary, accepted architecture decisions, and implementation requirements into a complete low-fidelity surface model for the iOS and Android private pilot. It does not specify final visual design, production components, or copy.

## Decision summary

Use a **task-first member shell** and a physically separate **operator shell**.

- Member navigation has four stable destinations: **Home**, **Group**, **Season**, and **You**. A persistent global banner region above route content carries offline, deadline-pause, restricted-access, and update-required states. The current route and every status are expressed in text, never by icon, color, position, motion, sound, or haptics alone.
- Home preserves the approved hierarchy: **Needs you**, personal weekly progress, friend Proof feed, then compact Season standings. A new Group-visible item never steals focus or displaces an in-progress action.
- Tasks deep-link to a full screen. Bottom sheets and dialogs are reserved for reversible choice, explanation, or a single confirmation; they never contain a multi-step core flow.
- Drafting is local and auto-saved. Consequential commands receive a review screen, one submission, visible pending state, authoritative server acknowledgement, and a stable receipt. Safety block and **Cannot safely perform** remain immediate and omit confirmation.
- Operator access is a separate authenticated entry, navigation model, and visual identity. Member routes never reveal operator controls; operator routes never simulate Group membership.

No new domain term or ADR is required. These are reversible presentation and interaction contracts under the accepted product and architecture decisions.

## Global route and navigation model

### Member shell

| Destination | Purpose | Stable routes |
| --- | --- | --- |
| Home | Next required action, current week, Proof feed, compact standings | `/home`; `/tasks/:task-id`; `/notifications` |
| Group | Members, invitations, settings, conduct and safety | `/group`; `/group/members`; `/group/invitations`; `/group/settings`; `/group/conduct` |
| Season | Current standings, weekly Crown results, membership-bounded summaries | `/season`; `/season/weeks/:week-id`; `/season/summaries/:season-id` |
| You | Account, notification/accessibility preferences, source permissions, support, privacy, export, deletion | `/you`; `/you/preferences`; `/you/activity-sources`; `/you/privacy`; `/you/support`; `/you/account` |

The tab bar stays available on top-level routes. Pushed task and detail screens use a labeled Back action that returns to the exact prior scroll and focus location. Deep links reconstruct required context; if access has ended, they show a neutral unavailable screen rather than another Group's content or a generic error.

### Operator shell

| Destination | Purpose | Stable routes |
| --- | --- | --- |
| Work queue | Assigned and due support, moderation, deletion, pause, and incident work | `/operator/work`; `/operator/work/:case-id` |
| Service health | Aggregate health, due-work backlog, alerts, deletion compliance | `/operator/health`; `/operator/incidents/:incident-id` |
| Procedures | Approved runbooks and handoff contacts | `/operator/procedures`; `/operator/procedures/:procedure-id` |
| Audit | Purpose-scoped command receipts and restricted audit lookup | `/operator/audit` |

Every operator case starts with purpose, scope, reason, assignment, expiry, and reauthentication state. Group or member drill-down is absent until those gates pass. Operator surfaces never provide peer verification, Exception, Consequence, Crown, or Group-admin actions.

### Navigation rules

1. One URL/route identifies each resumable state. Notifications and verified links land on the relevant task, then return to the prior route.
2. A destructive or locked transition uses **review → submit → pending → receipt**. Back from review preserves the editable draft. Duplicate taps and retries retain one idempotent submission.
3. Switching tabs never discards a draft or active Workout session. The Home **Needs you** panel links back to unfinished work.
4. System back follows route history. It never means submit, discard, vote, or confirm.
5. Navigation labels do not change with badge count. Badges supplement text such as “2 tasks need you.”

## Complete screen inventory

Each row names the minimum distinct screen contract. Variations listed under **required states** are implemented and tested; they are not separate high-fidelity designs.

### Entry, identity, and Group setup

| ID | Screen | Primary action | Required states |
| --- | --- | --- | --- |
| E01 | Launch and session restore | Continue to authorized destination | checking session; offline with usable local draft; signed out; access revoked; required update; service unavailable |
| E02 | Invitation landing | Verify invited email | valid; expired; revoked; used; Group full; already in another Group; country held/unavailable; offline |
| E03 | Email OTP request | Send code | ready; sending; sent with resend time as text; rate limited; unknown/ineligible address; network failure |
| E04 | Email OTP verification | Verify code | ready; verifying; invalid; expired; retry available; locked/rate limited; network failure |
| E05 | Pilot and product consent | Accept each required purpose | unread; partially accepted; version changed; declined; accessibility help; submission failure |
| E06 | Age confirmation | Confirm 18 or older | ready; under-18 denial; submission pending/failure |
| E07 | Group invitation review | Continue to targets | Group summary; admin inviter; capacity changed; invitation invalidated; exact membership effect |
| E08 | Joining-week targets | Set recurring and reduced target | normal; warning for one/high/sharp increase; validation error; exact Group-zone deadline; last-minute join |
| E09 | Join review and receipt | Accept invitation | review; submitting; accepted/active; accepted/accountability resumed; capacity or membership conflict; retry-safe failure |
| E10 | Create Group | Create private Group | draft; validation; creating; created/setup; failure |
| E11 | Create first target | Save recurring target | normal; warning; submitting; Group setup receipt; failure |

### Weekly accountability and Workout Proof

| ID | Screen | Primary action | Required states |
| --- | --- | --- | --- |
| H01 | Weekly home | Open highest-priority task | active; setup/one member; accountability paused; activation target pending; settlement; provisional; finalized; offline/stale; Technical/Service/Moderation hold; empty feed; enlarged text |
| H02 | Notification center | Open related task | unread/read; grouped; empty; stale/invalid target; notifications disabled |
| W01 | Weekly target edit | Schedule next target | unchanged; draft; warning; scheduled; boundary passed; failure |
| W02 | Workout-session start | Start acknowledged session | eligible; target pending; offline; another session active; starting; server refusal; started receipt |
| W03 | Active Workout session | End session | elapsed time; offline; background/resume; 12-hour expiry; capture available/unavailable; upload not required |
| W04 | Camera and capture review | Keep or retake capture | permission undecided/denied/restricted; camera unavailable; ready; captured; processing; failed; Activity/Member-presence requirement remaining |
| W05 | End session and select Proof | Create report draft | neither/one/both required photos selected; descriptions missing; end-time edit; invalid end; local save failure; session expired |
| W06 | Workout report editor | Review report | strength; cardio; class; sport; mixed; incomplete; auto-saved; save failed; reporting cutoff passed; membership ended |
| W07 | Report review | Submit locked report | complete summary; policy check; upload queued/progress/interrupted/resuming; rejected content; quarantined; durable-storage failure; duplicate submit |
| W08 | Report receipt/detail | View review status | submitted; pending review; Questioned; Verified; Unsupported; Rejected; withdrawn; media expired/deleted; blocked-content suppression |
| W09 | Peer report review | Accept, Reject, or Cannot assess | media loading/unavailable/deleted; both Proof photos; descriptions; Safety-block suppression; vote pending/recorded/changeable/closed; own report denial |
| W10 | Question report | Submit factual question | draft; conduct warning/rejection/quarantine; review; submitting; sent; failure |
| W11 | Withdraw report | Confirm withdrawal | effect review; submitting; withdrawn; already resolved; failure |

### Exceptions, Consequences, and safety

| ID | Screen | Primary action | Required states |
| --- | --- | --- | --- |
| X01 | Exception request editor | Review request | category missing/selected; optional note; 280-character limit; Safety-block implications; conduct rejection/quarantine; auto-save/failure; request window closed |
| X02 | Exception request review | Submit request | audience and deadline summary; no-proof statement; submitting; duplicate; accepted; failure |
| X03 | Exception detail and vote | Approve, Deny, or Abstain | eligible; requester; later joiner; blocked-note suppression; aggregate pending; ballot change; quarantined; approved; denied/tied/timed out; withdrawn; reason expired |
| C01 | Missed-target event | View Card offer | neutral event; responses available/suppressed; reason-free; event closed; membership-bounded unavailable |
| C02 | Consequence Card offer | Choose, redraw, or Cannot safely perform | three safe offers; redraw available/used; backlog position; no countdown-only cue; safety action immediate |
| C03 | Consequence Card detail | Start or submit | available; active; expired; paused; media permission; draft; cutoff approaching; membership ended |
| C04 | Consequence Proof editor/review | Submit Proof | capture; description/transcript; review; upload/retry; policy rejected/quarantined; submitted |
| C05 | Consequence peer review | Approve, Reject, or Cannot assess | eligible/ineligible; evidence available/unavailable; aggregate decision; replacement window; completed/closed |
| S01 | Safety controls | Block or get help | unblocked; blocked; unblock; reporting paths; urgent-danger guidance; offline local enforcement with server sync pending |
| S02 | Content report | Submit report | artifact/conduct target; bounded reason; optional factual note; review; sent; confidential status; unavailable artifact; failure |
| S03 | Restricted/held access | Follow next safe step | Moderation hold; underage suspension; termination pending appeal; terminated; appeal available/expired; no private case detail |

### Group, social, competition, and membership

| ID | Screen | Primary action | Required states |
| --- | --- | --- | --- |
| G01 | Group overview | Open member or setting | setup; active; paused; 2–10 members; role labels; pending tasks; offline/stale |
| G02 | Members | Open allowed member actions | current; joined-this-week; admin/member; blocked relation; departing; Former member in history |
| G03 | Invitations | Create/revoke invitation | admin; non-admin denial; capacity full; active/expired/revoked/accepted; offline; create/revoke pending/failure |
| G04 | Member administration | Promote, demote, or remove | permitted; last-admin denial; admin-demotion-first requirement; review; pending; receipt; stale conflict |
| G05 | Leave Group | Confirm departure | effect review; last/sole member; unresolved work cleanup; reauthentication if closure; pending; receipt/failure |
| G06 | Group settings | Schedule week setting change | current/scheduled; admin/non-admin; Group-zone preview; boundary effect; failure |
| G07 | Conduct and policies | Accept or review | current; acceptance required; version changed; declined/content creation restricted; offline cached copy |
| F01 | Proof feed item/detail | React, motivate, review, question, report, or block | own/peer; new/seen; media loading/failure/deleted; blocked text; action pending/failure; finalized |
| N01 | Social composer | Send permitted text | empty; conduct warning/rejected/quarantined; offline; pending; sent; failure |
| R01 | Current Season standings | Open category/week detail | active; paused; insufficient data; ties; new member; source missing/stale; finalized |
| R02 | Crown week detail | Inspect result explanation | eligible/ineligible; baseline establishing; tie; provisional/final; missing/late source; category explanation |
| R03 | Season summary | Review membership-era summary | champion/co-champions; prior membership denial; current/new/returned member visibility; empty first Season |

### Account, preferences, data, and support

| ID | Screen | Primary action | Required states |
| --- | --- | --- | --- |
| A01 | Account and verified email | Start sensitive change | current; reauthentication required; OTP pending; change conflict; receipt |
| A02 | Notification preferences | Save channels/schedule | permission undecided/denied; social/action controls independent; daily caps explained; Group-zone schedule; failure |
| A03 | Accessibility preferences/help | Follow platform settings/help | screen reader; text size/reflow; reduced motion; captions/transcript; haptic/audio supplements; Technical-pause support path |
| A04 | Activity sources | Connect, sync, or disconnect | unsupported platform; permission undecided/partial/denied; connected; syncing; stale; missing data; revoked; disconnect review |
| A05 | Privacy and data use | Request export or review policy | current/version changed; processor/country status; export unavailable/pending/ready/expired; offline cached policy |
| A06 | Account deletion | Confirm deletion after reauth | effect review; reauth; pending; access revoked receipt; retry/status through public web path; completed |
| A07 | Support | Submit request | ordinary/critical category; factual note; offline draft; sent with response target; status; resolved |
| A08 | Global sign-out | Sign out all devices after reauth | review; reauth; pending; receipt; failure |

### Operator work

| ID | Screen | Primary action | Required states |
| --- | --- | --- | --- |
| O01 | Operator sign-in | Complete email OTP and TOTP MFA | signed out; OTP; MFA; invalid/expired; locked; no active assignment |
| O02 | Work queue | Open assigned item | aggregate only; empty; due/overdue; severity; backup handoff; stale; service unavailable |
| O03 | Purpose gate | Enter approved reason and reauthenticate | no assignment; invalid purpose; expired scope; authorized receipt; failure |
| O04 | Moderation case | Perform named allowed command | quarantined content; restricted evidence; policy category; timers; appeal; command pending/receipt; explicit forbidden-action absence |
| O05 | Support/deletion case | Perform named runbook step | identity scoped; access cutoff; processor progress; retry; seven/30-day clocks; failure/escalation; completion |
| O06 | Pause control | Start/resume scoped pause | Technical/Service/Moderation type; affected deadlines; remaining time; review; active; resume receipt; stale conflict |
| O07 | Service health | Follow runbook | aggregate healthy/degraded/outage; five-minute check stale; alert delivered/unacknowledged; no member-content drill-down |
| O08 | Incident | Record containment/handoff | open; acknowledged; contained; updates due; repair witness; resolved; post-incident follow-up |
| O09 | Audit lookup | Review scoped receipts | query requires purpose; empty; result; expired evidence; export denied; access audited |
| O10 | Country register | Recheck eligibility | cleared; held; unavailable; recheck due; source/date/reason; enrollment blocked |

## State behavior shared by every screen

### Data freshness and loading

- Preserve the prior safe screen while refreshing. Show a labeled progress indicator only in the region being refreshed.
- First load uses a structural placeholder excluded from accessibility traversal, followed by a single announcement: “Content loaded” only when the result is not otherwise obvious.
- A refresh never resets scroll, focus, typed input, selections, media capture, or an active session.
- Each authoritative timestamp includes absolute local time and Group-zone context where deadlines differ. Relative time is supplemental.
- Stale cached data is visibly labeled with last successful sync. Consequential actions unavailable offline explain why and retain drafts.

### Empty, unavailable, and denied

- **Empty** states distinguish “nothing yet” from “you cannot see this” and “data is delayed.” They include one valid next action, or state that none is required.
- **Permission denied** screens retain all non-dependent functionality, explain the exact lost capability, and offer system-settings instructions. No repeated permission prompt loop.
- **No authority** states name the required role or membership condition without exposing hidden object existence or private data.
- **No longer available** replaces stale deep-linked private content after departure, retention deletion, moderation removal, or audience loss. It provides a safe destination.

### Failure, retry, and conflict

- Field errors appear beside fields and in a focusable summary. Submission failures keep every draft value and selected local media.
- Retry repeats the same idempotent command. The UI never suggests creating a second report, ballot, invitation, or operator action.
- A version conflict shows authoritative current state, explains whether the intended action still applies, and offers **Review current state**. It never silently overwrites.
- Unknown or prolonged state becomes **Still working** with a reference, safe navigation away, and later status recovery. It never claims success before acknowledgement.
- Fatal errors offer copyable reference, support path, and safe sign-out where applicable; no stack trace or sensitive identifier appears.

### Offline and synchronization

- Offline-safe: viewing previously authorized cached data, editing local drafts, capture during an acknowledged active Workout session, and immediate local Safety blocking.
- Online-required: session start, invitation acceptance, report/Proof submission, votes, finalization, role or membership changes, sensitive account actions, activity sync, and operator commands.
- Pending work survives app restart. Each item shows created time, last attempt, current stage, and one safe retry/cancel choice where cancellation is valid.
- Reconnection synchronizes in dependency order and surfaces any expired deadline or revoked authority before upload. No optimistic final outcome.

## Interaction contracts

### Consequential action pattern

Use a dedicated review screen for report submission, evidence questioning, final ballot submission or change, report withdrawal, invitation acceptance, leaving/removing a member, role change, source disconnect, sign-out-all, Account deletion, and every operator command. Review copy states the object, audience, deadline, reversibility, and exact result.

Buttons use action-result labels: **Submit Workout report**, **Approve waiver**, **Remove Jordan from Group**, not **Yes**, **Done**, or icon-only controls. Disabled buttons are accompanied by the unmet condition in text.

### Focus and announcements

- Screen entry focuses the route title only when navigation initiated a new route; returning restores originating control and scroll position.
- Opening a dialog focuses its title; closing restores its trigger. Focus is trapped only inside modal dialogs.
- Validation failure focuses the error summary. Successful consequential action focuses the receipt heading. Inline success without route change focuses the updated status only when person-initiated.
- New feed items, background refreshes, timers, upload progress, and incoming reactions never move focus. Polite announcements are coalesced; urgent assertive announcements are reserved for immediate safety/access loss.
- Status announcement format: object, state, consequence, next action. Example: “Workout report upload paused. Your draft and both photos are saved on this device. Retry when online.”

### Input, targets, and gestures

- Every action has a labeled single-tap and alternative-input path. Swipe, drag, long press, shake, device motion, and precision gestures are optional accelerators only.
- Minimum interactive target: 48 by 48 device-independent pixels, with spacing preventing adjacent activation. Visible focus indicator remains unobscured.
- Lists use explicit **Move up/down** only where ordering is essential; no core MVP flow currently requires drag ordering.
- Keyboard order follows visual/semantic order. Hardware Back/Escape closes transient UI before leaving the route; it never discards without warning.

### Media alternatives

- Each submitted Activity photo and Member-presence photo requires a concise factual description, typeable or dictatable, locked on submission with capture/session timestamps.
- Meaningful Consequence-video audio requires captions or transcript. Video never autoplays; play/pause, seek, mute, captions, and transcript are labeled.
- Camera announces readiness, capture success, elapsed recording time, and remaining media. Audio/haptic cues supplement visible text and can be disabled.
- Reviewer option **Cannot assess this evidence** is equally reachable, neutral, reminder-stopping, and changeable until decision closure.
- Descriptions and structured details enable understanding but never independently verify visual Proof. MVP supplies no nonvisual substitute evidence.

### Motion, sound, and haptics

- Honor system reduced-motion setting without a separate prerequisite. Replace spatial transitions, parallax, count-up, confetti, and animated rearrangement with instant changes or a subdued opacity fade no longer than 150 ms.
- No flashing content. Video starts only by user action.
- Sound and haptics are optional confirmations with matching visible text and assistive announcement. Silent operation remains complete.

## Responsive layouts

### Compact width and default text

Single column. Bottom tabs remain stable. **Needs you** fills width; progress precedes feed; standings use a compact ranked list. Activity photo dominates two-photo Proof, with Member-presence photo secondary.

### Wide phone, tablet, and windowed layout

Use a bounded reading column plus one contextual rail. Home rail contains weekly progress and standings; main column keeps **Needs you** and feed. Editors place preview beside fields only when reading order stays fields → review. Navigation becomes a labeled rail only when all four destinations remain continuously visible.

### Enlarged text and constrained width

At roughly 200-percent text, reflow to one column; replace bottom tabs with a labeled scroll-safe destination menu if labels no longer fit; stack both Proof photos with Activity first; convert tables to labeled definition lists; move trailing actions below content; allow vertical growth without clipping or horizontal scrolling. Text never overlays media.

### Orientation and device accommodation

Core flows support portrait and landscape except camera capture, which may follow sensor orientation while retaining labeled controls. Respect safe areas, keyboard occlusion, Dynamic Island/notches, Android edge-to-edge insets, platform font scaling, and display zoom. Do not encode meaning in platform-specific gesture placement.

## Platform accommodations

| Concern | iOS | Android | Shared contract |
| --- | --- | --- | --- |
| Navigation | Standard back gesture plus visible Back | System Back plus visible Back | Same route/history result; no consequential action on back |
| Screen reader | VoiceOver names, traits, rotor-friendly headings | TalkBack names, roles, traversal order | One concise accessible name; state/value separate; no duplicate announcements |
| Alternative input | Voice Control labels match visible text; Switch Control groups sparingly | Voice Access labels match visible text; Switch Access logical groups | Visible unique labels; no gesture-only operation |
| Text | Dynamic Type, including accessibility sizes | Font scaling and display size | Reflow around 200 percent; no clipped action/status |
| Motion | Reduce Motion | Remove animations/reduced motion scale | Instant/subdued transitions; no lost status |
| Permissions | Pre-permission explanation then system prompt | Pre-permission explanation; support one-time/limited choices where offered | Ask in context; degraded path; settings recovery; no prompt loop |
| Camera/media | App-private files; platform capture semantics | App-private files; lifecycle/process-death recovery | No library import; no location/hidden metadata; drafts remain device-bound |
| Notifications | Authorization and per-app settings recovery | Runtime notification permission where required plus channels | In-app task remains authoritative; generic private lock-screen copy |
| Activity source | HealthKit purpose-specific read access | Health Connect purpose-specific read access | Optional; partial/missing data means ineligible, never zero |

## Accessibility semantics

- Every screen has one level-one-equivalent route title and ordered section headings. Card collections expose list position only when useful.
- Proof accessible name combines evidence type, author, status, and description. It does not infer identity, exercise quality, body, location, or health.
- Progress exposes text such as “2 of 3 Verified completions” rather than a percentage alone. Season ranks expose ties explicitly.
- Status chips expose name and state once. Decorative icons/images are hidden. Member-presence media uses its authored factual description, not automated recognition.
- Live regions are scoped: polite for person-initiated completion and connection state; assertive only for immediate access/safety interruption. Repeated progress updates are throttled to meaningful stage changes.
- Errors identify the field, problem, and correction. Instructions never depend on “above,” “below,” shape, or color alone.

## Permission decision table

| Permission | Ask when | Denied/restricted path |
| --- | --- | --- |
| Camera | Member chooses first capture inside acknowledged session | Explain Proof cannot be created; retain active session; settings path; Support and Technical-pause path if product access defect, not permission refusal |
| Microphone | Member starts Consequence video requiring audio | Allow silent video where meaningful evidence remains; otherwise explain requirement; captions/transcript still required for meaningful audio |
| Notifications | After member reaches active Group context and sees value | Full in-app tasks/reminders remain; settings path; never block accountability flow |
| HealthKit/Health Connect | Member chooses one Crown source | Crown category shows permission missing/ineligible; target/accountability continues; granular reconnect/disconnect |
| Photos/library | Never for Workout Proof | No request. Proof must originate from in-app session capture |
| Location | Never | No request or fallback; location metadata removed |

## Privacy and content presentation

- Lock-screen notifications contain no Group name, category, note, exercise detail, Proof, moderation reason, or member identity unless future explicit consent changes this contract.
- Skeletons, analytics, crash diagnostics, screenshots, task switcher previews, and logs must not leak Proof, descriptions, Exception text, messages, email, activity/health details, or restricted operator material.
- Safety-block suppression removes optional free-form content from the blocker while preserving required structured accountability state. Layout does not reveal hidden text length.
- Media-deleted states retain permitted structured record and description only for its approved lifetime; they never show broken private object URLs.

## Representative prototype scenarios

The companion throwaway prototype covers three structurally different renderings of the same weekly-home route and five hard states:

1. active week with one report needing review;
2. offline active Workout-session draft;
3. enlarged-text reflow with two-photo Proof;
4. Exception vote with blocked optional note;
5. Service pause with preserved deadline time.

Recommended variant is **A: Task first** because it best preserves accepted semantic order, gives one dominant next action, keeps friend Proof central, and lets standings remain visible without becoming a public-status contest. Variant B tests feed-first density; Variant C tests a command-center split layout. Both remain primary-source alternatives, not implementation choices.

## Pilot-readiness acceptance

Implementation is conformant only when:

1. every inventory row has a reachable authorized path and every listed state has deterministic fixture coverage;
2. every core member flow completes end-to-end on representative physical iOS and Android devices with VoiceOver/TalkBack, roughly 200-percent text, reduced motion, and supported voice, switch, or keyboard-style input;
3. focus, announcements, 48-by-48 targets, color-independent meaning, and permission recovery pass manual review;
4. offline/retry/conflict tests prove no lost draft, duplicate consequential command, false success, premature finalization, or cross-membership disclosure;
5. operator tests prove purpose gating, MFA, audit receipts, expiry, aggregate-default views, and absence of peer-accountability powers;
6. screenshots and recordings at compact portrait, landscape, enlarged-text compact, and wide/tablet layouts show no clipping, overlap, inaccessible action, or semantic-order drift; and
7. every failure state provides a safe next step, retained work where permitted, and no sensitive diagnostic detail.

Automated accessibility checks supplement but never replace manual device completion. Any inaccessible core flow blocks pilot readiness.

## Traceability

This contract operationalizes `ACCESS-01` through `ACCESS-04` and every capability row in the implementation requirements and acceptance matrix. It preserves the accepted weekly-home prototype, two-photo Proof amendment, accessible interaction/media resolution, React Native/Expo architecture, server-authoritative state, bounded offline capture, live PostgreSQL authorization, private media lifecycle, deadline/pause model, and privacy-minimized operator model.
