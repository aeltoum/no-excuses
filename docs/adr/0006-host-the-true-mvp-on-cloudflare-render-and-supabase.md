---
status: accepted
---

# Host the True MVP on Cloudflare, Render, and Supabase

No Excuses will run its first hosted True MVP in one US production environment with:

- the Vite static build on Cloudflare Pages Free at `https://joinnoexcuses.com`;
- the Node API on one always-on Render Starter web service in Virginia at
  `https://api.joinnoexcuses.com`;
- one managed Supabase Pro project using Micro compute in AWS `us-east-1` (North Virginia)
  for PostgreSQL and Auth; and
- DNS and registration through Cloudflare Registrar.

`joinnoexcuses.com` is the approved domain candidate. Registration may proceed only after
Cloudflare's authoritative checkout confirms that exact name is registrable and its first-year
and renewal prices are each no more than USD 15. If it is unavailable or exceeds either cap,
stop and obtain a new domain decision; do not silently choose another name or TLD.

Supabase Auth will send OTP email through Resend Free using a dedicated
`auth.joinnoexcuses.com` sending subdomain and `no-reply@auth.joinnoexcuses.com`. Configure SPF,
DKIM, and DMARC before inviting any member. Supabase's default SMTP service is not a production
option because it is restricted to project-team addresses, currently rate-limited to two
messages per hour, and has no delivery SLA.

## Cost approval

Approved baseline spend, before tax:

| Item | Approved tier | Recurring cost |
| --- | --- | ---: |
| Cloudflare Pages and DNS | Free | USD 0/month |
| Render Node API | Starter, 512 MB | USD 7/month |
| Supabase PostgreSQL and Auth | Pro with one included Micro project | USD 25/month |
| Resend transactional SMTP | Free, up to 3,000 emails/month and 100/day | USD 0/month |
| Domain | Cloudflare Registrar | Up to USD 15/year registration and renewal |

Baseline ceiling: **USD 32/month plus USD 15/year**, or **USD 399/year before tax** when every
monthly service runs for a full year. Usage overages, paid email, extra projects, larger compute,
Supabase custom domains, Point-in-Time Recovery, log drains, Render workspace upgrades, and
other add-ons are not approved. Configure available spend caps and usage alerts. Stop before any
change would exceed this ceiling.

Supabase Pro daily backups with seven-day retention are accepted for this True MVP release.
Point-in-Time Recovery and the older production-shaped pilot recovery/observability gates remain
deferred with the Validation-pilot operations excluded by
`docs/product/true-mvp-scope.md`. Activating those gates requires a new cost and readiness
decision; this ADR does not weaken them.

## Provisioning contract

Provision through provider dashboards under owner-controlled accounts with MFA and billing
alerts. Do not place provider access tokens or server secrets in Git.

1. Register `joinnoexcuses.com` at Cloudflare only within the approved price cap. Enable
   auto-renew, registrar lock, DNSSEC, and account MFA.
2. Create one Supabase Pro project in specific region `us-east-1`. Apply committed migrations;
   configure the production site URL and redirect allowlist; keep the service-role key
   server-only.
3. Verify `auth.joinnoexcuses.com` in Resend. Publish SPF, DKIM, and DMARC records. Configure
   Supabase custom SMTP, then test delivery, expiry, replay rejection, and rate limits with
   approved pilot addresses.
4. Create one Render Starter web service in Virginia. Use Node `24.19.0`, build with
   `pnpm install --frozen-lockfile && pnpm api:build`, start with
   `node dist/api/delivery/src/server.js`, set `HOST=0.0.0.0`, and set health check path
   `/v1/health`. Store `DATABASE_URL`, `SUPABASE_URL`, `SUPABASE_ANON_KEY`,
   `SUPABASE_SERVICE_ROLE_KEY`, and a generated 32-byte-or-longer `INVITATION_SECRET` as Render
   secrets. Set `PWA_ORIGIN=https://joinnoexcuses.com`. Attach `api.joinnoexcuses.com` only after
   the provider URL passes health checks.
5. Create one Cloudflare Pages project from `apps/web`. Build from the locked repository with
   `pnpm install --frozen-lockfile && pnpm --filter @no-excuses/web build`; publish
   `apps/web/dist`. Set build-time public values only:
   `VITE_API_BASE_URL=https://api.joinnoexcuses.com`, the Supabase project URL, and the Supabase
   anonymous key. Never expose the service-role key, database URL, invitation secret, or provider
   tokens through a `VITE_` variable. Add the SPA fallback to `index.html`, then attach the apex
   domain and redirect `www` to it.
6. Seed the first organizer once through a one-off Render shell with
   `SEED_ORGANIZER_EMAIL`; remove that environment value immediately afterward.
7. Run migration, authorization-denial, live browser, installability, CORS, OTP, account-deletion,
   weekly-boundary, secret-scan, backup-visibility, and rollback checks against the exact deployed
   release. Admit no friend-group data until those checks pass and owner records activation.

Cloudflare Pages preview deployments must use synthetic data and a non-production backend.
Production secrets must not be exposed to pull-request builds. Automatic production deploys may
begin only after required repository checks pass; failed health checks must retain the previous
API release.

## Why this shape

- Static Pages hosting matches the portable client-rendered Vite build and costs nothing at
  pilot scale.
- Render supplies a small always-on Node process, managed TLS, HTTP health checks, and a Virginia
  region colocated with Supabase. Free sleeping compute is rejected because the API owns
  minute-level maintenance and Auth-deletion retries.
- Supabase Pro preserves the accepted PostgreSQL/Auth architecture, avoids Free-project pausing,
  and supplies managed daily backups without importing a second database vendor.
- Cloudflare consolidates registrar, DNS, TLS edge, and static hosting while keeping the Node API
  and database portable.

## Consequences

- Infrastructure spans three runtime vendors plus one SMTP processor. Account ownership,
  subprocessors, current terms, privacy disclosures, incident contacts, and deletion behavior
  must be reviewed before real member data enters production.
- `joinnoexcuses.com` is not reserved by this document. Availability and price can change until
  registration completes.
- Single Render instance and single-region Supabase project can have downtime. This is accepted
  for limited True MVP friend testing, not as evidence that later Validation-pilot availability,
  recovery, diagnostics, or audit gates pass.
- Any move outside US-only hosting, baseline tiers, cost ceiling, or active True MVP scope requires
  a new approval.

Pricing and capability snapshot verified 2026-09-20 against official Cloudflare Pages and
Registrar, Render pricing/regions/health-check, Supabase pricing/region/SMTP, and Resend pricing
documentation. Recheck live prices and availability immediately before provisioning.

Approved by owner on 2026-09-20 in the hosting decision request.
