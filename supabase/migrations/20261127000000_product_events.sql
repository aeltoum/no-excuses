-- Owner-approved 2026-11-11 (retention audit, section 7): minimal first-party product
-- events so the pilot can see where members drop. No third-party SDK. Events hold a name
-- from a fixed list and a small payload; never photo paths, message text, or Exception
-- notes. They are part of the member's data export and are erased when the Account is
-- deleted. Rows older than 180 days are pruned.

create table app_private.product_events (
  event_id bigserial primary key,
  account_id uuid not null references app_private.accounts(account_id) on delete cascade,
  membership_id uuid,
  name text not null check (name in (
    'app_opened', 'signin_verified', 'onboarding_step_completed', 'invite_created',
    'invite_shared', 'push_prompt_shown', 'push_enabled', 'log_sheet_opened',
    'log_submitted', 'log_abandoned', 'post_viewed', 'reaction_added', 'nudge_sent',
    'recap_viewed', 'card_offer_viewed', 'comeback_used', 'week_off_requested'
  )),
  payload jsonb not null default '{}'::jsonb check (length(payload::text) <= 1000),
  created_at timestamptz not null
);
create index product_events_account on app_private.product_events (account_id, created_at);
create index product_events_name on app_private.product_events (name, created_at);

create or replace function app_private.record_product_events(
  requested_events jsonb, requested_at timestamptz
) returns integer
language plpgsql security definer set search_path = '' as $$
declare actor uuid := app_private.actor_account_id(); added integer;
begin
  if actor is null then
    raise exception 'active account required' using errcode = '42501';
  end if;
  if jsonb_typeof(requested_events) <> 'array' or jsonb_array_length(requested_events) > 50 then
    raise exception 'invalid events' using errcode = '22023';
  end if;
  insert into app_private.product_events (account_id, membership_id, name, payload, created_at)
  select actor, (app_private.actor_current_membership()).membership_id,
    e ->> 'name', coalesce(e -> 'payload', '{}'::jsonb), requested_at
  from jsonb_array_elements(requested_events) e;
  get diagnostics added = row_count;
  delete from app_private.product_events where created_at < requested_at - interval '180 days';
  return added;
end;
$$;

create or replace function app_private.erase_deleted_account_events()
returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.status = 'deleted' and old.status is distinct from 'deleted' then
    delete from app_private.product_events where account_id = new.account_id;
  end if;
  return new;
end;
$$;
create trigger accounts_erase_product_events
  after update of status on app_private.accounts
  for each row execute function app_private.erase_deleted_account_events();

alter function app_private.account_export(timestamptz) rename to account_export_base;
create or replace function app_private.account_export(requested_at timestamptz)
returns jsonb
language sql stable security definer set search_path = '' as $$
  select app_private.account_export_base(requested_at) || jsonb_build_object(
    'productEvents', coalesce((
      select jsonb_agg(jsonb_build_object('name', name, 'payload', payload, 'at', created_at)
        order by created_at)
      from app_private.product_events where account_id = app_private.actor_account_id()
    ), '[]'::jsonb));
$$;

revoke all on table app_private.product_events from public, anon, authenticated;
revoke all on function app_private.record_product_events(jsonb, timestamptz),
  app_private.erase_deleted_account_events(),
  app_private.account_export_base(timestamptz),
  app_private.account_export(timestamptz)
  from public, anon, authenticated;
grant execute on function app_private.record_product_events(jsonb, timestamptz),
  app_private.account_export(timestamptz) to service_role;

insert into app_private.schema_versions (version) values (60);
