-- Streaks: current-week progress carries each member's Target and Workout streak, and
-- finalized history carries the Target streak as of each week. Both derive on read:
-- Target streak from the settled memberships.target_streak and finalized member-weeks,
-- Workout streak from Verified completions since the membership's latest missed week.

drop function app_private.current_week_progress(uuid, timestamptz);
create function app_private.current_week_progress(
  requested_group_id uuid,
  requested_at timestamptz
) returns table (
  membership_id uuid,
  display_name text,
  locked_target integer,
  completed_workout_count integer,
  activity_types text[],
  target_streak integer,
  workout_streak integer
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
    mw.target, count(wc.workout_checkin_id)::integer,
    coalesce(
      array_agg(wc.activity_type::text order by wc.completed_at, wc.workout_checkin_id)
        filter (where wc.workout_checkin_id is not null),
      array[]::text[]
    ),
    m.target_streak,
    (
      select count(*)::integer
      from app_private.member_weeks smw
      join app_private.accountability_weeks saw
        on saw.accountability_week_id = smw.accountability_week_id
      join app_private.workout_checkins swc on swc.member_week_id = smw.member_week_id
      where smw.membership_id = m.membership_id
        and swc.review_status = 'verified'
        and saw.ends_at > coalesce((
          select max(maw.ends_at)
          from app_private.member_weeks mmw
          join app_private.accountability_weeks maw
            on maw.accountability_week_id = mmw.accountability_week_id
          where mmw.membership_id = m.membership_id and mmw.status = 'missed'
        ), '-infinity'::timestamptz)
    )
  from app_private.memberships m
  join app_private.accounts a on a.account_id = m.account_id
  join app_private.member_weeks mw on mw.membership_id = m.membership_id
  join app_private.accountability_weeks aw
    on aw.accountability_week_id = mw.accountability_week_id
  left join app_private.workout_checkins wc on wc.member_week_id = mw.member_week_id
    and wc.review_status not in ('unsupported', 'rejected')
  where m.group_id = requested_group_id
    and m.ended_at is null
    and requested_at >= aw.starts_at and requested_at < aw.ends_at
  group by m.membership_id, a.display_name, mw.target, m.target_streak
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
  outcome app_private.member_week_status,
  target_streak integer
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
  with weeks as (
    select m.membership_id,
      case when a.status = 'deleted' then 'Former member'
        else coalesce(a.display_name, 'Member ' || left(m.membership_id::text, 8)) end
        as display_name,
      aw.starts_at, aw.ends_at, mw.target,
      (select count(*)::integer from app_private.workout_checkins wc
        where wc.member_week_id = mw.member_week_id and wc.review_status = 'verified')
        as completed,
      mw.status,
      count(*) filter (where mw.status = 'missed') over (
        partition by m.membership_id order by aw.ends_at
      ) as miss_run
    from app_private.memberships m
    join app_private.accounts a on a.account_id = m.account_id
    join app_private.member_weeks mw on mw.membership_id = m.membership_id
    join app_private.accountability_weeks aw
      on aw.accountability_week_id = mw.accountability_week_id
    where m.group_id = requested_group_id
      and mw.status in ('attained', 'missed')
  ), streaks as (
    select w.*,
      (count(*) filter (where w.status = 'attained') over (
        partition by w.membership_id, w.miss_run order by w.ends_at
      ))::integer as streak
    from weeks w
  )
  select w.membership_id, w.display_name, w.starts_at, w.ends_at, w.target, w.completed,
    w.status, w.streak
  from streaks w
  where w.ends_at > viewer_joined_at
  order by w.ends_at desc, w.membership_id;
end;
$$;

revoke all on function app_private.current_week_progress(uuid, timestamptz),
  app_private.finalized_weekly_history(uuid)
  from public, anon, authenticated;
grant execute on function app_private.current_week_progress(uuid, timestamptz),
  app_private.finalized_weekly_history(uuid)
  to authenticated, service_role;

insert into app_private.schema_versions (version) values (24);
