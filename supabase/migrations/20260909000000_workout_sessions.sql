create type app_private.workout_session_status as enum ('active', 'ended', 'expired');

alter table app_private.member_weeks
  add constraint member_weeks_identity
  unique (accountability_week_id, member_week_id, membership_id);

create table app_private.workout_sessions (
  workout_session_id uuid primary key,
  membership_id uuid not null references app_private.memberships(membership_id) on delete restrict,
  accountability_week_id uuid not null,
  member_week_id uuid not null,
  started_at timestamptz not null,
  ended_at timestamptz,
  status app_private.workout_session_status not null default 'active',
  constraint workout_sessions_member_week
    foreign key (accountability_week_id, member_week_id, membership_id)
    references app_private.member_weeks(accountability_week_id, member_week_id, membership_id)
    on delete restrict,
  constraint workout_sessions_end_order check (ended_at is null or ended_at >= started_at),
  constraint workout_sessions_status_times check (
    (status = 'active' and ended_at is null)
    or (status in ('ended', 'expired') and ended_at is not null)
  )
);

create unique index workout_sessions_one_active_per_membership
  on app_private.workout_sessions (membership_id) where status = 'active';

create or replace function app_private.protect_workout_session_assignment()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if new.membership_id <> old.membership_id
     or new.accountability_week_id <> old.accountability_week_id
     or new.member_week_id <> old.member_week_id
     or new.started_at <> old.started_at then
    raise exception 'Workout session assignment and start are immutable'
      using errcode = '23514';
  end if;
  return new;
end;
$$;

create trigger protect_workout_session_assignment
before update on app_private.workout_sessions
for each row execute function app_private.protect_workout_session_assignment();

create or replace function app_private.start_workout_session(
  requested_workout_session_id uuid,
  requested_membership_id uuid,
  requested_at timestamptz
) returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  found_accountability_week_id uuid;
  found_member_week_id uuid;
begin
  perform 1
  from app_private.memberships m
  join app_private.groups g on g.group_id = m.group_id
  where m.membership_id = requested_membership_id
    and m.account_id = app_private.actor_account_id()
    and m.joined_at <= requested_at
    and m.ended_at is null
    and g.status = 'active'
    and g.activation_at <= requested_at
  for update of m, g;
  if not found then
    raise exception 'active Workout-session membership required' using errcode = '42501';
  end if;

  select mw.accountability_week_id, mw.member_week_id
    into found_accountability_week_id, found_member_week_id
  from app_private.member_weeks mw
  join app_private.accountability_weeks aw
    on aw.accountability_week_id = mw.accountability_week_id
  where mw.membership_id = requested_membership_id
    and mw.status = 'active'
    and mw.target_pending_until is null
    and mw.target_locked_at <= requested_at
    and aw.activation_at is not null
    and aw.activation_at <= requested_at
    and aw.starts_at <= requested_at
    and aw.ends_at > requested_at
  for update of mw;
  if not found then
    raise exception 'eligible Member-week with locked Target required' using errcode = '42501';
  end if;

  insert into app_private.workout_sessions (
    workout_session_id, membership_id, accountability_week_id, member_week_id, started_at
  ) values (
    requested_workout_session_id, requested_membership_id,
    found_accountability_week_id, found_member_week_id, requested_at
  );
  return requested_workout_session_id;
end;
$$;

create or replace function app_private.end_workout_session(
  requested_workout_session_id uuid,
  requested_at timestamptz
) returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  found_session app_private.workout_sessions%rowtype;
begin
  select ws.* into found_session
  from app_private.workout_sessions ws
  join app_private.memberships m on m.membership_id = ws.membership_id
  where ws.workout_session_id = requested_workout_session_id
    and m.account_id = app_private.actor_account_id()
  for update of ws;
  if not found or found_session.status <> 'active' then
    raise exception 'active Workout session required' using errcode = 'P0002';
  end if;
  if requested_at < found_session.started_at then
    raise exception 'Workout session cannot end before it starts' using errcode = '22023';
  end if;

  update app_private.workout_sessions
  set status = case
        when requested_at >= started_at + interval '12 hours'
          then 'expired'::app_private.workout_session_status
        else 'ended'::app_private.workout_session_status
      end,
      ended_at = least(requested_at, started_at + interval '12 hours')
  where workout_session_id = requested_workout_session_id;
  return requested_workout_session_id;
end;
$$;

create or replace function app_private.expire_workout_sessions(requested_at timestamptz)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  expired_count integer;
begin
  update app_private.workout_sessions
  set status = 'expired', ended_at = started_at + interval '12 hours'
  where status = 'active'
    and started_at + interval '12 hours' <= requested_at;
  get diagnostics expired_count = row_count;
  return expired_count;
end;
$$;

alter table app_private.workout_sessions enable row level security;

revoke all on table app_private.workout_sessions from public, anon, authenticated;
revoke all on function app_private.protect_workout_session_assignment() from public, anon, authenticated;
revoke all on function app_private.start_workout_session(uuid, uuid, timestamptz) from public, anon, authenticated;
revoke all on function app_private.end_workout_session(uuid, timestamptz) from public, anon, authenticated;
revoke all on function app_private.expire_workout_sessions(timestamptz) from public, anon, authenticated;

grant select, insert, update, delete on table app_private.workout_sessions to service_role;
grant execute on function app_private.start_workout_session(uuid, uuid, timestamptz) to service_role;
grant execute on function app_private.end_workout_session(uuid, timestamptz) to service_role;
grant execute on function app_private.expire_workout_sessions(timestamptz) to service_role;

insert into app_private.schema_versions (version) values (4);
