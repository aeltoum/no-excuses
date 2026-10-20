-- Keep Proof history (owner-approved 2026-10-19).
-- Verified Proof photos no longer expire 90 days after verification; they stay on the Wall.
-- Early deletion triggers and abandoned-upload cleanup are unchanged.

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
  limit 200;
$$;
