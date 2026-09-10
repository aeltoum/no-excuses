create type app_private.activity_platform as enum ('healthkit', 'health_connect');
create type app_private.activity_permission as enum ('not_requested', 'granted', 'limited', 'denied');
create type app_private.activity_completeness as enum ('complete', 'partial');
create type app_private.crown_category as enum ('top_steps', 'load_progression', 'cardio_leap');
create type app_private.comparison_direction as enum ('higher', 'lower');
create type app_private.competition_result_status as enum
  ('disconnected', 'missing', 'limited', 'stale', 'ineligible', 'provisional', 'eligible', 'finalized');

create table app_private.activity_connections (
  account_id uuid primary key references app_private.accounts(account_id) on delete restrict,
  platform app_private.activity_platform not null,
  permission app_private.activity_permission not null,
  source_generation integer not null default 1 check (source_generation > 0),
  changed_at timestamptz not null
);

create or replace function app_private.enforce_activity_source_change()
returns trigger language plpgsql set search_path = '' as $$
begin
  if new.source_generation < old.source_generation
     or new.changed_at < old.changed_at
     or (new.source_generation > old.source_generation and new.changed_at <= old.changed_at)
     or (new.platform <> old.platform and new.source_generation <= old.source_generation) then
    raise exception 'activity source changes require a newer generation and timestamp'
      using errcode = '22023';
  end if;
  return new;
end;
$$;

create trigger activity_connections_source_change
before update on app_private.activity_connections
for each row execute function app_private.enforce_activity_source_change();

create table app_private.activity_interval_snapshots (
  snapshot_id uuid primary key,
  membership_id uuid not null references app_private.memberships(membership_id) on delete restrict,
  accountability_week_id uuid not null references app_private.accountability_weeks(accountability_week_id) on delete restrict,
  platform app_private.activity_platform not null,
  source_generation integer not null check (source_generation > 0),
  interval_starts_at timestamptz not null,
  interval_ends_at timestamptz not null,
  synced_at timestamptz not null,
  permission app_private.activity_permission not null,
  completeness app_private.activity_completeness not null,
  steps bigint check (steps is null or steps >= 0),
  constraint activity_snapshot_interval check (interval_starts_at < interval_ends_at),
  constraint activity_snapshot_sync_order check (synced_at >= interval_starts_at),
  unique (membership_id, accountability_week_id, source_generation)
);

create table app_private.performance_results (
  performance_result_id uuid primary key,
  membership_id uuid not null references app_private.memberships(membership_id) on delete restrict,
  accountability_week_id uuid not null references app_private.accountability_weeks(accountability_week_id) on delete restrict,
  category app_private.crown_category not null,
  comparable_key text not null,
  comparison_direction app_private.comparison_direction not null,
  measure numeric not null check (measure > 0),
  repetitions integer check (repetitions is null or repetitions > 0),
  recorded_at timestamptz not null,
  verified boolean not null default false,
  constraint performance_category_shape check (
    (category = 'load_progression' and repetitions is not null)
    or (category = 'cardio_leap' and repetitions is null)
  ),
  unique (membership_id, accountability_week_id, category, comparable_key)
);

create or replace function app_private.guard_performance_result()
returns trigger language plpgsql set search_path = '' as $$
declare eligible_start timestamptz; week_end timestamptz;
begin
  if tg_op in ('UPDATE', 'DELETE') and exists (
      select 1 from app_private.crown_category_finalizations
      where accountability_week_id = old.accountability_week_id and category = old.category) then
    raise exception 'finalized Crown performance facts are immutable' using errcode = '55000';
  end if;
  if tg_op in ('INSERT', 'UPDATE') and exists (
      select 1 from app_private.crown_category_finalizations
      where accountability_week_id = new.accountability_week_id and category = new.category) then
    raise exception 'finalized Crown performance facts are immutable' using errcode = '55000';
  end if;
  if tg_op = 'DELETE' then return old; end if;
  select greatest(m.joined_at, coalesce(w.activation_at, w.starts_at)), w.ends_at
    into eligible_start, week_end
  from app_private.memberships m join app_private.accountability_weeks w
    on w.accountability_week_id = new.accountability_week_id
  where m.membership_id = new.membership_id and m.group_id = w.group_id;
  if not found or new.recorded_at < eligible_start or new.recorded_at >= week_end then
    raise exception 'performance must fall inside membership eligibility interval' using errcode = '22023';
  end if;
  return new;
end;
$$;

create trigger performance_results_guard
before insert or update or delete on app_private.performance_results
for each row execute function app_private.guard_performance_result();

create table app_private.competition_results (
  membership_id uuid not null references app_private.memberships(membership_id) on delete restrict,
  accountability_week_id uuid not null references app_private.accountability_weeks(accountability_week_id) on delete restrict,
  category app_private.crown_category not null,
  status app_private.competition_result_status not null,
  displayed_score numeric,
  partial_window boolean not null,
  source_status text not null,
  finalized_at timestamptz,
  constraint competition_result_score check (
    (status in ('eligible', 'finalized') and displayed_score is not null)
    or (status not in ('eligible', 'finalized') and displayed_score is null)
  ),
  primary key (membership_id, accountability_week_id, category)
);

create table app_private.crown_category_finalizations (
  accountability_week_id uuid not null references app_private.accountability_weeks(accountability_week_id) on delete restrict,
  category app_private.crown_category not null,
  finalized_at timestamptz not null,
  eligible_result_count integer not null check (eligible_result_count >= 0),
  contested boolean not null,
  primary key (accountability_week_id, category)
);

create or replace function app_private.guard_finalized_competition_result()
returns trigger language plpgsql set search_path = '' as $$
begin
  if old.finalized_at is not null then
    raise exception 'finalized Competition results are immutable' using errcode = '55000';
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

create trigger competition_results_finalized_guard
before update or delete on app_private.competition_results
for each row execute function app_private.guard_finalized_competition_result();

create table app_private.crown_awards (
  crown_award_id uuid primary key default gen_random_uuid(),
  accountability_week_id uuid not null,
  category app_private.crown_category not null,
  membership_id uuid not null references app_private.memberships(membership_id) on delete restrict,
  account_id uuid not null references app_private.accounts(account_id) on delete restrict,
  season_id uuid not null references app_private.seasons(season_id) on delete restrict,
  displayed_score numeric not null,
  awarded_at timestamptz not null,
  foreign key (accountability_week_id, category)
    references app_private.crown_category_finalizations(accountability_week_id, category) on delete restrict,
  unique (accountability_week_id, category, membership_id)
);

create table app_private.season_weeks (
  season_id uuid not null references app_private.seasons(season_id) on delete restrict,
  accountability_week_id uuid not null unique references app_private.accountability_weeks(accountability_week_id) on delete restrict,
  active_week_number smallint not null check (active_week_number between 1 and 4),
  consumed_at timestamptz not null,
  primary key (season_id, active_week_number)
);

create table app_private.season_summaries (
  season_id uuid primary key references app_private.seasons(season_id) on delete restrict,
  finalized_at timestamptz not null
);

create table app_private.season_summary_standings (
  season_id uuid not null references app_private.season_summaries(season_id) on delete restrict,
  membership_id uuid not null references app_private.memberships(membership_id) on delete restrict,
  crowns integer not null check (crowns >= 0),
  rank integer not null check (rank > 0),
  cochampion boolean not null,
  primary key (season_id, membership_id)
);

create table app_private.season_summary_audience (
  season_id uuid not null references app_private.season_summaries(season_id) on delete restrict,
  membership_id uuid not null references app_private.memberships(membership_id) on delete restrict,
  primary key (season_id, membership_id)
);

create or replace function app_private.reject_immutable_activity_snapshot()
returns trigger language plpgsql set search_path = '' as $$
begin
  raise exception 'activity interval snapshots are immutable' using errcode = '55000';
end;
$$;

create trigger activity_interval_snapshots_immutable
before update or delete on app_private.activity_interval_snapshots
for each row execute function app_private.reject_immutable_activity_snapshot();

create or replace function app_private.record_activity_snapshot(
  requested_snapshot_id uuid, requested_membership_id uuid, requested_week_id uuid,
  requested_platform app_private.activity_platform, requested_source_generation integer,
  requested_interval_start timestamptz, requested_interval_end timestamptz,
  requested_synced_at timestamptz, requested_permission app_private.activity_permission,
  requested_completeness app_private.activity_completeness, requested_steps bigint
) returns uuid language plpgsql security definer set search_path = '' as $$
declare existing app_private.activity_interval_snapshots%rowtype; eligible_start timestamptz; week_end timestamptz;
begin
  select greatest(m.joined_at, coalesce(w.activation_at, w.starts_at)), w.ends_at
    into eligible_start, week_end
  from app_private.memberships m join app_private.accountability_weeks w on w.accountability_week_id = requested_week_id
  where m.membership_id = requested_membership_id and m.group_id = w.group_id;
  if not found or requested_interval_start <> eligible_start or requested_interval_end <> week_end then
    raise exception 'exact membership eligibility interval required' using errcode = '22023';
  end if;
  if requested_permission <> 'granted' or requested_completeness <> 'complete' then
    requested_steps := null;
  end if;
  select * into existing from app_private.activity_interval_snapshots
    where snapshot_id = requested_snapshot_id;
  if found then
    if existing.membership_id = requested_membership_id
       and existing.accountability_week_id = requested_week_id
       and existing.platform = requested_platform
       and existing.source_generation = requested_source_generation
       and existing.interval_starts_at = requested_interval_start
       and existing.interval_ends_at = requested_interval_end
       and existing.synced_at = requested_synced_at
       and existing.permission = requested_permission
       and existing.completeness = requested_completeness
       and existing.steps is not distinct from requested_steps then return existing.snapshot_id; end if;
    raise exception 'snapshot id conflicts with immutable facts' using errcode = '23505';
  end if;
  insert into app_private.activity_interval_snapshots values (
    requested_snapshot_id, requested_membership_id, requested_week_id, requested_platform,
    requested_source_generation, requested_interval_start, requested_interval_end,
    requested_synced_at, requested_permission, requested_completeness, requested_steps
  );
  return requested_snapshot_id;
end;
$$;

create or replace function app_private.score_competition_week(
  requested_week_id uuid, requested_at timestamptz
) returns integer language plpgsql security definer set search_path = '' as $$
declare item record; score numeric; result_status app_private.competition_result_status; source_note text; written integer := 0; current_count integer; baseline_count integer;
begin
  for item in
    select m.membership_id, m.account_id, m.joined_at, m.ended_at, mw.status member_week_status,
      w.starts_at, w.ends_at, w.activation_at, c.permission, c.source_generation,
      s.synced_at, s.completeness, s.steps, category.category
    from app_private.member_weeks mw
    join app_private.memberships m using (membership_id)
    join app_private.accountability_weeks w using (accountability_week_id)
    cross join (values ('top_steps'::app_private.crown_category), ('load_progression'), ('cardio_leap')) category(category)
    left join app_private.activity_connections c on c.account_id = m.account_id
    left join app_private.activity_interval_snapshots s on s.membership_id = m.membership_id
      and s.accountability_week_id = w.accountability_week_id and s.source_generation = c.source_generation
      and s.platform = c.platform
    where mw.accountability_week_id = requested_week_id
  loop
    score := null; current_count := 0; baseline_count := 0; result_status := 'ineligible'; source_note := 'available';
    if item.ended_at is not null and item.ended_at <= requested_at then source_note := 'departed';
    elsif item.member_week_status = 'excepted' then source_note := 'exception';
    elsif item.category = 'top_steps' then
      if item.permission is null or item.permission = 'denied' or item.permission = 'not_requested' then result_status := 'disconnected'; source_note := 'permission_missing';
      elsif item.permission = 'limited' or item.completeness = 'partial' then result_status := 'limited'; source_note := 'limited';
      elsif item.synced_at is null or item.synced_at <= item.ends_at or item.synced_at > requested_at then result_status := 'stale'; source_note := 'post_close_sync_required';
      elsif item.steps is null then result_status := 'missing'; source_note := 'missing';
      else result_status := 'eligible'; score := round(item.steps::numeric / 100) * 100; end if;
    elsif item.category = 'cardio_leap' and
      (item.permission is null or item.permission in ('denied', 'not_requested')) then
      result_status := 'disconnected'; source_note := 'permission_missing';
    elsif item.category = 'cardio_leap' and
      (item.permission = 'limited' or item.completeness = 'partial') then
      result_status := 'limited'; source_note := 'limited';
    elsif item.category = 'cardio_leap' and
      (item.synced_at is null or item.synced_at <= item.ends_at or item.synced_at > requested_at) then
      result_status := 'stale'; source_note := 'post_close_sync_required';
    elsif not exists (select 1 from app_private.performance_results p
        where p.membership_id = item.membership_id and p.accountability_week_id = requested_week_id
          and p.category = item.category and p.verified) then
      result_status := 'missing'; source_note := 'missing_or_unverified';
    else
      select count(*), count(baseline.measure), max(round((case when p.comparison_direction = 'higher'
          then (p.measure / baseline.measure - 1) * 100
          else (baseline.measure / p.measure - 1) * 100 end) * 10) / 10)
        into current_count, baseline_count, score
      from app_private.performance_results p
      left join lateral (
        select case when p.comparison_direction = 'higher' then max(pr.measure) else min(pr.measure) end measure
        from app_private.performance_results pr
        join app_private.memberships old_m using (membership_id)
        join app_private.accountability_weeks old_w using (accountability_week_id)
        where old_m.account_id = item.account_id and pr.category = p.category
          and pr.comparable_key = p.comparable_key
          and pr.comparison_direction = p.comparison_direction
          and pr.repetitions is not distinct from p.repetitions and pr.verified
          and old_w.accountability_week_id in (
            select prior.accountability_week_id
            from app_private.member_weeks prior_member_week
            join app_private.memberships prior_membership using (membership_id)
            join app_private.accountability_weeks prior
              using (accountability_week_id)
            where prior_membership.account_id = item.account_id
              and prior.ends_at <= item.starts_at
            order by prior.ends_at desc
            limit 8
          )
      ) baseline on true
      where p.membership_id = item.membership_id and p.accountability_week_id = requested_week_id
        and p.category = item.category and p.verified;
      if baseline_count = 0 then source_note := 'first_result_baseline_only'; score := null;
      else
        result_status := 'eligible'; source_note := case when baseline_count < current_count then 'best_comparable_result' else 'available' end;
      end if;
    end if;
    insert into app_private.competition_results
      (membership_id, accountability_week_id, category, status, displayed_score, partial_window, source_status)
    values (item.membership_id, requested_week_id, item.category, result_status, score,
      greatest(item.joined_at, coalesce(item.activation_at, item.starts_at)) > item.starts_at, source_note)
    on conflict (membership_id, accountability_week_id, category) do update
      set status = excluded.status, displayed_score = excluded.displayed_score,
          partial_window = excluded.partial_window, source_status = excluded.source_status
      where app_private.competition_results.finalized_at is null;
    written := written + 1;
  end loop;
  return written;
end;
$$;

create or replace function app_private.finalize_crown_category(
  requested_week_id uuid, requested_category app_private.crown_category, requested_at timestamptz
) returns integer language plpgsql security definer set search_path = '' as $$
declare eligible_count integer; winning_score numeric; found_season uuid; awards integer := 0;
begin
  perform 1 from app_private.accountability_weeks where accountability_week_id = requested_week_id
    and ends_at + interval '24 hours' <= requested_at for update;
  if not found then raise exception 'settled Accountability week required' using errcode = '22023'; end if;
  if exists (select 1 from app_private.member_weeks
      where accountability_week_id = requested_week_id and status in ('active', 'provisional')) then
    raise exception 'settled member-weeks required' using errcode = '55000';
  end if;
  select season_id into found_season from app_private.season_weeks
    where accountability_week_id = requested_week_id;
  if found_season is null then
    raise exception 'Season assignment required before Crown finalization' using errcode = '55000';
  end if;
  if exists (select 1 from app_private.crown_category_finalizations where accountability_week_id = requested_week_id and category = requested_category) then
    return (select count(*)::integer from app_private.crown_awards where accountability_week_id = requested_week_id and category = requested_category);
  end if;
  perform app_private.score_competition_week(requested_week_id, requested_at);
  select count(*), max(displayed_score) into eligible_count, winning_score
    from app_private.competition_results where accountability_week_id = requested_week_id
      and category = requested_category and status = 'eligible';
  insert into app_private.crown_category_finalizations values
    (requested_week_id, requested_category, requested_at, eligible_count, eligible_count >= 2);
  if eligible_count >= 2 then
    insert into app_private.crown_awards
      (accountability_week_id, category, membership_id, account_id, season_id, displayed_score, awarded_at)
    select requested_week_id, requested_category, r.membership_id, m.account_id, found_season, r.displayed_score, requested_at
    from app_private.competition_results r join app_private.memberships m using (membership_id)
    where r.accountability_week_id = requested_week_id and r.category = requested_category
      and r.status = 'eligible' and r.displayed_score = winning_score;
    get diagnostics awards = row_count;
  end if;
  update app_private.competition_results set status = 'finalized', finalized_at = requested_at
    where accountability_week_id = requested_week_id and category = requested_category and status = 'eligible';
  return awards;
end;
$$;

create or replace function app_private.consume_season_week(
  requested_week_id uuid, requested_at timestamptz
) returns uuid language plpgsql security definer set search_path = '' as $$
declare found_group uuid; active_at timestamptz; week_end timestamptz; current_season app_private.seasons%rowtype; position integer; new_season_id uuid;
begin
  select group_id, coalesce(activation_at, starts_at), ends_at into found_group, active_at, week_end from app_private.accountability_weeks
    where accountability_week_id = requested_week_id and activation_at is not null
      and ends_at <= requested_at;
  if not found then raise exception 'active Accountability week required' using errcode = '22023'; end if;
  if (select count(*) from app_private.memberships where group_id = found_group
      and joined_at <= active_at and (ended_at is null or ended_at > active_at)) < 2 then
    raise exception 'Season paused below two members' using errcode = '55000';
  end if;
  if exists (select 1 from app_private.pause_intervals
      where group_id = found_group and kind = 'below_capacity'
        and starts_at < week_end and coalesce(ends_at, 'infinity'::timestamptz) > active_at) then
    raise exception 'Season paused below two members' using errcode = '55000';
  end if;
  select s.* into current_season from app_private.seasons s where s.group_id = found_group
    and not exists (select 1 from app_private.season_summaries x where x.season_id = s.season_id)
    order by season_number desc limit 1 for update;
  if exists (select 1 from app_private.season_weeks where accountability_week_id = requested_week_id) then
    return (select season_id from app_private.season_weeks where accountability_week_id = requested_week_id);
  end if;
  position := coalesce((select max(active_week_number) + 1 from app_private.season_weeks where season_id = current_season.season_id), 1);
  insert into app_private.season_weeks values (current_season.season_id, requested_week_id, position, requested_at);
  update app_private.seasons set active_weeks_consumed = position where season_id = current_season.season_id;
  if position = 4 then
    new_season_id := gen_random_uuid();
    insert into app_private.seasons
      (season_id, group_id, season_number, starts_at, ends_at, time_zone, active_weeks_consumed)
    values (new_season_id, found_group, current_season.season_number + 1, week_end,
      ((week_end at time zone current_season.time_zone) + interval '28 days')
        at time zone current_season.time_zone,
      current_season.time_zone, 1);
  end if;
  return current_season.season_id;
end;
$$;

create or replace function app_private.finalize_season_summary(
  requested_season_id uuid, requested_at timestamptz
) returns uuid language plpgsql security definer set search_path = '' as $$
declare found_season app_private.seasons%rowtype;
begin
  select * into found_season from app_private.seasons where season_id = requested_season_id for update;
  if not found or found_season.active_weeks_consumed <> 4
     or (select count(*) from app_private.season_weeks where season_id = requested_season_id) <> 4 then
    raise exception 'four consumed Season weeks required' using errcode = '55000';
  end if;
  if exists (
    select 1 from app_private.season_weeks sw
    cross join (values ('top_steps'::app_private.crown_category), ('load_progression'), ('cardio_leap')) category(category)
    where sw.season_id = requested_season_id and not exists (
      select 1 from app_private.crown_category_finalizations finalization
      where finalization.accountability_week_id = sw.accountability_week_id
        and finalization.category = category.category
        and finalization.finalized_at >= (
          select ends_at + interval '24 hours' from app_private.accountability_weeks
          where accountability_week_id = sw.accountability_week_id
        )
    )
  ) then raise exception 'all Season Crown categories must be finalized' using errcode = '55000'; end if;
  if exists (select 1 from app_private.season_summaries where season_id = requested_season_id) then
    return requested_season_id;
  end if;
  insert into app_private.season_summaries values (requested_season_id, requested_at);
  insert into app_private.season_summary_audience
    select requested_season_id, membership_id from app_private.memberships
    where group_id = found_season.group_id and joined_at <= requested_at
      and (ended_at is null or ended_at > requested_at);
  insert into app_private.season_summary_standings
    (season_id, membership_id, crowns, rank, cochampion)
  select requested_season_id, membership_id, crowns,
    rank() over (order by crowns desc)::integer,
    crowns = max(crowns) over ()
  from (select m.membership_id, count(a.crown_award_id)::integer crowns
    from app_private.memberships m left join app_private.crown_awards a
      on a.membership_id = m.membership_id and a.season_id = requested_season_id
    where m.group_id = found_season.group_id and m.joined_at <= requested_at
      and (m.ended_at is null or m.ended_at > requested_at) group by m.membership_id) totals;
  return requested_season_id;
end;
$$;

create or replace function app_private.read_season_summary(requested_season_id uuid)
returns table (membership_id uuid, crowns integer, rank integer, cochampion boolean)
language sql stable security definer set search_path = '' as $$
  select standing.membership_id, standing.crowns, standing.rank, standing.cochampion
  from app_private.season_summary_standings standing
  join app_private.seasons season using (season_id)
  where standing.season_id = requested_season_id
    and exists (
      select 1 from app_private.season_summary_audience audience
      join app_private.memberships viewer on viewer.membership_id = audience.membership_id
      join app_private.groups found_group on found_group.group_id = viewer.group_id
      where audience.season_id = requested_season_id
        and viewer.account_id = app_private.actor_account_id()
        and viewer.ended_at is null and viewer.group_id = season.group_id
        and found_group.status <> 'closed'
    )
$$;

revoke all on table app_private.activity_connections, app_private.activity_interval_snapshots,
  app_private.performance_results, app_private.competition_results,
  app_private.crown_category_finalizations, app_private.crown_awards,
  app_private.season_weeks, app_private.season_summaries,
  app_private.season_summary_standings, app_private.season_summary_audience
  from public, anon, authenticated;
grant select, insert, update on table app_private.activity_connections,
  app_private.performance_results, app_private.competition_results to service_role;
grant select, insert on table app_private.crown_category_finalizations,
  app_private.crown_awards, app_private.season_weeks, app_private.season_summaries,
  app_private.season_summary_standings, app_private.season_summary_audience to service_role;
grant select, insert on table app_private.activity_interval_snapshots to service_role;
revoke all on function app_private.record_activity_snapshot(uuid,uuid,uuid,app_private.activity_platform,integer,timestamptz,timestamptz,timestamptz,app_private.activity_permission,app_private.activity_completeness,bigint),
  app_private.score_competition_week(uuid,timestamptz), app_private.finalize_crown_category(uuid,app_private.crown_category,timestamptz),
  app_private.consume_season_week(uuid,timestamptz), app_private.finalize_season_summary(uuid,timestamptz) from public, anon, authenticated;
grant execute on function app_private.record_activity_snapshot(uuid,uuid,uuid,app_private.activity_platform,integer,timestamptz,timestamptz,timestamptz,app_private.activity_permission,app_private.activity_completeness,bigint),
  app_private.score_competition_week(uuid,timestamptz), app_private.finalize_crown_category(uuid,app_private.crown_category,timestamptz),
  app_private.consume_season_week(uuid,timestamptz), app_private.finalize_season_summary(uuid,timestamptz) to service_role;
revoke all on function app_private.read_season_summary(uuid) from public, anon;
grant execute on function app_private.read_season_summary(uuid) to authenticated, service_role;

insert into app_private.schema_versions (version) values (12);
