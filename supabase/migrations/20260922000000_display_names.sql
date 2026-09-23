alter table app_private.accounts
  add column display_name text,
  add constraint accounts_display_name check (
    display_name is null or (
      display_name = btrim(display_name)
      and char_length(display_name) between 1 and 40
    )
  );

create function app_private.erase_deleted_account_display_name()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.status = 'deleted' then
    new.display_name := null;
    update app_private.idempotent_requests
    set response = response - 'display_name'
    where actor_id = new.account_id and response ? 'display_name';
  end if;
  return new;
end;
$$;

create trigger erase_deleted_account_display_name
before insert or update of status, display_name on app_private.accounts
for each row execute function app_private.erase_deleted_account_display_name();

create or replace function app_private.current_account_display_name()
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select account.display_name
  from app_private.accounts account
  where account.account_id = app_private.actor_account_id()
    and account.status = 'active'
$$;

create or replace function app_private.set_display_name_command(
  requested_idempotency_key uuid,
  requested_request_hash text,
  requested_request_id uuid,
  requested_display_name text
) returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid;
  claim record;
  completed_name text;
begin
  actor_id := app_private.actor_account_id();
  if actor_id is null then
    raise exception 'active account required' using errcode = '42501';
  end if;
  if requested_display_name is null
     or requested_display_name <> btrim(requested_display_name)
     or char_length(requested_display_name) not between 1 and 40 then
    raise exception 'display name must be trimmed and 1 to 40 characters'
      using errcode = '22023';
  end if;

  select * into claim from app_private.claim_idempotent_request(
    requested_idempotency_key,
    requested_request_hash,
    requested_request_id,
    actor_id
  );
  if claim.state = 'completed' then
    return claim.response ->> 'display_name';
  end if;

  update app_private.accounts
  set display_name = requested_display_name
  where account_id = actor_id and status = 'active'
  returning display_name into completed_name;
  if completed_name is null then
    raise exception 'active account required' using errcode = '42501';
  end if;

  perform app_private.complete_idempotent_request(
    requested_idempotency_key,
    requested_request_hash,
    jsonb_build_object('display_name', completed_name)
  );
  return completed_name;
end;
$$;

drop function app_private.current_week_progress(uuid, timestamptz);

create function app_private.current_week_progress(
  requested_group_id uuid,
  requested_at timestamptz
) returns table (
  membership_id uuid,
  display_name text,
  locked_target integer,
  completed_workout_count integer
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not app_private.is_current_member(requested_group_id) then
    raise exception 'current Group membership required' using errcode = '42501';
  end if;
  return query
  select m.membership_id,
    coalesce(a.display_name, 'Member ' || left(m.membership_id::text, 8)),
    mw.target, count(wc.workout_checkin_id)::integer
  from app_private.memberships m
  join app_private.accounts a on a.account_id = m.account_id
  join app_private.member_weeks mw on mw.membership_id = m.membership_id
  join app_private.accountability_weeks aw
    on aw.accountability_week_id = mw.accountability_week_id
  left join app_private.workout_checkins wc on wc.member_week_id = mw.member_week_id
  where m.group_id = requested_group_id
    and m.ended_at is null
    and requested_at >= aw.starts_at and requested_at < aw.ends_at
  group by m.membership_id, a.display_name, mw.target
  order by m.membership_id;
end;
$$;

drop function app_private.finalized_weekly_history(uuid);

create function app_private.finalized_weekly_history(
  requested_group_id uuid
) returns table (
  membership_id uuid,
  display_name text,
  starts_at timestamptz,
  ends_at timestamptz,
  locked_target integer,
  completed_workout_count integer,
  outcome app_private.member_week_status
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  viewer_joined_at timestamptz;
begin
  select m.joined_at into viewer_joined_at
  from app_private.memberships m
  where m.account_id = app_private.actor_account_id()
    and m.group_id = requested_group_id
    and m.ended_at is null;
  if viewer_joined_at is null then
    raise exception 'current Group membership required' using errcode = '42501';
  end if;

  return query
  select m.membership_id,
    case when a.status = 'deleted' then 'Former member'
      else coalesce(a.display_name, 'Member ' || left(m.membership_id::text, 8)) end,
    aw.starts_at, aw.ends_at, mw.target,
    count(wc.workout_checkin_id)::integer, mw.status
  from app_private.memberships m
  join app_private.accounts a on a.account_id = m.account_id
  join app_private.member_weeks mw on mw.membership_id = m.membership_id
  join app_private.accountability_weeks aw
    on aw.accountability_week_id = mw.accountability_week_id
  left join app_private.workout_checkins wc on wc.member_week_id = mw.member_week_id
  where m.group_id = requested_group_id
    and mw.status in ('attained', 'missed')
    and aw.ends_at > viewer_joined_at
  group by m.membership_id, a.status, a.display_name, aw.starts_at, aw.ends_at, mw.target, mw.status
  order by aw.ends_at desc, m.membership_id;
end;
$$;

revoke all on function app_private.current_account_display_name() from public, anon;
revoke all on function app_private.set_display_name_command(uuid, text, uuid, text)
  from public, anon, authenticated;
grant execute on function app_private.current_account_display_name()
  to authenticated, service_role;
grant execute on function app_private.set_display_name_command(uuid, text, uuid, text)
  to service_role;
revoke all on function app_private.current_week_progress(uuid, timestamptz)
  from public, anon;
revoke all on function app_private.finalized_weekly_history(uuid)
  from public, anon;
grant execute on function app_private.current_week_progress(uuid, timestamptz)
  to authenticated, service_role;
grant execute on function app_private.finalized_weekly_history(uuid)
  to authenticated, service_role;

insert into app_private.schema_versions (version) values (16);
