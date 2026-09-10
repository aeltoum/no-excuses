create or replace function app_private.rebuild_group_read_models(
  requested_group_id uuid, requested_at timestamptz
) returns table (home_rows integer, group_rows integer, season_rows integer)
language plpgsql security definer set search_path = '' as $$
declare homes integer; groups_count integer; seasons_count integer;
begin
  delete from app_private.season_standing_projections p where p.viewer_membership_id in (
    select membership_id from app_private.memberships where group_id = requested_group_id);
  delete from app_private.group_member_projections where group_id = requested_group_id;
  delete from app_private.member_home_projections where group_id = requested_group_id;

  insert into app_private.member_home_projections
    (membership_id, group_id, accountability_week_id, week_status, locked_target,
     completed_workout_count, needs_you_count, rebuilt_at)
  select m.membership_id, m.group_id, mw.accountability_week_id, mw.status, mw.target,
    count(distinct wc.workout_checkin_id)::integer,
    case when mw.status = 'active' and count(distinct wc.workout_checkin_id) < mw.target
      then 1 else 0 end,
    requested_at
  from app_private.memberships m
  left join app_private.member_weeks mw on mw.membership_id = m.membership_id
    and exists (select 1 from app_private.accountability_weeks w
      where w.accountability_week_id = mw.accountability_week_id
        and requested_at >= w.starts_at and requested_at < w.ends_at)
  left join app_private.workout_checkins wc on wc.member_week_id = mw.member_week_id
  where m.group_id = requested_group_id and m.ended_at is null
  group by m.membership_id, m.group_id, mw.accountability_week_id, mw.status, mw.target;
  get diagnostics homes = row_count;

  insert into app_private.group_member_projections
    (viewer_membership_id, subject_membership_id, group_id, locked_target,
     completed_workout_count, week_status, rebuilt_at)
  select viewer.membership_id, home.membership_id, requested_group_id,
    home.locked_target, home.completed_workout_count, home.week_status, requested_at
  from app_private.memberships viewer
  cross join app_private.member_home_projections home
  where viewer.group_id = requested_group_id and viewer.ended_at is null
    and home.group_id = requested_group_id;
  get diagnostics groups_count = row_count;

  insert into app_private.season_standing_projections
    (viewer_membership_id, season_id, subject_membership_id, crowns, rank, cochampion, rebuilt_at)
  with current_season as (
    select season_id from app_private.seasons
    where group_id = requested_group_id
      and requested_at >= starts_at and requested_at < ends_at
  ), totals as (
    select season.season_id, member.membership_id,
      count(award.crown_award_id)::integer crowns
    from current_season season
    join app_private.memberships member on member.group_id = requested_group_id
      and member.joined_at <= requested_at and member.ended_at is null
    left join app_private.crown_awards award on award.season_id = season.season_id
      and award.membership_id = member.membership_id
    group by season.season_id, member.membership_id
  ), standings as (
    select totals.*,
      rank() over (partition by season_id order by crowns desc)::integer rank,
      crowns = max(crowns) over (partition by season_id) cochampion
    from totals
  )
  select viewer.membership_id, standings.season_id, standings.membership_id,
    standings.crowns, standings.rank, standings.cochampion, requested_at
  from standings
  join app_private.memberships viewer on viewer.group_id = requested_group_id
    and viewer.joined_at <= requested_at and viewer.ended_at is null;
  get diagnostics seasons_count = row_count;
  return query select homes, groups_count, seasons_count;
end;
$$;

create or replace function app_private.read_member_home_view(requested_at timestamptz)
returns table (
  membership_id uuid,
  group_id uuid,
  accountability_week_id uuid,
  week_status app_private.member_week_status,
  locked_target integer,
  completed_workout_count integer,
  needs_you_count integer,
  friend_activity jsonb,
  season_standings jsonb,
  rebuilt_at timestamptz
)
language sql stable security definer set search_path = '' as $$
  select home.membership_id, home.group_id, home.accountability_week_id,
    home.week_status, home.locked_target, home.completed_workout_count,
    home.needs_you_count,
    coalesce((
      select jsonb_agg(jsonb_build_object(
        'membership_id', friend.subject_membership_id,
        'locked_target', friend.locked_target,
        'completed_workout_count', friend.completed_workout_count,
        'week_status', friend.week_status
      ) order by friend.completed_workout_count desc, friend.subject_membership_id)
      from app_private.group_member_projections friend
      where friend.viewer_membership_id = home.membership_id
        and friend.subject_membership_id <> home.membership_id
        and friend.rebuilt_at <= requested_at
    ), '[]'::jsonb),
    coalesce((
      select jsonb_agg(jsonb_build_object(
        'membership_id', standing.subject_membership_id,
        'crowns', standing.crowns,
        'rank', standing.rank,
        'cochampion', standing.cochampion
      ) order by standing.rank, standing.subject_membership_id)
      from app_private.season_standing_projections standing
      where standing.viewer_membership_id = home.membership_id
        and standing.rebuilt_at <= requested_at
    ), '[]'::jsonb),
    home.rebuilt_at
  from app_private.read_member_home(requested_at) home
$$;

revoke all on function app_private.read_member_home_view(timestamptz) from public, anon;
grant execute on function app_private.read_member_home_view(timestamptz) to authenticated, service_role;
