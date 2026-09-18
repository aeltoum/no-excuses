# Naturally elapsed weekly outcome: pending

Issue #158. Candidate base commit: `f1293f2` on `codex/pwa-integrated-acceptance`; pending evidence preparation continues on that branch. Local-only synthetic fixture created 2026-09-18 against local Supabase Auth, PostgreSQL schema version 15, and the deployable API at `http://127.0.0.1:8787`. No hosted service, database reset, or real user data was used.

The two-member Group uses `Pacific/Kiritimati`. Its current accountability week starts **2026-09-13 10:00 UTC** and ends naturally **2026-09-20 10:00 UTC** (Monday 00:00 local). Each member has locked target 2. The organizer recorded two self-reported workout check-ins through the real API; the invited member recorded none. Before the boundary, PostgreSQL reports one active week and two active member weeks: organizer 2/2, peer 0/2. Authenticated finalized-history API returned an empty list. No clock override or early finalizer call was used.

Expected after natural boundary and the API's ordinary weekly close: organizer **Met** (`attained`, 2/2), peer **Missed** (`missed`, 0/2), with both rows in finalized history. **Outcome is NOT RUN** until 2026-09-20 10:00 UTC or later. Naturally elapsed browser presentation also remains NOT RUN.

Private local state and maintenance scripts are outside Git, mode `0600`:

- `/tmp/no-excuses-natural-week-20260920.json`: exact synthetic identifiers and email addresses, no access token or OTP.
- `/tmp/no-excuses-natural-week-verify.mjs`: refuses execution before the boundary; obtains fresh local OTP and checks the real authenticated history API for both outcomes.
- `/tmp/no-excuses-natural-week-cleanup.mjs`: checks fixture identity, removes only its SQL rows transactionally, then deletes its two synthetic Auth identities. Run only after final evidence is captured.

To resume, start local Supabase **without reset**, build/start the existing API using local `supabase status` values in process environment, then run the private verify script with `SUPABASE_ANON_KEY` set from that local status. API startup/minute maintenance will close the week using actual time. If verification passes, capture sanitized browser History evidence at `http://127.0.0.1:4174/` before running cleanup with local `DATABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY`. Keep keys, OTP, synthetic emails, and identifiers out of screenshots and repository logs. The private scripts and state are local temporary artifacts; preserve them until verification and cleanup finish.

Physical iPhone Safari remains NOT RUN and is a separate release gate.
