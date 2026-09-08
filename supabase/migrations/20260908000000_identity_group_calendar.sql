create type app_private.account_status as enum ('active', 'suspended', 'deleted');
create type app_private.group_status as enum ('setup', 'active', 'accountability_paused', 'closed');
create type app_private.membership_end_reason as enum ('left', 'removed', 'account_deleted', 'service_terminated');
create type app_private.invitation_status as enum ('issued', 'revoked', 'accepted');
create type app_private.member_week_status as enum ('active', 'provisional', 'attained', 'missed', 'excepted', 'ended_without_result');

create table app_private.accounts (
  account_id uuid primary key,
  auth_user_id uuid not null unique,
  email text not null,
  status app_private.account_status not null default 'active',
  adult_attested_at timestamptz,
  access_cutoff timestamptz,
  created_at timestamptz not null default transaction_timestamp(),
  constraint accounts_normalized_email check (email = lower(btrim(email)))
);

create unique index accounts_normalized_email_unique
  on app_private.accounts (lower(email));

create table app_private.consents (
  account_id uuid not null references app_private.accounts(account_id) on delete restrict,
  purpose text not null,
  version text not null,
  granted_at timestamptz not null,
  withdrawn_at timestamptz,
  primary key (account_id, purpose, version),
  constraint consents_purpose check (purpose in ('pilot', 'product', 'media', 'research')),
  constraint consents_order check (withdrawn_at is null or withdrawn_at >= granted_at)
);

create table app_private.groups (
  group_id uuid primary key,
  name text not null,
  time_zone text not null,
  week_starts smallint not null default 1,
  status app_private.group_status not null default 'setup',
  activation_at timestamptz,
  created_at timestamptz not null default transaction_timestamp(),
  closed_at timestamptz,
  constraint groups_name check (length(btrim(name)) between 1 and 80),
  constraint groups_week_starts check (week_starts between 1 and 7),
  constraint groups_status_times check (
    (status = 'setup' and activation_at is null and closed_at is null)
    or (status in ('active', 'accountability_paused') and activation_at is not null and closed_at is null)
    or (status = 'closed' and closed_at is not null)
  )
);

create table app_private.memberships (
  membership_id uuid primary key,
  account_id uuid not null references app_private.accounts(account_id) on delete restrict,
  group_id uuid not null references app_private.groups(group_id) on delete restrict,
  joined_at timestamptz not null,
  ended_at timestamptz,
  end_reason app_private.membership_end_reason,
  recurring_target integer not null,
  constraint memberships_target check (recurring_target >= 1),
  constraint memberships_end check (
    (ended_at is null and end_reason is null)
    or (ended_at is not null and end_reason is not null and ended_at >= joined_at)
  )
);

create unique index memberships_one_current_group_per_account
  on app_private.memberships (account_id) where ended_at is null;

create table app_private.group_admins (
  membership_id uuid primary key references app_private.memberships(membership_id) on delete restrict,
  granted_at timestamptz not null default transaction_timestamp()
);

create table app_private.staff_assignments (
  assignment_id uuid primary key,
  account_id uuid not null references app_private.accounts(account_id) on delete restrict,
  role text not null,
  starts_at timestamptz not null,
  ends_at timestamptz,
  constraint staff_role check (role in ('operator', 'developer')),
  constraint staff_assignment_order check (ends_at is null or ends_at > starts_at)
);

create table app_private.group_invitations (
  invitation_id uuid primary key,
  group_id uuid not null references app_private.groups(group_id) on delete restrict,
  email text not null,
  token_digest text not null unique,
  status app_private.invitation_status not null default 'issued',
  issued_by_membership_id uuid not null references app_private.memberships(membership_id) on delete restrict,
  issued_at timestamptz not null,
  expires_at timestamptz not null,
  accepted_at timestamptz,
  accepted_by_membership_id uuid references app_private.memberships(membership_id) on delete restrict,
  constraint invitations_normalized_email check (email = lower(btrim(email))),
  constraint invitations_digest check (token_digest ~ '^[0-9a-f]{64}$'),
  constraint invitations_expiry check (expires_at = issued_at + interval '168 hours'),
  constraint invitations_acceptance check (
    (status = 'accepted' and accepted_at is not null and accepted_by_membership_id is not null)
    or (status <> 'accepted' and accepted_at is null and accepted_by_membership_id is null)
  )
);

create table app_private.accountability_weeks (
  accountability_week_id uuid primary key,
  group_id uuid not null references app_private.groups(group_id) on delete restrict,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  time_zone text not null,
  activation_at timestamptz,
  unique (group_id, starts_at),
  constraint accountability_week_order check (starts_at < ends_at),
  constraint accountability_activation_range check (
    activation_at is null or (activation_at >= starts_at and activation_at < ends_at)
  )
);

create table app_private.seasons (
  season_id uuid primary key,
  group_id uuid not null references app_private.groups(group_id) on delete restrict,
  season_number integer not null,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  time_zone text not null,
  active_weeks_consumed smallint not null default 1,
  constraint seasons_number check (season_number > 0),
  constraint seasons_active_weeks check (active_weeks_consumed between 1 and 4),
  constraint seasons_order check (starts_at < ends_at),
  unique (group_id, season_number),
  unique (group_id, starts_at)
);

create table app_private.member_weeks (
  member_week_id uuid primary key,
  membership_id uuid not null references app_private.memberships(membership_id) on delete restrict,
  accountability_week_id uuid not null references app_private.accountability_weeks(accountability_week_id) on delete restrict,
  target integer not null,
  target_locked_at timestamptz not null,
  target_pending_until timestamptz,
  status app_private.member_week_status not null default 'active',
  unique (membership_id, accountability_week_id),
  constraint member_weeks_target check (target >= 1)
);

create table app_private.pause_intervals (
  pause_interval_id uuid primary key,
  group_id uuid not null references app_private.groups(group_id) on delete restrict,
  kind text not null,
  starts_at timestamptz not null,
  ends_at timestamptz,
  affected_membership_id uuid references app_private.memberships(membership_id) on delete restrict,
  constraint pause_kind check (kind in ('below_capacity', 'technical', 'service', 'moderation')),
  constraint pause_order check (ends_at is null or ends_at >= starts_at)
);

create table app_private.departure_cleanup_receipts (
  membership_id uuid primary key references app_private.memberships(membership_id) on delete restrict,
  cleaned_at timestamptz not null,
  unfinished_member_weeks integer not null,
  constraint cleanup_count check (unfinished_member_weeks >= 0)
);

create or replace function app_private.actor_account_id()
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select account_id
  from app_private.accounts
  where auth_user_id = nullif(current_setting('app.auth_user_id', true), '')::uuid
    and status = 'active'
    and (
      access_cutoff is null
      or nullif(current_setting('app.token_issued_at', true), '')::timestamptz > access_cutoff
    )
$$;

create or replace function app_private.is_current_member(requested_group_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from app_private.memberships
    where account_id = app_private.actor_account_id()
      and group_id = requested_group_id
      and ended_at is null
  )
$$;

create or replace function app_private.can_group_action(requested_group_id uuid, requested_action text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when requested_action = 'operator_assignment' then exists (
      select 1 from app_private.staff_assignments
      where account_id = app_private.actor_account_id()
        and role = 'operator'
        and starts_at <= transaction_timestamp()
        and (ends_at is null or ends_at > transaction_timestamp())
    )
    when requested_action = 'group_read' then app_private.is_current_member(requested_group_id)
    when requested_action = 'peer_decision' then app_private.is_current_member(requested_group_id)
    when requested_action = 'group_admin' then exists (
      select 1
      from app_private.memberships m
      join app_private.group_admins a on a.membership_id = m.membership_id
      where m.account_id = app_private.actor_account_id()
        and m.group_id = requested_group_id
        and m.ended_at is null
    )
    else false
  end
$$;

create or replace function app_private.accountability_week_bounds(
  at_instant timestamptz,
  requested_time_zone text,
  requested_week_starts smallint default 1
) returns table (starts_at timestamptz, ends_at timestamptz)
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  local_start timestamp;
  local_date date;
  day_offset integer;
begin
  if not exists (select 1 from pg_catalog.pg_timezone_names where name = requested_time_zone) then
    raise exception 'unknown time zone' using errcode = '22023';
  end if;
  if requested_week_starts not between 1 and 7 then
    raise exception 'week start must be an ISO weekday from 1 through 7'
      using errcode = '22023';
  end if;
  local_date := (at_instant at time zone requested_time_zone)::date;
  day_offset := (extract(isodow from local_date)::integer - requested_week_starts + 7) % 7;
  local_start := (local_date - day_offset)::timestamp;
  return query select
    local_start at time zone requested_time_zone,
    (local_start + interval '7 days') at time zone requested_time_zone;
end;
$$;

create or replace function app_private.can_begin_email_otp(
  requested_email text,
  requested_token_digest text,
  requested_at timestamptz
) returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from app_private.accounts
    where email = lower(btrim(requested_email)) and status = 'active'
  ) or exists (
    select 1
    from app_private.group_invitations i
    join app_private.groups g on g.group_id = i.group_id
    where i.email = lower(btrim(requested_email))
      and i.token_digest = requested_token_digest
      and i.status = 'issued'
      and i.expires_at > requested_at
      and g.status <> 'closed'
  )
$$;

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
      and purpose in ('pilot', 'product', 'media')
      and withdrawn_at is null
    group by account_id having count(distinct purpose) = 3
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
      and purpose in ('pilot', 'product', 'media')
      and withdrawn_at is null
    group by account_id having count(distinct purpose) = 3
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

create or replace function app_private.end_membership(
  requested_membership_id uuid,
  requested_reason app_private.membership_end_reason,
  requested_at timestamptz
) returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  found_membership app_private.memberships%rowtype;
  cleanup_count integer;
  remaining_members integer;
begin
  select * into found_membership from app_private.memberships
    where membership_id = requested_membership_id for update;
  if not found or found_membership.ended_at is not null then
    raise exception 'current membership required' using errcode = 'P0002';
  end if;
  perform 1 from app_private.groups where group_id = found_membership.group_id for update;
  if exists (select 1 from app_private.group_admins where membership_id = requested_membership_id)
     and exists (
       select 1 from app_private.memberships
       where group_id = found_membership.group_id and ended_at is null
         and membership_id <> requested_membership_id
     )
     and not exists (
       select 1 from app_private.group_admins a
       join app_private.memberships m on m.membership_id = a.membership_id
       where m.group_id = found_membership.group_id and m.ended_at is null
         and m.membership_id <> requested_membership_id
     ) then
    raise exception 'Group must retain an admin' using errcode = '23514';
  end if;

  update app_private.memberships set ended_at = requested_at, end_reason = requested_reason
    where membership_id = requested_membership_id;
  delete from app_private.group_admins where membership_id = requested_membership_id;
  select count(*) into remaining_members from app_private.memberships
    where group_id = found_membership.group_id and ended_at is null;
  if remaining_members < 2 then
    update app_private.member_weeks as mw set status = 'ended_without_result'
      from app_private.memberships as m
      where mw.membership_id = m.membership_id
        and m.group_id = found_membership.group_id
        and mw.status in ('active', 'provisional');
  else
    update app_private.member_weeks set status = 'ended_without_result'
      where membership_id = requested_membership_id
        and status in ('active', 'provisional');
  end if;
  get diagnostics cleanup_count = row_count;
  update app_private.accounts set access_cutoff = requested_at
    where account_id = found_membership.account_id;
  insert into app_private.departure_cleanup_receipts (
    membership_id, cleaned_at, unfinished_member_weeks
  ) values (requested_membership_id, requested_at, cleanup_count);

  if remaining_members = 0 then
    update app_private.groups set status = 'closed', closed_at = requested_at
      where group_id = found_membership.group_id;
  elsif remaining_members < 2 then
    update app_private.groups set status = 'accountability_paused'
      where group_id = found_membership.group_id;
    insert into app_private.pause_intervals (
      pause_interval_id, group_id, kind, starts_at
    ) values (gen_random_uuid(), found_membership.group_id, 'below_capacity', requested_at);
  end if;
  return cleanup_count;
end;
$$;

alter table app_private.accounts enable row level security;
alter table app_private.consents enable row level security;
alter table app_private.groups enable row level security;
alter table app_private.memberships enable row level security;
alter table app_private.group_admins enable row level security;
alter table app_private.staff_assignments enable row level security;
alter table app_private.group_invitations enable row level security;
alter table app_private.accountability_weeks enable row level security;
alter table app_private.seasons enable row level security;
alter table app_private.member_weeks enable row level security;
alter table app_private.pause_intervals enable row level security;
alter table app_private.departure_cleanup_receipts enable row level security;

revoke all on all tables in schema app_private from public, anon, authenticated;
revoke all on function app_private.actor_account_id() from public, anon;
revoke all on function app_private.is_current_member(uuid) from public, anon;
revoke all on function app_private.can_group_action(uuid, text) from public, anon;
revoke all on function app_private.accountability_week_bounds(timestamptz, text, smallint) from public, anon, authenticated;
revoke all on function app_private.can_begin_email_otp(text, text, timestamptz) from public, anon, authenticated;
revoke all on function app_private.create_group(uuid, uuid, uuid, text, text, integer, timestamptz) from public, anon, authenticated;
revoke all on function app_private.accept_group_invitation(text, uuid, integer, integer, timestamptz) from public, anon, authenticated;
revoke all on function app_private.end_membership(uuid, app_private.membership_end_reason, timestamptz) from public, anon, authenticated;

grant execute on function app_private.actor_account_id() to authenticated, service_role;
grant execute on function app_private.is_current_member(uuid) to authenticated, service_role;
grant execute on function app_private.can_group_action(uuid, text) to authenticated, service_role;
grant usage on schema app_private to authenticated;
grant execute on function app_private.accountability_week_bounds(timestamptz, text, smallint) to service_role;
grant execute on function app_private.can_begin_email_otp(text, text, timestamptz) to service_role;
grant execute on function app_private.create_group(uuid, uuid, uuid, text, text, integer, timestamptz) to service_role;
grant execute on function app_private.accept_group_invitation(text, uuid, integer, integer, timestamptz) to service_role;
grant execute on function app_private.end_membership(uuid, app_private.membership_end_reason, timestamptz) to service_role;
grant select, insert, update, delete on all tables in schema app_private to service_role;

insert into app_private.schema_versions (version) values (3);
