# What depends on manual proof verification today (#267)

Sources: repo at branch base `claude/blissful-cori-5ocicf`. Note: there is no `apps/api`; HTTP API lives in `packages/delivery/src/server.ts`. Later migrations re-`create or replace` several functions (`proof_feed` in `20261029000000_post_deletion.sql`, `finalize_ended_member_weeks` in `20261106000000_operator_console.sql`); cited lines are where the rule lives.

## 1. State machine (`app_private.proof_review_status`)

States: `pending, verified, questioned, unsupported, rejected` — `supabase/migrations/20261015000000_photo_proof.sql:8`. Column default `'verified'` (legacy rows) — `:14`.

| Transition | Where |
|---|---|
| submit → `pending` (`verified_at = null`) | `submit_proof_checkin` `photo_proof.sql:144-146` |
| `pending` → `verified` by one peer "verify" (within 24h, not author, joined before submit) | `review_proof_checkin` `photo_proof.sql:204-230` |
| `pending` → `questioned` by one peer "question"; snapshots voter audience (all other current members) | `photo_proof.sql:231-240` |
| `pending` → `verified` after 24h unquestioned (`verified_at = submitted_at+24h`) | `advance_proof_reviews` `photo_proof.sql:347-355` |
| `questioned` → `verified` / `rejected` on strict majority of audience; → `unsupported` when all voted or 48h pass | `resolve_proof_decision` `photo_proof.sql:154-201` |
| `rejected` → adds `rejected_report` Consequence obligation | `photo_proof.sql:194-199` |
| votes (accept/reject, changeable) | `vote_proof_checkin` `photo_proof.sql:246-271`; table `proof_votes` `:40` |
| author withdraws `questioned` → `unsupported` | `withdraw_proof_checkin` `photo_proof.sql:274-288` |
| departed member's pending reports become Unsupported | `CONTEXT.md:24` |

Key constraint: questioning is only possible while `pending` (`photo_proof.sql:222-225`). A `verified` row can never be questioned today.

## 2. Consumers of `verified` / `pending`

- **Week finalization / targets**: week waits while any report is `pending`/`questioned` (`photo_proof.sql:497-506`; re-declared `20261106000000_operator_console.sql:235`); counts only `verified` (`photo_proof.sql:520`; `operator_console.sql:262`). Header comment "a week waits for its open reviews (at most 72 hours)" `photo_proof.sql:481`. Provisional result: `CONTEXT.md:260`.
- **Streaks**: workout streak counts only `verified` (`20261027000000_streaks.sql:45`, `:107`); live progress counts non-unsupported/rejected (`streaks.sql:60`).
- **Crowns**: activity rows filter `review_status = 'verified'` (`20261102000000_crowns_seasons.sql:60,71,82`); Performance-gain uses Verified completions (`CONTEXT.md:68`).
- **Nudge eligibility / reminders / notification counts**: count non-unsupported/rejected, i.e. pending counts optimistically (`20261021000000_nudge_eligibility.sql:22`; `photo_proof.sql:736`; `20261104000000_notification_center.sql:128`).
- **Wall visibility** (`proof_feed`): pending/questioned visible only to members joined before submit; `verified` visible 90 days from `verified_at` (`photo_proof.sql:437-442`; `post_deletion.sql:142-147`). `can_review`/`can_vote` flags `photo_proof.sql:421-430`.
- **Media retention**: 90 days from `verified_at`; unsupported/rejected → delete (`photo_proof.sql:449-460`; `20261024000000_keep_proof_history.sql:13`). Own-photo removal only when `verified` (`20261110000000_remove_own_photos.sql:16`; UI `apps/web/src/Wall.tsx:459`).
- **Post deletion**: allowed states `pending, verified, questioned` (`20261029000000_post_deletion.sql:21,34`).
- **Notifications** (`enqueue_push_notifications` `photo_proof.sql:656+`): new-workout review push `:662-681`; "workout was questioned — vote within 48h" `:685-698`; author outcome push for questioned/rejected/unsupported `:702-724`. Web: `apps/web/src/Notifications.tsx:33`.
- **API** `packages/delivery/src/server.ts`: feed mapping `reviewStatus`/`canVote` `:945-954`; actions review/vote/withdraw `:1116-1121`.
- **Web UI**: type `apps/web/src/proof.ts:20` (`pending|verified|questioned`), `:29`; Wall status badge "Review · Xh / Awaiting review / Questioned / Verified ✓" `Wall.tsx:623-632`; optimistic verify/question `Wall.tsx:240-256`; vote UI `Wall.tsx:443`, `:804-810`, toast `:706`; Weekly review queue `Weekly.tsx:451-461`; copy "Only workouts your friends verify, or that go unquestioned for 24 hours, count." `Weekly.tsx:991`.
- **Operator console** open-review checks `operator_console.sql:235,262`.
- **CONTEXT.md terms**: Verified completion `:139-140`; Questioned report `:144`; Unsupported report `:151-152`; Rejected report `:156`; Provisional result `:260`; Workout streak `:104`; Target attainment `:96`; Weekly target `:108`; Wall `:128`; Proof photo retention `:124`; Trust integrity `:216`; Group admin/operator have no verification authority `:16`, `:224`.

## 3. Reusable group-vote mechanisms

1. **Proof decision itself (best fit)** — `questioned` + `proof_decision_audience` + `proof_votes` + `resolve_proof_decision` already implement "question → strict-majority vote → Rejected (Consequence) / Verified / Unsupported" (`photo_proof.sql:154-271`). Only the entry gate (`review_status <> 'pending'` + 24h window, `:222-225`) blocks questioning a Verified post.
2. **Exceptions** — `exception_requests`/`exception_ballots`, sealed Approve/Deny/Abstain, strict majority, tie/timeout denies (`20261030000000_exceptions.sql:9,33,54-88,137-177`; `CONTEXT.md:268`). Different semantics (approve a waiver).
3. **Consequence pause votes** — `consequence_pause_votes` (`20261017000000_consequence_log_gate.sql:47`) and Consequence completion claim review (two reviewers, `CONTEXT.md:192`; `20261113000000_consequence_next_card.sql:44-117`).

## 4. Rules that change if proof is Verified on submit

1. Submit sets `verified`, `verified_at = submitted_at` (`photo_proof.sql:144-146`); `pending` and 24h auto-verify (`:347-355`), single-peer "verify" action (`:226-230`) become dead.
2. Question must be allowed from `verified` (`:222-225`); question must revert completion to provisional (Questioned already excluded from verified counts). Decide window (24h? until week finalization?) — otherwise finalized weeks, streaks, Crowns would need recalculation, which CONTEXT says never changes (`CONTEXT.md:24`).
3. `finalize_ended_member_weeks` no longer waits on `pending` (`photo_proof.sql:504`, `operator_console.sql:235`) — weeks finalize faster unless question window held open.
4. Streaks/Crowns/targets credit immediately (`streaks.sql:45,107`; `crowns_seasons.sql:60-82`); a later Rejected/Unsupported must subtract, so live counts become "verified minus questioned".
5. Wall: pending-specific joiner rule (`photo_proof.sql:439-440`) collapses into the Verified 90-day rule; post-submit joiners see items immediately. 90-day retention clock starts at submit (`CONTEXT.md:124`, `photo_proof.sql:459`).
6. Notifications: new-workout "review" push (`:662-681`) becomes informational; questioned/outcome pushes unchanged.
7. UI: drop Verify button / "Awaiting review" / countdown (`Wall.tsx:623-632`, `:240-256`), Weekly review queue (`Weekly.tsx:451-461`), copy `Weekly.tsx:991`; `proof.ts:20` type.
8. CONTEXT.md: rewrite Verified completion (`:140`), Questioned report "during initial 24-hour review period" (`:144`), Wall/Proof photo text, departure rule "pending Workout reports become Unsupported" (`:24`), Trust integrity (`:216`).
9. Tests referencing pending flow: `tests/photo-proof.test.ts`, `tests/streaks*`, `tests/weekly-settlement.test.ts`, `apps/web/tests/wall.spec.ts`, `apps/web/tests/optimistic.spec.ts`.
