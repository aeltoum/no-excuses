-- Crowns and Seasons on the PWA (owner-approved 2026-10-20). Once every member week of an
-- accountability week has settled, two Crown categories are scored from Verified posts' details:
--   Load Progression: best weight for an exercise, equipment, and rep count against the member's
--     best for the same lift in the previous eight weeks (bodyweight and band are ineligible).
--   Cardio Leap: time for the same cardio type and distance, or distance for the same type and
--     time, against the previous eight weeks' best.
-- A first comparable result sets a baseline but cannot win; excused weeks are ineligible; a
-- category needs two eligible members and only a real gain wins; ties share the Crown.
-- Seasons are each run of four of the Group's accountability weeks. Top Steps needs a device
-- step source the browser lacks, so it stays deferred.

create table app_private.pwa_crown_weeks (
  accountability_week_id uuid primary key
    references app_private.accountability_weeks(accountability_week_id) on delete cascade,
  group_id uuid not null references app_private.groups(group_id) on delete cascade,
  season_number integer not null check (season_number > 0),
  week_number smallint not null check (week_number between 1 and 4),
  crowned_at timestamptz not null
);

create table app_private.pwa_crown_results (
  accountability_week_id uuid not null
    references app_private.pwa_crown_weeks(accountability_week_id) on delete cascade,
  category text not null check (category in ('load_progression', 'cardio_leap')),
  membership_id uuid not null references app_private.memberships(membership_id) on delete cascade,
  score numeric not null,
  winner boolean not null,
  pushed_at timestamptz,
  primary key (accountability_week_id, category, membership_id)
);

-- Position of each of a Group's weeks: season n holds weeks 4n-3 through 4n.
create or replace function app_private.group_week_positions(requested_group_id uuid)
returns table (accountability_week_id uuid, starts_at timestamptz, ends_at timestamptz,
  season_number integer, week_number smallint)
language sql stable security definer set search_path = '' as $$
  select w.accountability_week_id, w.starts_at, w.ends_at,
    ((w.position - 1) / 4 + 1)::integer, ((w.position - 1) % 4 + 1)::smallint
  from (
    select aw.accountability_week_id, aw.starts_at, aw.ends_at,
      row_number() over (order by aw.starts_at) as position
    from app_private.accountability_weeks aw where aw.group_id = requested_group_id
  ) w;
$$;

-- Comparable results from Verified posts: one row per lift or cardio benchmark.
create or replace function app_private.performance_rows(requested_account_id uuid,
  requested_from timestamptz, requested_until timestamptz)
returns table (membership_id uuid, accountability_week_id uuid, category text, key text,
  measure numeric, higher_is_better boolean)
language sql stable security definer set search_path = '' as $$
  select m.membership_id, aw.accountability_week_id, 'load_progression',
    (l ->> 'exercise') || ':' || (l ->> 'equipment') || ':' || (l ->> 'reps'),
    (l ->> 'weightKg')::numeric, true
  from app_private.workout_checkins c
  join app_private.memberships m on m.membership_id = c.membership_id
  join app_private.member_weeks mw on mw.member_week_id = c.member_week_id
  join app_private.accountability_weeks aw on aw.accountability_week_id = mw.accountability_week_id
  cross join lateral jsonb_array_elements(coalesce(c.details -> 'lifts', '[]'::jsonb)) l
  where m.account_id = requested_account_id and c.review_status = 'verified'
    and aw.starts_at >= requested_from and aw.starts_at < requested_until
    and l ? 'weightKg' and (l ->> 'equipment') not in ('bodyweight', 'band')
  union all
  select m.membership_id, aw.accountability_week_id, 'cardio_leap',
    (c.details #>> '{cardio,activity}') || ':d:' || round((c.details #>> '{cardio,distanceKm}')::numeric, 1),
    (c.details #>> '{cardio,timeSeconds}')::numeric, false
  from app_private.workout_checkins c
  join app_private.memberships m on m.membership_id = c.membership_id
  join app_private.member_weeks mw on mw.member_week_id = c.member_week_id
  join app_private.accountability_weeks aw on aw.accountability_week_id = mw.accountability_week_id
  where m.account_id = requested_account_id and c.review_status = 'verified'
    and aw.starts_at >= requested_from and aw.starts_at < requested_until
    and c.details #> '{cardio,distanceKm}' is not null and c.details #> '{cardio,timeSeconds}' is not null
  union all
  select m.membership_id, aw.accountability_week_id, 'cardio_leap',
    (c.details #>> '{cardio,activity}') || ':t:' || round((c.details #>> '{cardio,timeSeconds}')::numeric / 60),
    (c.details #>> '{cardio,distanceKm}')::numeric, true
  from app_private.workout_checkins c
  join app_private.memberships m on m.membership_id = c.membership_id
  join app_private.member_weeks mw on mw.member_week_id = c.member_week_id
  join app_private.accountability_weeks aw on aw.accountability_week_id = mw.accountability_week_id
  where m.account_id = requested_account_id and c.review_status = 'verified'
    and aw.starts_at >= requested_from and aw.starts_at < requested_until
    and c.details #> '{cardio,distanceKm}' is not null and c.details #> '{cardio,timeSeconds}' is not null;
$$;

create or replace function app_private.crown_week(requested_week_id uuid, requested_at timestamptz)
returns integer
language plpgsql security definer set search_path = '' as $$
declare
  week record;
  awarded integer;
begin
  select p.*, aw.group_id into week
  from app_private.accountability_weeks aw
  cross join lateral app_private.group_week_positions(aw.group_id) p
  where aw.accountability_week_id = requested_week_id
    and p.accountability_week_id = requested_week_id;
  insert into app_private.pwa_crown_weeks
    (accountability_week_id, group_id, season_number, week_number, crowned_at)
  values (requested_week_id, week.group_id, week.season_number, week.week_number, requested_at)
  on conflict do nothing;
  if not found then return 0; end if;

  with members as (
    select m.membership_id, m.account_id
    from app_private.member_weeks mw
    join app_private.memberships m on m.membership_id = mw.membership_id
    where mw.accountability_week_id = requested_week_id and mw.status in ('attained', 'missed')
  ), current_best as (
    select r.membership_id, r.category, r.key,
      case when bool_and(r.higher_is_better) then max(r.measure) else min(r.measure) end as best,
      bool_and(r.higher_is_better) as higher
    from members mb
    cross join lateral app_private.performance_rows(mb.account_id, week.starts_at, week.ends_at) r
    where r.accountability_week_id = requested_week_id
    group by r.membership_id, r.category, r.key
  ), baseline as (
    select mb.membership_id, r.category, r.key,
      case when bool_and(r.higher_is_better) then max(r.measure) else min(r.measure) end as best
    from members mb
    cross join lateral app_private.performance_rows(
      mb.account_id, week.starts_at - interval '56 days', week.starts_at) r
    group by mb.membership_id, r.category, r.key
  ), scored as (
    select c.membership_id, c.category,
      round(max(case when c.higher then (c.best - b.best) / b.best
        else (b.best - c.best) / b.best end) * 100, 1) as score
    from current_best c
    join baseline b on b.membership_id = c.membership_id and b.category = c.category and b.key = c.key
    where b.best > 0
    group by c.membership_id, c.category
  ), contested as (
    select category, max(score) as top from scored group by category having count(*) >= 2
  )
  insert into app_private.pwa_crown_results
    (accountability_week_id, category, membership_id, score, winner)
  select requested_week_id, s.category, s.membership_id, s.score,
    k.top is not null and k.top > 0 and s.score = k.top
  from scored s left join contested k on k.category = s.category;
  get diagnostics awarded = row_count;
  return awarded;
end;
$$;

-- Crowns each week once all its member weeks have settled, oldest first.
create or replace function app_private.advance_crowns(requested_at timestamptz)
returns integer
language plpgsql security definer set search_path = '' as $$
declare item record; total integer := 0;
begin
  for item in
    select aw.accountability_week_id
    from app_private.accountability_weeks aw
    where aw.ends_at <= requested_at
      and not exists (select 1 from app_private.pwa_crown_weeks cw
        where cw.accountability_week_id = aw.accountability_week_id)
      and not exists (select 1 from app_private.member_weeks mw
        where mw.accountability_week_id = aw.accountability_week_id
          and mw.status in ('active', 'provisional'))
      and exists (select 1 from app_private.member_weeks mw
        where mw.accountability_week_id = aw.accountability_week_id)
    order by aw.ends_at
    limit 200
  loop
    perform app_private.crown_week(item.accountability_week_id, requested_at);
    total := total + 1;
  end loop;
  return total;
end;
$$;

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
          select cw.season_number, app_private.member_label(r.membership_id) as name,
            count(*)::integer as crowns,
            rank() over (partition by cw.season_number order by count(*) desc) as place
          from app_private.pwa_crown_weeks cw
          join app_private.pwa_crown_results r
            on r.accountability_week_id = cw.accountability_week_id and r.winner
          where cw.group_id = viewer.group_id
            and cw.season_number < coalesce(current_season, 1)
            and cw.season_number in (
              select f.season_number from app_private.pwa_crown_weeks f
              where f.group_id = viewer.group_id and f.week_number = 4
                and f.crowned_at >= viewer.joined_at)
          group by cw.season_number, r.membership_id
        ) t
        where t.place = 1
        group by t.season_number
      ) c
    ), '[]'::jsonb)
  );
end;
$$;

create or replace function app_private.home_extras(requested_at timestamptz)
returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  return app_private.home_extras_exceptions(requested_at)
    || jsonb_build_object(
      'missed', app_private.home_missed(requested_at),
      'season', app_private.season_home(requested_at)
    );
end;
$$;

-- Winners hear about their Crown once.
create or replace function app_private.enqueue_crown_push(requested_at timestamptz)
returns integer
language plpgsql security definer set search_path = '' as $$
declare added integer;
begin
  with due as (
    update app_private.pwa_crown_results r set pushed_at = requested_at
    where r.winner and r.pushed_at is null
    returning r.accountability_week_id, r.category, r.membership_id, r.score
  )
  insert into app_private.web_push_outbox (account_id, dedupe_key, title, body)
  select m.account_id, 'crown:' || due.accountability_week_id || ':' || due.category || ':' || m.account_id,
    'You won a Crown 👑',
    case due.category when 'load_progression' then 'Load Progression' else 'Cardio Leap' end
      || ': +' || due.score || '% on your best. Your crew can see it.'
  from due
  join app_private.memberships m on m.membership_id = due.membership_id and m.ended_at is null
  join app_private.push_recipients() s on s.account_id = m.account_id
  on conflict (dedupe_key) do nothing;
  get diagnostics added = row_count;
  return added;
end;
$$;

alter table app_private.pwa_crown_weeks enable row level security;
alter table app_private.pwa_crown_results enable row level security;
revoke all on table app_private.pwa_crown_weeks, app_private.pwa_crown_results
  from public, anon, authenticated;
grant select, insert, update, delete on table app_private.pwa_crown_weeks,
  app_private.pwa_crown_results to service_role;
revoke all on function app_private.group_week_positions(uuid),
  app_private.performance_rows(uuid, timestamptz, timestamptz),
  app_private.crown_week(uuid, timestamptz),
  app_private.advance_crowns(timestamptz),
  app_private.season_home(timestamptz),
  app_private.enqueue_crown_push(timestamptz)
  from public, anon, authenticated;
grant execute on function app_private.group_week_positions(uuid),
  app_private.performance_rows(uuid, timestamptz, timestamptz),
  app_private.crown_week(uuid, timestamptz),
  app_private.advance_crowns(timestamptz),
  app_private.season_home(timestamptz),
  app_private.enqueue_crown_push(timestamptz)
  to service_role;

insert into app_private.schema_versions (version) values (36);
