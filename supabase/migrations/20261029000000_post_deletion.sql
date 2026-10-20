-- Post deletion (owner-approved 2026-10-20): a member deletes their own workout post while its
-- week is still running. The workout stops counting at once, so a corrected post can replace it
-- and the member stays on track. Rejected reports keep their record and cannot be deleted.
-- A member may also remove every Proof photo they have shared; structured outcomes remain.

create or replace function app_private.delete_own_checkin(
  requested_checkin_id uuid, requested_at timestamptz
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  viewer app_private.memberships := app_private.actor_current_membership();
  item app_private.workout_checkins%rowtype;
  remaining integer;
begin
  select c.* into item
  from app_private.workout_checkins c
  join app_private.member_weeks mw on mw.member_week_id = c.member_week_id
  join app_private.accountability_weeks aw on aw.accountability_week_id = mw.accountability_week_id
  where c.workout_checkin_id = requested_checkin_id
    and c.membership_id = viewer.membership_id
    and c.review_status in ('pending', 'verified', 'questioned')
    and mw.status = 'active'
    and requested_at < aw.ends_at
  for update of c;
  if viewer.membership_id is null or item.workout_checkin_id is null then
    raise exception 'delete unavailable' using errcode = '42501';
  end if;
  -- Reactions, votes, and reports go with the post; its photos are swept as unused uploads.
  delete from app_private.workout_checkins where workout_checkin_id = item.workout_checkin_id;
  update app_private.proof_uploads set used_at = null
  where path in (item.activity_photo_path, item.presence_photo_path);
  select count(*)::integer into remaining from app_private.workout_checkins
  where member_week_id = item.member_week_id
    and review_status not in ('unsupported', 'rejected');
  return jsonb_build_object(
    'workoutCheckinId', item.workout_checkin_id,
    'currentWeekCount', remaining,
    'paths', to_jsonb(array_remove(array[item.activity_photo_path, item.presence_photo_path], null))
  );
end;
$$;

-- Marks deleted-post photos gone once the API has deleted the objects.
create or replace function app_private.mark_proof_uploads_deleted(
  requested_paths text[], requested_at timestamptz
) returns void
language sql security definer set search_path = '' as $$
  update app_private.proof_uploads set deleted_at = requested_at
  where path = any(requested_paths) and used_at is null and deleted_at is null;
$$;

create or replace function app_private.remove_all_my_proof(requested_at timestamptz)
returns integer
language plpgsql security definer set search_path = '' as $$
declare actor uuid := app_private.actor_account_id(); changed integer;
begin
  if actor is null then
    raise exception 'active account required' using errcode = '42501';
  end if;
  update app_private.workout_checkins c set removed_at = requested_at
  from app_private.memberships m
  where m.membership_id = c.membership_id and m.account_id = actor
    and c.activity_photo_path is not null and c.removed_at is null
    and c.media_deleted_at is null;
  get diagnostics changed = row_count;
  return changed;
end;
$$;

-- The feed now says which of the viewer's own posts can still be deleted.
drop function app_private.proof_feed(timestamptz);
create function app_private.proof_feed(requested_at timestamptz)
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
    c.completed_at, c.submitted_at, c.review_status::text,
    case when c.review_status = 'pending' then c.submitted_at + interval '24 hours' end,
    case when c.review_status = 'questioned' then c.questioned_at + interval '48 hours' end,
    c.hidden_at is not null,
    v.vote::text,
    (select count(*)::integer from app_private.proof_votes pv
     where pv.workout_checkin_id = c.workout_checkin_id and pv.vote = 'accept'),
    (select count(*)::integer from app_private.proof_votes pv
     where pv.workout_checkin_id = c.workout_checkin_id and pv.vote = 'reject'),
    (select count(*)::integer from app_private.proof_decision_audience pa
     join app_private.memberships am on am.membership_id = pa.membership_id and am.ended_at is null
     where pa.workout_checkin_id = c.workout_checkin_id),
    c.review_status = 'pending' and m.membership_id <> viewer.membership_id
      and c.hidden_at is null and viewer.joined_at <= c.submitted_at
      and requested_at < c.submitted_at + interval '24 hours',
    c.review_status = 'questioned' and c.hidden_at is null
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
    and (
      (c.review_status in ('pending', 'questioned')
        and (viewer.joined_at <= c.submitted_at or m.membership_id = viewer.membership_id))
      or (c.review_status = 'verified' and requested_at < c.verified_at + interval '90 days')
    )
  order by c.submitted_at desc
  limit 100;
end;
$$;

revoke all on function app_private.proof_feed(timestamptz) from public, anon, authenticated;
grant execute on function app_private.proof_feed(timestamptz) to service_role;

revoke all on function app_private.delete_own_checkin(uuid, timestamptz),
  app_private.mark_proof_uploads_deleted(text[], timestamptz),
  app_private.remove_all_my_proof(timestamptz)
  from public, anon, authenticated;
grant execute on function app_private.delete_own_checkin(uuid, timestamptz),
  app_private.mark_proof_uploads_deleted(text[], timestamptz),
  app_private.remove_all_my_proof(timestamptz)
  to service_role;
grant delete on table app_private.workout_checkins to service_role;

insert into app_private.schema_versions (version) values (32);
