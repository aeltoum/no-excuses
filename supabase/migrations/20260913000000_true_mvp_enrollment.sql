-- First organizer is explicitly seeded by private operator workflow.
alter table app_private.accounts
  add column organizer_seeded boolean not null default false,
  add column auth_deleted_at timestamptz;

create unique index accounts_one_organizer_seed
  on app_private.accounts (organizer_seeded) where organizer_seeded;

create or replace function app_private.record_true_mvp_consent(
  requested_adult boolean,
  requested_pilot boolean,
  requested_product boolean,
  requested_at timestamptz
) returns void
language plpgsql security definer set search_path = '' as $$
declare actor_id uuid;
begin
  actor_id := app_private.actor_account_id();
  if actor_id is null or requested_adult is not true
     or requested_pilot is not true or requested_product is not true then
    raise exception 'required consent missing' using errcode = '42501';
  end if;
  update app_private.accounts set adult_attested_at = coalesce(adult_attested_at, requested_at)
    where account_id = actor_id;
  insert into app_private.consents(account_id, purpose, version, granted_at)
    values (actor_id, 'pilot', 'true-mvp-1', requested_at),
           (actor_id, 'product', 'true-mvp-1', requested_at)
    on conflict (account_id, purpose, version) do update
      set granted_at = requested_at, withdrawn_at = null;
end;
$$;

revoke all on function app_private.record_true_mvp_consent(boolean, boolean, boolean, timestamptz)
  from public, anon, authenticated;
grant execute on function app_private.record_true_mvp_consent(boolean, boolean, boolean, timestamptz)
  to service_role;

create or replace function app_private.create_group(
  requested_group_id uuid,
  requested_membership_id uuid,
  requested_admin_account_id uuid,
  requested_name text,
  requested_time_zone text,
  requested_target integer,
  requested_at timestamptz
) returns uuid
language plpgsql
security definer
set search_path = ''
as $$
begin
  if requested_target < 1 then
    raise exception 'weekly target must be positive' using errcode = '22023';
  end if;
  if not exists (
    select 1 from app_private.accounts
    where account_id = requested_admin_account_id and status = 'active'
      and adult_attested_at is not null
  ) then
    raise exception 'active account required' using errcode = '42501';
  end if;
  if not exists (
    select 1 from app_private.consents
    where account_id = requested_admin_account_id
      and purpose in ('pilot', 'product')
      and withdrawn_at is null
    group by account_id having count(distinct purpose) = 2
  ) then
    raise exception 'required consent missing' using errcode = '42501';
  end if;
  perform * from app_private.accountability_week_bounds(requested_at, requested_time_zone);
  insert into app_private.groups (group_id, name, time_zone)
    values (requested_group_id, requested_name, requested_time_zone);
  insert into app_private.memberships (
    membership_id, account_id, group_id, joined_at, recurring_target
  ) values (
    requested_membership_id, requested_admin_account_id, requested_group_id, requested_at, requested_target
  );
  insert into app_private.group_admins (membership_id) values (requested_membership_id);
  return requested_membership_id;
end;
$$;

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
  end if;
  return requested_membership_id;
end;
$$;

create or replace function app_private.advance_true_mvp_weeks(requested_at timestamptz)
returns integer language plpgsql security definer set search_path = '' as $$
declare
  item record;
  week_start timestamptz;
  week_end timestamptz;
  week_id uuid;
  step_count integer := 0;
begin
  for item in
    select g.group_id, g.time_zone, g.week_starts, max(aw.ends_at) as last_end
    from app_private.groups g
    join app_private.accountability_weeks aw on aw.group_id = g.group_id
    where g.status = 'active'
    group by g.group_id, g.time_zone, g.week_starts
  loop
    week_end := item.last_end;
    while week_end <= requested_at loop
      if step_count >= 520 then
        raise exception 'weekly backlog exceeds maintenance limit' using errcode = '22023';
      end if;
      select bounds.starts_at, bounds.ends_at into week_start, week_end
      from app_private.accountability_week_bounds(week_end + interval '1 second', item.time_zone, item.week_starts) bounds;
      week_id := gen_random_uuid();
      insert into app_private.accountability_weeks
        (accountability_week_id, group_id, starts_at, ends_at, time_zone, activation_at)
      values (week_id, item.group_id, week_start, week_end, item.time_zone, week_start)
      on conflict (group_id, starts_at) do nothing;
      select accountability_week_id into week_id
      from app_private.accountability_weeks
      where group_id = item.group_id and starts_at = week_start;
      insert into app_private.member_weeks
        (member_week_id, membership_id, accountability_week_id, target, target_locked_at)
      select gen_random_uuid(), m.membership_id, week_id, m.recurring_target, week_start
      from app_private.memberships m
      where m.group_id = item.group_id and m.ended_at is null
      on conflict (membership_id, accountability_week_id) do nothing;
      step_count := step_count + 1;
    end loop;
  end loop;
  perform app_private.finalize_ended_member_weeks(requested_at);
  return step_count;
end;
$$;

revoke all on function app_private.advance_true_mvp_weeks(timestamptz)
  from public, anon, authenticated;
grant execute on function app_private.advance_true_mvp_weeks(timestamptz)
  to service_role;

insert into app_private.schema_versions (version) values (15);
