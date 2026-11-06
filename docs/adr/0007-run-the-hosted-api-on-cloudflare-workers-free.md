---
status: accepted
---

# Run the hosted API on Cloudflare Workers Free

Supersedes the API host in [ADR 0006](0006-host-the-true-mvp-on-cloudflare-render-and-supabase.md).
Everything else in ADR 0006 stands: Cloudflare Pages, Supabase Free in `us-east-1`, Gmail SMTP,
provider subdomains, and the USD 0 ceiling.

## Context

Render Free stops the API after 15 idle minutes and takes 30 to 60 seconds to start again, so
the first action after a quiet spell stalls. Its in-process minute maintenance (weekly rollover,
cleanup, push delivery) also stops while asleep, which delays notifications. A scheduled GitHub
Actions ping kept it awake, but it used about 4,300 Actions minutes a month, more than the free
quota, and ADR 0006 forbids artificial keep-awake traffic anyway.

## Decision

Run the API as one Cloudflare Worker, `no-excuses-api`, on Workers Free at the provider
subdomain `no-excuses-api.<account>.workers.dev`. A Worker starts in milliseconds, so no
keep-awake traffic is needed.

- `packages/delivery/src/app.ts` holds the API. `cloudflare.ts` is the Worker entry;
  `server.ts` stays as the Node entry for local development and the one-time organizer seed.
- A Cron Trigger runs maintenance every minute, replacing the Node `setInterval`.
- Work that ran after a response with `setImmediate` (push delivery, photo deletion) now runs
  inside `ctx.waitUntil` on Workers.
- Each request and cron run opens its own small `pg` pool, because a Worker cannot share a
  connection between requests. `DATABASE_URL` is the Supabase pooler URL. An optional free
  Hyperdrive binding named `HYPERDRIVE` replaces it when configured.
- Web Push uses WebCrypto and `fetch` (`web-push.ts`, RFC 8291 and RFC 8292) instead of the
  Node-only `web-push` package. Existing VAPID keys and subscriptions keep working.
- Server secrets live in the Worker's Cloudflare settings. `wrangler.jsonc` holds no values.

## Accepted limits

- Workers Free allows 100,000 requests a day, 10 ms CPU per request or cron run, 50 outbound
  requests per run, and 6 open connections per run. One cron run sends at most 20 pushes and
  finishes at most 10 Auth deletions; the rest wait for the next minute.
- Each request opens a new database connection, which adds a few round trips to Supabase.
  Hyperdrive (free) removes most of that if needed.
- If a quota runs out, accept errors until the daily reset or seek new approval. Do not enable
  Workers Paid without approval.

## Consequences

- No cold starts, and maintenance and push delivery run every minute whether or not members are
  active.
- Render, `render.yaml`, and `scripts/deploy-render.mjs` are retired. The deploy workflow runs
  `wrangler deploy` after migrations, using the existing Cloudflare token, which now also needs
  Workers Scripts edit permission.

Approved by owner on 2026-11-06.
