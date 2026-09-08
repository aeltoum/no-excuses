create table app_private.idempotent_requests (
  idempotency_key uuid primary key,
  request_hash text not null,
  request_id uuid not null,
  actor_id uuid not null,
  state text not null default 'claimed',
  response jsonb,
  created_at timestamptz not null default transaction_timestamp(),
  completed_at timestamptz,
  constraint idempotent_requests_hash check (request_hash ~ '^[0-9a-f]{64}$'),
  constraint idempotent_requests_state check (state in ('claimed', 'completed')),
  constraint idempotent_requests_completion check (
    (state = 'claimed' and response is null and completed_at is null)
    or (state = 'completed' and response is not null and completed_at is not null)
  )
);

create table app_private.domain_events (
  event_id uuid primary key,
  aggregate_id uuid not null,
  aggregate_version bigint not null,
  event_type text not null,
  occurred_at timestamptz not null,
  payload jsonb not null,
  recorded_at timestamptz not null default transaction_timestamp(),
  constraint domain_events_version check (aggregate_version >= 0),
  constraint domain_events_type check (length(event_type) > 0),
  unique (aggregate_id, aggregate_version)
);

create table app_private.outbox (
  event_id uuid primary key references app_private.domain_events(event_id) on delete restrict,
  available_at timestamptz not null default transaction_timestamp(),
  claimed_at timestamptz,
  delivered_at timestamptz,
  attempts integer not null default 0,
  constraint outbox_attempts check (attempts >= 0),
  constraint outbox_delivery_order check (delivered_at is null or claimed_at is not null)
);

create or replace function app_private.claim_idempotent_request(
  requested_key uuid,
  requested_hash text,
  requested_request_id uuid,
  requested_actor_id uuid
) returns table (state text, response jsonb)
language plpgsql
security invoker
set search_path = ''
as $$
declare
  stored_hash text;
begin
  if requested_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'request hash must be 64 lowercase hexadecimal characters'
      using errcode = '22023';
  end if;

  insert into app_private.idempotent_requests (
    idempotency_key, request_hash, request_id, actor_id
  ) values (
    requested_key, requested_hash, requested_request_id, requested_actor_id
  ) on conflict (idempotency_key) do nothing;

  select item.request_hash into stored_hash
  from app_private.idempotent_requests as item
  where item.idempotency_key = requested_key
  for update;

  if stored_hash <> requested_hash then
    raise exception 'idempotency key was already used with a different request hash'
      using errcode = '23505';
  end if;

  return query
  select item.state, item.response
  from app_private.idempotent_requests as item
  where item.idempotency_key = requested_key;
end;
$$;

create or replace function app_private.complete_idempotent_request(
  requested_key uuid,
  requested_hash text,
  completed_response jsonb
) returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  stored_hash text;
  stored_response jsonb;
begin
  select item.request_hash, item.response
    into stored_hash, stored_response
  from app_private.idempotent_requests as item
  where item.idempotency_key = requested_key
  for update;

  if not found then
    raise exception 'idempotency key has not been claimed'
      using errcode = 'P0002';
  end if;

  if stored_hash <> requested_hash then
    raise exception 'idempotency key was already used with a different request hash'
      using errcode = '23505';
  end if;

  if stored_response is not null then
    return stored_response;
  end if;

  if completed_response is null then
    raise exception 'completed response must not be null'
      using errcode = '22004';
  end if;

  update app_private.idempotent_requests as item
  set state = 'completed',
      response = completed_response,
      completed_at = transaction_timestamp()
  where item.idempotency_key = requested_key;

  return completed_response;
end;
$$;

revoke all on table app_private.idempotent_requests from public, anon, authenticated;
revoke all on table app_private.domain_events from public, anon, authenticated;
revoke all on table app_private.outbox from public, anon, authenticated;
revoke all on function app_private.claim_idempotent_request(uuid, text, uuid, uuid)
  from public, anon, authenticated;
revoke all on function app_private.complete_idempotent_request(uuid, text, jsonb)
  from public, anon, authenticated;

grant usage on schema app_private to service_role;
grant select, insert, update on table app_private.idempotent_requests to service_role;
grant select, insert on table app_private.domain_events to service_role;
grant select, insert, update on table app_private.outbox to service_role;
grant execute on function app_private.claim_idempotent_request(uuid, text, uuid, uuid)
  to service_role;
grant execute on function app_private.complete_idempotent_request(uuid, text, jsonb)
  to service_role;

insert into app_private.schema_versions (version) values (2);
