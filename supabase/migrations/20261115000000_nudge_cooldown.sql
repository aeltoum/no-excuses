-- Nudges: a rolling 4-hour cooldown per friend instead of once per UTC day.
alter table app_private.nudges
  drop constraint if exists nudges_from_membership_id_to_membership_id_nudge_day_key;
create index nudges_recent on app_private.nudges (from_membership_id, to_membership_id, created_at);

create or replace function app_private.nudge_member(
  requested_membership_id uuid, requested_at timestamptz
) returns boolean
language plpgsql security definer set search_path = '' as $$
declare viewer app_private.memberships := app_private.actor_current_membership();
begin
  if viewer.membership_id is null then
    raise exception 'current Group membership required' using errcode = '42501';
  end if;
  if requested_membership_id = viewer.membership_id or not exists (
    select 1 from app_private.memberships m
    join app_private.member_weeks mw on mw.membership_id = m.membership_id
    join app_private.accountability_weeks aw on aw.accountability_week_id = mw.accountability_week_id
    where m.membership_id = requested_membership_id and m.group_id = viewer.group_id
      and m.ended_at is null
      and requested_at >= aw.starts_at and requested_at < aw.ends_at
      and (select count(*) from app_private.workout_checkins c
           where c.member_week_id = mw.member_week_id
             and c.review_status not in ('unsupported', 'rejected')) < mw.target
  ) then
    raise exception 'Nudge unavailable' using errcode = '42501';
  end if;
  -- One nudge per friend at a time; the lock keeps two quick taps from both landing.
  perform pg_advisory_xact_lock(hashtext(viewer.membership_id::text || requested_membership_id::text));
  if exists (
    select 1 from app_private.nudges n
    where n.from_membership_id = viewer.membership_id
      and n.to_membership_id = requested_membership_id
      and n.created_at > requested_at - interval '4 hours'
  ) then
    raise exception 'Already nudged' using errcode = '23505';
  end if;
  insert into app_private.nudges (from_membership_id, to_membership_id, nudge_day, created_at)
  values (viewer.membership_id, requested_membership_id, (requested_at at time zone 'UTC')::date, requested_at);
  return true;
end;
$$;

create or replace function app_private.nudged_today(requested_at timestamptz)
returns setof uuid
language sql stable security definer set search_path = '' as $$
  select distinct n.to_membership_id from app_private.nudges n
  where n.from_membership_id = (app_private.actor_current_membership()).membership_id
    and n.created_at > requested_at - interval '4 hours';
$$;

insert into app_private.schema_versions (version) values (48);
