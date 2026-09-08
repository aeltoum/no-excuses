#!/usr/bin/env bash
set -euo pipefail

: "${DATABASE_URL:?Set DATABASE_URL to an empty disposable PostgreSQL database}"

psql -v ON_ERROR_STOP=1 "$DATABASE_URL" -c \
  'create role anon; create role authenticated; create role service_role;'
psql -v ON_ERROR_STOP=1 "$DATABASE_URL" \
  -f supabase/migrations/20260907000000_execution_baseline.sql \
  -f supabase/migrations/20260907010000_shared_kernel.sql \
  -f supabase/migrations/20260908000000_identity_group_calendar.sql

psql -v ON_ERROR_STOP=1 "$DATABASE_URL" <<'SQL'
insert into app_private.accounts
  (account_id, auth_user_id, email, adult_attested_at)
values
  ('10000000-0000-4000-8000-000000000001',
   '20000000-0000-4000-8000-000000000001', 'admin@example.test', now()),
  ('10000000-0000-4000-8000-000000000002',
   '20000000-0000-4000-8000-000000000002', 'peer@example.test', now());
insert into app_private.consents (account_id, purpose, version, granted_at)
select account_id, purpose, 'v1', now()
from app_private.accounts
cross join (values ('pilot'), ('product'), ('media')) as p(purpose);
select app_private.create_group(
  '30000000-0000-4000-8000-000000000001',
  '40000000-0000-4000-8000-000000000001',
  '10000000-0000-4000-8000-000000000001',
  'Race Group', 'America/Chicago', 3, '2026-03-04T18:00:00Z'
);
insert into app_private.group_invitations
  (invitation_id, group_id, email, token_digest, issued_by_membership_id,
   issued_at, expires_at)
values
  ('50000000-0000-4000-8000-000000000001',
   '30000000-0000-4000-8000-000000000001', 'peer@example.test',
   'dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd',
   '40000000-0000-4000-8000-000000000001',
   '2026-03-04T18:01:00Z', '2026-03-11T18:01:00Z');
SQL

race_dir=$(mktemp -d /private/tmp/no-excuses-postgres-race.XXXXXX)
race_a="$race_dir/a.log"
race_b="$race_dir/b.log"
race_sql_a="set app.auth_user_id = '20000000-0000-4000-8000-000000000002'; set app.token_issued_at = '2026-03-05T18:00:00Z'; select app_private.accept_group_invitation('dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd', '40000000-0000-4000-8000-000000000002', 3, 2, '2026-03-05T18:00:00Z');"
race_sql_b="set app.auth_user_id = '20000000-0000-4000-8000-000000000002'; set app.token_issued_at = '2026-03-05T18:00:00Z'; select app_private.accept_group_invitation('dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd', '40000000-0000-4000-8000-000000000003', 3, 2, '2026-03-05T18:00:00Z');"
set +e
psql -v ON_ERROR_STOP=1 "$DATABASE_URL" -c "$race_sql_a" >"$race_a" 2>&1 &
race_pid_a=$!
psql -v ON_ERROR_STOP=1 "$DATABASE_URL" -c "$race_sql_b" >"$race_b" 2>&1 &
race_pid_b=$!
wait "$race_pid_a"
race_status_a=$?
wait "$race_pid_b"
race_status_b=$?
set -e
if [[ $((race_status_a + race_status_b)) -eq 0 ]] \
  || [[ $race_status_a -ne 0 && $race_status_b -ne 0 ]]; then
  echo "expected exactly one concurrent invitation acceptance" >&2
  exit 1
fi
psql -v ON_ERROR_STOP=1 "$DATABASE_URL" <<'SQL'
do $$
begin
  if (select count(*) from app_private.group_invitations where status = 'accepted') <> 1
     or (select count(*) from app_private.memberships
         where group_id = '30000000-0000-4000-8000-000000000001'
           and ended_at is null) <> 2 then
    raise exception 'concurrent invitation acceptance did not produce one activation';
  end if;
end $$;
SQL
rm -r "$race_dir"

run_exactly_one() {
  local first_sql="$1"
  local second_sql="$2"
  local check_name="$3"
  local check_dir
  local first_pid
  local second_pid
  local first_status
  local second_status
  check_dir=$(mktemp -d /private/tmp/no-excuses-postgres-race.XXXXXX)
  set +e
  psql -v ON_ERROR_STOP=1 "$DATABASE_URL" -c "$first_sql" >"$check_dir/a.log" 2>&1 &
  first_pid=$!
  psql -v ON_ERROR_STOP=1 "$DATABASE_URL" -c "$second_sql" >"$check_dir/b.log" 2>&1 &
  second_pid=$!
  wait "$first_pid"
  first_status=$?
  wait "$second_pid"
  second_status=$?
  set -e
  if [[ $((first_status + second_status)) -eq 0 ]] \
    || [[ $first_status -ne 0 && $second_status -ne 0 ]]; then
    echo "expected exactly one successful $check_name command" >&2
    exit 1
  fi
  rm -r "$check_dir"
}

psql -v ON_ERROR_STOP=1 "$DATABASE_URL" <<'SQL'
insert into app_private.accounts
  (account_id, auth_user_id, email, adult_attested_at)
values
  ('10000000-0000-4000-8000-000000000011', '20000000-0000-4000-8000-000000000011', 'admin-a@example.test', now()),
  ('10000000-0000-4000-8000-000000000012', '20000000-0000-4000-8000-000000000012', 'admin-b@example.test', now()),
  ('10000000-0000-4000-8000-000000000013', '20000000-0000-4000-8000-000000000013', 'one-group@example.test', now());
insert into app_private.consents (account_id, purpose, version, granted_at)
select account_id, purpose, 'v1', now()
from app_private.accounts
cross join (values ('pilot'), ('product'), ('media')) as p(purpose)
where email in ('admin-a@example.test', 'admin-b@example.test', 'one-group@example.test');
select app_private.create_group('30000000-0000-4000-8000-000000000011', '40000000-0000-4000-8000-000000000011', '10000000-0000-4000-8000-000000000011', 'A', 'UTC', 2, '2026-03-12Z');
select app_private.create_group('30000000-0000-4000-8000-000000000012', '40000000-0000-4000-8000-000000000012', '10000000-0000-4000-8000-000000000012', 'B', 'UTC', 2, '2026-03-12Z');
insert into app_private.group_invitations
  (invitation_id, group_id, email, token_digest, issued_by_membership_id, issued_at, expires_at)
values
  ('50000000-0000-4000-8000-000000000011', '30000000-0000-4000-8000-000000000011', 'one-group@example.test', repeat('e', 64), '40000000-0000-4000-8000-000000000011', '2026-03-12Z', '2026-03-19Z'),
  ('50000000-0000-4000-8000-000000000012', '30000000-0000-4000-8000-000000000012', 'one-group@example.test', repeat('f', 64), '40000000-0000-4000-8000-000000000012', '2026-03-12Z', '2026-03-19Z');
SQL
run_exactly_one \
  "set app.auth_user_id = '20000000-0000-4000-8000-000000000013'; set app.token_issued_at = '2026-03-13Z'; select app_private.accept_group_invitation('eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee', '40000000-0000-4000-8000-000000000013', 2, 1, '2026-03-13Z');" \
  "set app.auth_user_id = '20000000-0000-4000-8000-000000000013'; set app.token_issued_at = '2026-03-13Z'; select app_private.accept_group_invitation('ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff', '40000000-0000-4000-8000-000000000014', 2, 1, '2026-03-13Z');" \
  "one-Group"
psql -v ON_ERROR_STOP=1 "$DATABASE_URL" -c \
  "select 1 / (count(*) = 1)::integer from app_private.memberships where account_id = '10000000-0000-4000-8000-000000000013' and ended_at is null;"

psql -v ON_ERROR_STOP=1 "$DATABASE_URL" <<'SQL'
insert into app_private.accounts
  (account_id, auth_user_id, email, adult_attested_at)
select gen_random_uuid(), gen_random_uuid(), 'capacity-' || n || '@example.test', now()
from generate_series(0, 10) n;
insert into app_private.consents (account_id, purpose, version, granted_at)
select account_id, purpose, 'v1', now()
from app_private.accounts
cross join (values ('pilot'), ('product'), ('media')) as p(purpose)
where email like 'capacity-%';
select app_private.create_group(
  '30000000-0000-4000-8000-000000000021',
  '40000000-0000-4000-8000-000000000021',
  (select account_id from app_private.accounts where email = 'capacity-0@example.test'),
  'Capacity', 'UTC', 2, '2026-03-12Z'
);
insert into app_private.memberships
  (membership_id, account_id, group_id, joined_at, recurring_target)
select gen_random_uuid(), account_id, '30000000-0000-4000-8000-000000000021', '2026-03-12Z', 2
from app_private.accounts
where email ~ '^capacity-[1-8]@';
insert into app_private.group_invitations
  (invitation_id, group_id, email, token_digest, issued_by_membership_id, issued_at, expires_at)
values
  ('50000000-0000-4000-8000-000000000021', '30000000-0000-4000-8000-000000000021', 'capacity-9@example.test', repeat('9', 64), '40000000-0000-4000-8000-000000000021', '2026-03-12Z', '2026-03-19Z'),
  ('50000000-0000-4000-8000-000000000022', '30000000-0000-4000-8000-000000000021', 'capacity-10@example.test', repeat('8', 64), '40000000-0000-4000-8000-000000000021', '2026-03-12Z', '2026-03-19Z');
SQL
capacity_auth_a=$(psql -At "$DATABASE_URL" -c "select auth_user_id from app_private.accounts where email = 'capacity-9@example.test'")
capacity_auth_b=$(psql -At "$DATABASE_URL" -c "select auth_user_id from app_private.accounts where email = 'capacity-10@example.test'")
run_exactly_one \
  "set app.auth_user_id = '$capacity_auth_a'; set app.token_issued_at = '2026-03-13Z'; select app_private.accept_group_invitation('9999999999999999999999999999999999999999999999999999999999999999', '40000000-0000-4000-8000-000000000022', 2, 1, '2026-03-13Z');" \
  "set app.auth_user_id = '$capacity_auth_b'; set app.token_issued_at = '2026-03-13Z'; select app_private.accept_group_invitation('8888888888888888888888888888888888888888888888888888888888888888', '40000000-0000-4000-8000-000000000023', 2, 1, '2026-03-13Z');" \
  "capacity"
psql -v ON_ERROR_STOP=1 "$DATABASE_URL" -c \
  "select 1 / (count(*) = 10)::integer from app_private.memberships where group_id = '30000000-0000-4000-8000-000000000021' and ended_at is null;"

psql -v ON_ERROR_STOP=1 "$DATABASE_URL" <<'SQL'
begin;
insert into app_private.domain_events
  (event_id, aggregate_id, aggregate_version, event_type, occurred_at, payload)
values
  ('018f63c2-7d33-7f54-9fa7-9f55d735ae35',
   '018f63c2-7d33-7f54-9fa7-9f55d735ae36', 0, 'smoke.recorded', now(), '{}');
insert into app_private.outbox (event_id)
values ('018f63c2-7d33-7f54-9fa7-9f55d735ae35');
commit;

do $$
begin
  if (select count(*) from app_private.domain_events) <> 1
    or (select count(*) from app_private.outbox) <> 1 then
    raise exception 'event and outbox did not commit atomically';
  end if;
end $$;

select * from app_private.claim_idempotent_request(
  '018f63c2-7d33-7f54-9fa7-9f55d735ae38',
  'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
  '018f63c2-7d33-7f54-9fa7-9f55d735ae39',
  '018f63c2-7d33-7f54-9fa7-9f55d735ae40'
);
select app_private.complete_idempotent_request(
  '018f63c2-7d33-7f54-9fa7-9f55d735ae38',
  'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
  '{"receipt":"stable"}'::jsonb
);
select * from app_private.claim_idempotent_request(
  '018f63c2-7d33-7f54-9fa7-9f55d735ae38',
  'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
  '018f63c2-7d33-7f54-9fa7-9f55d735ae39',
  '018f63c2-7d33-7f54-9fa7-9f55d735ae40'
);
do $$
begin
  if app_private.complete_idempotent_request(
    '018f63c2-7d33-7f54-9fa7-9f55d735ae38',
    'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    '{"receipt":"different"}'::jsonb
  ) <> '{"receipt":"stable"}'::jsonb then
    raise exception 'completed response was not stable on replay';
  end if;
end $$;
select * from app_private.claim_idempotent_request(
  '018f63c2-7d33-7f54-9fa7-9f55d735ae38',
  'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
  '018f63c2-7d33-7f54-9fa7-9f55d735ae39',
  '018f63c2-7d33-7f54-9fa7-9f55d735ae40'
);

do $$
begin
  begin
    perform * from app_private.claim_idempotent_request(
      '018f63c2-7d33-7f54-9fa7-9f55d735ae38',
      'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
      '018f63c2-7d33-7f54-9fa7-9f55d735ae39',
      '018f63c2-7d33-7f54-9fa7-9f55d735ae40'
    );
    raise exception 'different-hash claim unexpectedly succeeded';
  exception when unique_violation then
    null;
  end;

  begin
    insert into app_private.domain_events
      (event_id, aggregate_id, aggregate_version, event_type, occurred_at, payload)
    values
      ('018f63c2-7d33-7f54-9fa7-9f55d735ae41',
       '018f63c2-7d33-7f54-9fa7-9f55d735ae42', 0, 'rollback.recorded', now(), '{}');
    insert into app_private.outbox (event_id)
      values ('018f63c2-7d33-7f54-9fa7-9f55d735ae43');
  exception when foreign_key_violation then
    null;
  end;

  if exists (
    select from app_private.domain_events
    where event_id = '018f63c2-7d33-7f54-9fa7-9f55d735ae41'
  ) then
    raise exception 'failed outbox write did not roll back its event';
  end if;
end $$;

do $$
declare
  retry_key constant uuid := '018f63c2-7d33-7f54-9fa7-9f55d735ae44';
  retry_hash constant text := 'cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc';
begin
  begin
    perform * from app_private.claim_idempotent_request(
      retry_key, retry_hash,
      '018f63c2-7d33-7f54-9fa7-9f55d735ae45',
      '018f63c2-7d33-7f54-9fa7-9f55d735ae46'
    );
    insert into app_private.domain_events
      (event_id, aggregate_id, aggregate_version, event_type, occurred_at, payload)
    values
      ('018f63c2-7d33-7f54-9fa7-9f55d735ae47',
       '018f63c2-7d33-7f54-9fa7-9f55d735ae48', 0, 'retry.recorded', now(), '{}');
    raise exception 'simulated command failure';
  exception when raise_exception then
    null;
  end;

  perform * from app_private.claim_idempotent_request(
    retry_key, retry_hash,
    '018f63c2-7d33-7f54-9fa7-9f55d735ae45',
    '018f63c2-7d33-7f54-9fa7-9f55d735ae46'
  );
  insert into app_private.domain_events
    (event_id, aggregate_id, aggregate_version, event_type, occurred_at, payload)
  values
    ('018f63c2-7d33-7f54-9fa7-9f55d735ae47',
     '018f63c2-7d33-7f54-9fa7-9f55d735ae48', 0, 'retry.recorded', now(), '{}');
  insert into app_private.outbox (event_id)
    values ('018f63c2-7d33-7f54-9fa7-9f55d735ae47');
  perform app_private.complete_idempotent_request(
    retry_key, retry_hash, '{"receipt":"retry-stable"}'::jsonb
  );

  if (select count(*) from app_private.domain_events
      where event_id = '018f63c2-7d33-7f54-9fa7-9f55d735ae47') <> 1 then
    raise exception 'failed-command retry did not produce exactly one effect';
  end if;
end $$;
SQL
