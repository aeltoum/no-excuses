#!/usr/bin/env bash
set -euo pipefail

: "${DATABASE_URL:?Set DATABASE_URL to an empty disposable PostgreSQL database}"

psql -v ON_ERROR_STOP=1 "$DATABASE_URL" -c \
  'create role anon; create role authenticated; create role service_role;'
psql -v ON_ERROR_STOP=1 "$DATABASE_URL" \
  -f supabase/migrations/20260907000000_execution_baseline.sql \
  -f supabase/migrations/20260907010000_shared_kernel.sql
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
