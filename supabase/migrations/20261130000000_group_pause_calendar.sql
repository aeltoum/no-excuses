-- Group pause stops the clock (owner-approved 2026-11-22). While a Service pause is open the
-- Group's week does not roll over and the Week countdown shows Paused. When the operator ends
-- it, the current week and the whole calendar after it move later by the pause's length, so
-- nobody loses time; later weeks keep that offset. Members get a notification when the pause
-- opens and when it ends. Technical pauses (one member) are unchanged.

alter table app_private.groups
  add column calendar_offset interval not null default interval '0';

create or replace function app_private.notify_group(
  requested_group_id uuid, requested_key text, requested_title text, requested_body text
) returns void
language sql security definer set search_path = '' as $$
  insert into app_private.web_push_outbox (account_id, dedupe_key, title, body)
  select m.account_id, requested_key || ':' || m.account_id, requested_title, requested_body
  from app_private.memberships m
  join app_private.accounts a on a.account_id = m.account_id
  where m.group_id = requested_group_id and m.ended_at is null and a.status = 'active'
  on conflict (dedupe_key) do nothing;
$$;

-- Moves everything the pause covered later by its length.
create or replace function app_private.shift_group_calendar(
  requested_group_id uuid, paused_from timestamptz, shift interval
) returns timestamptz
language plpgsql security definer set search_path = '' as $$
declare item record; current_end timestamptz;
begin
  -- Latest first, so moved weeks never collide with (group_id, starts_at).
  for item in
    select accountability_week_id from app_private.accountability_weeks
    where group_id = requested_group_id and ends_at > paused_from
    order by starts_at desc
  loop
    update app_private.accountability_weeks set
      starts_at = case when starts_at > paused_from then starts_at + shift else starts_at end,
      activation_at = case when activation_at > paused_from then activation_at + shift
        else activation_at end,
      ends_at = ends_at + shift
    where accountability_week_id = item.accountability_week_id;
  end loop;
  update app_private.exception_requests r set week_starts_at = r.week_starts_at + shift
  from app_private.memberships m
  where m.membership_id = r.membership_id and m.group_id = requested_group_id
    and r.week_starts_at > paused_from;
  update app_private.seasons set
    starts_at = case when starts_at > paused_from then starts_at + shift else starts_at end,
    ends_at = ends_at + shift
  where group_id = requested_group_id and ends_at > paused_from;
  update app_private.groups set calendar_offset = calendar_offset + shift
  where group_id = requested_group_id;
  select max(ends_at) into current_end from app_private.accountability_weeks
  where group_id = requested_group_id;
  return current_end;
end;
$$;

create or replace function app_private.operator_set_hold(
  requested_group_id uuid, requested_membership_id uuid, requested_reason text,
  requested_open boolean, requested_hold_id uuid, requested_at timestamptz
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  operator uuid := app_private.actor_operator();
  hold app_private.operator_holds%rowtype;
  new_end timestamptz;
  zone text;
begin
  if requested_open then
    if requested_membership_id is not null and not exists (
      select 1 from app_private.memberships
      where membership_id = requested_membership_id and group_id = requested_group_id
        and ended_at is null
    ) then
      raise exception 'member not in Group' using errcode = '22023';
    end if;
    if requested_membership_id is null and exists (
      select 1 from app_private.operator_holds
      where group_id = requested_group_id and kind = 'service' and ends_at is null
    ) then
      raise exception 'Group is already paused' using errcode = '22023';
    end if;
    insert into app_private.operator_holds
      (kind, group_id, membership_id, reason, opened_by, starts_at)
    values (case when requested_membership_id is null then 'service' else 'technical' end,
      requested_group_id, requested_membership_id, btrim(requested_reason), operator, requested_at)
    returning * into hold;
    if hold.kind = 'service' then
      perform app_private.notify_group(hold.group_id, 'pause:' || hold.operator_hold_id || ':start',
        'Week paused',
        'The clock is stopped: ' || hold.reason || '. Nobody misses for this, and the time comes back when it resumes.');
    end if;
  else
    update app_private.operator_holds set ends_at = requested_at
    where operator_hold_id = requested_hold_id and ends_at is null
    returning * into hold;
    if hold.kind = 'service' then
      new_end := app_private.shift_group_calendar(
        hold.group_id, hold.starts_at, requested_at - hold.starts_at);
      select time_zone into zone from app_private.groups where group_id = hold.group_id;
      perform app_private.notify_group(hold.group_id, 'pause:' || hold.operator_hold_id || ':end',
        'Week resumed',
        'The clock is running again. This week now ends '
          || to_char(new_end at time zone zone, 'FMDay FMMonth FMDD, FMHH12:MI AM') || '.');
    end if;
  end if;
  return app_private.operator_console(requested_at);
end;
$$;

-- A Group under a Service pause does not roll over; later weeks keep the calendar offset.
create or replace function app_private.advance_true_mvp_weeks(requested_at timestamptz)
returns integer language plpgsql security definer set search_path = '' as $$
declare
  item record;
  week_start timestamptz;
  week_end timestamptz;
  week_id uuid;
  step_count integer := 0;
  zone text;
  starts smallint;
begin
  for item in
    select g.group_id, g.time_zone, g.week_starts, g.pending_time_zone, g.pending_week_starts,
      g.calendar_offset, max(aw.ends_at) as last_end
    from app_private.groups g
    join app_private.accountability_weeks aw on aw.group_id = g.group_id
    where g.status = 'active' and not exists (
      select 1 from app_private.operator_holds h
      where h.group_id = g.group_id and h.kind = 'service' and h.ends_at is null)
    group by g.group_id
  loop
    week_end := item.last_end;
    zone := item.time_zone;
    starts := item.week_starts;
    while week_end <= requested_at loop
      if step_count >= 520 then
        raise exception 'weekly backlog exceeds maintenance limit' using errcode = '22023';
      end if;
      if item.pending_time_zone is not null then
        zone := item.pending_time_zone;
        starts := item.pending_week_starts;
        update app_private.groups
        set time_zone = zone, week_starts = starts,
          pending_time_zone = null, pending_week_starts = null
        where group_id = item.group_id;
        item.pending_time_zone := null;
      end if;
      week_start := week_end;
      select bounds.ends_at + item.calendar_offset into week_end
      from app_private.accountability_week_bounds(
        week_start - item.calendar_offset + interval '1 second', zone, starts) bounds;
      if week_end - week_start < interval '3 days' then
        week_end := week_end + interval '7 days';
      end if;
      week_id := gen_random_uuid();
      insert into app_private.accountability_weeks
        (accountability_week_id, group_id, starts_at, ends_at, time_zone, activation_at)
      values (week_id, item.group_id, week_start, week_end, zone, week_start)
      on conflict (group_id, starts_at) do nothing;
      select accountability_week_id into week_id
      from app_private.accountability_weeks
      where group_id = item.group_id and starts_at = week_start;
      insert into app_private.member_weeks
        (member_week_id, membership_id, accountability_week_id, target, target_locked_at)
      select gen_random_uuid(), m.membership_id, week_id, m.recurring_target, week_start
      from app_private.memberships m
      where m.group_id = item.group_id and m.ended_at is null
      on conflict (membership_id, accountability_week_id) do nothing;
      step_count := step_count + 1;
    end loop;
  end loop;
  perform app_private.finalize_ended_member_weeks(requested_at);
  return step_count;
end;
$$;

-- Home learns about an open Group pause so the countdown can stop.
create or replace function app_private.home_extras(requested_at timestamptz)
returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare viewer app_private.memberships := app_private.actor_current_membership();
begin
  return app_private.home_extras_exceptions(requested_at)
    || jsonb_build_object(
      'recap', app_private.home_recap(requested_at),
      'season', app_private.season_home(requested_at),
      'unlocks', app_private.home_unlocks(requested_at),
      'unreadNotifications', app_private.notification_unread(requested_at),
      'safety', app_private.home_safety(requested_at),
      'session', app_private.my_session(requested_at),
      'pausedStreak', viewer.paused_target_streak,
      'comeback', app_private.comeback_week(requested_at),
      'freeWeekOff', viewer.membership_id is not null
        and app_private.free_week_off_available(viewer.membership_id, requested_at),
      'groupPause', (
        select jsonb_build_object('since', h.starts_at, 'reason', h.reason)
        from app_private.operator_holds h
        where h.group_id = viewer.group_id and h.kind = 'service' and h.ends_at is null
        order by h.starts_at limit 1)
    );
end;
$$;

revoke all on function app_private.notify_group(uuid, text, text, text),
  app_private.shift_group_calendar(uuid, timestamptz, interval),
  app_private.operator_set_hold(uuid, uuid, text, boolean, uuid, timestamptz),
  app_private.advance_true_mvp_weeks(timestamptz),
  app_private.home_extras(timestamptz)
  from public, anon, authenticated;
grant execute on function app_private.operator_set_hold(uuid, uuid, text, boolean, uuid, timestamptz),
  app_private.advance_true_mvp_weeks(timestamptz),
  app_private.home_extras(timestamptz)
  to service_role;

insert into app_private.schema_versions (version) values (63);
