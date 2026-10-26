-- Profile photos and clearing notifications (owner-asked 2026-10-26).
-- Profile photos: each member may set one photo shown beside their
-- name to their Group. Photos reuse the private proof-photos bucket and upload ledger with kind
-- 'avatar'. A replaced or cleared photo, or the photo of an account no longer active, goes to
-- the existing media sweep.

alter table app_private.proof_uploads drop constraint proof_uploads_kind_check;
alter table app_private.proof_uploads add constraint proof_uploads_kind_check
  check (kind in ('activity', 'presence', 'avatar'));

alter table app_private.accounts add column avatar_path text;

-- Sets (or, with null, clears) the caller's photo from an unused avatar upload they own.
create or replace function app_private.set_avatar(
  requested_path text, requested_at timestamptz
) returns text
language plpgsql security definer set search_path = '' as $$
declare
  actor uuid := app_private.actor_account_id();
  previous text;
begin
  if actor is null or (app_private.actor_current_membership()).membership_id is null then
    raise exception 'current membership required' using errcode = '42501';
  end if;
  if requested_path is not null then
    update app_private.proof_uploads set used_at = requested_at
    where path = requested_path and account_id = actor and kind = 'avatar'
      and used_at is null and deleted_at is null;
    if not found then
      raise exception 'avatar upload unavailable' using errcode = '42501';
    end if;
  end if;
  select avatar_path into previous from app_private.accounts where account_id = actor;
  update app_private.accounts set avatar_path = requested_path where account_id = actor;
  -- The old photo counts as an abandoned upload, so the sweep deletes it.
  if previous is not null then
    update app_private.proof_uploads set used_at = null where path = previous;
  end if;
  return requested_path;
end;
$$;

-- Photo paths of the caller's current Group members, including the caller.
create or replace function app_private.group_avatars(requested_at timestamptz)
returns table (membership_id uuid, avatar_path text)
language sql stable security definer set search_path = '' as $$
  select m.membership_id, a.avatar_path from app_private.memberships m
  join app_private.accounts a on a.account_id = m.account_id
  where m.group_id = (app_private.actor_current_membership()).group_id
    and m.ended_at is null and a.status = 'active' and a.avatar_path is not null;
$$;

create or replace function app_private.proof_media_due(requested_at timestamptz)
returns table (path text)
language sql stable security definer set search_path = '' as $$
  select p.path from app_private.workout_checkins c
  join app_private.memberships m on m.membership_id = c.membership_id
  join app_private.accounts a on a.account_id = m.account_id
  cross join lateral (values (c.activity_photo_path), (c.presence_photo_path)) p(path)
  where c.activity_photo_path is not null and c.media_deleted_at is null
    and (c.review_status in ('unsupported', 'rejected') or c.removed_at is not null
      or m.ended_at is not null or a.status <> 'active')
  union
  select u.path from app_private.proof_uploads u
  where u.deleted_at is null and u.used_at is null
    and requested_at >= u.created_at + interval '1 day'
  union
  select u.path from app_private.proof_uploads u
  join app_private.accounts a on a.account_id = u.account_id
  where u.kind = 'avatar' and u.deleted_at is null and a.status <> 'active'
  limit 200;
$$;

-- Clear notifications: the list hides everything recorded up to the tap. Delivery is unchanged.
alter table app_private.accounts add column notifications_cleared_at timestamptz;

create or replace function app_private.clear_notifications(requested_at timestamptz)
returns boolean
language plpgsql security definer set search_path = '' as $$
begin
  update app_private.accounts
  set notifications_cleared_at = requested_at,
    notifications_seen_at = greatest(coalesce(notifications_seen_at, requested_at), requested_at)
  where account_id = app_private.actor_account_id();
  return found;
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
        'kind', split_part(o.dedupe_key, ':', 1)
      ) order by o.created_at desc, o.outbox_id desc)
      from (
        select * from app_private.web_push_outbox
        where account_id = actor.account_id and created_at > requested_at - interval '30 days'
          and created_at > coalesce(actor.notifications_cleared_at, '-infinity'::timestamptz)
        order by created_at desc, outbox_id desc limit 60
      ) o
    ), '[]'::jsonb),
    'prefs', jsonb_build_object(
      'socialPush', actor.social_push, 'digest', actor.daily_digest, 'digestHour', actor.digest_hour
    )
  );
end;
$$;

revoke all on function app_private.clear_notifications(timestamptz)
  from public, anon, authenticated;
grant execute on function app_private.clear_notifications(timestamptz) to service_role;

revoke all on function app_private.set_avatar(text, timestamptz),
  app_private.group_avatars(timestamptz)
  from public, anon, authenticated;
grant execute on function app_private.set_avatar(text, timestamptz),
  app_private.group_avatars(timestamptz) to service_role;

insert into app_private.schema_versions (version) values (45);
