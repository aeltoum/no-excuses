#!/usr/bin/env bash
set -euo pipefail

: "${DATABASE_URL:?Set DATABASE_URL to an empty disposable PostgreSQL database}"

psql -v ON_ERROR_STOP=1 "$DATABASE_URL" -c \
  'create role anon; create role authenticated; create role service_role;'
for migration in supabase/migrations/*.sql; do
  psql -v ON_ERROR_STOP=1 "$DATABASE_URL" -f "$migration"
done

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

psql -v ON_ERROR_STOP=1 "$DATABASE_URL" <<'SQL'
insert into app_private.accounts (account_id, auth_user_id, email, adult_attested_at)
values
  ('85000000-0000-4000-8000-000000000001', '86000000-0000-4000-8000-000000000001', 'm5-owner@example.test', now()),
  ('85000000-0000-4000-8000-000000000002', '86000000-0000-4000-8000-000000000002', 'm5-peer@example.test', now());
insert into app_private.groups (group_id, name, time_zone, status, activation_at)
values ('87000000-0000-4000-8000-000000000001', 'M5 Group', 'UTC', 'active', '2026-03-01Z');
insert into app_private.memberships
  (membership_id, account_id, group_id, joined_at, recurring_target)
values
  ('88000000-0000-4000-8000-000000000001', '85000000-0000-4000-8000-000000000001', '87000000-0000-4000-8000-000000000001', '2026-03-01Z', 2),
  ('88000000-0000-4000-8000-000000000002', '85000000-0000-4000-8000-000000000002', '87000000-0000-4000-8000-000000000001', '2026-03-01Z', 2);
do $$
declare
  obligation uuid := 'a1000000-0000-4000-8000-000000000001';
  offer uuid := 'a2000000-0000-4000-8000-000000000001';
  attempt uuid := 'a3000000-0000-4000-8000-000000000001';
  claim uuid := 'a4000000-0000-4000-8000-000000000001';
  chosen_card uuid;
begin
  if (select count(*) from app_private.consequence_cards) <> 14
     or (select count(*) from app_private.consequence_cards where not progression) <> 6
     or (select count(*) from app_private.consequence_cards where progression) <> 8 then
    raise exception 'M5 catalog seed does not contain six starters and eight progression Cards';
  end if;
  if app_private.add_consequence_obligation(
      obligation, '88000000-0000-4000-8000-000000000001', 'missed_target',
      'a5000000-0000-4000-8000-000000000001', '2026-03-10Z') <> obligation then
    raise exception 'M5 obligation was not created';
  end if;
  if app_private.add_consequence_obligation(
      'a1000000-0000-4000-8000-000000000002',
      '88000000-0000-4000-8000-000000000001', 'missed_target',
      'a5000000-0000-4000-8000-000000000001', '2026-03-10Z') <> obligation then
    raise exception 'M5 source replay was not idempotent';
  end if;
  perform app_private.create_card_offer(offer, obligation, 'postgres-smoke', '2026-03-10Z');
  if (select count(distinct card_id) from app_private.offered_cards
      where offer_id = offer and phase = 'initial') <> 3 then
    raise exception 'M5 offer did not contain three distinct Cards';
  end if;
  select card_id into chosen_card from app_private.offered_cards
    where offer_id = offer and phase = 'initial' order by position limit 1;
  perform app_private.select_consequence_card(attempt, offer, chosen_card, '2026-03-10Z');
  perform app_private.submit_consequence_claim(
    claim, attempt, '2026-03-10T01:00Z', true, '2026-03-10T02:00Z');
  perform app_private.respond_to_consequence_claim(
    'a6000000-0000-4000-8000-000000000001', claim,
    '88000000-0000-4000-8000-000000000002', 'approve', '2026-03-10T03:00Z');
  if (select status from app_private.consequence_obligations
      where obligation_id = obligation) <> 'completed' then
    raise exception 'M5 small-Group threshold did not close exactly one obligation';
  end if;
  if app_private.finalize_consequence_claim(claim, '2026-03-20Z') <> 'approved'
     or (select count(*) from app_private.consequence_obligations
         where obligation_id = obligation) <> 1 then
    raise exception 'M5 completion replay was not stable';
  end if;
  if exists (
    select from information_schema.columns where table_schema = 'app_private'
      and table_name like '%consequence%'
      and (column_name like '%video%' or column_name like '%media%'
        or column_name like '%description%' or column_name like '%text%')
  ) then
    raise exception 'M5 Consequence schema contains forbidden media or free-text field';
  end if;
end $$;
SQL

psql -v ON_ERROR_STOP=1 "$DATABASE_URL" -f scripts/fixtures/real-postgres-weekly-settlement.sql

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

psql -v ON_ERROR_STOP=1 "$DATABASE_URL" <<'SQL'
insert into app_private.accounts
  (account_id, auth_user_id, email, adult_attested_at)
values
  ('b2000000-0000-4000-8000-000000000001', 'b3000000-0000-4000-8000-000000000001', 'm7-a@example.test', now()),
  ('b2000000-0000-4000-8000-000000000002', 'b3000000-0000-4000-8000-000000000002', 'm7-b@example.test', now()),
  ('b2000000-0000-4000-8000-000000000003', 'b3000000-0000-4000-8000-000000000003', 'm7-outsider@example.test', now());
insert into app_private.groups (group_id, name, time_zone, status, activation_at)
values
  ('b1000000-0000-4000-8000-000000000001', 'M7 Friends', 'UTC', 'active', '2026-09-07Z'),
  ('b1000000-0000-4000-8000-000000000002', 'M7 Other', 'UTC', 'active', '2026-06-07Z');
insert into app_private.memberships
  (membership_id, account_id, group_id, joined_at, recurring_target)
values
  ('b4000000-0000-4000-8000-000000000001', 'b2000000-0000-4000-8000-000000000001', 'b1000000-0000-4000-8000-000000000001', '2026-09-07Z', 2),
  ('b4000000-0000-4000-8000-000000000002', 'b2000000-0000-4000-8000-000000000002', 'b1000000-0000-4000-8000-000000000001', '2026-09-07Z', 3),
  ('b4000000-0000-4000-8000-000000000003', 'b2000000-0000-4000-8000-000000000003', 'b1000000-0000-4000-8000-000000000002', '2026-06-07Z', 2);
insert into app_private.accountability_weeks
  (accountability_week_id, group_id, starts_at, ends_at, time_zone, activation_at)
values ('b5000000-0000-4000-8000-000000000001', 'b1000000-0000-4000-8000-000000000001',
  '2026-09-07Z', '2026-09-14Z', 'UTC', '2026-09-07Z');
insert into app_private.member_weeks
  (member_week_id, membership_id, accountability_week_id, target, target_locked_at)
values
  ('b6000000-0000-4000-8000-000000000001', 'b4000000-0000-4000-8000-000000000001', 'b5000000-0000-4000-8000-000000000001', 2, '2026-09-07Z'),
  ('b6000000-0000-4000-8000-000000000002', 'b4000000-0000-4000-8000-000000000002', 'b5000000-0000-4000-8000-000000000001', 3, '2026-09-07Z');
insert into app_private.workout_checkins
  (workout_checkin_id, member_week_id, membership_id, activity_type,
   completed_at, duration_minutes, perceived_intensity, self_report_attested, submitted_at)
values ('b7000000-0000-4000-8000-000000000001', 'b6000000-0000-4000-8000-000000000001',
  'b4000000-0000-4000-8000-000000000001', 'strength', '2026-09-08Z', 30, 'moderate', true, '2026-09-08Z');
insert into app_private.seasons
  (season_id, group_id, season_number, starts_at, ends_at, time_zone)
values ('b8000000-0000-4000-8000-000000000001', 'b1000000-0000-4000-8000-000000000001',
  1, '2026-09-07Z', '2026-10-05Z', 'UTC');
insert into app_private.consequence_obligations
  (obligation_id, membership_id, source_kind, source_id, created_at)
values ('b9000000-0000-4000-8000-000000000001', 'b4000000-0000-4000-8000-000000000001',
  'missed_target', 'b9000000-0000-4000-8000-000000000002', '2026-09-09Z');

do $$
declare first_rebuild jsonb; second_rebuild jsonb;
begin
  perform * from app_private.rebuild_group_read_models(
    'b1000000-0000-4000-8000-000000000001', '2026-09-10Z');
  select jsonb_build_object(
    'home', (select jsonb_agg(to_jsonb(p) order by p.membership_id)
      from app_private.member_home_projections p
      where p.group_id = 'b1000000-0000-4000-8000-000000000001'),
    'group', (select jsonb_agg(to_jsonb(p) order by p.viewer_membership_id, p.subject_membership_id)
      from app_private.group_member_projections p
      where p.group_id = 'b1000000-0000-4000-8000-000000000001'),
    'season', (select jsonb_agg(to_jsonb(p) order by p.viewer_membership_id, p.subject_membership_id)
      from app_private.season_standing_projections p
      where p.season_id = 'b8000000-0000-4000-8000-000000000001'))
    into first_rebuild;
  perform * from app_private.rebuild_group_read_models(
    'b1000000-0000-4000-8000-000000000001', '2026-09-10Z');
  select jsonb_build_object(
    'home', (select jsonb_agg(to_jsonb(p) order by p.membership_id)
      from app_private.member_home_projections p
      where p.group_id = 'b1000000-0000-4000-8000-000000000001'),
    'group', (select jsonb_agg(to_jsonb(p) order by p.viewer_membership_id, p.subject_membership_id)
      from app_private.group_member_projections p
      where p.group_id = 'b1000000-0000-4000-8000-000000000001'),
    'season', (select jsonb_agg(to_jsonb(p) order by p.viewer_membership_id, p.subject_membership_id)
      from app_private.season_standing_projections p
      where p.season_id = 'b8000000-0000-4000-8000-000000000001'))
    into second_rebuild;
  if first_rebuild is distinct from second_rebuild then
    raise exception 'M7 projection rebuild was not equivalent';
  end if;
  if (select count(*) from app_private.group_member_projections
      where group_id = 'b1000000-0000-4000-8000-000000000001') <> 4
     or exists (select from app_private.group_member_projections
       where subject_membership_id = 'b4000000-0000-4000-8000-000000000003') then
    raise exception 'M7 projections crossed Group boundary';
  end if;
  if (select count(*) from app_private.season_standing_projections
      where season_id = 'b8000000-0000-4000-8000-000000000001'
        and crowns = 0 and rank = 1 and cochampion) <> 4 then
    raise exception 'M7 current active-Season zero-Crown standings were incomplete';
  end if;
end $$;

select set_config('app.auth_user_id', 'b3000000-0000-4000-8000-000000000001', false);
select set_config('app.token_issued_at', '2026-09-10Z', false);
set role authenticated;
do $$
declare home record;
begin
  select * into home from app_private.read_member_home_view('2026-09-10Z');
  if home.membership_id <> 'b4000000-0000-4000-8000-000000000001'
     or home.completed_workout_count <> 1 or home.needs_you_count <> 1
     or jsonb_array_length(home.friend_activity) <> 1
     or jsonb_array_length(home.season_standings) <> 2 then
    raise exception 'M7 member Home read did not return expected current projection';
  end if;
  begin
    perform app_private.create_social_interaction(gen_random_uuid(),
      'b4000000-0000-4000-8000-000000000003', 'reaction', 'fire', '2026-09-10Z');
    raise exception 'M7 cross-Group social write unexpectedly succeeded';
  exception when insufficient_privilege then null;
  end;
  perform app_private.create_social_interaction(
    'ba000000-0000-4000-8000-000000000001',
    'b4000000-0000-4000-8000-000000000002', 'reaction', 'fire', '2026-09-10Z');
end $$;
reset role;

select set_config('app.auth_user_id', 'b3000000-0000-4000-8000-000000000003', false);
set role authenticated;
do $$
begin
  if exists (select from app_private.read_member_home_view('2026-09-10Z')) then
    raise exception 'M7 member Home read crossed Group boundary';
  end if;
end $$;
reset role;

insert into app_private.notification_preferences
  (account_id, notification_time_zone, changed_at)
values
  ('b2000000-0000-4000-8000-000000000001', 'UTC', '2026-09-01Z'),
  ('b2000000-0000-4000-8000-000000000002', 'UTC', '2026-09-01Z');
insert into app_private.push_subscriptions
  (subscription_id, account_id, installation_id, permission, endpoint_digest, verified_at)
values ('bb000000-0000-4000-8000-000000000001', 'b2000000-0000-4000-8000-000000000002',
  'bb000000-0000-4000-8000-000000000002', 'granted', repeat('a', 64), '2026-09-01Z');
insert into app_private.push_subscriptions
  (subscription_id, account_id, installation_id, permission, endpoint_digest)
values ('bb000000-0000-4000-8000-000000000003', 'b2000000-0000-4000-8000-000000000001',
  'bb000000-0000-4000-8000-000000000004', 'denied', repeat('b', 64));

do $$
declare n integer;
begin
  for n in 1..5 loop
    perform app_private.schedule_notification(gen_random_uuid(),
      'b2000000-0000-4000-8000-000000000002', 'm7-social-' || n,
      'social', 1, 'generic', 'home', null,
      '2026-09-10Z'::timestamptz + (n || ' hours')::interval, '2026-09-11Z');
    perform * from app_private.dispatch_notification_work(
      '2026-09-10Z'::timestamptz + (n || ' hours')::interval);
    perform app_private.schedule_notification(gen_random_uuid(),
      'b2000000-0000-4000-8000-000000000002', 'm7-action-' || n,
      'action', 1, 'generic', 'home', null,
      '2026-09-10Z'::timestamptz + (n || ' hours')::interval, '2026-09-11Z');
    perform * from app_private.dispatch_notification_work(
      '2026-09-10Z'::timestamptz + (n || ' hours')::interval);
  end loop;
  if (select count(*) from app_private.notification_budgets
      where account_id = 'b2000000-0000-4000-8000-000000000002' and consumed = 3) <> 2
     or not exists (select from app_private.push_bundles
       where recipient_account_id = 'b2000000-0000-4000-8000-000000000002'
         and class = 'social' and notification_count = 2)
     or (select count(*) from app_private.notification_delivery_work
       where state = 'suppressed' and suppression_reason = 'daily_cap'
         and notification_id in (select notification_id from app_private.notification_items
           where recipient_account_id = 'b2000000-0000-4000-8000-000000000002')) <> 4 then
    raise exception 'M7 social/action caps were not separate';
  end if;

  perform app_private.schedule_notification('bc000000-0000-4000-8000-000000000001',
    'b2000000-0000-4000-8000-000000000001', 'm7-denied', 'action', 1,
    'deadline_due', 'task', 'bc000000-0000-4000-8000-000000000002', '2026-09-10Z', '2026-09-11Z');
  perform * from app_private.dispatch_notification_work('2026-09-10Z');
  if not exists (select from app_private.notification_delivery_work
      where notification_id = 'bc000000-0000-4000-8000-000000000001'
        and state = 'suppressed' and suppression_reason = 'permission_unavailable')
     or not exists (select from app_private.notification_items
       where notification_id = 'bc000000-0000-4000-8000-000000000001' and state = 'unread') then
    raise exception 'M7 denied push changed canonical notification authority';
  end if;
end $$;

insert into app_private.notification_items
  (notification_id, recipient_account_id, source_identity, class, priority,
   template_key, route_kind, route_id, state, created_at, relevant_until)
values
  ('bd000000-0000-4000-8000-000000000001', 'b2000000-0000-4000-8000-000000000001', 'm7-order-1', 'action', 2, 'generic', 'home', null, 'unread', '2026-09-10T10:00Z', '2026-09-11Z'),
  ('bd000000-0000-4000-8000-000000000002', 'b2000000-0000-4000-8000-000000000001', 'm7-order-2', 'social', 1, 'generic', 'home', null, 'unread', '2026-09-10T09:00Z', '2026-09-11Z'),
  ('bd000000-0000-4000-8000-000000000003', 'b2000000-0000-4000-8000-000000000001', 'm7-order-3', 'action', 1, 'generic', 'home', null, 'read', '2026-09-10T11:00Z', '2026-09-11Z'),
  ('bd000000-0000-4000-8000-000000000004', 'b2000000-0000-4000-8000-000000000001', 'm7-resolved', 'action', 1, 'generic', 'home', null, 'resolved', '2026-09-10Z', '2026-09-11Z'),
  ('bd000000-0000-4000-8000-000000000005', 'b2000000-0000-4000-8000-000000000001', 'm7-malformed', 'action', 1, 'generic', 'task', null, 'unread', '2026-09-10Z', '2026-09-11Z');

select set_config('app.auth_user_id', 'b3000000-0000-4000-8000-000000000001', false);
select set_config('app.token_issued_at', '2026-09-10Z', false);
set role authenticated;
do $$
declare ordered_ids uuid[];
begin
  select array_agg(notification_id) into ordered_ids
  from app_private.read_notification_center('2026-09-10T12:00Z');
  if ordered_ids <> array[
      'bd000000-0000-4000-8000-000000000002'::uuid,
      'bc000000-0000-4000-8000-000000000001'::uuid,
      'bd000000-0000-4000-8000-000000000005'::uuid,
      'bd000000-0000-4000-8000-000000000001'::uuid,
      'bd000000-0000-4000-8000-000000000003'::uuid] then
    raise exception 'M7 notification center ordering was not deterministic';
  end if;
  if app_private.resolve_member_route(
      'bd000000-0000-4000-8000-000000000004', '2026-09-10T12:00Z') <> '/notifications?notice=resolved'
     or app_private.resolve_member_route(
       'bd000000-0000-4000-8000-000000000005', '2026-09-10T12:00Z') <> '/home?notice=unavailable'
     or app_private.resolve_member_route(
       'bc000000-0000-4000-8000-000000000001', '2026-09-12Z') <> '/home?notice=unavailable' then
    raise exception 'M7 stale or terminal route recovery was unsafe';
  end if;
end $$;
reset role;

do $$
begin
  if (select count(*) from app_private.member_weeks
      where member_week_id in ('b6000000-0000-4000-8000-000000000001', 'b6000000-0000-4000-8000-000000000002')
        and status = 'active') <> 2
     or exists (select from app_private.crown_awards
       where membership_id in ('b4000000-0000-4000-8000-000000000001', 'b4000000-0000-4000-8000-000000000002'))
     or not exists (select from app_private.consequence_obligations
       where obligation_id = 'b9000000-0000-4000-8000-000000000001' and status = 'open') then
    raise exception 'M7 social or notification work changed authoritative outcomes';
  end if;
  update app_private.memberships set ended_at = '2026-09-10Z', end_reason = 'left'
    where membership_id = 'b4000000-0000-4000-8000-000000000002';
  perform * from app_private.rebuild_group_read_models(
    'b1000000-0000-4000-8000-000000000001', '2026-09-10T00:01Z');
  if (select count(*) from app_private.group_member_projections
      where group_id = 'b1000000-0000-4000-8000-000000000001') <> 1 then
    raise exception 'M7 projection rebuild retained departed membership';
  end if;
end $$;
SQL
