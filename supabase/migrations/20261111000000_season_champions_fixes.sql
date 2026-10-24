-- Season champions: list a finished Season while the Group is paused, and count a
-- person's Crowns across a leave-and-rejoin within one Season.
-- The Season card: standings, the latest crowned week, and finished Seasons' champions.
create or replace function app_private.season_home(requested_at timestamptz)
returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  viewer app_private.memberships := app_private.actor_current_membership();
  current_season integer;
  current_week smallint;
  latest uuid;
begin
  if viewer.membership_id is null then
    raise exception 'current Group membership required' using errcode = '42501';
  end if;
  select p.season_number, p.week_number into current_season, current_week
  from app_private.group_week_positions(viewer.group_id) p
  where requested_at >= p.starts_at and requested_at < p.ends_at;
  if current_season is null then
    select max(season_number), 4 into current_season, current_week
    from app_private.pwa_crown_weeks where group_id = viewer.group_id;
  end if;
  select cw.accountability_week_id into latest
  from app_private.pwa_crown_weeks cw
  join app_private.accountability_weeks aw on aw.accountability_week_id = cw.accountability_week_id
  where cw.group_id = viewer.group_id and aw.ends_at > viewer.joined_at
  order by aw.ends_at desc limit 1;
  return jsonb_build_object(
    'season', current_season,
    'week', current_week,
    'standings', coalesce((
      select jsonb_agg(jsonb_build_object(
        'membershipId', s.membership_id, 'name', s.name, 'crowns', s.crowns,
        'mine', s.membership_id = viewer.membership_id, 'rank', s.rank
      ) order by s.rank, s.joined_at)
      from (
        select m.membership_id, m.joined_at, app_private.member_label(m.membership_id) as name,
          count(r.*) filter (where r.winner)::integer as crowns,
          rank() over (order by count(r.*) filter (where r.winner) desc)::integer as rank
        from app_private.memberships m
        left join app_private.pwa_crown_results r on r.membership_id = m.membership_id
          and r.accountability_week_id in (
            select cw.accountability_week_id from app_private.pwa_crown_weeks cw
            where cw.group_id = viewer.group_id and cw.season_number = current_season)
        where m.group_id = viewer.group_id and m.ended_at is null
        group by m.membership_id
      ) s
    ), '[]'::jsonb),
    'latest', case when latest is null then null else jsonb_build_object(
      'endsAt', (select ends_at from app_private.accountability_weeks where accountability_week_id = latest),
      'results', coalesce((
        select jsonb_agg(jsonb_build_object(
          'category', r.category, 'name', app_private.member_label(r.membership_id),
          'mine', r.membership_id = viewer.membership_id, 'score', r.score, 'winner', r.winner
        ) order by r.category, r.score desc)
        from app_private.pwa_crown_results r where r.accountability_week_id = latest
      ), '[]'::jsonb)
    ) end,
    'champions', coalesce((
      select jsonb_agg(jsonb_build_object('season', c.season_number, 'names', c.names, 'crowns', c.crowns)
        order by c.season_number desc)
      from (
        select t.season_number, jsonb_agg(t.name order by t.name) as names, max(t.crowns) as crowns
        from (
          select cw.season_number,
            app_private.member_label((array_agg(r.membership_id order by m.joined_at desc))[1]) as name,
            count(*)::integer as crowns,
            rank() over (partition by cw.season_number order by count(*) desc) as place
          from app_private.pwa_crown_weeks cw
          join app_private.pwa_crown_results r
            on r.accountability_week_id = cw.accountability_week_id and r.winner
          join app_private.memberships m on m.membership_id = r.membership_id
          where cw.group_id = viewer.group_id
            and cw.season_number in (
              select f.season_number from app_private.pwa_crown_weeks f
              where f.group_id = viewer.group_id and f.week_number = 4
                and f.crowned_at >= viewer.joined_at)
          group by cw.season_number, m.account_id
        ) t
        where t.place = 1
        group by t.season_number
      ) c
    ), '[]'::jsonb)
  );
end;
$$;

