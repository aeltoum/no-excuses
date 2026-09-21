#!/usr/bin/env bash
set -euo pipefail

: "${DATABASE_URL:?Set DATABASE_URL from local Supabase status}"
if [[ ! "$DATABASE_URL" =~ ^postgresql://([^:]+):([^@]+)@127\.0\.0\.1:([0-9]+)/postgres$ ]]; then
  echo 'Requires local Supabase postgres URL; refusing other database' >&2
  exit 1
fi
export PGHOST=127.0.0.1
export PGPORT="${BASH_REMATCH[3]}"
export PGUSER="${BASH_REMATCH[1]}"
export PGPASSWORD="${BASH_REMATCH[2]}"

test_db="no_excuses_pwa_$(date +%s)_$$"
createdb --maintenance-db=postgres "$test_db"
trap 'dropdb --if-exists --force --maintenance-db=postgres "$test_db"' EXIT

for migration in supabase/migrations/*.sql; do
  PGDATABASE="$test_db" psql -v ON_ERROR_STOP=1 -f "$migration" >/dev/null
done
PGDATABASE="$test_db" psql -v ON_ERROR_STOP=1 \
  -f scripts/fixtures/real-postgres-weekly-settlement.sql >/dev/null
echo 'Disposable real-PostgreSQL settlement and history checks passed'
