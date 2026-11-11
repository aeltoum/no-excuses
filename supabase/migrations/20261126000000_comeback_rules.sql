-- Owner-approved 2026-11-11 (retention audit, docs/research/product-ux-retention-audit.md).
-- Softer return after a bad week, recorded in CONTEXT.md:
-- 1. Streak repair: a missed week pauses the Target streak instead of erasing it. Meeting
--    the next finalized week restores it plus one; missing again ends it.
-- 2. Comeback week: after a missed week, a member may lower the current week's locked
--    target once, to any value from one up to one below it.
-- 3. Free week off: one Exception per 28 days is approved at once with no Group vote.
--    Further requests go to the Group as before.

alter table app_private.memberships add column paused_target_streak integer
  check (paused_target_streak is null or paused_target_streak > 0);
alter table app_private.member_weeks add column comeback_from integer
  check (comeback_from is null or comeback_from > target);
alter table app_private.exception_requests add column self_serve boolean not null default false;

create or replace function app_private.finalize_ended_member_weeks(
  requested_at timestamptz
) returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare finalized_count integer; missed_item record; completed_count integer;
begin
  perform app_private.advance_proof_reviews(requested_at);
  perform app_private.advance_exceptions(requested_at);
  finalized_count := 0;
  for missed_item in
    select mw.member_week_id, mw.membership_id, m.account_id, mw.target, aw.starts_at
    from app_private.member_weeks mw
    join app_private.memberships m on m.membership_id = mw.membership_id
    join app_private.accountability_weeks aw using (accountability_week_id)
    where mw.status = 'active' and m.ended_at is null and requested_at >= aw.ends_at
      and not exists (
        select 1 from app_private.workout_checkins open_review
        where open_review.member_week_id = mw.member_week_id
          and (app_private.proof_decision_open(open_review)
            or (open_review.review_status = 'verified'
              and open_review.activity_photo_path is not null
              and open_review.questioned_at is null and open_review.decided_at is null
              and requested_at < open_review.submitted_at + interval '24 hours'))
      )
      and not exists (
        select 1 from app_private.exception_requests open_exception
        where open_exception.membership_id = mw.membership_id
          and open_exception.week_starts_at = aw.starts_at
          and open_exception.status = 'pending'
      )
      and not exists (
        select 1 from app_private.operator_holds hold
        where hold.ends_at is null and hold.group_id = m.group_id
          and (hold.membership_id is null or hold.membership_id = mw.membership_id)
      )
      and not exists (
        select 1
        from app_private.member_weeks earlier_mw
        join app_private.accountability_weeks earlier_aw using (accountability_week_id)
        where earlier_mw.membership_id = mw.membership_id
          and earlier_mw.status = 'active'
          and earlier_aw.ends_at <= requested_at
          and (earlier_aw.ends_at, earlier_mw.member_week_id)
            < (aw.ends_at, mw.member_week_id)
      )
    order by aw.ends_at, mw.member_week_id
    for update of mw skip locked
  loop
    select count(*)::integer into completed_count from app_private.workout_checkins
      where member_week_id = missed_item.member_week_id and review_status = 'verified';
    if exists (
      select 1 from app_private.exception_requests r
      where r.membership_id = missed_item.membership_id
        and r.week_starts_at = missed_item.starts_at and r.status = 'approved'
    ) then
      update app_private.member_weeks set status = 'excepted'
        where member_week_id = missed_item.member_week_id and status = 'active';
    elsif completed_count >= missed_item.target then
      update app_private.member_weeks set status = 'attained'
        where member_week_id = missed_item.member_week_id and status = 'active';
      -- A met week after a single miss restores the paused streak.
      update app_private.memberships
        set target_streak = coalesce(paused_target_streak, target_streak) + 1,
            paused_target_streak = null
        where membership_id = missed_item.membership_id;
      if (select target_streak from app_private.memberships
          where membership_id = missed_item.membership_id) in (1, 2, 4, 8) then
        perform app_private.award_card_unlock(
          gen_random_uuid(), missed_item.account_id,
          (select target_streak from app_private.memberships
           where membership_id = missed_item.membership_id),
          missed_item.member_week_id::text, requested_at
        );
      end if;
    else
      update app_private.member_weeks set status = 'missed'
        where member_week_id = missed_item.member_week_id and status = 'active';
      -- One miss pauses the streak; a second miss in a row ends it.
      update app_private.memberships
        set paused_target_streak = case
              when paused_target_streak is null and target_streak > 0 then target_streak
              else null end,
            target_streak = 0
        where membership_id = missed_item.membership_id;
      perform app_private.add_consequence_obligation(
        md5('missed_target:' || missed_item.member_week_id::text)::uuid,
        missed_item.membership_id, 'missed_target', missed_item.member_week_id, requested_at
      );
    end if;
    finalized_count := finalized_count + 1;
  end loop;
  return finalized_count;
end;
$$;

-- The member's current active week, with the outcome of the finalized week before it.
create or replace function app_private.comeback_week(requested_at timestamptz)
returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce((
    select jsonb_build_object(
      'available', mw.comeback_from is null and mw.target > 1 and prev.status = 'missed',
      'target', mw.target,
      'loweredFrom', mw.comeback_from)
    from app_private.memberships m
    join app_private.member_weeks mw on mw.membership_id = m.membership_id
    join app_private.accountability_weeks aw using (accountability_week_id)
    left join lateral (
      select pmw.status from app_private.member_weeks pmw
      join app_private.accountability_weeks paw using (accountability_week_id)
      where pmw.membership_id = m.membership_id and paw.ends_at <= aw.starts_at
      order by paw.ends_at desc limit 1
    ) prev on true
    where m.membership_id = (app_private.actor_current_membership()).membership_id
      and mw.status = 'active' and aw.starts_at <= requested_at and requested_at < aw.ends_at
  ), jsonb_build_object('available', false));
$$;

create or replace function app_private.set_comeback_target(
  requested_target integer, requested_at timestamptz
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare viewer app_private.memberships := app_private.actor_current_membership();
begin
  if viewer.membership_id is null
    or not coalesce((app_private.comeback_week(requested_at) ->> 'available')::boolean, false)
  then
    raise exception 'Comeback week unavailable' using errcode = '42501';
  end if;
  update app_private.member_weeks mw
    set comeback_from = mw.target, target = requested_target
  from app_private.accountability_weeks aw
  where aw.accountability_week_id = mw.accountability_week_id
    and mw.membership_id = viewer.membership_id and mw.status = 'active'
    and aw.starts_at <= requested_at and requested_at < aw.ends_at
    and requested_target between 1 and mw.target - 1;
  if not found then
    raise exception 'target must be between 1 and one below this week' using errcode = '22023';
  end if;
  return app_private.home_extras(requested_at);
end;
$$;

-- Free week off: approved at once when none was used in the last 28 days.
create or replace function app_private.free_week_off_available(
  requested_membership_id uuid, requested_at timestamptz
) returns boolean
language sql stable security definer set search_path = '' as $$
  select not exists (
    select 1 from app_private.exception_requests
    where membership_id = requested_membership_id and self_serve
      and status = 'approved' and submitted_at > requested_at - interval '28 days'
  );
$$;

create or replace function app_private.request_exception(
  requested_id uuid, requested_week text, requested_category text, requested_note text,
  requested_at timestamptz
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  viewer app_private.memberships := app_private.actor_current_membership();
  starts timestamptz;
  cleaned text := nullif(btrim(coalesce(requested_note, '')), '');
  free boolean;
begin
  if viewer.membership_id is null then
    raise exception 'current Group membership required' using errcode = '42501';
  end if;
  starts := app_private.exception_week_start(viewer.membership_id, requested_week, requested_at);
  if starts is null or not exists (
    select 1 from app_private.memberships
    where group_id = viewer.group_id and ended_at is null
      and membership_id <> viewer.membership_id
  ) then
    raise exception 'Exception unavailable' using errcode = '42501';
  end if;
  if cleaned is not null and length(cleaned) > 280 then
    raise exception 'note too long' using errcode = '22023';
  end if;
  perform 1 from app_private.memberships where membership_id = viewer.membership_id for update;
  if exists (
    select 1 from app_private.exception_requests
    where membership_id = viewer.membership_id and week_starts_at = starts
      and status in ('pending', 'approved')
  ) then
    raise exception 'Exception already requested' using errcode = '23505';
  end if;
  free := app_private.free_week_off_available(viewer.membership_id, requested_at);
  insert into app_private.exception_requests (
    exception_request_id, membership_id, week_starts_at, category, note,
    submitted_at, closes_at, status, resolved_at, self_serve
  ) values (
    requested_id, viewer.membership_id, starts, requested_category, cleaned,
    requested_at, requested_at + interval '48 hours',
    case when free then 'approved' else 'pending' end,
    case when free then requested_at end, free
  );
  if not free then
    insert into app_private.exception_ballots (exception_request_id, membership_id)
    select requested_id, m.membership_id from app_private.memberships m
    where m.group_id = viewer.group_id and m.ended_at is null
      and m.membership_id <> viewer.membership_id;
  end if;
  return app_private.home_extras(requested_at);
end;
$$;

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
        and app_private.free_week_off_available(viewer.membership_id, requested_at)
    );
end;
$$;

revoke all on function app_private.comeback_week(timestamptz),
  app_private.set_comeback_target(integer, timestamptz),
  app_private.free_week_off_available(uuid, timestamptz)
  from public, anon, authenticated;
grant execute on function app_private.comeback_week(timestamptz),
  app_private.set_comeback_target(integer, timestamptz)
  to service_role;

insert into app_private.schema_versions (version) values (59);
