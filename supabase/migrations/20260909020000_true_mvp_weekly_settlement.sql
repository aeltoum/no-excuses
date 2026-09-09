create or replace function app_private.finalize_ended_member_weeks(
  requested_at timestamptz
) returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  finalized_count integer;
begin
  with completed_counts as (
    select mw.member_week_id, count(wc.workout_checkin_id)::integer as completed_count
    from app_private.member_weeks mw
    join app_private.memberships m on m.membership_id = mw.membership_id
    join app_private.accountability_weeks aw
      on aw.accountability_week_id = mw.accountability_week_id
    left join app_private.workout_checkins wc on wc.member_week_id = mw.member_week_id
    where mw.status = 'active'
      and m.ended_at is null
      and requested_at >= aw.ends_at
    group by mw.member_week_id
  )
  update app_private.member_weeks mw
  set status = case
    when completed_counts.completed_count >= mw.target then 'attained'::app_private.member_week_status
    else 'missed'::app_private.member_week_status
  end
  from completed_counts
  where mw.member_week_id = completed_counts.member_week_id
    and mw.status = 'active';

  get diagnostics finalized_count = row_count;
  return finalized_count;
end;
$$;

create or replace function app_private.finalized_weekly_history(
  requested_group_id uuid
) returns table (
  membership_id uuid,
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
  select m.membership_id, aw.starts_at, aw.ends_at, mw.target,
    count(wc.workout_checkin_id)::integer, mw.status
  from app_private.memberships m
  join app_private.member_weeks mw on mw.membership_id = m.membership_id
  join app_private.accountability_weeks aw
    on aw.accountability_week_id = mw.accountability_week_id
  left join app_private.workout_checkins wc on wc.member_week_id = mw.member_week_id
  where m.group_id = requested_group_id
    and mw.status in ('attained', 'missed')
    and aw.ends_at > viewer_joined_at
  group by m.membership_id, aw.starts_at, aw.ends_at, mw.target, mw.status
  order by aw.ends_at desc, m.membership_id;
end;
$$;

revoke all on function app_private.finalize_ended_member_weeks(timestamptz)
  from public, anon, authenticated;
revoke all on function app_private.finalized_weekly_history(uuid)
  from public, anon;

grant execute on function app_private.finalize_ended_member_weeks(timestamptz)
  to service_role;
grant execute on function app_private.finalized_weekly_history(uuid)
  to authenticated, service_role;

insert into app_private.schema_versions (version) values (6);
