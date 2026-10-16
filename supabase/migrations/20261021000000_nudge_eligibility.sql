-- Nudge eligibility now matches the Home friend cards (current_week_progress): any current-week
-- member week counts, and Unsupported or Rejected reports drop out. Before, a friend shown as
-- behind (e.g. after a rejected report) could not be nudged and no push was sent.
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
  insert into app_private.nudges (from_membership_id, to_membership_id, nudge_day, created_at)
  values (viewer.membership_id, requested_membership_id, (requested_at at time zone 'UTC')::date, requested_at)
  on conflict (from_membership_id, to_membership_id, nudge_day) do nothing;
  if not found then
    raise exception 'Already nudged today' using errcode = '23505';
  end if;
  return true;
end;
$$;

insert into app_private.schema_versions (version) values (25);
