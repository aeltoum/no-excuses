-- Proof counts the moment it is posted (#278). A submitted Workout report is a Verified
-- completion at once. Any other current member may question it until 24 hours after it was
-- submitted; questioning opens the 48-hour Group decision while the report keeps counting.
-- An open decision is a Verified report with questioned_at set and decided_at empty, so every
-- existing Verified count keeps the credit. A strict majority rejecting it makes it Rejected
-- (Consequence card); the author withdrawing makes it Unsupported; anything else leaves it
-- Verified. The single-peer Verify action and the 24-hour auto-verify are gone.

create or replace function app_private.proof_decision_open(
  item app_private.workout_checkins
) returns boolean
language sql immutable set search_path = '' as $$
  select item.review_status = 'verified' and item.questioned_at is not null
    and item.decided_at is null;
$$;

create or replace function app_private.submit_proof_checkin(
  requested_idempotency_key uuid,
  requested_request_hash text,
  requested_request_id uuid,
  requested_workout_checkin_id uuid,
  requested_activity_type app_private.workout_activity_type,
  requested_completed_at timestamptz,
  requested_duration_minutes integer,
  requested_perceived_intensity app_private.perceived_intensity,
  requested_self_report_attested boolean,
  requested_activity_photo_path text,
  requested_presence_photo_path text,
  requested_media_consent boolean,
  requested_at timestamptz
) returns table (workout_checkin_id uuid, current_week_count integer)
language plpgsql security definer set search_path = '' as $$
declare
  actor uuid := app_private.actor_account_id();
  result_id uuid;
  result_count integer;
begin
  if requested_media_consent is not true then
    raise exception 'media-sharing consent required' using errcode = '22023';
  end if;
  select s.workout_checkin_id, s.current_week_count into result_id, result_count
  from app_private.submit_workout_checkin(
    requested_idempotency_key, requested_request_hash, requested_request_id,
    requested_workout_checkin_id, requested_activity_type, requested_completed_at,
    requested_duration_minutes, requested_perceived_intensity,
    requested_self_report_attested, requested_at
  ) s;

  -- Idempotent replay returns the stored result without attaching photos again.
  if exists (select 1 from app_private.workout_checkins c
             where c.workout_checkin_id = result_id and c.activity_photo_path is null) then
    update app_private.proof_uploads set used_at = requested_at
    where account_id = actor and used_at is null and deleted_at is null
      and ((path = requested_activity_photo_path and kind = 'activity')
        or (path = requested_presence_photo_path and kind = 'presence'));
    if not found or (select count(*) from app_private.proof_uploads
        where used_at = requested_at and account_id = actor
          and path in (requested_activity_photo_path, requested_presence_photo_path)) <> 2 then
      raise exception 'both proof photos required' using errcode = '22023';
    end if;
    update app_private.workout_checkins
    set review_status = 'verified', activity_photo_path = requested_activity_photo_path,
      presence_photo_path = requested_presence_photo_path, verified_at = submitted_at,
      questioned_at = null, decided_at = null
    where workout_checkins.workout_checkin_id = result_id;
  end if;
  return query select result_id, result_count;
end;
$$;

-- Close an open Group decision: a strict majority rejecting it makes it Rejected; when
-- everyone has responded or 48 hours pass without that, it stays Verified.
create or replace function app_private.resolve_proof_decision(
  requested_checkin_id uuid, requested_at timestamptz
) returns app_private.proof_review_status
language plpgsql security definer set search_path = '' as $$
declare
  item app_private.workout_checkins%rowtype;
  eligible integer;
  accepts integer;
  rejects integer;
  responded integer;
begin
  select * into item from app_private.workout_checkins
  where workout_checkin_id = requested_checkin_id for update;
  if item.workout_checkin_id is null then return null; end if;
  if not app_private.proof_decision_open(item) then return item.review_status; end if;
  select count(*) into eligible
  from app_private.proof_decision_audience a
  join app_private.memberships m on m.membership_id = a.membership_id and m.ended_at is null
  where a.workout_checkin_id = requested_checkin_id;
  select count(*) filter (where v.vote = 'accept'), count(*) filter (where v.vote = 'reject'),
    count(*)
  into accepts, rejects, responded
  from app_private.proof_votes v
  join app_private.memberships m on m.membership_id = v.membership_id and m.ended_at is null
  where v.workout_checkin_id = requested_checkin_id;

  if rejects * 2 > eligible then
    update app_private.workout_checkins
    set review_status = 'rejected', decided_at = requested_at
    where workout_checkin_id = requested_checkin_id;
    perform app_private.add_consequence_obligation(
      md5('rejected_report:' || requested_checkin_id::text)::uuid,
      item.membership_id, 'rejected_report', requested_checkin_id, requested_at
    );
    return 'rejected';
  elsif accepts * 2 > eligible or responded >= eligible
     or requested_at >= item.questioned_at + interval '48 hours' then
    update app_private.workout_checkins set decided_at = requested_at
    where workout_checkin_id = requested_checkin_id;
    return 'verified';
  end if;
  return 'questioned';
end;
$$;

-- Question is the only review action left; it is open for 24 hours after submission.
create or replace function app_private.review_proof_checkin(
  requested_checkin_id uuid, requested_action text, requested_at timestamptz
) returns app_private.proof_review_status
language plpgsql security definer set search_path = '' as $$
declare
  viewer app_private.memberships := app_private.actor_current_membership();
  item app_private.workout_checkins%rowtype;
  author app_private.memberships%rowtype;
begin
  if requested_action is distinct from 'question' then
    raise exception 'unknown review action' using errcode = '22023';
  end if;
  select * into item from app_private.workout_checkins
  where workout_checkin_id = requested_checkin_id for update;
  select * into author from app_private.memberships where membership_id = item.membership_id;
  if viewer.membership_id is null or item.workout_checkin_id is null
     or author.group_id <> viewer.group_id or author.membership_id = viewer.membership_id
     or author.ended_at is not null or item.hidden_at is not null
     or item.removed_at is not null or item.activity_photo_path is null then
    raise exception 'review unavailable' using errcode = '42501';
  end if;
  if item.review_status <> 'verified' or item.questioned_at is not null
     or item.decided_at is not null
     or requested_at >= item.submitted_at + interval '24 hours' then
    raise exception 'review window closed' using errcode = 'P0002';
  end if;
  update app_private.workout_checkins set questioned_at = requested_at
  where workout_checkin_id = requested_checkin_id;
  insert into app_private.proof_decision_audience (workout_checkin_id, membership_id)
  select requested_checkin_id, m.membership_id
  from app_private.memberships m
  where m.group_id = author.group_id and m.ended_at is null
    and m.membership_id <> author.membership_id
  on conflict do nothing;
  return 'questioned';
end;
$$;

create or replace function app_private.vote_proof_checkin(
  requested_checkin_id uuid, requested_vote app_private.proof_vote, requested_at timestamptz
) returns app_private.proof_review_status
language plpgsql security definer set search_path = '' as $$
declare
  viewer app_private.memberships := app_private.actor_current_membership();
  item app_private.workout_checkins%rowtype;
begin
  select * into item from app_private.workout_checkins
  where workout_checkin_id = requested_checkin_id for update;
  if viewer.membership_id is null or not exists (
    select 1 from app_private.proof_decision_audience
    where workout_checkin_id = requested_checkin_id and membership_id = viewer.membership_id
  ) then
    raise exception 'vote unavailable' using errcode = '42501';
  end if;
  if not app_private.proof_decision_open(item)
     or requested_at >= item.questioned_at + interval '48 hours' then
    raise exception 'decision closed' using errcode = 'P0002';
  end if;
  insert into app_private.proof_votes (workout_checkin_id, membership_id, vote, voted_at)
  values (requested_checkin_id, viewer.membership_id, requested_vote, requested_at)
  on conflict (workout_checkin_id, membership_id)
    do update set vote = excluded.vote, voted_at = excluded.voted_at;
  return app_private.resolve_proof_decision(requested_checkin_id, requested_at);
end;
$$;

create or replace function app_private.withdraw_proof_checkin(
  requested_checkin_id uuid, requested_at timestamptz
) returns app_private.proof_review_status
language plpgsql security definer set search_path = '' as $$
declare viewer app_private.memberships := app_private.actor_current_membership();
begin
  update app_private.workout_checkins c
  set review_status = 'unsupported', decided_at = requested_at
  where c.workout_checkin_id = requested_checkin_id and c.membership_id = viewer.membership_id
    and app_private.proof_decision_open(c);
  if not found then
    raise exception 'withdraw unavailable' using errcode = '42501';
  end if;
  return 'unsupported';
end;
$$;

-- Nothing auto-verifies any more; only open Group decisions can time out.
create or replace function app_private.advance_proof_reviews(requested_at timestamptz)
returns integer
language plpgsql security definer set search_path = '' as $$
declare changed integer := 0; item record;
begin
  for item in
    select c.workout_checkin_id from app_private.workout_checkins c
    where app_private.proof_decision_open(c)
  loop
    if app_private.resolve_proof_decision(item.workout_checkin_id, requested_at)
       <> 'questioned' then
      changed := changed + 1;
    end if;
  end loop;
  return changed;
end;
$$;

-- A member may not take down photos while their Group is deciding on them.
create or replace function app_private.remove_own_photos(
  requested_checkin_id uuid, requested_at timestamptz
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare viewer app_private.memberships := app_private.actor_current_membership();
begin
  if viewer.membership_id is null then
    raise exception 'current Group membership required' using errcode = '42501';
  end if;
  update app_private.workout_checkins c set removed_at = coalesce(c.removed_at, requested_at)
  where c.workout_checkin_id = requested_checkin_id and c.membership_id = viewer.membership_id
    and c.review_status = 'verified' and c.activity_photo_path is not null
    and c.media_deleted_at is null and not app_private.proof_decision_open(c);
  if not found then
    raise exception 'remove unavailable' using errcode = '42501';
  end if;
  return requested_checkin_id;
end;
$$;

-- The Wall reports an open decision as 'questioned'; review_closes_at and can_review now
-- describe the 24-hour question window. Verified items show for 90 days from submission.
create or replace function app_private.proof_feed(requested_at timestamptz)
returns table (
  workout_checkin_id uuid,
  author_membership_id uuid,
  author_name text,
  mine boolean,
  activity_type text,
  duration_minutes integer,
  perceived_intensity text,
  completed_at timestamptz,
  submitted_at timestamptz,
  review_status text,
  review_closes_at timestamptz,
  decision_closes_at timestamptz,
  hidden boolean,
  my_vote text,
  accept_votes integer,
  reject_votes integer,
  eligible_voters integer,
  can_review boolean,
  can_vote boolean,
  activity_photo_path text,
  presence_photo_path text,
  can_delete boolean
)
language plpgsql stable security definer set search_path = '' as $$
declare
  viewer app_private.memberships := app_private.actor_current_membership();
  admin boolean;
begin
  if viewer.membership_id is null then
    raise exception 'current Group membership required' using errcode = '42501';
  end if;
  admin := exists (select 1 from app_private.group_admins where membership_id = viewer.membership_id);
  return query
  select c.workout_checkin_id, m.membership_id,
    coalesce(a.display_name, 'Member ' || left(m.membership_id::text, 8)),
    m.membership_id = viewer.membership_id,
    c.activity_type::text, c.duration_minutes, c.perceived_intensity::text,
    c.completed_at, c.submitted_at,
    case when app_private.proof_decision_open(c) then 'questioned'
      else c.review_status::text end,
    case when c.review_status = 'verified' and c.questioned_at is null and c.decided_at is null
        and requested_at < c.submitted_at + interval '24 hours'
      then c.submitted_at + interval '24 hours' end,
    case when app_private.proof_decision_open(c) then c.questioned_at + interval '48 hours' end,
    c.hidden_at is not null,
    v.vote::text,
    (select count(*)::integer from app_private.proof_votes pv
     where pv.workout_checkin_id = c.workout_checkin_id and pv.vote = 'accept'),
    (select count(*)::integer from app_private.proof_votes pv
     where pv.workout_checkin_id = c.workout_checkin_id and pv.vote = 'reject'),
    (select count(*)::integer from app_private.proof_decision_audience pa
     join app_private.memberships am on am.membership_id = pa.membership_id and am.ended_at is null
     where pa.workout_checkin_id = c.workout_checkin_id),
    c.review_status = 'verified' and c.questioned_at is null and c.decided_at is null
      and m.membership_id <> viewer.membership_id and c.hidden_at is null
      and requested_at < c.submitted_at + interval '24 hours',
    app_private.proof_decision_open(c) and c.hidden_at is null
      and requested_at < c.questioned_at + interval '48 hours'
      and exists (select 1 from app_private.proof_decision_audience pa
        where pa.workout_checkin_id = c.workout_checkin_id
          and pa.membership_id = viewer.membership_id),
    c.activity_photo_path, c.presence_photo_path,
    m.membership_id = viewer.membership_id and mw.status = 'active' and requested_at < aw.ends_at
  from app_private.workout_checkins c
  join app_private.memberships m on m.membership_id = c.membership_id
  join app_private.member_weeks mw on mw.member_week_id = c.member_week_id
  join app_private.accountability_weeks aw on aw.accountability_week_id = mw.accountability_week_id
  join app_private.accounts a on a.account_id = m.account_id
  left join app_private.proof_votes v
    on v.workout_checkin_id = c.workout_checkin_id and v.membership_id = viewer.membership_id
  where m.group_id = viewer.group_id and m.ended_at is null
    and c.activity_photo_path is not null and c.removed_at is null and c.media_deleted_at is null
    and (c.hidden_at is null or admin or m.membership_id = viewer.membership_id)
    and c.review_status = 'verified'
    and (app_private.proof_decision_open(c) or requested_at < c.submitted_at + interval '90 days')
  order by c.submitted_at desc
  limit 100;
end;
$$;

-- A week waits while any of its posts can still be questioned or is being decided
-- (at most 72 hours after it ends); holds and exceptions still apply.
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

-- Push copy is unchanged (#279); only the open-decision test moves off the stored status.
create or replace function app_private.enqueue_push_notifications(requested_at timestamptz)
returns integer
language plpgsql security definer set search_path = '' as $$
declare enqueued integer := 0; added integer;
begin

  insert into app_private.web_push_outbox (account_id, dedupe_key, title, body)
  select recipient.account_id,
    'workout:' || wc.workout_checkin_id || ':' || recipient.account_id,
    coalesce(author_account.display_name, 'A Group member') || ' logged a workout',
    case when wc.activity_photo_path is null
      then (select count(*) from app_private.workout_checkins c
            where c.member_week_id = wc.member_week_id)
        || ' of ' || mw.target || ' this week. Your move.'
      else 'Check the proof and verify it on the Wall.' end
  from app_private.workout_checkins wc
  join app_private.member_weeks mw on mw.member_week_id = wc.member_week_id
  join app_private.memberships author on author.membership_id = wc.membership_id
  join app_private.accounts author_account on author_account.account_id = author.account_id
  join app_private.memberships peer on peer.group_id = author.group_id
    and peer.ended_at is null and peer.membership_id <> author.membership_id
    and peer.joined_at <= wc.submitted_at
  join app_private.push_recipients() recipient on recipient.account_id = peer.account_id
  where wc.submitted_at > requested_at - interval '1 day'
    and wc.submitted_at >= recipient.since
  on conflict (dedupe_key) do nothing;
  get diagnostics added = row_count;
  enqueued := enqueued + added;

  insert into app_private.web_push_outbox (account_id, dedupe_key, title, body)
  select recipient.account_id,
    'questioned:' || wc.workout_checkin_id || ':' || recipient.account_id,
    coalesce(author_account.display_name, 'A Group member') || '''s workout was questioned',
    'Vote within 48 hours: accept or reject the proof.'
  from app_private.workout_checkins wc
  join app_private.memberships author on author.membership_id = wc.membership_id
  join app_private.accounts author_account on author_account.account_id = author.account_id
  join app_private.proof_decision_audience pa on pa.workout_checkin_id = wc.workout_checkin_id
  join app_private.memberships voter on voter.membership_id = pa.membership_id
    and voter.ended_at is null
  join app_private.push_recipients() recipient on recipient.account_id = voter.account_id
  where app_private.proof_decision_open(wc) and wc.questioned_at >= recipient.since
  on conflict (dedupe_key) do nothing;
  get diagnostics added = row_count;
  enqueued := enqueued + added;

  insert into app_private.web_push_outbox (account_id, dedupe_key, title, body)
  select recipient.account_id,
    'proof-outcome:' || wc.workout_checkin_id,
    case when app_private.proof_decision_open(wc) then 'Your workout was questioned'
      when wc.review_status = 'rejected' then 'Your workout was rejected'
      else 'Your workout did not count' end,
    case when app_private.proof_decision_open(wc) then 'Your Group is voting on your proof.'
      when wc.review_status = 'rejected' then 'It does not count, and you owe a Consequence card.'
      else 'The Group decision ended without accepting it.' end
  from app_private.workout_checkins wc
  join app_private.memberships author on author.membership_id = wc.membership_id
    and author.ended_at is null
  join app_private.push_recipients() recipient on recipient.account_id = author.account_id
  where (app_private.proof_decision_open(wc) or wc.review_status in ('rejected', 'unsupported'))
    and coalesce(wc.decided_at, wc.questioned_at) > requested_at - interval '1 day'
    and coalesce(wc.decided_at, wc.questioned_at) >= recipient.since
  on conflict (dedupe_key) do update
    set title = excluded.title, body = excluded.body, sent_at = null
    where app_private.web_push_outbox.title <> excluded.title;
  get diagnostics added = row_count;
  enqueued := enqueued + added;

  insert into app_private.web_push_outbox (account_id, dedupe_key, title, body)
  select m.account_id, 'reminder:' || mw.member_week_id, 'Less than 24 hours left',
    'You have ' || done.count || ' of ' || mw.target || ' workouts. No excuses.'
  from app_private.member_weeks mw
  join app_private.accountability_weeks aw on aw.accountability_week_id = mw.accountability_week_id
  join app_private.memberships m on m.membership_id = mw.membership_id and m.ended_at is null
  join app_private.push_recipients() s on s.account_id = m.account_id
  cross join lateral (
    select count(*)::integer as count from app_private.workout_checkins c
    where c.member_week_id = mw.member_week_id
      and c.review_status not in ('unsupported', 'rejected')
  ) done
  where mw.status = 'active'
    and requested_at >= aw.ends_at - interval '24 hours' and requested_at < aw.ends_at
    and done.count < mw.target
  on conflict (dedupe_key) do nothing;
  get diagnostics added = row_count;
  enqueued := enqueued + added;

  insert into app_private.web_push_outbox (account_id, dedupe_key, title, body)
  select m.account_id, 'result:' || mw.member_week_id,
    case when mw.status = 'attained' then 'Week Met' else 'Week Missed' end,
    case when mw.status = 'attained' then 'Target hit. Keep it going.'
      else 'Target missed. Your Group can see it.' end
  from app_private.member_weeks mw
  join app_private.accountability_weeks aw on aw.accountability_week_id = mw.accountability_week_id
  join app_private.memberships m on m.membership_id = mw.membership_id and m.ended_at is null
  join app_private.push_recipients() s on s.account_id = m.account_id
  where mw.status in ('attained', 'missed')
    and aw.ends_at > requested_at - interval '5 days' and aw.ends_at >= s.since
  on conflict (dedupe_key) do nothing;
  get diagnostics added = row_count;
  return enqueued + added;
end;
$$;

-- Switch-over: reports awaiting review become Verified from their submission, keeping the
-- rest of their 24-hour question window; open decisions keep running and close under the new
-- rule. Closed results, including Unsupported ones, are untouched.
update app_private.workout_checkins
set review_status = 'verified', verified_at = submitted_at, decided_at = null
where review_status in ('pending', 'questioned');

revoke all on function app_private.proof_decision_open(app_private.workout_checkins)
  from public, anon, authenticated;
grant execute on function app_private.proof_decision_open(app_private.workout_checkins)
  to service_role;

insert into app_private.schema_versions (version) values (48);
