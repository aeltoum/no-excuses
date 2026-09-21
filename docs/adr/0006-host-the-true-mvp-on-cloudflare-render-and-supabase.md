---
status: accepted
---

# Host the True MVP beta at zero cost

No Excuses will run its first hosted True MVP as a **hosted beta**, not a production-grade
service. Cost is the controlling constraint. The approved stack is:

- Vite static build on Cloudflare Pages Free;
- Node API on one Render Free web service in Virginia;
- PostgreSQL and Auth in one Supabase Free project in AWS `us-east-1` (North Virginia); and
- OTP email through one dedicated standard Gmail account using SMTP and an app password.

Use provider domains. Request `no-excuses.pages.dev` for the PWA and
`no-excuses-api.onrender.com` for the API. Provider names are globally unique and not reserved by
this decision. If either is unavailable, choose the smallest recognizable available variation,
record the assigned URL in deployment evidence, and use it consistently. Do not buy or connect a
custom domain.

## Cost approval

| Item | Approved tier | Cost |
| --- | --- | ---: |
| Cloudflare Pages | Free | USD 0 |
| Render Node API | Free | USD 0 |
| Supabase PostgreSQL and Auth | Free | USD 0 |
| Gmail transactional SMTP | Standard account | USD 0 |
| Domain | Provider subdomains | USD 0 |

Total approved spend: **USD 0**. Do not add a payment method where the provider permits use
without one. Do not enable usage overages, paid tiers, add-ons, a custom domain, or any trial that
converts to paid service. If a quota is exhausted, accept suspension until reset or stop and seek
new approval; never incur a charge automatically.

## Accepted beta limits

- Render documents Free compute as non-production. It spins down after 15 minutes without inbound
  traffic, can take about one minute to restart, can restart at any time, supplies 750 instance
  hours per workspace each month, has an ephemeral filesystem, and supplies no shell access.
- Supabase Free supplies 500 MB database space and 5 GB egress, has no automatic backups or
  Point-in-Time Recovery, and may pause after low activity during a seven-day period. Owner must
  manually resume a paused project.
- Cloudflare Pages and Gmail remain subject to their free quotas. Standard Gmail accounts
  currently permit 500 outgoing messages per day. This shared limit includes manual mail from the
  same account, so use a dedicated account only for beta authentication.
- No owned domain, uptime commitment, recovery-point commitment, or production readiness claim is
  made. Cold starts, temporary unavailability, manual recovery, quota suspension, and data loss
  are accepted beta risks.
- Do not use artificial traffic to defeat provider idle or pausing policies. Normal member traffic
  may keep services active; otherwise let them sleep or pause.

These limits are acceptable only for invited friend-group beta use under the active True MVP.
They do not satisfy deferred Validation-pilot availability, backup, recovery, diagnostics, audit,
or production-shaped rehearsal gates. Activating those gates requires a new hosting and cost
decision.

## Provisioning contract

Provision through owner-controlled accounts with MFA. Keep provider tokens and server secrets
out of Git.

1. Create one Supabase Free project in specific region `us-east-1`. Apply committed migrations;
   configure the Cloudflare Pages production URL as the Auth site URL and only approved preview
   URLs as redirects. Keep the service-role key server-only.
2. Create or designate one standard Gmail account used only for beta authentication. Enable
   two-step verification, create one app password for Supabase, and configure Supabase custom
   SMTP with that account. Store the app password only in Supabase, retain recovery access, and
   revoke it when beta hosting ends. Test delivery to every invited email provider before launch.
   Do not use Supabase's default SMTP: it is restricted to project-team addresses, currently
   limited to two messages per hour, and has no delivery SLA.
3. Create one Render Free web service in Virginia. Use Node `24.19.0`, build with
   `pnpm install --frozen-lockfile && pnpm api:build`, start with
   `node dist/api/delivery/src/server.js`, set `HOST=0.0.0.0`, and set health check path
   `/v1/health`. Store `DATABASE_URL`, `SUPABASE_URL`, `SUPABASE_ANON_KEY`,
   `SUPABASE_SERVICE_ROLE_KEY`, and a generated 32-byte-or-longer `INVITATION_SECRET` as Render
   secrets. Set `PWA_ORIGIN` to the final Cloudflare Pages production URL.
4. Create one Cloudflare Pages project from `apps/web`. Build with
   `pnpm install --frozen-lockfile && pnpm --filter @no-excuses/web build`; publish
   `apps/web/dist`. Set only public build values: final Render URL in `VITE_API_BASE_URL`, the
   Supabase project URL, and the Supabase anonymous key. Never expose the service-role key,
   database URL, invitation secret, or provider tokens through a `VITE_` variable. Add the SPA
   fallback to `index.html`.
5. Because Render Free has no shell, seed the first organizer once from a trusted local checkout
   using an ignored temporary environment file pointed at the hosted project. Remove the hosted
   secrets from that device immediately afterward. Never run reset, fixture, migration-test, or
   destructive database commands against the hosted project.
6. Run migration, authorization-denial, live browser, installability, CORS, OTP, account-deletion,
   weekly-boundary, cold-start, service-resume, and secret-scan checks against the exact deployed
   release. Record lack of managed backups as accepted, not passed. Admit no friend-group data
   until remaining checks pass and owner records beta activation.

Cloudflare Pages preview deployments must use synthetic data and a non-production backend.
Production secrets must never enter pull-request builds. Automatic production deploys may begin
only after required repository checks pass; failed API health checks must retain the previous
release where Render Free supports rollback.

## Consequences

- Sleeping Render compute can delay sign-in and every API action after inactivity. Its in-process
  minute maintenance also stops while sleeping; startup maintenance catches up weekly state and
  pending Auth deletion only after the next request wakes the service.
- Supabase inactivity warnings and Render/Supabase quota notices require owner monitoring. No
  monitoring purchase is authorized.
- Absence of managed backups means hosted beta data can be lost. Participants must be told that
  service and data are experimental before joining.
- Any paid service, owned domain, broader audience, production claim, or deferred pilot gate
  requires new approval.

Pricing and capability snapshot verified 2026-09-20 against official Cloudflare Pages, Render
Free, Supabase Free/project-pausing/custom-SMTP, and Google account/app-password/Gmail-limit
documentation. Recheck free-tier terms immediately before provisioning.

Approved by owner on 2026-09-20 after explicitly accepting hosted-beta sleep, pause, and no-backup
risks in exchange for a USD 0 cost ceiling.
