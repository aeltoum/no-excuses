-- New-post push reads as information (#279): "Sam posted a 5 km run", with no review call to
-- action. The trigger is unchanged. Outcome pushes match the result: a decision without a
-- reject majority leaves the post Verified, and a withdrawn post is Unsupported.
-- Members of a Group at release see a one-time notice on Home until they dismiss it; Accounts
-- that join afterwards never had the old rule, so they start without it.

-- A short phrase for a post, from its structured details when present, else its activity type.
create or replace function app_private.workout_label(item app_private.workout_checkins)
returns text
language sql immutable set search_path = '' as $$
  select case
    when item.details ? 'cardio' then
      case when item.details #> '{cardio,distanceKm}' is not null then
        'a ' || trim(trailing '.' from trim(trailing '0' from
          round((item.details #>> '{cardio,distanceKm}')::numeric, 1)::text)) || ' km '
      else 'a ' end
      || case item.details #>> '{cardio,activity}'
        when 'cycle' then 'ride' when 'row' then 'row' when 'elliptical' then 'elliptical session'
        when 'stairs' then 'stair climb' else item.details #>> '{cardio,activity}' end
    when item.activity_type = 'strength' then 'a strength workout'
    when item.activity_type = 'cardio' then 'a cardio workout'
    when item.activity_type = 'class' then 'a class'
    when item.activity_type = 'sport' then 'a sport session'
    when item.activity_type = 'mixed' then 'a mixed workout'
    else 'a workout' end;
$$;

alter table app_private.accounts add column count_notice_pending boolean not null default false;
update app_private.accounts a set count_notice_pending = true
where exists (select 1 from app_private.memberships m
              where m.account_id = a.account_id and m.ended_at is null);

create or replace function app_private.notices()
returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare actor app_private.accounts%rowtype;
begin
  select * into actor from app_private.accounts where account_id = app_private.actor_account_id();
  if actor.account_id is null then
    raise exception 'active account required' using errcode = '42501';
  end if;
  return jsonb_build_object('countsRightAway', actor.count_notice_pending);
end;
$$;

create or replace function app_private.dismiss_count_notice()
returns boolean
language plpgsql security definer set search_path = '' as $$
begin
  update app_private.accounts set count_notice_pending = false
  where account_id = app_private.actor_account_id();
  if not found then
    raise exception 'active account required' using errcode = '42501';
  end if;
  return true;
end;
$$;

create or replace function app_private.enqueue_push_notifications(requested_at timestamptz)
returns integer
language plpgsql security definer set search_path = '' as $$
declare enqueued integer := 0; added integer;
begin

  insert into app_private.web_push_outbox (account_id, dedupe_key, title, body)
  select recipient.account_id,
    'workout:' || wc.workout_checkin_id || ':' || recipient.account_id,
    coalesce(author_account.display_name, 'A Group member') || ' posted '
      || app_private.workout_label(wc),
    (select count(*) from app_private.workout_checkins c
     where c.member_week_id = wc.member_week_id and c.submitted_at <= wc.submitted_at)
      || ' of ' || mw.target || ' this week.'
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
      when wc.review_status = 'verified' then 'Your workout still counts'
      else 'Your workout did not count' end,
    case when app_private.proof_decision_open(wc) then 'Your Group is voting on your proof.'
      when wc.review_status = 'rejected' then 'It does not count, and you owe a Consequence card.'
      when wc.review_status = 'verified' then 'The Group decision ended without a majority to reject it.'
      else 'You withdrew it, so it does not count.' end
  from app_private.workout_checkins wc
  join app_private.memberships author on author.membership_id = wc.membership_id
    and author.ended_at is null
  join app_private.push_recipients() recipient on recipient.account_id = author.account_id
  where (wc.questioned_at is not null or wc.review_status in ('rejected', 'unsupported'))
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

revoke all on function app_private.workout_label(app_private.workout_checkins),
  app_private.notices(), app_private.dismiss_count_notice()
  from public, anon, authenticated;
grant execute on function app_private.workout_label(app_private.workout_checkins),
  app_private.notices(), app_private.dismiss_count_notice()
  to service_role;

insert into app_private.schema_versions (version) values (49);
