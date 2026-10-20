-- Remove own photos (owner-asked 2026-10-20): a member may take down the photos of their own
-- verified workout at any time, including after its week ends. The workout stays verified, so
-- the week's count and outcome do not change; the media sweep deletes the files.

create or replace function app_private.remove_own_photos(
  requested_checkin_id uuid, requested_at timestamptz
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare viewer app_private.memberships := app_private.actor_current_membership();
begin
  if viewer.membership_id is null then
    raise exception 'current Group membership required' using errcode = '42501';
  end if;
  update app_private.workout_checkins set removed_at = coalesce(removed_at, requested_at)
  where workout_checkin_id = requested_checkin_id and membership_id = viewer.membership_id
    and review_status = 'verified' and activity_photo_path is not null
    and media_deleted_at is null;
  if not found then
    raise exception 'remove unavailable' using errcode = '42501';
  end if;
  return requested_checkin_id;
end;
$$;

revoke all on function app_private.remove_own_photos(uuid, timestamptz)
  from public, anon, authenticated;
grant execute on function app_private.remove_own_photos(uuid, timestamptz) to service_role;

insert into app_private.schema_versions (version) values (44);
