-- A member joining an already-active Group gets a current-week row immediately
-- with their reduced current-week target, so Home shows their progress.
create or replace function app_private.accept_group_invitation(
  requested_token_digest text,
  requested_membership_id uuid,
  requested_recurring_target integer,
  requested_current_target integer,
  requested_at timestamptz
) returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  found_invitation app_private.group_invitations%rowtype;
  found_account app_private.accounts%rowtype;
  found_group app_private.groups%rowtype;
  found_week_id uuid;
  week_start timestamptz;
  week_end timestamptz;
  current_count integer;
  member_item record;
begin
  if requested_recurring_target < 1
     or requested_current_target < 1
     or requested_current_target > requested_recurring_target then
    raise exception 'invalid weekly target' using errcode = '22023';
  end if;

  select * into found_invitation
  from app_private.group_invitations
  where token_digest = requested_token_digest
  for update;
  if not found or found_invitation.status <> 'issued' or found_invitation.expires_at <= requested_at then
    raise exception 'invitation unavailable' using errcode = '42501';
  end if;

  select * into found_account
  from app_private.accounts
  where account_id = app_private.actor_account_id()
  for update;
  if not found or found_account.email <> found_invitation.email
     or found_account.adult_attested_at is null then
    raise exception 'invitation unavailable' using errcode = '42501';
  end if;
  if not exists (
    select 1 from app_private.consents
    where account_id = found_account.account_id
      and purpose in ('pilot', 'product')
      and withdrawn_at is null
    group by account_id having count(distinct purpose) = 2
  ) then
    raise exception 'required consent missing' using errcode = '42501';
  end if;

  select * into found_group
  from app_private.groups
  where group_id = found_invitation.group_id
  for update;
  if found_group.status = 'closed' then
    raise exception 'invitation unavailable' using errcode = '42501';
  end if;
  if exists (select 1 from app_private.memberships where account_id = found_account.account_id and ended_at is null) then
    raise exception 'account already belongs to a Group' using errcode = '23505';
  end if;
  select count(*) into current_count from app_private.memberships
    where group_id = found_group.group_id and ended_at is null;
  if current_count >= 10 then
    raise exception 'Group is at capacity' using errcode = '23514';
  end if;

  insert into app_private.memberships (
    membership_id, account_id, group_id, joined_at, recurring_target
  ) values (
    requested_membership_id, found_account.account_id, found_group.group_id,
    requested_at, requested_recurring_target
  );
  update app_private.group_invitations
    set status = 'accepted', accepted_at = requested_at,
        accepted_by_membership_id = requested_membership_id
    where invitation_id = found_invitation.invitation_id;

  if current_count = 1 and found_group.activation_at is null then
    select starts_at, ends_at into week_start, week_end
      from app_private.accountability_week_bounds(
        requested_at, found_group.time_zone, found_group.week_starts
      );
    found_week_id := gen_random_uuid();
    insert into app_private.accountability_weeks (
      accountability_week_id, group_id, starts_at, ends_at, time_zone, activation_at
    ) values (
      found_week_id, found_group.group_id, week_start, week_end, found_group.time_zone, requested_at
    ) on conflict (group_id, starts_at) do update set activation_at = requested_at
      returning accountability_week_id into found_week_id;
    update app_private.groups set status = 'active', activation_at = requested_at
      where group_id = found_group.group_id;
    insert into app_private.seasons (
      season_id, group_id, season_number, starts_at, ends_at, time_zone
    ) values (
      gen_random_uuid(), found_group.group_id, 1, requested_at,
      ((week_end at time zone found_group.time_zone) + interval '21 days')
        at time zone found_group.time_zone,
      found_group.time_zone
    );
    update app_private.pause_intervals set ends_at = requested_at
      where group_id = found_group.group_id and ends_at is null and kind = 'below_capacity';

    for member_item in
      select membership_id, recurring_target
      from app_private.memberships
      where group_id = found_group.group_id and ended_at is null
    loop
      insert into app_private.member_weeks (
        member_week_id, membership_id, accountability_week_id, target,
        target_locked_at, target_pending_until
      ) values (
        gen_random_uuid(), member_item.membership_id, found_week_id,
        case when member_item.membership_id = requested_membership_id
          then requested_current_target else member_item.recurring_target end,
        requested_at,
        case when member_item.membership_id = requested_membership_id then null
          else least(requested_at + interval '24 hours', week_end) end
      );
    end loop;
  elsif found_group.status = 'accountability_paused' and current_count + 1 >= 2 then
    select starts_at, ends_at into week_start, week_end
      from app_private.accountability_week_bounds(
        requested_at, found_group.time_zone, found_group.week_starts
      );
    found_week_id := gen_random_uuid();
    insert into app_private.accountability_weeks (
      accountability_week_id, group_id, starts_at, ends_at, time_zone, activation_at
    ) values (
      found_week_id, found_group.group_id, week_start, week_end, found_group.time_zone, requested_at
    ) on conflict (group_id, starts_at) do update set activation_at = requested_at
      returning accountability_week_id into found_week_id;
    update app_private.groups
      set status = 'active', activation_at = requested_at
      where group_id = found_group.group_id;
    update app_private.pause_intervals set ends_at = requested_at
      where group_id = found_group.group_id and ends_at is null and kind = 'below_capacity';
    for member_item in
      select membership_id, recurring_target
      from app_private.memberships
      where group_id = found_group.group_id and ended_at is null
    loop
      insert into app_private.member_weeks (
        member_week_id, membership_id, accountability_week_id, target,
        target_locked_at, target_pending_until
      ) values (
        gen_random_uuid(), member_item.membership_id, found_week_id,
        case when member_item.membership_id = requested_membership_id
          then requested_current_target else member_item.recurring_target end,
        requested_at,
        case when member_item.membership_id = requested_membership_id then null
          else least(requested_at + interval '24 hours', week_end) end
      ) on conflict (membership_id, accountability_week_id) do update
        set target = excluded.target,
            target_locked_at = excluded.target_locked_at,
            target_pending_until = excluded.target_pending_until,
            status = 'active';
    end loop;
  elsif found_group.status = 'active' then
    select accountability_week_id, ends_at into found_week_id, week_end
      from app_private.accountability_weeks
      where group_id = found_group.group_id
        and requested_at >= starts_at and requested_at < ends_at;
    if found_week_id is not null then
      insert into app_private.member_weeks (
        member_week_id, membership_id, accountability_week_id, target, target_locked_at
      ) values (
        gen_random_uuid(), requested_membership_id, found_week_id,
        requested_current_target, requested_at
      ) on conflict (membership_id, accountability_week_id) do nothing;
    end if;
  end if;
  return requested_membership_id;
end;
$$;

-- Repair members who already joined an active Group mid-week.
insert into app_private.member_weeks
  (member_week_id, membership_id, accountability_week_id, target, target_locked_at)
select gen_random_uuid(), m.membership_id, aw.accountability_week_id,
  m.recurring_target, m.joined_at
from app_private.memberships m
join app_private.groups g on g.group_id = m.group_id and g.status = 'active'
join app_private.accountability_weeks aw on aw.group_id = m.group_id
  and m.joined_at >= aw.starts_at and now() < aw.ends_at
where m.ended_at is null
on conflict (membership_id, accountability_week_id) do nothing;

insert into app_private.schema_versions (version) values (22);
