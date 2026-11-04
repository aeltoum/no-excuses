-- Pushes skip what the member already saw, and every notification names the post it is
-- about so a tap (in the app or on the device) can open it.

-- The workout post a notification is about, when there is one.
create or replace function app_private.notification_post(requested_dedupe_key text)
returns uuid
language sql stable security definer set search_path = '' as $$
  -- A key that does not hold a well-formed id simply has no post.
  select case
    when split_part(requested_dedupe_key, ':', 1) in ('workout', 'questioned', 'proof-outcome')
      and split_part(requested_dedupe_key, ':', 2)
        ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      then split_part(requested_dedupe_key, ':', 2)::uuid
    when requested_dedupe_key like 'social:msg:%' then (
      select pm.workout_checkin_id from app_private.proof_messages pm
      where pm.proof_message_id::text = split_part(requested_dedupe_key, ':', 3))
  end;
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
        'kind', split_part(o.dedupe_key, ':', 1),
        'ref', split_part(o.dedupe_key, ':', 2),
        'post', app_private.notification_post(o.dedupe_key)
      ) order by o.created_at desc, o.outbox_id desc)
      from (
        select * from app_private.web_push_outbox
        where account_id = actor.account_id and created_at > requested_at - interval '30 days'
          and created_at > coalesce(actor.notifications_cleared_at, '-infinity'::timestamptz)
          and dismissed_at is null
        order by created_at desc, outbox_id desc limit 60
      ) o
    ), '[]'::jsonb),
    'prefs', jsonb_build_object(
      'socialPush', actor.social_push, 'digest', actor.daily_digest, 'digestHour', actor.digest_hour
    )
  );
end;
$$;

-- Unsent pushes to deliver now. A row is skipped (marked sent, no device alert) when the
-- member muted it, already dismissed it in the app, or already saw the post it announces.
drop function app_private.pending_push(integer);
create function app_private.pending_push(requested_limit integer)
returns table (outbox_id bigint, title text, body text, endpoint text, p256dh text, auth text,
  muted boolean, tag text, post uuid)
language sql stable security definer set search_path = '' as $$
  select o.outbox_id, o.title, o.body, s.endpoint, s.p256dh, s.auth,
    (not a.social_push and app_private.social_notification(o.dedupe_key))
      or o.dismissed_at is not null
      or (split_part(o.dedupe_key, ':', 1) = 'workout' and exists (
        select 1 from app_private.proof_seen_marks sm
        join app_private.memberships m on m.membership_id = sm.membership_id
        where m.account_id = o.account_id
          and sm.workout_checkin_id = app_private.notification_post(o.dedupe_key))),
    -- One alert per subject on the device: a newer one replaces the older.
    coalesce(app_private.notification_post(o.dedupe_key)::text, o.dedupe_key),
    app_private.notification_post(o.dedupe_key)
  from app_private.web_push_outbox o
  join app_private.web_push_subscriptions s on s.account_id = o.account_id
  join app_private.accounts a on a.account_id = o.account_id
  where o.sent_at is null
  order by o.outbox_id
  limit requested_limit;
$$;

revoke all on function app_private.notification_post(text),
  app_private.notification_center(timestamptz),
  app_private.pending_push(integer)
  from public, anon, authenticated;
grant execute on function app_private.notification_post(text),
  app_private.notification_center(timestamptz),
  app_private.pending_push(integer)
  to service_role;

insert into app_private.schema_versions (version) values (57);
