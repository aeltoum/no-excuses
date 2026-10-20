-- Timed Workout sessions in the PWA (owner-approved 2026-10-20). A member starts a session,
-- takes photo candidates during it (they stay on the device), and on finishing picks one
-- Activity and one Member-presence photo for the post. Only the picked pair uploads. Sessions
-- end after 12 hours, one is active at a time, and each produces at most one post.

alter table app_private.workout_checkins
  add column workout_session_id uuid unique
    references app_private.workout_sessions(workout_session_id) on delete set null;

create or replace function app_private.my_session(requested_at timestamptz)
returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('id', ws.workout_session_id, 'startedAt', ws.started_at)
  from app_private.workout_sessions ws
  where ws.membership_id = (app_private.actor_current_membership()).membership_id
    and ws.status = 'active' and requested_at < ws.started_at + interval '12 hours'
  limit 1;
$$;

create or replace function app_private.start_my_session(
  requested_session_id uuid, requested_at timestamptz
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare viewer app_private.memberships := app_private.actor_current_membership();
begin
  perform app_private.expire_workout_sessions(requested_at);
  if exists (select 1 from app_private.workout_sessions
      where workout_session_id = requested_session_id and membership_id = viewer.membership_id) then
    return app_private.my_session(requested_at);
  end if;
  perform app_private.start_workout_session(requested_session_id, viewer.membership_id, requested_at);
  return app_private.my_session(requested_at);
end;
$$;

create or replace function app_private.end_my_session(
  requested_session_id uuid, requested_at timestamptz
) returns jsonb
language plpgsql security definer set search_path = '' as $$
begin
  if exists (select 1 from app_private.workout_sessions
      where workout_session_id = requested_session_id and status = 'active') then
    perform app_private.end_workout_session(requested_session_id, requested_at);
  end if;
  return (
    select jsonb_build_object('id', workout_session_id, 'startedAt', started_at,
      'endedAt', ended_at, 'status', status)
    from app_private.workout_sessions ws
    where ws.workout_session_id = requested_session_id
      and ws.membership_id = (app_private.actor_current_membership()).membership_id
  );
end;
$$;

-- Ties the post made from a session to it; a session yields at most one post.
create or replace function app_private.link_session_checkin(
  requested_session_id uuid, requested_checkin_id uuid, requested_at timestamptz
) returns boolean
language plpgsql security definer set search_path = '' as $$
declare viewer app_private.memberships := app_private.actor_current_membership();
begin
  update app_private.workout_checkins c set workout_session_id = requested_session_id
  from app_private.workout_sessions ws
  where c.workout_checkin_id = requested_checkin_id and c.membership_id = viewer.membership_id
    and ws.workout_session_id = requested_session_id and ws.membership_id = viewer.membership_id
    and ws.status <> 'active'
    and (c.workout_session_id is null or c.workout_session_id = requested_session_id);
  if not found then
    raise exception 'link unavailable' using errcode = '42501';
  end if;
  return true;
end;
$$;

create or replace function app_private.home_extras(requested_at timestamptz)
returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  return app_private.home_extras_exceptions(requested_at)
    || jsonb_build_object(
      'missed', app_private.home_missed(requested_at),
      'season', app_private.season_home(requested_at),
      'unlocks', app_private.home_unlocks(requested_at),
      'unreadNotifications', app_private.notification_unread(requested_at),
      'safety', app_private.home_safety(requested_at),
      'session', app_private.my_session(requested_at)
    );
end;
$$;

revoke all on function app_private.my_session(timestamptz),
  app_private.start_my_session(uuid, timestamptz),
  app_private.end_my_session(uuid, timestamptz),
  app_private.link_session_checkin(uuid, uuid, timestamptz),
  app_private.home_extras(timestamptz)
  from public, anon, authenticated;
grant execute on function app_private.my_session(timestamptz),
  app_private.start_my_session(uuid, timestamptz),
  app_private.end_my_session(uuid, timestamptz),
  app_private.link_session_checkin(uuid, uuid, timestamptz),
  app_private.home_extras(timestamptz)
  to service_role;

insert into app_private.schema_versions (version) values (42);
