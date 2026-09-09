create or replace function app_private.issue_group_invitation(
  requested_invitation_id uuid,
  requested_email text,
  requested_token_digest text,
  requested_at timestamptz
) returns table (invitation_id uuid, expires_at timestamptz)
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_actor_id uuid;
  actor_membership app_private.memberships%rowtype;
begin
  current_actor_id := app_private.actor_account_id();
  select m.* into actor_membership
  from app_private.memberships m
  join app_private.group_admins a on a.membership_id = m.membership_id
  where m.account_id = current_actor_id and m.ended_at is null
  for update of m;
  if not found then
    raise exception 'Group action unavailable' using errcode = '42501';
  end if;
  if requested_token_digest !~ '^[0-9a-f]{64}$' then
    raise exception 'token digest must be 64 lowercase hexadecimal characters'
      using errcode = '22023';
  end if;

  insert into app_private.group_invitations (
    invitation_id, group_id, email, token_digest, issued_by_membership_id,
    issued_at, expires_at
  ) values (
    requested_invitation_id, actor_membership.group_id,
    lower(btrim(requested_email)), requested_token_digest,
    actor_membership.membership_id, requested_at, requested_at + interval '7 days'
  );
  return query select requested_invitation_id, requested_at + interval '7 days';
end;
$$;

create or replace function app_private.revoke_group_invitation(
  requested_invitation_id uuid,
  requested_at timestamptz
) returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid;
  revoked_id uuid;
begin
  actor_id := app_private.actor_account_id();
  update app_private.group_invitations i
  set status = 'revoked'
  from app_private.memberships m
  join app_private.group_admins a on a.membership_id = m.membership_id
  where i.invitation_id = requested_invitation_id
    and i.group_id = m.group_id
    and m.account_id = actor_id
    and m.ended_at is null
    and i.status = 'issued'
    and i.expires_at > requested_at
  returning i.invitation_id into revoked_id;
  if revoked_id is null then
    raise exception 'Group action unavailable' using errcode = '42501';
  end if;
  return revoked_id;
end;
$$;

create or replace function app_private.leave_group(
  requested_at timestamptz
) returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_membership_id uuid;
begin
  select membership_id into actor_membership_id
  from app_private.memberships
  where account_id = app_private.actor_account_id() and ended_at is null
  for update;
  if actor_membership_id is null then
    raise exception 'Group action unavailable' using errcode = '42501';
  end if;
  perform app_private.end_membership(actor_membership_id, 'left', requested_at);
  return actor_membership_id;
end;
$$;

create or replace function app_private.remove_group_member(
  requested_group_id uuid,
  requested_membership_id uuid,
  requested_at timestamptz
) returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid;
  removable_id uuid;
begin
  actor_id := app_private.actor_account_id();
  select target.membership_id into removable_id
  from app_private.memberships actor_membership
  join app_private.group_admins actor_admin
    on actor_admin.membership_id = actor_membership.membership_id
  join app_private.memberships target
    on target.group_id = actor_membership.group_id
  left join app_private.group_admins target_admin
    on target_admin.membership_id = target.membership_id
  where actor_membership.account_id = actor_id
    and actor_membership.ended_at is null
    and actor_membership.group_id = requested_group_id
    and target.membership_id = requested_membership_id
    and target.ended_at is null
    and target_admin.membership_id is null
  for update of target;
  if removable_id is null then
    raise exception 'Group action unavailable' using errcode = '42501';
  end if;
  perform app_private.end_membership(removable_id, 'removed', requested_at);
  return removable_id;
end;
$$;

create or replace function app_private.claim_group_command(
  requested_idempotency_key uuid,
  requested_request_hash text,
  requested_request_id uuid
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_actor_id uuid;
  claim record;
  stored_actor_id uuid;
begin
  current_actor_id := app_private.actor_account_id();
  if current_actor_id is null then
    raise exception 'active account required' using errcode = '42501';
  end if;
  select * into claim from app_private.claim_idempotent_request(
    requested_idempotency_key, requested_request_hash, requested_request_id, current_actor_id
  );
  select request.actor_id into stored_actor_id
  from app_private.idempotent_requests request
  where request.idempotency_key = requested_idempotency_key;
  if stored_actor_id <> current_actor_id then
    raise exception 'idempotency key was already used for a different request'
      using errcode = '23505';
  end if;
  return case when claim.state = 'completed' then claim.response else null end;
end;
$$;

create or replace function app_private.create_group_command(
  requested_idempotency_key uuid, requested_request_hash text, requested_request_id uuid,
  requested_group_id uuid, requested_membership_id uuid, requested_name text,
  requested_time_zone text, requested_target integer, requested_at timestamptz
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare actor_id uuid; stored_response jsonb; result_id uuid;
begin
  actor_id := app_private.actor_account_id();
  stored_response := app_private.claim_group_command(
    requested_idempotency_key, requested_request_hash, requested_request_id);
  if stored_response is not null then
    return (stored_response ->> 'membership_id')::uuid;
  end if;
  result_id := app_private.create_group(
    requested_group_id, requested_membership_id, actor_id, requested_name,
    requested_time_zone, requested_target, requested_at);
  perform app_private.complete_idempotent_request(
    requested_idempotency_key, requested_request_hash,
    jsonb_build_object('membership_id', result_id));
  return result_id;
end;
$$;

create or replace function app_private.issue_group_invitation_command(
  requested_idempotency_key uuid, requested_request_hash text, requested_request_id uuid,
  requested_invitation_id uuid, requested_email text, requested_token_digest text,
  requested_at timestamptz
) returns table (invitation_id uuid, expires_at timestamptz)
language plpgsql security definer set search_path = '' as $$
declare stored_response jsonb; issued record;
begin
  stored_response := app_private.claim_group_command(
    requested_idempotency_key, requested_request_hash, requested_request_id);
  if stored_response is not null then
    return query select
      (stored_response ->> 'invitation_id')::uuid,
      (stored_response ->> 'expires_at')::timestamptz;
    return;
  end if;
  select * into issued from app_private.issue_group_invitation(
    requested_invitation_id, requested_email, requested_token_digest, requested_at);
  perform app_private.complete_idempotent_request(
    requested_idempotency_key, requested_request_hash,
    jsonb_build_object('invitation_id', issued.invitation_id, 'expires_at', issued.expires_at));
  return query select issued.invitation_id, issued.expires_at;
end;
$$;

create or replace function app_private.revoke_group_invitation_command(
  requested_idempotency_key uuid, requested_request_hash text, requested_request_id uuid,
  requested_invitation_id uuid, requested_at timestamptz
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare stored_response jsonb; result_id uuid;
begin
  stored_response := app_private.claim_group_command(
    requested_idempotency_key, requested_request_hash, requested_request_id);
  if stored_response is not null then
    return (stored_response ->> 'invitation_id')::uuid;
  end if;
  result_id := app_private.revoke_group_invitation(requested_invitation_id, requested_at);
  perform app_private.complete_idempotent_request(
    requested_idempotency_key, requested_request_hash,
    jsonb_build_object('invitation_id', result_id, 'status', 'revoked'));
  return result_id;
end;
$$;

create or replace function app_private.accept_group_invitation_command(
  requested_idempotency_key uuid, requested_request_hash text, requested_request_id uuid,
  requested_token_digest text, requested_membership_id uuid,
  requested_recurring_target integer, requested_current_target integer,
  requested_at timestamptz
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare stored_response jsonb; result_id uuid;
begin
  stored_response := app_private.claim_group_command(
    requested_idempotency_key, requested_request_hash, requested_request_id);
  if stored_response is not null then
    return (stored_response ->> 'membership_id')::uuid;
  end if;
  result_id := app_private.accept_group_invitation(
    requested_token_digest, requested_membership_id, requested_recurring_target,
    requested_current_target, requested_at);
  perform app_private.complete_idempotent_request(
    requested_idempotency_key, requested_request_hash,
    jsonb_build_object('membership_id', result_id));
  return result_id;
end;
$$;

create or replace function app_private.leave_group_command(
  requested_idempotency_key uuid, requested_request_hash text, requested_request_id uuid,
  requested_at timestamptz
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare stored_response jsonb; result_id uuid;
begin
  stored_response := app_private.claim_group_command(
    requested_idempotency_key, requested_request_hash, requested_request_id);
  if stored_response is not null then
    return (stored_response ->> 'membership_id')::uuid;
  end if;
  result_id := app_private.leave_group(requested_at);
  perform app_private.complete_idempotent_request(
    requested_idempotency_key, requested_request_hash,
    jsonb_build_object('membership_id', result_id));
  return result_id;
end;
$$;

create or replace function app_private.remove_group_member_command(
  requested_idempotency_key uuid, requested_request_hash text, requested_request_id uuid,
  requested_group_id uuid, requested_membership_id uuid, requested_at timestamptz
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare stored_response jsonb; result_id uuid;
begin
  stored_response := app_private.claim_group_command(
    requested_idempotency_key, requested_request_hash, requested_request_id);
  if stored_response is not null then
    return (stored_response ->> 'membership_id')::uuid;
  end if;
  result_id := app_private.remove_group_member(
    requested_group_id, requested_membership_id, requested_at);
  perform app_private.complete_idempotent_request(
    requested_idempotency_key, requested_request_hash,
    jsonb_build_object('membership_id', result_id));
  return result_id;
end;
$$;

revoke all on function app_private.issue_group_invitation(uuid, text, text, timestamptz)
  from public, anon, authenticated, service_role;
revoke all on function app_private.revoke_group_invitation(uuid, timestamptz)
  from public, anon, authenticated, service_role;
revoke all on function app_private.leave_group(timestamptz)
  from public, anon, authenticated, service_role;
revoke all on function app_private.remove_group_member(uuid, uuid, timestamptz)
  from public, anon, authenticated, service_role;
revoke all on function app_private.create_group(uuid, uuid, uuid, text, text, integer, timestamptz)
  from service_role;
revoke all on function app_private.accept_group_invitation(text, uuid, integer, integer, timestamptz)
  from service_role;
revoke all on function app_private.end_membership(uuid, app_private.membership_end_reason, timestamptz)
  from service_role;
revoke all on function app_private.claim_group_command(uuid, text, uuid)
  from public, anon, authenticated;
revoke all on function app_private.create_group_command(uuid, text, uuid, uuid, uuid, text, text, integer, timestamptz)
  from public, anon, authenticated;
revoke all on function app_private.issue_group_invitation_command(uuid, text, uuid, uuid, text, text, timestamptz)
  from public, anon, authenticated;
revoke all on function app_private.revoke_group_invitation_command(uuid, text, uuid, uuid, timestamptz)
  from public, anon, authenticated;
revoke all on function app_private.accept_group_invitation_command(uuid, text, uuid, text, uuid, integer, integer, timestamptz)
  from public, anon, authenticated;
revoke all on function app_private.leave_group_command(uuid, text, uuid, timestamptz)
  from public, anon, authenticated;
revoke all on function app_private.remove_group_member_command(uuid, text, uuid, uuid, uuid, timestamptz)
  from public, anon, authenticated;

grant execute on function app_private.create_group_command(uuid, text, uuid, uuid, uuid, text, text, integer, timestamptz)
  to service_role;
grant execute on function app_private.issue_group_invitation_command(uuid, text, uuid, uuid, text, text, timestamptz)
  to service_role;
grant execute on function app_private.revoke_group_invitation_command(uuid, text, uuid, uuid, timestamptz)
  to service_role;
grant execute on function app_private.accept_group_invitation_command(uuid, text, uuid, text, uuid, integer, integer, timestamptz)
  to service_role;
grant execute on function app_private.leave_group_command(uuid, text, uuid, timestamptz)
  to service_role;
grant execute on function app_private.remove_group_member_command(uuid, text, uuid, uuid, uuid, timestamptz)
  to service_role;

insert into app_private.schema_versions (version) values (7);
