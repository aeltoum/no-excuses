-- Alpha operator overrides (owner-approved 2026-11-22). While the alpha irons out defects,
-- the Private-pilot operator may, case by case:
-- * waive owed Consequence items (one item or a member's whole backlog), closing any live
--   Card offer, card, safety pause, pause request, or claim on them;
-- * excuse a missed week: it becomes Excepted, its owed item is waived, and when it is the
--   member's latest finalized week the paused Target streak comes back;
-- * add a Verified workout a member could not log. It has no photos, so it counts toward
--   the week without reaching the Wall. Added to a missed week that now meets its target,
--   the week becomes Attained and its owed item is waived.
-- Every override is recorded in app_private.operator_actions.

alter table app_private.workout_checkins
  add column operator_added_by uuid references app_private.accounts(account_id) on delete set null;

create table app_private.operator_actions (
  operator_action_id uuid primary key default gen_random_uuid(),
  operator_account_id uuid references app_private.accounts(account_id) on delete set null,
  membership_id uuid not null references app_private.memberships(membership_id) on delete cascade,
  kind text not null check (kind in ('waive_consequence', 'excuse_week', 'add_workout')),
  subject_id uuid,
  acted_at timestamptz not null
);

-- One member as the operator sees them: owed items, live card, and the last eight weeks.
create or replace function app_private.operator_member(
  requested_membership_id uuid, requested_at timestamptz
) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare found_member app_private.memberships%rowtype;
begin
  perform app_private.actor_operator();
  select * into found_member from app_private.memberships
  where membership_id = requested_membership_id and ended_at is null;
  if found_member.membership_id is null then
    raise exception 'member unavailable' using errcode = 'P0002';
  end if;
  return jsonb_build_object(
    'membershipId', found_member.membership_id,
    'name', app_private.member_label(found_member.membership_id),
    'targetStreak', found_member.target_streak,
    'pausedStreak', found_member.paused_target_streak,
    'owed', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', o.obligation_id, 'source', o.source_kind, 'createdAt', o.created_at,
        'weekStartsAt', (
          select aw.starts_at from app_private.member_weeks mw
          join app_private.accountability_weeks aw using (accountability_week_id)
          where o.source_kind = 'missed_target' and mw.member_week_id = o.source_id),
        'card', (
          select jsonb_build_object('title', c.title, 'status', a.status, 'expiresAt', a.expires_at)
          from app_private.consequence_attempts a
          join app_private.consequence_cards c using (card_id)
          where a.obligation_id = o.obligation_id
            and a.status in ('active', 'safety_paused', 'review')),
        'offered', exists (
          select 1 from app_private.card_offers f
          where f.obligation_id = o.obligation_id and f.status in ('initial', 'redrawn'))
      ) order by o.created_at)
      from app_private.consequence_obligations o
      where o.membership_id = found_member.membership_id and o.status = 'open'
    ), '[]'::jsonb),
    'weeks', coalesce((
      select jsonb_agg(jsonb_build_object(
        'memberWeekId', w.member_week_id, 'startsAt', w.starts_at, 'endsAt', w.ends_at,
        'status', w.status, 'target', w.target, 'verified', w.verified, 'added', w.added
      ) order by w.starts_at desc)
      from (
        select mw.member_week_id, aw.starts_at, aw.ends_at, mw.status::text as status,
          mw.target,
          (select count(*) from app_private.workout_checkins c
           where c.member_week_id = mw.member_week_id and c.review_status = 'verified') as verified,
          (select count(*) from app_private.workout_checkins c
           where c.member_week_id = mw.member_week_id and c.operator_added_by is not null) as added
        from app_private.member_weeks mw
        join app_private.accountability_weeks aw using (accountability_week_id)
        where mw.membership_id = found_member.membership_id and aw.starts_at <= requested_at
        order by aw.starts_at desc limit 8
      ) w
    ), '[]'::jsonb)
  );
end;
$$;

-- Closes the given open owed items and everything live on them. Returns how many closed.
create or replace function app_private.operator_close_obligations(
  requested_obligation_ids uuid[], closing_at timestamptz
) returns integer
language plpgsql security definer set search_path = '' as $$
declare closed_count integer;
begin
  update app_private.consequence_claims set status = 'replaced', finalized_at = closing_at
  where status = 'pending' and attempt_id in (
    select attempt_id from app_private.consequence_attempts
    where obligation_id = any(requested_obligation_ids));
  update app_private.consequence_pause_requests set status = 'denied', resolved_at = closing_at
  where status = 'pending' and attempt_id in (
    select attempt_id from app_private.consequence_attempts
    where obligation_id = any(requested_obligation_ids));
  update app_private.consequence_safety_pauses set ends_at = closing_at
  where ends_at is null and attempt_id in (
    select attempt_id from app_private.consequence_attempts
    where obligation_id = any(requested_obligation_ids));
  update app_private.consequence_attempts set status = 'not_completed', terminal_at = closing_at
  where obligation_id = any(requested_obligation_ids)
    and status in ('active', 'safety_paused', 'review');
  update app_private.card_offers set status = 'replaced'
  where obligation_id = any(requested_obligation_ids)
    and status in ('initial', 'redrawn', 'selected');
  update app_private.consequence_obligations set status = 'waived', closed_at = closing_at
  where obligation_id = any(requested_obligation_ids) and status = 'open';
  get diagnostics closed_count = row_count;
  return closed_count;
end;
$$;

-- A null obligation waives the member's whole backlog. The next owed item, if any, gets
-- a fresh Card offer on the next maintenance pass.
create or replace function app_private.operator_waive_consequences(
  requested_membership_id uuid, requested_obligation_id uuid, requested_at timestamptz
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  operator uuid := app_private.actor_operator();
  targets uuid[];
begin
  select coalesce(array_agg(obligation_id), '{}') into targets
  from app_private.consequence_obligations
  where membership_id = requested_membership_id and status = 'open'
    and (requested_obligation_id is null or obligation_id = requested_obligation_id);
  if cardinality(targets) = 0 then
    raise exception 'nothing owed' using errcode = 'P0002';
  end if;
  perform app_private.operator_close_obligations(targets, requested_at);
  insert into app_private.operator_actions
    (operator_account_id, membership_id, kind, subject_id, acted_at)
  select operator, requested_membership_id, 'waive_consequence', t, requested_at
  from unnest(targets) t;
  return app_private.operator_member(requested_membership_id, requested_at);
end;
$$;

-- Turns a settled missed week into requested_status ('excepted' or 'attained'), waives
-- its owed item, and repairs the Target streak when it is the latest finalized week.
create or replace function app_private.operator_clear_missed_week(
  requested_member_week_id uuid, requested_status app_private.member_week_status,
  requested_at timestamptz
) returns void
language plpgsql security definer set search_path = '' as $$
declare
  item record;
  latest boolean;
begin
  select mw.member_week_id, mw.membership_id, aw.starts_at into item
  from app_private.member_weeks mw
  join app_private.accountability_weeks aw using (accountability_week_id)
  where mw.member_week_id = requested_member_week_id and mw.status = 'missed'
  for update of mw;
  if item.member_week_id is null then return; end if;
  select not exists (
    select 1 from app_private.member_weeks later
    join app_private.accountability_weeks law using (accountability_week_id)
    where later.membership_id = item.membership_id and law.starts_at > item.starts_at
      and later.status in ('attained', 'missed', 'excepted')
  ) into latest;
  update app_private.member_weeks set status = requested_status
  where member_week_id = item.member_week_id;
  perform app_private.operator_close_obligations(array(
    select obligation_id from app_private.consequence_obligations
    where source_kind = 'missed_target' and source_id = item.member_week_id
  ), requested_at);
  -- The miss paused the streak (or ended a paused one); undo that for the latest week.
  if latest then
    update app_private.memberships
    set target_streak = coalesce(paused_target_streak, target_streak)
          + case when requested_status = 'attained' then 1 else 0 end,
        paused_target_streak = null
    where membership_id = item.membership_id;
  end if;
end;
$$;

create or replace function app_private.operator_excuse_week(
  requested_member_week_id uuid, requested_at timestamptz
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  operator uuid := app_private.actor_operator();
  owner_id uuid;
begin
  select mw.membership_id into owner_id
  from app_private.member_weeks mw
  join app_private.memberships m using (membership_id)
  where mw.member_week_id = requested_member_week_id and mw.status = 'missed'
    and m.ended_at is null;
  if owner_id is null then
    raise exception 'missed week required' using errcode = 'P0002';
  end if;
  perform app_private.operator_clear_missed_week(requested_member_week_id, 'excepted', requested_at);
  insert into app_private.operator_actions
    (operator_account_id, membership_id, kind, subject_id, acted_at)
  values (operator, owner_id, 'excuse_week', requested_member_week_id, requested_at);
  return app_private.operator_member(owner_id, requested_at);
end;
$$;

create or replace function app_private.operator_add_workout(
  requested_member_week_id uuid,
  requested_activity_type app_private.workout_activity_type,
  requested_completed_at timestamptz,
  requested_duration_minutes integer,
  requested_perceived_intensity app_private.perceived_intensity,
  requested_at timestamptz
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  operator uuid := app_private.actor_operator();
  item record;
  checkin uuid := gen_random_uuid();
  verified_count integer;
begin
  select mw.member_week_id, mw.membership_id, mw.status, mw.target, aw.starts_at, aw.ends_at
  into item
  from app_private.member_weeks mw
  join app_private.memberships m using (membership_id)
  join app_private.accountability_weeks aw using (accountability_week_id)
  where mw.member_week_id = requested_member_week_id and m.ended_at is null
  for update of mw;
  if item.member_week_id is null then
    raise exception 'member week unavailable' using errcode = 'P0002';
  end if;
  if item.status not in ('active', 'missed', 'attained') then
    raise exception 'week cannot take a workout' using errcode = '22023';
  end if;
  if requested_completed_at < item.starts_at or requested_completed_at >= item.ends_at
     or requested_completed_at > requested_at then
    raise exception 'completion must fall inside the week and not in the future'
      using errcode = '22023';
  end if;
  if requested_duration_minutes is null or requested_duration_minutes not between 1 and 600 then
    raise exception 'duration must be 1 to 600 minutes' using errcode = '22023';
  end if;
  insert into app_private.workout_checkins (
    workout_checkin_id, member_week_id, membership_id, activity_type, completed_at,
    duration_minutes, perceived_intensity, self_report_attested, submitted_at,
    review_status, verified_at, operator_added_by
  ) values (
    checkin, item.member_week_id, item.membership_id, requested_activity_type,
    requested_completed_at, requested_duration_minutes, requested_perceived_intensity,
    true, requested_at, 'verified', requested_at, operator
  );
  if item.status = 'missed' then
    select count(*)::integer into verified_count from app_private.workout_checkins
    where member_week_id = item.member_week_id and review_status = 'verified';
    if verified_count >= item.target then
      perform app_private.operator_clear_missed_week(item.member_week_id, 'attained', requested_at);
    end if;
  end if;
  insert into app_private.operator_actions
    (operator_account_id, membership_id, kind, subject_id, acted_at)
  values (operator, item.membership_id, 'add_workout', checkin, requested_at);
  return app_private.operator_member(item.membership_id, requested_at);
end;
$$;

alter table app_private.operator_actions enable row level security;
revoke all on table app_private.operator_actions from public, anon, authenticated;
grant select, insert on table app_private.operator_actions to service_role;
revoke all on function app_private.operator_member(uuid, timestamptz),
  app_private.operator_close_obligations(uuid[], timestamptz),
  app_private.operator_waive_consequences(uuid, uuid, timestamptz),
  app_private.operator_clear_missed_week(uuid, app_private.member_week_status, timestamptz),
  app_private.operator_excuse_week(uuid, timestamptz),
  app_private.operator_add_workout(uuid, app_private.workout_activity_type, timestamptz,
    integer, app_private.perceived_intensity, timestamptz)
  from public, anon, authenticated;
grant execute on function app_private.operator_member(uuid, timestamptz),
  app_private.operator_waive_consequences(uuid, uuid, timestamptz),
  app_private.operator_excuse_week(uuid, timestamptz),
  app_private.operator_add_workout(uuid, app_private.workout_activity_type, timestamptz,
    integer, app_private.perceived_intensity, timestamptz)
  to service_role;

insert into app_private.schema_versions (version) values (62);
