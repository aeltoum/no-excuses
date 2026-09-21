# Hosted beta deployment runbook

This runbook activates ADR 0006's zero-cost hosted beta. It is not a production-readiness
claim. Recheck provider free-tier terms before provisioning. Use owner-controlled accounts with
MFA. Do not add payment methods, paid resources, trials that convert to paid service, custom
domains, or artificial keep-alive traffic.

Record final Cloudflare, Render, and Supabase URLs plus deployed Git commit in release evidence.
Use provider subdomains. Substitute final assigned URLs consistently if requested names are
unavailable.

## 1. Supabase and migrations

Create one Free project in AWS `us-east-1` (North Virginia). Save its project ref and database
password in a password manager. From a trusted clean checkout of the exact release:

```bash
export SUPABASE_ACCESS_TOKEN='<owner token>'
pnpm exec supabase link --project-ref '<project-ref>'
pnpm exec supabase migration list --linked
pnpm exec supabase db push --linked --dry-run
pnpm exec supabase db push --linked
pnpm exec supabase migration list --linked
unset SUPABASE_ACCESS_TOKEN
```

Review dry-run output: only committed forward migrations may appear. Stop on unexpected remote
history, destructive SQL, or target mismatch. Never run `db:reset`, `db:test:postgres`,
`db:test:pwa-settlement`, fixtures, or migration tests against hosted database.

In Supabase Auth URL Configuration:

- Site URL: final Cloudflare production origin, for example
  `https://no-excuses.pages.dev` (no trailing slash).
- Redirect URLs: same production origin plus only explicitly approved Cloudflare preview URLs.
  Never point production Auth at localhost or an untrusted wildcard preview.

## 2. Gmail OTP delivery

Use one dedicated standard Gmail account. Enable two-step verification. Create one app password.
In Supabase Auth SMTP Settings, enable custom SMTP and set Gmail SMTP host `smtp.gmail.com`, port
`465`, username to full Gmail address, password to app password, sender email to same address, and
sender name to `No Excuses`. Keep app password only in Supabase; never put it in Git, Cloudflare,
Render, screenshots, logs, or release evidence.

Before inviting members, request an OTP from deployed PWA to one address at each invited email
provider. Confirm message arrives, sender identity is expected, code works once, reused/expired
code fails, and message is not unexpectedly classified as spam. Gmail's standard-account daily
send quota is shared with manual mail; stop sending when quota blocks delivery. Do not fall back
to Supabase default SMTP.

## 3. Render API

Create Blueprint from repository `render.yaml`. Confirm one web service only: Free plan, Virginia,
Node `24.19.0`, configured build/start commands, `/v1/health`, checks-passed auto-deploy. Do not add
a Render database, disk, worker, cron job, or paid feature.

Set these Render environment values:

| Variable | Source | Boundary |
| --- | --- | --- |
| `DATABASE_URL` | Supabase direct/session-pooler connection string | secret, server only |
| `SUPABASE_URL` | Supabase project URL | server config |
| `SUPABASE_ANON_KEY` | Supabase anonymous key | public-capable, server also needs it |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase service-role key | secret, server only |
| `INVITATION_SECRET` | cryptographically random 32+ byte value | secret, server only; keep stable |
| `PWA_ORIGIN` | exact final Cloudflare production origin | server config; no trailing slash |

Render supplies `PORT`; do not override it. Confirm `GET https://<render-host>/v1/health` returns
HTTP 200. Confirm request with `Origin: https://example.invalid` returns HTTP 403. API CORS accepts
exactly `PWA_ORIGIN`; preview deployments must use synthetic data and a non-production backend.

## 4. Cloudflare Pages

Create one Pages Free project from repository. Use repository root as build root, command
`pnpm install --frozen-lockfile && pnpm --filter @no-excuses/web build`, and output directory
`apps/web/dist`. `_redirects` is copied into build output and rewrites direct SPA routes to
`index.html`.

Set only these Cloudflare build variables:

| Variable | Value | Boundary |
| --- | --- | --- |
| `VITE_API_BASE_URL` | final HTTPS Render origin | public |
| `VITE_SUPABASE_URL` | Supabase project URL | public |
| `VITE_SUPABASE_ANON_KEY` | Supabase anonymous key | public |

Any `VITE_` value is client-readable. Never set `DATABASE_URL`, service-role key,
`INVITATION_SECRET`, Gmail app password, provider token, or database password in Cloudflare.
Production secrets must not enter preview/PR builds.

After deployment, open `/`, `/sign-in`, `/group`, `/home`, `/target`, `/history`, and `/account`
directly over HTTPS in a fresh browser session. Each must return app shell without 404 or redirect
loop.

## 5. First organizer

Render Free has no shell. On trusted checkout, create temporary file outside repository:

```bash
BETA_ENV_FILE="$(mktemp)"
chmod 600 "$BETA_ENV_FILE"
```

Populate it with `DATABASE_URL`, `SUPABASE_URL`, `SUPABASE_ANON_KEY`,
`SUPABASE_SERVICE_ROLE_KEY`, the same `INVITATION_SECRET`, `PWA_ORIGIN`, and
`SEED_ORGANIZER_EMAIL`. Build exact release, then seed once:

```bash
pnpm api:build
node --env-file="$BETA_ENV_FILE" dist/api/delivery/src/server.js seed-organizer
```

Confirm success once; repeated seed must fail. Organizer then signs in through deployed PWA,
attests 18+, accepts pilot/product consent, and creates Group. Immediately delete temporary file
using OS trash/secure local procedure, clear shell history if values were pasted there, and remove
local Supabase link credentials when no longer needed. Remove `SEED_ORGANIZER_EMAIL` anywhere it
was temporarily stored. Never place seed email or hosted secrets in Render or Git.

## 6. Monitoring and manual exports

Free-tier monitoring is manual:

- enable owner email notifications for Render deploy/failure and quota events;
- enable Supabase project, inactivity, database-size, and egress notifications available on Free;
- review Cloudflare deployment failures and analytics available on Free;
- review Gmail security alerts, rejected OTPs, and sending quota;
- after each release and at least weekly during active beta, check API health, recent provider
  logs, Supabase status/usage, pending pauses, and Render/Supabase quota notices.

Supabase Free has no managed automatic backup or Point-in-Time Recovery. Record this as accepted
beta risk, never as passed. Tell participants experimental data may be lost. Before each release
and after material beta data changes, make best-effort manual logical export from trusted machine:

```bash
BETA_EXPORT_DIR="$(mktemp -d)"
chmod 700 "$BETA_EXPORT_DIR"
pnpm exec supabase db dump --linked --file "$BETA_EXPORT_DIR/no-excuses.sql"
shasum -a 256 "$BETA_EXPORT_DIR/no-excuses.sql"
```

Verify dump is nonempty and store encrypted outside repository with owner-only access. Record
timestamp and checksum, never dump contents. Delete expired copies per beta retention decision.
CLI dump is best-effort, not managed backup; restore remains unproved until separately rehearsed
in disposable non-production project. Stop and record limitation if current Free tier or CLI no
longer supports export.

## 7. One synthetic production smoke

Run once against exact deployed commit before real friend data. Use dedicated synthetic inbox and
synthetic names; do not run repository `LIVE_PWA_INTEGRATION` suite against hosted services.

1. Fresh browser: open production `/sign-in` directly over HTTPS; confirm app shell and no
   console, mixed-content, failed relevant network, or certificate errors.
2. Organizer signs in by emailed OTP, creates Group, issues invitation to synthetic inbox.
3. Synthetic member opens fresh private session, enters invitation token on first sign-in,
   receives Gmail-delivered OTP, attests 18+, accepts consent, and joins Group.
4. Organizer sets weekly target; synthetic member records one workout; both see consistent weekly
   progress after reload and session restoration.
5. From terminal, confirm `/v1/health` is HTTP 200 with allowed production `Origin`; confirm an
   invalid origin is HTTP 403. Allow documented Render cold-start delay after inactivity.
6. Synthetic member deletes Account in app. Confirm sign-in no longer succeeds and organizer no
   longer sees active member. Keep only sanitized timestamps/statuses in evidence; no OTP,
   invitation token, email, access token, or provider secret.

Any failure blocks admission of real data. Also validate installability, authorization denials,
weekly boundary, service resume, and account deletion per release gate; this scenario is only one
synthetic end-to-end smoke.

## 8. Rollback and shutdown

On bad web release, select prior successful Cloudflare deployment and roll it back. On bad API
release, use Render rollback to prior healthy deploy where Free supports it; otherwise redeploy
prior known-good Git commit. Never roll database migrations backward in place. Stop writes,
preserve export, fix through a new forward migration, deploy API compatibility first, then PWA.
Re-run health, CORS, direct-route, OTP, and synthetic smoke checks after rollback.

If compromise is suspected: stop service, rotate affected Supabase/Render secrets, revoke Gmail
app password and provider tokens, invalidate outstanding invitations by rotating
`INVITATION_SECRET` only with explicit acceptance, then investigate sanitized logs. At beta end,
export if appropriate, notify participants, revoke Gmail app password, remove hosted services,
and retain/delete exports according to recorded retention decision.
