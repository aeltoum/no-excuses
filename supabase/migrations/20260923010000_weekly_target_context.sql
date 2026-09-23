create function app_private.weekly_target_context(requested_at timestamptz)
returns table (
  membership_id uuid,
  recurring_target integer,
  locked_target integer,
  next_week_starts_at timestamptz,
  member_count integer,
  time_zone text
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  actor_id uuid := app_private.actor_account_id();
begin
  return query
  select own.membership_id,
    own.recurring_target,
    mw.target,
    case when members.member_count >= 2 then bounds.ends_at end,
    members.member_count,
    g.time_zone
  from app_private.memberships own
  join app_private.groups g on g.group_id = own.group_id
  cross join lateral app_private.accountability_week_bounds(
    requested_at, g.time_zone, g.week_starts
  ) bounds
  cross join lateral (
    select count(*)::integer as member_count
    from app_private.memberships member
    where member.group_id = own.group_id and member.ended_at is null
  ) members
  left join app_private.accountability_weeks aw
    on aw.group_id = own.group_id
    and aw.starts_at = bounds.starts_at and aw.ends_at = bounds.ends_at
  left join app_private.member_weeks mw
    on mw.membership_id = own.membership_id
    and mw.accountability_week_id = aw.accountability_week_id
  where own.account_id = actor_id
    and own.ended_at is null;
end;
$$;

revoke all on function app_private.weekly_target_context(timestamptz)
  from public, anon;
grant execute on function app_private.weekly_target_context(timestamptz)
  to authenticated, service_role;
