drop function app_private.current_week_progress(uuid, timestamptz);

create function app_private.current_week_progress(
  requested_group_id uuid,
  requested_at timestamptz
) returns table (
  membership_id uuid,
  display_name text,
  locked_target integer,
  completed_workout_count integer,
  activity_types text[]
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
    )
  from app_private.memberships m
  join app_private.accounts a on a.account_id = m.account_id
  join app_private.member_weeks mw on mw.membership_id = m.membership_id
  join app_private.accountability_weeks aw
    on aw.accountability_week_id = mw.accountability_week_id
  left join app_private.workout_checkins wc on wc.member_week_id = mw.member_week_id
  where m.group_id = requested_group_id
    and m.ended_at is null
    and requested_at >= aw.starts_at and requested_at < aw.ends_at
  group by m.membership_id, a.display_name, mw.target
  order by m.membership_id;
end;
$$;

revoke all on function app_private.current_week_progress(uuid, timestamptz)
  from public, anon;
grant execute on function app_private.current_week_progress(uuid, timestamptz)
  to authenticated, service_role;
