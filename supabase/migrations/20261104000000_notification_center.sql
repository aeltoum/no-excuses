-- Notification center, daily digest, and a separate social push switch (owner-approved
-- 2026-10-20). Every notification is now recorded for every active member, whether or not
-- they enabled push, so the app can list them; delivery still pushes only to subscribed
-- devices. Members may mute Immediate social pushes (reactions, nudges, missed-week
-- responses) without losing them in the app, and get an optional daily Social and
-- competition digest at an hour they choose in their Group's time zone.

alter table app_private.accounts
  add column notifications_since timestamptz not null default transaction_timestamp(),
  add column notifications_seen_at timestamptz,
  add column social_push boolean not null default true,
  add column daily_digest boolean not null default true,
  add column digest_hour smallint not null default 19,
  add constraint accounts_digest_hour check (digest_hour between 0 and 23);

-- Members without a device still collect notifications from when this shipped.
create or replace function app_private.push_recipients()
returns table (account_id uuid, since timestamptz)
language sql stable security definer set search_path = '' as $$
  select a.account_id,
    least(coalesce(min(ps.created_at), 'infinity'::timestamptz), a.notifications_since)
  from app_private.accounts a
  left join app_private.web_push_subscriptions ps on ps.account_id = a.account_id
  where a.status = 'active'
  group by a.account_id;
$$;

create or replace function app_private.social_notification(requested_dedupe_key text)
returns boolean
language sql immutable set search_path = '' as $$
  select requested_dedupe_key like 'social:%' or requested_dedupe_key like 'missed-response:%';
$$;

create or replace function app_private.notification_center(requested_at timestamptz)
returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare actor app_private.accounts%rowtype;
begin
  select * into actor from app_private.accounts where account_id = app_private.actor_account_id();
  if actor.account_id is null then
    raise exception 'active account required' using errcode = '42501';
  end if;
  return jsonb_build_object(
    'items', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', o.outbox_id, 'title', o.title, 'body', o.body, 'at', o.created_at,
        'unread', o.created_at > coalesce(actor.notifications_seen_at, '-infinity'::timestamptz),
        'kind', split_part(o.dedupe_key, ':', 1)
      ) order by o.created_at desc, o.outbox_id desc)
      from (
        select * from app_private.web_push_outbox
        where account_id = actor.account_id and created_at > requested_at - interval '30 days'
        order by created_at desc, outbox_id desc limit 60
      ) o
    ), '[]'::jsonb),
    'prefs', jsonb_build_object(
      'socialPush', actor.social_push, 'digest', actor.daily_digest, 'digestHour', actor.digest_hour
    )
  );
end;
$$;

create or replace function app_private.notification_unread(requested_at timestamptz)
returns integer
language sql stable security definer set search_path = '' as $$
  select count(*)::integer from app_private.web_push_outbox o
  join app_private.accounts a on a.account_id = o.account_id
  where a.account_id = app_private.actor_account_id()
    and o.created_at > coalesce(a.notifications_seen_at, '-infinity'::timestamptz)
    and o.created_at > requested_at - interval '30 days';
$$;

create or replace function app_private.mark_notifications_seen(requested_at timestamptz)
returns boolean
language plpgsql security definer set search_path = '' as $$
begin
  update app_private.accounts
  set notifications_seen_at = greatest(coalesce(notifications_seen_at, requested_at), requested_at)
  where account_id = app_private.actor_account_id();
  return found;
end;
$$;

create or replace function app_private.set_notification_prefs(
  requested_social boolean, requested_digest boolean, requested_hour smallint
) returns jsonb
language plpgsql security definer set search_path = '' as $$
begin
  update app_private.accounts
  set social_push = coalesce(requested_social, social_push),
    daily_digest = coalesce(requested_digest, daily_digest),
    digest_hour = coalesce(requested_hour, digest_hour)
  where account_id = app_private.actor_account_id();
  if not found then
    raise exception 'active account required' using errcode = '42501';
  end if;
  return (select jsonb_build_object('socialPush', social_push, 'digest', daily_digest,
      'digestHour', digest_hour)
    from app_private.accounts where account_id = app_private.actor_account_id());
end;
$$;

-- One digest per member per local day, at their hour, and only when something happened.
create or replace function app_private.enqueue_digest(requested_at timestamptz)
returns integer
language plpgsql security definer set search_path = '' as $$
declare added integer;
begin
  insert into app_private.web_push_outbox (account_id, dedupe_key, title, body, created_at)
  select d.account_id,
    'digest:' || d.account_id || ':' || d.local_day,
    'Today in ' || d.group_name,
    concat_ws(' · ',
      case when d.posts > 0 then d.posts || case when d.posts = 1 then ' workout' else ' workouts' end
        || ' from your crew' end,
      case when d.reactions > 0 then d.reactions || case when d.reactions = 1 then ' reaction' else ' reactions' end
        || ' on your proof' end,
      case when d.crowns > 0 then d.crowns || case when d.crowns = 1 then ' Crown' else ' Crowns' end
        || ' this Season' end),
    requested_at
  from (
    select a.account_id, g.name as group_name,
      (requested_at at time zone g.time_zone)::date as local_day,
      (select count(*)::integer from app_private.workout_checkins c
        join app_private.memberships pm on pm.membership_id = c.membership_id
        where pm.group_id = m.group_id and pm.membership_id <> m.membership_id
          and c.submitted_at > requested_at - interval '24 hours'
          and c.review_status not in ('unsupported', 'rejected')) as posts,
      (select count(*)::integer from app_private.proof_reactions pr
        join app_private.workout_checkins c on c.workout_checkin_id = pr.workout_checkin_id
        where c.membership_id = m.membership_id
          and pr.created_at > requested_at - interval '24 hours') as reactions,
      (select count(*)::integer from app_private.pwa_crown_results r
        join app_private.pwa_crown_weeks cw on cw.accountability_week_id = r.accountability_week_id
        where r.membership_id = m.membership_id and r.winner
          and cw.season_number = (
            select max(season_number) from app_private.pwa_crown_weeks
            where group_id = m.group_id)) as crowns
    from app_private.accounts a
    join app_private.memberships m on m.account_id = a.account_id and m.ended_at is null
    join app_private.groups g on g.group_id = m.group_id
    where a.status = 'active' and a.daily_digest
      and extract(hour from requested_at at time zone g.time_zone) = a.digest_hour
  ) d
  where d.posts > 0 or d.reactions > 0
  on conflict (dedupe_key) do nothing;
  get diagnostics added = row_count;
  return added;
end;
$$;

-- Unsent pushes to deliver now; muted social items are returned as muted so they are marked
-- sent without reaching a device.
create or replace function app_private.pending_push(requested_limit integer)
returns table (outbox_id bigint, title text, body text, endpoint text, p256dh text, auth text,
  muted boolean)
language sql stable security definer set search_path = '' as $$
  select o.outbox_id, o.title, o.body, s.endpoint, s.p256dh, s.auth,
    not a.social_push and app_private.social_notification(o.dedupe_key)
  from app_private.web_push_outbox o
  join app_private.web_push_subscriptions s on s.account_id = o.account_id
  join app_private.accounts a on a.account_id = o.account_id
  where o.sent_at is null
  order by o.outbox_id
  limit requested_limit;
$$;

create or replace function app_private.home_extras(requested_at timestamptz)
returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  return app_private.home_extras_exceptions(requested_at)
    || jsonb_build_object(
      'missed', app_private.home_missed(requested_at),
      'season', app_private.season_home(requested_at),
      'unlocks', app_private.home_unlocks(requested_at),
      'unreadNotifications', app_private.notification_unread(requested_at)
    );
end;
$$;

revoke all on function app_private.push_recipients(),
  app_private.social_notification(text),
  app_private.notification_center(timestamptz),
  app_private.notification_unread(timestamptz),
  app_private.mark_notifications_seen(timestamptz),
  app_private.set_notification_prefs(boolean, boolean, smallint),
  app_private.enqueue_digest(timestamptz),
  app_private.pending_push(integer),
  app_private.home_extras(timestamptz)
  from public, anon, authenticated;
grant execute on function app_private.push_recipients(),
  app_private.social_notification(text),
  app_private.notification_center(timestamptz),
  app_private.notification_unread(timestamptz),
  app_private.mark_notifications_seen(timestamptz),
  app_private.set_notification_prefs(boolean, boolean, smallint),
  app_private.enqueue_digest(timestamptz),
  app_private.pending_push(integer),
  app_private.home_extras(timestamptz)
  to service_role;

insert into app_private.schema_versions (version) values (38);
