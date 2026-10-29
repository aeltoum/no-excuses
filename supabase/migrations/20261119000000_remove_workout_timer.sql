-- Removes the timed Workout session feature (owner decision 2026-10-28). Home no longer reads
-- `session`, and the start, end, and link entry points go. The core Workout-session model from
-- schema version 4 stays, as do stored session rows and workout_checkins.workout_session_id;
-- dropping that stored data is a separate decision.

-- Close any session still running, with the same end rule as end_workout_session: one past
-- 12 hours is expired at its 12-hour mark, any other ends now. No post is linked.
update app_private.workout_sessions
set status = case
      when now() >= started_at + interval '12 hours'
        then 'expired'::app_private.workout_session_status
      else 'ended'::app_private.workout_session_status
    end,
    ended_at = least(now(), started_at + interval '12 hours')
where status = 'active';

create or replace function app_private.home_extras(requested_at timestamptz)
returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  return app_private.home_extras_exceptions(requested_at)
    || jsonb_build_object(
      'recap', app_private.home_recap(requested_at),
      'season', app_private.season_home(requested_at),
      'unlocks', app_private.home_unlocks(requested_at),
      'unreadNotifications', app_private.notification_unread(requested_at),
      'safety', app_private.home_safety(requested_at)
    );
end;
$$;

revoke all on function app_private.home_extras(timestamptz) from public, anon, authenticated;
grant execute on function app_private.home_extras(timestamptz) to service_role;

revoke all on function app_private.my_session(timestamptz),
  app_private.start_my_session(uuid, timestamptz),
  app_private.end_my_session(uuid, timestamptz),
  app_private.link_session_checkin(uuid, uuid, timestamptz)
  from public, anon, authenticated, service_role;
drop function app_private.link_session_checkin(uuid, uuid, timestamptz);
drop function app_private.end_my_session(uuid, timestamptz);
drop function app_private.start_my_session(uuid, timestamptz);
drop function app_private.my_session(timestamptz);

insert into app_private.schema_versions (version) values (52);
