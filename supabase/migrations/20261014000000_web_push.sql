-- Deferred slice: Notifications (owner-approved 2026-10-13). Web Push delivery for
-- friend check-ins, a last-24-hours reminder, and weekly Met/Missed results.
create table app_private.web_push_subscriptions (
  endpoint text primary key,
  account_id uuid not null references app_private.accounts(account_id) on delete cascade,
  p256dh text not null,
  auth text not null,
  created_at timestamptz not null default transaction_timestamp(),
  constraint web_push_subscriptions_shape check (
    endpoint ~ '^https://' and length(endpoint) <= 1000
    and length(p256dh) between 1 and 200 and length(auth) between 1 and 100
  )
);
create index web_push_subscriptions_account on app_private.web_push_subscriptions (account_id);

create table app_private.web_push_outbox (
  outbox_id bigint generated always as identity primary key,
  account_id uuid not null references app_private.accounts(account_id) on delete cascade,
  dedupe_key text not null unique,
  title text not null,
  body text not null,
  created_at timestamptz not null default transaction_timestamp(),
  sent_at timestamptz
);
create index web_push_outbox_unsent on app_private.web_push_outbox (outbox_id) where sent_at is null;

create or replace function app_private.save_push_subscription(
  requested_endpoint text, requested_p256dh text, requested_auth text
) returns boolean
language plpgsql security definer set search_path = '' as $$
declare actor uuid := app_private.actor_account_id();
begin
  if actor is null then
    raise exception 'Access denied' using errcode = '42501';
  end if;
  insert into app_private.web_push_subscriptions (endpoint, account_id, p256dh, auth)
  values (requested_endpoint, actor, requested_p256dh, requested_auth)
  on conflict (endpoint) do update
    set account_id = excluded.account_id, p256dh = excluded.p256dh,
      auth = excluded.auth, created_at = transaction_timestamp();
  return true;
end;
$$;

create or replace function app_private.delete_push_subscription(requested_endpoint text)
returns boolean
language plpgsql security definer set search_path = '' as $$
begin
  delete from app_private.web_push_subscriptions
  where endpoint = requested_endpoint and account_id = app_private.actor_account_id();
  return true;
end;
$$;

-- Only events after a subscription exists are enqueued, so subscribing never replays history.
create or replace function app_private.enqueue_push_notifications(requested_at timestamptz)
returns integer
language plpgsql security definer set search_path = '' as $$
declare enqueued integer := 0; added integer;
begin
  with subscribed as (
    select ps.account_id, min(ps.created_at) as since
    from app_private.web_push_subscriptions ps
    join app_private.accounts a on a.account_id = ps.account_id and a.status = 'active'
    group by ps.account_id
  )
  insert into app_private.web_push_outbox (account_id, dedupe_key, title, body)
  select recipient.account_id,
    'workout:' || wc.workout_checkin_id || ':' || recipient.account_id,
    coalesce(author_account.display_name, 'A Group member') || ' logged a workout',
    (select count(*) from app_private.workout_checkins c where c.member_week_id = wc.member_week_id)
      || ' of ' || mw.target || ' this week. Your move.'
  from app_private.workout_checkins wc
  join app_private.member_weeks mw on mw.member_week_id = wc.member_week_id
  join app_private.memberships author on author.membership_id = wc.membership_id
  join app_private.accounts author_account on author_account.account_id = author.account_id
  join app_private.memberships peer on peer.group_id = author.group_id
    and peer.ended_at is null and peer.membership_id <> author.membership_id
    and peer.joined_at <= wc.submitted_at
  join subscribed recipient on recipient.account_id = peer.account_id
  where wc.submitted_at > requested_at - interval '1 day'
    and wc.submitted_at >= recipient.since
  on conflict (dedupe_key) do nothing;
  get diagnostics added = row_count;
  enqueued := enqueued + added;

  with subscribed as (
    select ps.account_id, min(ps.created_at) as since
    from app_private.web_push_subscriptions ps
    join app_private.accounts a on a.account_id = ps.account_id and a.status = 'active'
    group by ps.account_id
  )
  insert into app_private.web_push_outbox (account_id, dedupe_key, title, body)
  select m.account_id, 'reminder:' || mw.member_week_id, 'Less than 24 hours left',
    'You have ' || done.count || ' of ' || mw.target || ' workouts. No excuses.'
  from app_private.member_weeks mw
  join app_private.accountability_weeks aw on aw.accountability_week_id = mw.accountability_week_id
  join app_private.memberships m on m.membership_id = mw.membership_id and m.ended_at is null
  join subscribed s on s.account_id = m.account_id
  cross join lateral (
    select count(*)::integer as count from app_private.workout_checkins c
    where c.member_week_id = mw.member_week_id
  ) done
  where mw.status = 'active'
    and requested_at >= aw.ends_at - interval '24 hours' and requested_at < aw.ends_at
    and done.count < mw.target
  on conflict (dedupe_key) do nothing;
  get diagnostics added = row_count;
  enqueued := enqueued + added;

  with subscribed as (
    select ps.account_id, min(ps.created_at) as since
    from app_private.web_push_subscriptions ps
    join app_private.accounts a on a.account_id = ps.account_id and a.status = 'active'
    group by ps.account_id
  )
  insert into app_private.web_push_outbox (account_id, dedupe_key, title, body)
  select m.account_id, 'result:' || mw.member_week_id,
    case when mw.status = 'attained' then 'Week Met' else 'Week Missed' end,
    case when mw.status = 'attained' then 'Target hit. Keep it going.'
      else 'Target missed. Your Group can see it.' end
  from app_private.member_weeks mw
  join app_private.accountability_weeks aw on aw.accountability_week_id = mw.accountability_week_id
  join app_private.memberships m on m.membership_id = mw.membership_id and m.ended_at is null
  join subscribed s on s.account_id = m.account_id
  where mw.status in ('attained', 'missed')
    and aw.ends_at > requested_at - interval '2 days' and aw.ends_at >= s.since
  on conflict (dedupe_key) do nothing;
  get diagnostics added = row_count;
  return enqueued + added;
end;
$$;

revoke all on table app_private.web_push_subscriptions, app_private.web_push_outbox
  from public, anon, authenticated;
revoke all on function app_private.save_push_subscription(text, text, text),
  app_private.delete_push_subscription(text),
  app_private.enqueue_push_notifications(timestamptz)
  from public, anon, authenticated;
grant select, insert, update, delete on table app_private.web_push_subscriptions,
  app_private.web_push_outbox to service_role;
grant execute on function app_private.save_push_subscription(text, text, text),
  app_private.delete_push_subscription(text),
  app_private.enqueue_push_notifications(timestamptz) to service_role;

insert into app_private.schema_versions (version) values (18);
