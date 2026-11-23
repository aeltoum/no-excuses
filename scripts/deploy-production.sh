#!/usr/bin/env bash
# Production release, in the same order the old GitHub workflow used. Runs from a
# developer machine (`pnpm release`). Pushes to main deploy through .github/workflows/deploy-web.yml.
#
# Needs in the environment (or in the git-ignored .env.production.local):
#   SUPABASE_DB_URL         Supabase session-pooler URL with password (server-only)
#   VITE_API_BASE_URL       https://no-excuses-api.<subdomain>.workers.dev
#   VITE_SUPABASE_URL       public Supabase URL
#   VITE_SUPABASE_ANON_KEY  public publishable key
# Cloudflare auth: `wrangler login` locally, or CLOUDFLARE_API_TOKEN and
# CLOUDFLARE_ACCOUNT_ID in Workers Builds.
set -euo pipefail

# GitHub Actions (deploy-web.yml, on push to main) is the one automatic release path. If Workers
# Builds is ever connected, it must not race that workflow on migrations, so it does nothing.
if [ -n "${WORKERS_CI:-}" ]; then
  echo "Workers Builds release skipped: GitHub Actions deploys production on push to main."
  exit 0
fi
cd "$(dirname "$0")/.."

if [ -f .env.production.local ]; then
  set -a
  # shellcheck disable=SC1091
  . ./.env.production.local
  set +a
fi

for key in SUPABASE_DB_URL VITE_API_BASE_URL VITE_SUPABASE_URL VITE_SUPABASE_ANON_KEY; do
  if [ -z "${!key:-}" ]; then echo "Missing configuration: $key" >&2; exit 1; fi
done

commit="$(git rev-parse HEAD)"
branch="$(git rev-parse --abbrev-ref HEAD)"
if [ "$branch" != "main" ]; then
  echo "Production releases run from main only (on $branch)." >&2
  exit 1
fi
if [ -n "$(git status --porcelain --untracked-files=no)" ]; then
  echo "Commit or stash tracked changes first; the release must match $commit." >&2
  exit 1
fi

echo "== Checks"
TZ=UTC pnpm check

echo "== Build API and web before changing production"
pnpm api:build
pnpm --filter @no-excuses/web build
bundle="$(mktemp -d)"
pnpm api:deploy --dry-run --outdir "$bundle"

echo "== Apply committed forward migrations"
pnpm exec supabase migration list --db-url "$SUPABASE_DB_URL"
pnpm exec supabase db push --db-url "$SUPABASE_DB_URL" --dry-run
pnpm exec supabase db push --db-url "$SUPABASE_DB_URL" --yes
pnpm exec supabase migration list --db-url "$SUPABASE_DB_URL"

echo "== Deploy API $commit"
pnpm api:deploy --message "$commit"

echo "== Check API health"
health="$(curl --fail --silent --show-error --max-time 90 --retry 2 "$VITE_API_BASE_URL/v1/health")"
node -e 'const r = JSON.parse(process.argv[1]); if (r.status !== "ok") throw new Error("API health failed")' "$health"

echo "== Publish web"
pnpm exec wrangler pages deploy apps/web/dist \
  --project-name no-excuses --branch main --commit-hash "$commit" --commit-dirty=true

echo "Released $commit."
