-- Group governance (owner-approved 2026-10-20): Group admins rename the Group, promote and
-- demote admins, and change the start day and time zone, which take effect when the current
-- week closes. Members see Membership events created during their own membership.

alter table app_private.groups
  add column pending_time_zone text,
  add column pending_week_starts smallint,
  add constraint groups_pending_week_starts check (pending_week_starts between 1 and 7);

create table app_private.group_events (
  group_event_id uuid primary key default gen_random_uuid(),
  group_id uuid not null references app_private.groups(group_id) on delete cascade,
  kind text not null check (kind in ('renamed', 'admin_granted', 'admin_revoked', 'settings_changed')),
  actor_membership_id uuid references app_private.memberships(membership_id) on delete set null,
  subject_membership_id uuid references app_private.memberships(membership_id) on delete set null,
  detail text,
  created_at timestamptz not null
);
create index group_events_group_created on app_private.group_events (group_id, created_at desc);

-- The caller's current membership when it holds the Group admin role.
create or replace function app_private.actor_admin_membership()
returns app_private.memberships
language plpgsql stable security definer set search_path = '' as $$
declare viewer app_private.memberships := app_private.actor_current_membership();
begin
  if viewer.membership_id is null or not exists (
    select 1 from app_private.group_admins where membership_id = viewer.membership_id
  ) then
    raise exception 'Group admin required' using errcode = '42501';
  end if;
  return viewer;
end;
$$;

create or replace function app_private.group_settings(requested_at timestamptz)
returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  viewer app_private.memberships := app_private.actor_current_membership();
  found_group app_private.groups%rowtype;
begin
  if viewer.membership_id is null then
    raise exception 'current Group membership required' using errcode = '42501';
  end if;
  select * into found_group from app_private.groups where group_id = viewer.group_id;
  return jsonb_build_object(
    'name', found_group.name,
    'timeZone', found_group.time_zone,
    'weekStarts', found_group.week_starts,
    'pendingTimeZone', found_group.pending_time_zone,
    'pendingWeekStarts', found_group.pending_week_starts,
    'admin', exists (select 1 from app_private.group_admins where membership_id = viewer.membership_id),
    'changesAt', (
      select min(aw.ends_at) from app_private.accountability_weeks aw
      where aw.group_id = viewer.group_id and aw.ends_at > requested_at
    )
  );
end;
$$;

create or replace function app_private.rename_group(requested_name text, requested_at timestamptz)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  viewer app_private.memberships := app_private.actor_admin_membership();
  cleaned text := btrim(coalesce(requested_name, ''));
begin
  if length(cleaned) not between 1 and 80 then
    raise exception 'Group name must be 1 to 80 characters' using errcode = '22023';
  end if;
  update app_private.groups set name = cleaned
  where group_id = viewer.group_id and name is distinct from cleaned;
  if found then
    insert into app_private.group_events (group_id, kind, actor_membership_id, detail, created_at)
    values (viewer.group_id, 'renamed', viewer.membership_id, cleaned, requested_at);
  end if;
  return app_private.group_settings(requested_at);
end;
$$;

-- Any Group admin may promote a member or demote another admin; one admin always remains.
create or replace function app_private.set_group_admin(
  requested_membership_id uuid, requested_admin boolean, requested_at timestamptz
) returns boolean
language plpgsql security definer set search_path = '' as $$
declare
  viewer app_private.memberships := app_private.actor_admin_membership();
  target app_private.memberships%rowtype;
begin
  perform 1 from app_private.groups where group_id = viewer.group_id for update;
  select * into target from app_private.memberships
  where membership_id = requested_membership_id and group_id = viewer.group_id
    and ended_at is null;
  if target.membership_id is null then
    raise exception 'Group action unavailable' using errcode = '42501';
  end if;
  if requested_admin then
    insert into app_private.group_admins (membership_id, granted_at)
    values (target.membership_id, requested_at)
    on conflict (membership_id) do nothing;
    if found then
      insert into app_private.group_events
        (group_id, kind, actor_membership_id, subject_membership_id, created_at)
      values (viewer.group_id, 'admin_granted', viewer.membership_id, target.membership_id, requested_at);
    end if;
    return true;
  end if;
  if target.membership_id = viewer.membership_id then
    raise exception 'Another admin must remove your role' using errcode = '42501';
  end if;
  delete from app_private.group_admins where membership_id = target.membership_id;
  if found then
    insert into app_private.group_events
      (group_id, kind, actor_membership_id, subject_membership_id, created_at)
    values (viewer.group_id, 'admin_revoked', viewer.membership_id, target.membership_id, requested_at);
  end if;
  return false;
end;
$$;

-- Start day and time zone apply from the next week; a Group without a running week changes now.
create or replace function app_private.set_group_settings(
  requested_time_zone text, requested_week_starts smallint, requested_at timestamptz
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  viewer app_private.memberships := app_private.actor_admin_membership();
  found_group app_private.groups%rowtype;
  day_names text[] := array['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
begin
  if not exists (select 1 from pg_catalog.pg_timezone_names where name = requested_time_zone)
     or requested_week_starts is null or requested_week_starts not between 1 and 7 then
    raise exception 'unknown time zone or start day' using errcode = '22023';
  end if;
  select * into found_group from app_private.groups where group_id = viewer.group_id for update;
  if found_group.time_zone = requested_time_zone
     and found_group.week_starts = requested_week_starts then
    update app_private.groups set pending_time_zone = null, pending_week_starts = null
    where group_id = found_group.group_id;
  elsif found_group.status = 'active' then
    update app_private.groups
    set pending_time_zone = requested_time_zone, pending_week_starts = requested_week_starts
    where group_id = found_group.group_id;
  else
    update app_private.groups
    set time_zone = requested_time_zone, week_starts = requested_week_starts,
      pending_time_zone = null, pending_week_starts = null
    where group_id = found_group.group_id;
  end if;
  insert into app_private.group_events (group_id, kind, actor_membership_id, detail, created_at)
  values (viewer.group_id, 'settings_changed', viewer.membership_id,
    day_names[requested_week_starts] || ' · ' || requested_time_zone, requested_at);
  return app_private.group_settings(requested_at);
end;
$$;

-- Joins, departures, role changes, and setting changes from the viewer's own membership onward.
create or replace function app_private.group_activity(requested_at timestamptz)
returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare viewer app_private.memberships := app_private.actor_current_membership();
begin
  if viewer.membership_id is null then
    raise exception 'current Group membership required' using errcode = '42501';
  end if;
  return coalesce((
    select jsonb_agg(event order by (event ->> 'at') desc)
    from (
      select jsonb_build_object(
        'kind', e.kind, 'at', e.at, 'name', e.name, 'actor', e.actor, 'detail', e.detail
      ) as event
      from (
        select 'joined' as kind, m.joined_at as at, app_private.member_label(m.membership_id) as name,
          null::text as actor, null::text as detail
        from app_private.memberships m where m.group_id = viewer.group_id
        union all
        select m.end_reason::text, m.ended_at, app_private.member_label(m.membership_id), null, null
        from app_private.memberships m
        where m.group_id = viewer.group_id and m.ended_at is not null
        union all
        select g.kind, g.created_at, app_private.member_label(g.subject_membership_id),
          app_private.member_label(g.actor_membership_id), g.detail
        from app_private.group_events g where g.group_id = viewer.group_id
      ) e
      where e.at >= viewer.joined_at and e.at <= requested_at
      order by e.at desc
      limit 40
    ) recent
  ), '[]'::jsonb);
end;
$$;

create or replace function app_private.member_label(requested_membership_id uuid)
returns text
language sql stable security definer set search_path = '' as $$
  select case when a.status = 'deleted' then 'Former member'
    else coalesce(a.display_name, 'Member ' || left(m.membership_id::text, 8)) end
  from app_private.memberships m join app_private.accounts a on a.account_id = m.account_id
  where m.membership_id = requested_membership_id;
$$;

-- Weekly rollover applies pending Group settings. When a new start day would begin before the
-- previous week ended, the first week under the new settings starts at that end instead, and a
-- remainder under three days joins the following week.
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
      max(aw.ends_at) as last_end
    from app_private.groups g
    join app_private.accountability_weeks aw on aw.group_id = g.group_id
    where g.status = 'active'
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
      select bounds.ends_at into week_end
      from app_private.accountability_week_bounds(week_start + interval '1 second', zone, starts) bounds;
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

alter table app_private.group_events enable row level security;
revoke all on table app_private.group_events from public, anon, authenticated;
grant select, insert, update, delete on table app_private.group_events to service_role;
revoke all on function app_private.actor_admin_membership(),
  app_private.group_settings(timestamptz),
  app_private.rename_group(text, timestamptz),
  app_private.set_group_admin(uuid, boolean, timestamptz),
  app_private.set_group_settings(text, smallint, timestamptz),
  app_private.group_activity(timestamptz),
  app_private.member_label(uuid)
  from public, anon, authenticated;
grant execute on function app_private.actor_admin_membership(),
  app_private.group_settings(timestamptz),
  app_private.rename_group(text, timestamptz),
  app_private.set_group_admin(uuid, boolean, timestamptz),
  app_private.set_group_settings(text, smallint, timestamptz),
  app_private.group_activity(timestamptz),
  app_private.member_label(uuid)
  to service_role;

insert into app_private.schema_versions (version) values (31);
