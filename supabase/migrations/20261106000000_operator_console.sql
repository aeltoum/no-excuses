-- Operator console (owner-approved 2026-10-20). An Account with a current 'operator' staff
-- assignment works the Moderation case queue from the PWA and can hold deadlines:
-- * dismiss a case (restoring a hidden message or photo pair), remove the content, suspend an
--   Account (a Moderation hold: access ends until reinstated), or end a membership
--   (service termination, ordinary departure cleanup);
-- * open a Technical pause (one member) or Service pause (whole Group): while open, the
--   affected weeks do not settle, so nobody misses a week for an outage or a product defect.
-- Operators never verify workouts, decide Exceptions or cards, or alter Crowns.

create table app_private.operator_holds (
  operator_hold_id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('technical', 'service')),
  group_id uuid not null references app_private.groups(group_id) on delete cascade,
  membership_id uuid references app_private.memberships(membership_id) on delete cascade,
  reason text not null check (length(reason) between 1 and 200),
  opened_by uuid references app_private.accounts(account_id) on delete set null,
  starts_at timestamptz not null,
  ends_at timestamptz,
  constraint operator_hold_scope check (
    (kind = 'technical' and membership_id is not null)
    or (kind = 'service' and membership_id is null)
  )
);

create or replace function app_private.actor_operator()
returns uuid
language plpgsql stable security definer set search_path = '' as $$
declare actor uuid := app_private.actor_account_id();
begin
  if actor is null or not exists (
    select 1 from app_private.staff_assignments s
    where s.account_id = actor and s.role = 'operator'
      and s.starts_at <= transaction_timestamp()
      and (s.ends_at is null or s.ends_at > transaction_timestamp())
  ) then
    raise exception 'operator required' using errcode = '42501';
  end if;
  return actor;
end;
$$;

create or replace function app_private.is_operator()
returns boolean
language plpgsql stable security definer set search_path = '' as $$
begin
  perform app_private.actor_operator();
  return true;
exception when insufficient_privilege then
  return false;
end;
$$;

create or replace function app_private.account_label(requested_account_id uuid)
returns text
language sql stable security definer set search_path = '' as $$
  select case when status = 'deleted' then 'Former member'
    else coalesce(display_name, 'Account ' || left(account_id::text, 8)) end
  from app_private.accounts where account_id = requested_account_id;
$$;

create or replace function app_private.operator_console(requested_at timestamptz)
returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  perform app_private.actor_operator();
  return jsonb_build_object(
    'cases', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', c.moderation_case_id, 'kind', c.kind, 'category', c.category,
        'createdAt', c.created_at, 'group', g.name, 'groupId', g.group_id,
        'reporter', app_private.account_label(c.reporter_account_id),
        'subject', app_private.account_label(c.subject_account_id),
        'subjectStatus', (select status from app_private.accounts where account_id = c.subject_account_id),
        'subjectMembershipId', (
          select m.membership_id from app_private.memberships m
          where m.account_id = c.subject_account_id and m.group_id = c.group_id and m.ended_at is null),
        'message', (select body from app_private.proof_messages where proof_message_id = c.proof_message_id),
        'workoutCheckinId', c.workout_checkin_id,
        'photoPaths', (
          select jsonb_build_array(w.activity_photo_path, w.presence_photo_path)
          from app_private.workout_checkins w
          where w.workout_checkin_id = c.workout_checkin_id and w.media_deleted_at is null
            and w.removed_at is null)
      ) order by c.created_at)
      from app_private.moderation_cases c
      join app_private.groups g on g.group_id = c.group_id
      where c.status = 'open'
    ), '[]'::jsonb),
    'holds', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', h.operator_hold_id, 'kind', h.kind, 'group', g.name,
        'member', case when h.membership_id is null then null else app_private.member_label(h.membership_id) end,
        'reason', h.reason, 'startsAt', h.starts_at
      ) order by h.starts_at)
      from app_private.operator_holds h
      join app_private.groups g on g.group_id = h.group_id
      where h.ends_at is null
    ), '[]'::jsonb),
    'suspended', coalesce((
      select jsonb_agg(jsonb_build_object(
        'accountId', a.account_id, 'name', app_private.account_label(a.account_id))
        order by a.display_name)
      from app_private.accounts a where a.status = 'suspended'
    ), '[]'::jsonb),
    'groups', coalesce((
      select jsonb_agg(jsonb_build_object(
        'groupId', g.group_id, 'name', g.name,
        'members', (select jsonb_agg(jsonb_build_object(
            'membershipId', m.membership_id, 'name', app_private.member_label(m.membership_id))
            order by m.joined_at)
          from app_private.memberships m where m.group_id = g.group_id and m.ended_at is null)
      ) order by g.name)
      from app_private.groups g where g.status <> 'closed'
    ), '[]'::jsonb)
  );
end;
$$;

create or replace function app_private.operator_resolve_case(
  requested_case_id uuid, requested_action text, requested_at timestamptz
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  operator uuid := app_private.actor_operator();
  item app_private.moderation_cases%rowtype;
begin
  select * into item from app_private.moderation_cases
  where moderation_case_id = requested_case_id and status = 'open' for update;
  if item.moderation_case_id is null then
    raise exception 'case unavailable' using errcode = 'P0002';
  end if;
  if requested_action = 'dismiss' then
    update app_private.proof_messages set hidden_at = null
    where proof_message_id = item.proof_message_id;
    if item.kind = 'proof_report' then
      update app_private.workout_checkins set hidden_at = null
      where workout_checkin_id = item.workout_checkin_id and removed_at is null;
      delete from app_private.proof_reports where workout_checkin_id = item.workout_checkin_id;
    end if;
  elsif requested_action = 'remove' then
    update app_private.proof_messages set hidden_at = coalesce(hidden_at, requested_at)
    where proof_message_id = item.proof_message_id;
    update app_private.workout_checkins set removed_at = coalesce(removed_at, requested_at)
    where workout_checkin_id = item.workout_checkin_id;
  elsif requested_action = 'suspend' then
    update app_private.accounts set status = 'suspended', access_cutoff = requested_at
    where account_id = item.subject_account_id and status = 'active';
    -- A Moderation hold also freezes the member's own deadlines.
    insert into app_private.operator_holds
      (kind, group_id, membership_id, reason, opened_by, starts_at)
    select 'technical', m.group_id, m.membership_id, 'Moderation hold', operator, requested_at
    from app_private.memberships m
    where m.account_id = item.subject_account_id and m.ended_at is null;
  elsif requested_action = 'terminate' then
    perform app_private.end_membership(m.membership_id, 'service_terminated', requested_at)
    from app_private.memberships m
    where m.account_id = item.subject_account_id and m.group_id = item.group_id
      and m.ended_at is null;
  else
    raise exception 'unknown action' using errcode = '22023';
  end if;
  update app_private.moderation_cases
  set status = case when requested_action = 'dismiss' then 'dismissed' else 'actioned' end,
    outcome = requested_action, resolved_at = requested_at
  where moderation_case_id = requested_case_id;
  return app_private.operator_console(requested_at);
end;
$$;

create or replace function app_private.operator_reinstate(
  requested_account_id uuid, requested_at timestamptz
) returns jsonb
language plpgsql security definer set search_path = '' as $$
begin
  perform app_private.actor_operator();
  update app_private.accounts set status = 'active'
  where account_id = requested_account_id and status = 'suspended';
  update app_private.operator_holds h set ends_at = requested_at
  from app_private.memberships m
  where m.account_id = requested_account_id and h.membership_id = m.membership_id
    and h.reason = 'Moderation hold' and h.ends_at is null;
  return app_private.operator_console(requested_at);
end;
$$;

create or replace function app_private.operator_set_hold(
  requested_group_id uuid, requested_membership_id uuid, requested_reason text,
  requested_open boolean, requested_hold_id uuid, requested_at timestamptz
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare operator uuid := app_private.actor_operator();
begin
  if requested_open then
    if requested_membership_id is not null and not exists (
      select 1 from app_private.memberships
      where membership_id = requested_membership_id and group_id = requested_group_id
        and ended_at is null
    ) then
      raise exception 'member not in Group' using errcode = '22023';
    end if;
    insert into app_private.operator_holds
      (kind, group_id, membership_id, reason, opened_by, starts_at)
    values (case when requested_membership_id is null then 'service' else 'technical' end,
      requested_group_id, requested_membership_id, btrim(requested_reason), operator, requested_at);
  else
    update app_private.operator_holds set ends_at = requested_at
    where operator_hold_id = requested_hold_id and ends_at is null;
  end if;
  return app_private.operator_console(requested_at);
end;
$$;

-- Settlement also waits while an operator hold covers the member or their Group.
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
          and open_review.review_status in ('pending', 'questioned')
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
      update app_private.memberships set target_streak = target_streak + 1
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
      update app_private.memberships set target_streak = 0
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

-- Home tells an operator where their console is.
create or replace function app_private.home_safety(requested_at timestamptz)
returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'conductAccepted', coalesce(a.conduct_version_accepted, 0) >= app_private.conduct_version(),
    'blocked', coalesce((
      select jsonb_agg(b.blocked_membership_id) from app_private.safety_blocks b
      where b.blocker_membership_id = (app_private.actor_current_membership()).membership_id
    ), '[]'::jsonb),
    'operator', app_private.is_operator()
  )
  from app_private.accounts a where a.account_id = app_private.actor_account_id();
$$;

alter table app_private.operator_holds enable row level security;
revoke all on table app_private.operator_holds from public, anon, authenticated;
grant select, insert, update, delete on table app_private.operator_holds to service_role;
revoke all on function app_private.actor_operator(),
  app_private.is_operator(),
  app_private.account_label(uuid),
  app_private.operator_console(timestamptz),
  app_private.operator_resolve_case(uuid, text, timestamptz),
  app_private.operator_reinstate(uuid, timestamptz),
  app_private.operator_set_hold(uuid, uuid, text, boolean, uuid, timestamptz),
  app_private.finalize_ended_member_weeks(timestamptz),
  app_private.home_safety(timestamptz)
  from public, anon, authenticated;
grant execute on function app_private.actor_operator(),
  app_private.is_operator(),
  app_private.account_label(uuid),
  app_private.operator_console(timestamptz),
  app_private.operator_resolve_case(uuid, text, timestamptz),
  app_private.operator_reinstate(uuid, timestamptz),
  app_private.operator_set_hold(uuid, uuid, text, boolean, uuid, timestamptz),
  app_private.finalize_ended_member_weeks(timestamptz),
  app_private.home_safety(timestamptz)
  to service_role;

insert into app_private.schema_versions (version) values (40);
