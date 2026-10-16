# Production releases

Every update to `main` runs `.github/workflows/deploy-web.yml` in this order:

1. Check configuration, run `pnpm check`, build API and PWA.
2. Confirm Render's independent Auto-Deploy is off.
3. List Supabase history, preview pending migrations, apply committed forward migrations.
4. Ask Render to deploy the workflow's exact commit and wait for that deploy to become Live.
5. Check `/v1/health`, then publish the matching PWA to Cloudflare Pages.

The production concurrency lock never cancels an active release. GitHub may replace an older
pending run with a newer pending run; the next release applies all missing migrations. A
failure stops later steps. Re-run the failed workflow after correcting its cause. Supabase
records successful migrations, so a retry skips them. A failed API deployment leaves the
previous PWA published. Database changes must remain compatible with the previous API while
Render builds. Use additive migrations; remove old columns/functions only in a later release.
A successful health check proves HTTP availability, not signed-in feature behavior.

## One-time setup

Repository Actions secrets:

- `SUPABASE_DB_URL`: Supabase session-pooler PostgreSQL URL, with database password. Use the
  session pooler on port 5432 when GitHub's runner cannot reach the direct IPv6 endpoint.
- `RENDER_API_KEY`: Render API key for the account that owns `no-excuses-api`.
- `CLOUDFLARE_API_TOKEN`: existing Pages deployment token.

Repository Actions variables:

- `RENDER_SERVICE_ID`: `srv-daoik6o473hc73afhbvg`.
- `CLOUDFLARE_ACCOUNT_ID`, `VITE_API_BASE_URL`, `VITE_SUPABASE_URL`, and
  `VITE_SUPABASE_ANON_KEY`: existing web settings. The anon key is public; privileged keys
  belong only in server secrets.

The one-time Repair migration history workflow sets Render Auto-Deploy to Off through the
Render API and confirms the setting. You can also set it in the service Settings.
`render.yaml` records `off` for Blueprint syncs. GitHub now triggers API deployments. Leaving Render's separate On Commit
path enabled can deploy an API before its migration; After CI Checks Pass would wait for
this same workflow while it waits for Render. The workflow refuses either setting.

Keep Render's existing database/Auth/Storage/VAPID environment variables. Recurring releases
apply database schema without changing Supabase Auth, Storage buckets, or provider settings.
The `production` GitHub environment must allow `main` and have no required reviewer if
unattended releases are desired. Branch protection and required PR checks remain separate.

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
2. Merge the coordinated-release PR. Its first Deploy production run refuses independent
   Render Auto-Deploy if still enabled, before database changes or deployments. If Auto-Deploy
   is already Off, the run instead stops at the existing migration-history conflict.
3. Run Repair migration history from `main`. It disables independent Render Auto-Deploy,
   confirms Off, then repeats all nine database checks and reconciles exactly October 17 and 18.
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
merge the coordinated-release PR after configuring the providers. Afterward inspect migration history, Render's deployed commit,
Cloudflare's deployment commit, and signed-in reactions/nudges. Physical-device behavior
requires its own retest.

Provider references: [Render commit-specific deploys](https://render.com/docs/deploys),
[Render API trigger deploy](https://api-docs.render.com/reference/create-deploy),
[Render API update service](https://api-docs.render.com/reference/update-service),
[Render Blueprint Auto-Deploy](https://render.com/docs/blueprint-spec#autodeploytrigger),
[Supabase migration repair](https://supabase.com/docs/reference/cli/supabase-migration-repair).
