# Production releases

Every update to `main` runs `.github/workflows/deploy-web.yml` in this order:

1. Check configuration, run `pnpm check`, build API and PWA, and bundle the API Worker.
2. List Supabase history, preview pending migrations, apply committed forward migrations.
3. Deploy the workflow's exact commit to the `no-excuses-api` Cloudflare Worker
   (`pnpm api:deploy`; the commit SHA is the version message).
4. Check `/v1/health`, then publish the matching PWA to Cloudflare Pages.

The production concurrency lock never cancels an active release. GitHub may replace an older
pending run with a newer pending run; the next release applies all missing migrations. A
failure stops later steps. Re-run the failed workflow after correcting its cause. Supabase
records successful migrations, so a retry skips them. A failed API deployment leaves the
previous PWA published. Database changes must remain compatible with the previous API until
the Worker deploy finishes. Use additive migrations; remove old columns/functions only in a
later release. A successful health check proves HTTP availability, not database access or
signed-in feature behavior. To roll back the API, run `wrangler rollback` or pick an earlier
version in the Worker's Deployments tab.

## One-time setup

Repository Actions secrets:

- `SUPABASE_DB_URL`: Supabase session-pooler PostgreSQL URL, with database password. Use the
  session pooler on port 5432 when GitHub's runner cannot reach the direct IPv6 endpoint.
- `CLOUDFLARE_API_TOKEN`: the existing Pages deployment token. It also needs
  **Workers Scripts: Edit** permission on the account to deploy the API Worker.

Repository Actions variables:

- `CLOUDFLARE_ACCOUNT_ID`, `VITE_API_BASE_URL`, `VITE_SUPABASE_URL`, and
  `VITE_SUPABASE_ANON_KEY`: existing web settings. `VITE_API_BASE_URL` is the Worker origin,
  `https://no-excuses-api.<account-subdomain>.workers.dev`, with no trailing slash. The anon key
  is public; privileged keys belong only in server secrets.

Worker secrets, set once in Cloudflare (Workers & Pages, `no-excuses-api`, Settings, Variables
and Secrets, type **Secret**) or with `pnpm exec wrangler secret put <NAME> -c
packages/delivery/wrangler.jsonc`. Deploys keep them.

| Secret | Value |
| --- | --- |
| `DATABASE_URL` | Supabase pooler URL (transaction mode, port 6543, recommended for per-request connections) |
| `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` | Supabase project values |
| `INVITATION_SECRET` | the value the API already uses; a new one voids outstanding invitations |
| `PWA_ORIGIN` | exact Pages production origin, no trailing slash |
| `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` | the existing keys; new keys void every push subscription |

Hyperdrive config `no-excuses-db` (free, query caching off) pools database connections near
Supabase; `packages/delivery/wrangler.jsonc` binds it as `HYPERDRIVE`, and the Worker uses it in
place of `DATABASE_URL`. It points at the Supabase session pooler (port 5432). Do not point it
at the transaction pooler (port 6543): on 2026-11-06 that made database requests hang. After a database
password change, update it with `pnpm exec wrangler hyperdrive update 657acc2fe26544bfba97129fe974390f
--connection-string "<session pooler URL, port 5432>"` as well as `DATABASE_URL`.

Recurring releases apply database schema without changing Supabase Auth, Storage buckets, or
provider settings. The `production` GitHub environment must allow `main` and have no required
reviewer if unattended releases are desired. Branch protection and required PR checks remain
separate.

## Move the API from Render once

1. Add the Worker secrets above, copying values from the Render service's environment.
2. Give `CLOUDFLARE_API_TOKEN` Workers Scripts edit permission.
3. Deploy once from a trusted checkout (`pnpm api:deploy` after `pnpm exec wrangler login`), or
   merge and let the workflow deploy. Note the `workers.dev` URL it prints.
4. Confirm `GET <worker>/v1/health` returns 200 and a request with
   `Origin: https://example.invalid` returns 403.
5. Set `VITE_API_BASE_URL` to the Worker origin and re-run Deploy production so the PWA points at
   it. Sign in, log a workout, and confirm a push arrives within about a minute.
6. Suspend or delete the Render service, then delete the `RENDER_API_KEY` secret and
   `RENDER_SERVICE_ID` variable from GitHub.

## Repair the October 16 history mismatch once

Production inspection found migrations `20261017000000` and `20261018000000` present in
application schema but absent from Supabase migration history. Migration `20261019000000`
adds the reactions tables/functions that the current API already calls. Its deployment
stopped because replaying October 17 tries to create an existing trigger.

Do not infer applied migrations from the highest `app_private.schema_versions` number.
Do not rerun migration SQL, reset production, or mark the reactions migration applied.
The manual repair workflow now verifies exact committed effects before repairing only those two entries. It never applies migration SQL.

Before any history change:

```bash
node scripts/verify-migration-history.mjs > /tmp/no-excuses-verify-history.sql
```

Run that generated SQL in the hosted Supabase SQL editor. It uses a read-only transaction.
Every field must be `true`. It compares committed function bodies and signatures, security
and execution grants, table columns/defaults/nullability, constraints, indexes, trigger
configuration, exact migration/schema history, and the midweek repair data invariant.
The reference database runs locally through October 18. PostgreSQL 18 records NOT NULL
constraints differently from earlier versions, so nullability is compared through columns.
If any comparison fails, inspect the exact difference before proceeding.

Both production workflows run only from `main`. Activate them in this order:

1. Add the required GitHub secrets and variables.
2. Merge the coordinated-release PR. Its first Deploy production run stops at the existing
   migration-history conflict.
3. Run Repair migration history from `main`. It repeats all nine database checks and reconciles
   exactly October 17 and 18.
4. Confirm its dry-run lists only `20261019000000_reactions_nudges.sql`, then rerun Deploy production.

The repair workflow fails closed after reconciliation because its expected pre-repair history
no longer matches. If you already have trusted local database credentials, you can perform the
verified repair before merging instead. Equivalent pinned CLI commands:

```bash
pnpm exec supabase migration list --db-url "$SUPABASE_DB_URL"
pnpm exec supabase migration repair --db-url "$SUPABASE_DB_URL" --status applied 20261017000000 20261018000000
pnpm exec supabase db push --db-url "$SUPABASE_DB_URL" --dry-run
```

The dry-run must show only the actual remaining migration, currently
`20261019000000_reactions_nudges.sql`. Then rerun Deploy production on `main`. If you used the trusted local repair before merging,
merge the coordinated-release PR after configuring the providers. Afterward inspect migration history, the Worker's deployed version,
Cloudflare's deployment commit, and signed-in reactions/nudges. Physical-device behavior
requires its own retest.

Provider references: [Workers limits](https://developers.cloudflare.com/workers/platform/limits/),
[Wrangler deploy and rollback](https://developers.cloudflare.com/workers/wrangler/commands/),
[Workers secrets](https://developers.cloudflare.com/workers/configuration/secrets/),
[Cron Triggers](https://developers.cloudflare.com/workers/configuration/cron-triggers/),
[Hyperdrive](https://developers.cloudflare.com/hyperdrive/),
[Supabase migration repair](https://supabase.com/docs/reference/cli/supabase-migration-repair).
