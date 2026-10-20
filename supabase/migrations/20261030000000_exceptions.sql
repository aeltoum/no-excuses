-- Exceptions (owner-approved 2026-10-20): a member asks to waive their Weekly target for this
-- week or next with a broad category and an optional note of at most 280 characters. Members
-- active at submission cast sealed Approve, Deny, or Abstain ballots for 48 hours and may change
-- them until a strict majority closes the decision; a tie or timeout denies. While a request is
-- open the week waits to settle. An approved Exception settles the week as Excepted: no Missed-
-- target event or Consequence card, and both streaks freeze. Category and note leave active
-- systems seven days after resolution, or when the requester's membership ends.

create table app_private.exception_requests (
  exception_request_id uuid primary key,
  membership_id uuid not null references app_private.memberships(membership_id) on delete cascade,
  week_starts_at timestamptz not null,
  category text,
  note text,
  status text not null default 'pending'
    check (status in ('pending', 'approved', 'denied', 'withdrawn')),
  submitted_at timestamptz not null,
  closes_at timestamptz not null,
  resolved_at timestamptz,
  content_cleared_at timestamptz,
  constraint exception_category check (category in (
    'health_safety', 'family_caregiving', 'schedule_disruption', 'travel_access',
    'planned_recovery', 'private'
  )),
  constraint exception_content check (
    content_cleared_at is not null or category is not null
  ),
  constraint exception_note check (note is null or length(note) <= 280)
);
create unique index exception_requests_one_open on app_private.exception_requests
  (membership_id, week_starts_at) where status in ('pending', 'approved');

create table app_private.exception_ballots (
  exception_request_id uuid not null
    references app_private.exception_requests(exception_request_id) on delete cascade,
  membership_id uuid not null references app_private.memberships(membership_id) on delete cascade,
  response text check (response in ('approve', 'deny', 'abstain')),
  responded_at timestamptz,
  primary key (exception_request_id, membership_id)
);

-- Start of the viewer's current week, or of the week after it.
create or replace function app_private.exception_week_start(
  requested_membership_id uuid, requested_week text, requested_at timestamptz
) returns timestamptz
language sql stable security definer set search_path = '' as $$
  select case requested_week when 'current' then aw.starts_at when 'next' then aw.ends_at end
  from app_private.member_weeks mw
  join app_private.accountability_weeks aw on aw.accountability_week_id = mw.accountability_week_id
  where mw.membership_id = requested_membership_id and mw.status = 'active'
    and requested_at >= aw.starts_at and requested_at < aw.ends_at;
$$;

create or replace function app_private.resolve_exception(
  requested_id uuid, requested_at timestamptz
) returns text
language plpgsql security definer set search_path = '' as $$
declare
  item app_private.exception_requests%rowtype;
  eligible integer;
  approvals integer;
  denials integer;
  responded integer;
  outcome text;
begin
  select * into item from app_private.exception_requests
  where exception_request_id = requested_id for update;
  if item.status <> 'pending' then return item.status; end if;
  select count(*),
    count(*) filter (where b.response = 'approve'),
    count(*) filter (where b.response = 'deny'),
    count(*) filter (where b.response is not null)
  into eligible, approvals, denials, responded
  from app_private.exception_ballots b
  join app_private.memberships m on m.membership_id = b.membership_id and m.ended_at is null
  where b.exception_request_id = requested_id;
  if approvals * 2 > eligible then
    outcome := 'approved';
  elsif denials * 2 > eligible or responded >= eligible or requested_at >= item.closes_at then
    outcome := 'denied';
  else
    return 'pending';
  end if;
  update app_private.exception_requests set status = outcome, resolved_at = requested_at
  where exception_request_id = requested_id;
  return outcome;
end;
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
  insert into app_private.exception_requests (
    exception_request_id, membership_id, week_starts_at, category, note,
    submitted_at, closes_at
  ) values (
    requested_id, viewer.membership_id, starts, requested_category, cleaned,
    requested_at, requested_at + interval '48 hours'
  );
  insert into app_private.exception_ballots (exception_request_id, membership_id)
  select requested_id, m.membership_id from app_private.memberships m
  where m.group_id = viewer.group_id and m.ended_at is null
    and m.membership_id <> viewer.membership_id;
  return app_private.home_extras(requested_at);
end;
$$;

create or replace function app_private.respond_to_exception(
  requested_id uuid, requested_response text, requested_at timestamptz
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare viewer app_private.memberships := app_private.actor_current_membership();
begin
  perform 1 from app_private.exception_requests
  where exception_request_id = requested_id for update;
  update app_private.exception_ballots b
  set response = requested_response, responded_at = requested_at
  from app_private.exception_requests r
  where b.exception_request_id = requested_id and b.membership_id = viewer.membership_id
    and r.exception_request_id = b.exception_request_id and r.status = 'pending'
    and requested_at < r.closes_at;
  if viewer.membership_id is null or not found then
    raise exception 'ballot unavailable' using errcode = '42501';
  end if;
  perform app_private.resolve_exception(requested_id, requested_at);
  return app_private.home_extras(requested_at);
end;
$$;

create or replace function app_private.withdraw_exception(
  requested_id uuid, requested_at timestamptz
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare viewer app_private.memberships := app_private.actor_current_membership();
begin
  update app_private.exception_requests
  set status = 'withdrawn', resolved_at = requested_at
  where exception_request_id = requested_id and membership_id = viewer.membership_id
    and status = 'pending';
  if viewer.membership_id is null or not found then
    raise exception 'withdraw unavailable' using errcode = '42501';
  end if;
  return app_private.home_extras(requested_at);
end;
$$;

-- Timeouts close open decisions; private context leaves after its retention period.
create or replace function app_private.advance_exceptions(requested_at timestamptz)
returns integer
language plpgsql security definer set search_path = '' as $$
declare item record; changed integer := 0;
begin
  for item in
    select exception_request_id from app_private.exception_requests
    where status = 'pending' and requested_at >= closes_at
  loop
    perform app_private.resolve_exception(item.exception_request_id, requested_at);
    changed := changed + 1;
  end loop;
  update app_private.exception_requests r
  set category = null, note = null, content_cleared_at = requested_at
  from app_private.memberships m
  where m.membership_id = r.membership_id and r.content_cleared_at is null
    and ((r.status <> 'pending' and requested_at >= r.resolved_at + interval '7 days')
      or m.ended_at is not null);
  -- A requester who leaves withdraws their open request.
  update app_private.exception_requests r
  set status = 'withdrawn', resolved_at = requested_at
  from app_private.memberships m
  where m.membership_id = r.membership_id and r.status = 'pending' and m.ended_at is not null;
  return changed;
end;
$$;

-- Settlement: an open request holds its week; an approved one settles it as Excepted.
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

-- Workout streak freezes through excused weeks: their completions neither add nor reset.
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
        and smw.status <> 'excepted'
        and not exists (
          select 1 from app_private.exception_requests er
          where er.membership_id = m.membership_id and er.week_starts_at = saw.starts_at
            and er.status = 'approved'
        )
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

-- History now includes excused weeks; they keep the streak as it stood.
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
      and mw.status in ('attained', 'missed', 'excepted')
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

-- Home data for the newer slices, in one read so Home makes one extra request.
create or replace function app_private.home_extras(requested_at timestamptz)
returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  viewer app_private.memberships := app_private.actor_current_membership();
  current_start timestamptz;
begin
  if viewer.membership_id is null then
    raise exception 'current Group membership required' using errcode = '42501';
  end if;
  current_start := app_private.exception_week_start(viewer.membership_id, 'current', requested_at);
  return jsonb_build_object(
    'exceptions', jsonb_build_object(
      'mine', coalesce((
        select jsonb_agg(jsonb_build_object(
          'id', r.exception_request_id,
          'week', case when r.week_starts_at = current_start then 'current' else 'next' end,
          'category', r.category, 'note', r.note, 'status', r.status,
          'closesAt', r.closes_at
        ) order by r.week_starts_at)
        from app_private.exception_requests r
        where r.membership_id = viewer.membership_id
          and r.week_starts_at >= current_start
          and r.status in ('pending', 'approved', 'denied')
      ), '[]'::jsonb),
      'toDecide', coalesce((
        select jsonb_agg(jsonb_build_object(
          'id', r.exception_request_id,
          'name', app_private.member_label(r.membership_id),
          'week', case when r.week_starts_at > requested_at then 'next' else 'current' end,
          'category', r.category, 'note', r.note, 'closesAt', r.closes_at,
          'myResponse', b.response
        ) order by r.submitted_at)
        from app_private.exception_requests r
        join app_private.exception_ballots b
          on b.exception_request_id = r.exception_request_id
          and b.membership_id = viewer.membership_id
        where r.status = 'pending' and requested_at < r.closes_at
      ), '[]'::jsonb),
      -- Neutral, Group-visible state for this week's friend cards.
      'excused', coalesce((
        select jsonb_agg(r.membership_id)
        from app_private.exception_requests r
        join app_private.memberships m on m.membership_id = r.membership_id
        where m.group_id = viewer.group_id and m.ended_at is null
          and r.week_starts_at = current_start and r.status = 'approved'
      ), '[]'::jsonb),
      'pending', coalesce((
        select jsonb_agg(r.membership_id)
        from app_private.exception_requests r
        join app_private.memberships m on m.membership_id = r.membership_id
        where m.group_id = viewer.group_id and m.ended_at is null
          and r.week_starts_at = current_start and r.status = 'pending'
      ), '[]'::jsonb)
    )
  );
end;
$$;

-- Push: voters hear about a new request; the requester hears the outcome.
create or replace function app_private.enqueue_exception_push(requested_at timestamptz)
returns integer
language plpgsql security definer set search_path = '' as $$
declare added integer; total integer := 0;
begin
  insert into app_private.web_push_outbox (account_id, dedupe_key, title, body)
  select voter.account_id, 'exception:' || r.exception_request_id || ':' || voter.account_id,
    app_private.member_label(r.membership_id) || ' asked to skip a week',
    'Approve, deny, or abstain within 48 hours.'
  from app_private.exception_requests r
  join app_private.exception_ballots b on b.exception_request_id = r.exception_request_id
  join app_private.memberships voter on voter.membership_id = b.membership_id and voter.ended_at is null
  join app_private.push_recipients() s on s.account_id = voter.account_id
  where r.status = 'pending' and r.submitted_at > requested_at - interval '1 day'
    and r.submitted_at >= s.since
  on conflict (dedupe_key) do nothing;
  get diagnostics added = row_count;
  total := total + added;
  insert into app_private.web_push_outbox (account_id, dedupe_key, title, body)
  select m.account_id, 'exception-outcome:' || r.exception_request_id,
    case when r.status = 'approved' then 'Exception approved' else 'Exception denied' end,
    case when r.status = 'approved' then 'Your target is waived for that week. Streaks hold.'
      else 'Your target stands for that week.' end
  from app_private.exception_requests r
  join app_private.memberships m on m.membership_id = r.membership_id and m.ended_at is null
  join app_private.push_recipients() s on s.account_id = m.account_id
  where r.status in ('approved', 'denied') and r.resolved_at > requested_at - interval '1 day'
    and r.resolved_at >= s.since
  on conflict (dedupe_key) do nothing;
  get diagnostics added = row_count;
  return total + added;
end;
$$;

alter table app_private.exception_requests enable row level security;
alter table app_private.exception_ballots enable row level security;
revoke all on table app_private.exception_requests, app_private.exception_ballots
  from public, anon, authenticated;
grant select, insert, update, delete on table app_private.exception_requests,
  app_private.exception_ballots to service_role;
revoke all on function app_private.exception_week_start(uuid, text, timestamptz),
  app_private.resolve_exception(uuid, timestamptz),
  app_private.request_exception(uuid, text, text, text, timestamptz),
  app_private.respond_to_exception(uuid, text, timestamptz),
  app_private.withdraw_exception(uuid, timestamptz),
  app_private.advance_exceptions(timestamptz),
  app_private.finalize_ended_member_weeks(timestamptz),
  app_private.home_extras(timestamptz),
  app_private.enqueue_exception_push(timestamptz),
  app_private.current_week_progress(uuid, timestamptz),
  app_private.finalized_weekly_history(uuid)
  from public, anon, authenticated;
grant execute on function app_private.exception_week_start(uuid, text, timestamptz),
  app_private.resolve_exception(uuid, timestamptz),
  app_private.request_exception(uuid, text, text, text, timestamptz),
  app_private.respond_to_exception(uuid, text, timestamptz),
  app_private.withdraw_exception(uuid, timestamptz),
  app_private.advance_exceptions(timestamptz),
  app_private.finalize_ended_member_weeks(timestamptz),
  app_private.home_extras(timestamptz),
  app_private.enqueue_exception_push(timestamptz)
  to service_role;
grant execute on function app_private.current_week_progress(uuid, timestamptz),
  app_private.finalized_weekly_history(uuid)
  to authenticated, service_role;

insert into app_private.schema_versions (version) values (33);
