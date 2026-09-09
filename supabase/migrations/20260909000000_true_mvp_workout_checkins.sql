create type app_private.workout_activity_type as enum (
  'strength', 'cardio', 'class', 'sport', 'mixed'
);
create type app_private.perceived_intensity as enum ('low', 'moderate', 'high');

create table app_private.workout_checkins (
  workout_checkin_id uuid primary key,
  member_week_id uuid not null references app_private.member_weeks(member_week_id) on delete restrict,
  membership_id uuid not null references app_private.memberships(membership_id) on delete restrict,
  activity_type app_private.workout_activity_type not null,
  completed_at timestamptz not null,
  duration_minutes integer not null,
  perceived_intensity app_private.perceived_intensity not null,
  self_report_attested boolean not null,
  submitted_at timestamptz not null,
  constraint workout_checkins_duration check (duration_minutes > 0),
  constraint workout_checkins_attestation check (self_report_attested)
);

create or replace function app_private.submit_workout_checkin(
  requested_idempotency_key uuid,
  requested_request_hash text,
  requested_request_id uuid,
  requested_workout_checkin_id uuid,
  requested_activity_type app_private.workout_activity_type,
  requested_completed_at timestamptz,
  requested_duration_minutes integer,
  requested_perceived_intensity app_private.perceived_intensity,
  requested_self_report_attested boolean,
  requested_at timestamptz
) returns table (workout_checkin_id uuid, current_week_count integer)
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid;
  found_membership app_private.memberships%rowtype;
  found_member_week app_private.member_weeks%rowtype;
  found_week app_private.accountability_weeks%rowtype;
  stored_request app_private.idempotent_requests%rowtype;
  completed_count integer;
  completed_response jsonb;
begin
  actor_id := app_private.actor_account_id();
  if actor_id is null then
    raise exception 'active account required' using errcode = '42501';
  end if;
  if requested_request_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'request hash must be 64 lowercase hexadecimal characters'
      using errcode = '22023';
  end if;

  insert into app_private.idempotent_requests (
    idempotency_key, request_hash, request_id, actor_id
  ) values (
    requested_idempotency_key, requested_request_hash, requested_request_id, actor_id
  ) on conflict (idempotency_key) do nothing;

  select * into stored_request
  from app_private.idempotent_requests
  where idempotency_key = requested_idempotency_key
  for update;
  if stored_request.request_hash <> requested_request_hash
     or stored_request.actor_id <> actor_id then
    raise exception 'idempotency key was already used for a different request'
      using errcode = '23505';
  end if;
  if stored_request.state = 'completed' then
    return query select
      (stored_request.response ->> 'workout_checkin_id')::uuid,
      (stored_request.response ->> 'current_week_count')::integer;
    return;
  end if;

  select * into found_membership
  from app_private.memberships
  where account_id = actor_id and ended_at is null
  for update;
  if not found then
    raise exception 'current membership required' using errcode = '42501';
  end if;

  select mw.* into found_member_week
  from app_private.member_weeks mw
  join app_private.accountability_weeks aw
    on aw.accountability_week_id = mw.accountability_week_id
  where mw.membership_id = found_membership.membership_id
    and mw.status = 'active'
    and requested_at >= aw.starts_at and requested_at < aw.ends_at
  for update of mw;
  if not found then
    raise exception 'active member week required' using errcode = '42501';
  end if;

  select * into found_week
  from app_private.accountability_weeks
  where accountability_week_id = found_member_week.accountability_week_id;
  if requested_self_report_attested is not true then
    raise exception 'self-report attestation required' using errcode = '22023';
  end if;
  if requested_duration_minutes <= 0 then
    raise exception 'duration must be positive' using errcode = '22023';
  end if;
  if requested_completed_at > requested_at then
    raise exception 'completion cannot be in the future' using errcode = '22023';
  end if;
  if requested_completed_at < found_membership.joined_at
     or (found_membership.ended_at is not null
         and requested_completed_at >= found_membership.ended_at) then
    raise exception 'completion must be within membership' using errcode = '22023';
  end if;
  if requested_completed_at < found_week.starts_at
     or requested_completed_at >= found_week.ends_at
     or (found_week.activation_at is not null
         and requested_completed_at < found_week.activation_at) then
    raise exception 'completion must be within assigned accountability week'
      using errcode = '22023';
  end if;

  insert into app_private.workout_checkins (
    workout_checkin_id, member_week_id, membership_id, activity_type,
    completed_at, duration_minutes, perceived_intensity,
    self_report_attested, submitted_at
  ) values (
    requested_workout_checkin_id, found_member_week.member_week_id,
    found_membership.membership_id, requested_activity_type,
    requested_completed_at, requested_duration_minutes,
    requested_perceived_intensity, requested_self_report_attested, requested_at
  );

  select count(*)::integer into completed_count
  from app_private.workout_checkins
  where member_week_id = found_member_week.member_week_id;
  completed_response := jsonb_build_object(
    'workout_checkin_id', requested_workout_checkin_id,
    'current_week_count', completed_count
  );
  update app_private.idempotent_requests
  set state = 'completed', response = completed_response, completed_at = requested_at
  where idempotency_key = requested_idempotency_key;

  return query select requested_workout_checkin_id, completed_count;
end;
$$;

create or replace function app_private.current_week_progress(
  requested_group_id uuid,
  requested_at timestamptz
) returns table (membership_id uuid, locked_target integer, completed_workout_count integer)
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
  select m.membership_id, mw.target, count(wc.workout_checkin_id)::integer
  from app_private.memberships m
  join app_private.member_weeks mw on mw.membership_id = m.membership_id
  join app_private.accountability_weeks aw
    on aw.accountability_week_id = mw.accountability_week_id
  left join app_private.workout_checkins wc on wc.member_week_id = mw.member_week_id
  where m.group_id = requested_group_id
    and m.ended_at is null
    and requested_at >= aw.starts_at and requested_at < aw.ends_at
  group by m.membership_id, mw.target
  order by m.membership_id;
end;
$$;

alter table app_private.workout_checkins enable row level security;
revoke all on table app_private.workout_checkins from public, anon, authenticated;
revoke all on function app_private.submit_workout_checkin(
  uuid, text, uuid, uuid, app_private.workout_activity_type, timestamptz,
  integer, app_private.perceived_intensity, boolean, timestamptz
) from public, anon, authenticated;
revoke all on function app_private.current_week_progress(uuid, timestamptz)
  from public, anon;

grant execute on function app_private.submit_workout_checkin(
  uuid, text, uuid, uuid, app_private.workout_activity_type, timestamptz,
  integer, app_private.perceived_intensity, boolean, timestamptz
) to service_role;
grant execute on function app_private.current_week_progress(uuid, timestamptz)
  to authenticated, service_role;
grant select, insert on table app_private.workout_checkins to service_role;

insert into app_private.schema_versions (version) values (4);
