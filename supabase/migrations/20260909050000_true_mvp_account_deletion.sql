create or replace function app_private.delete_account_command(
  requested_idempotency_key uuid,
  requested_request_hash text,
  requested_request_id uuid,
  requested_confirmation boolean,
  requested_at timestamptz
) returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_auth_user_id uuid;
  actor_account app_private.accounts%rowtype;
  actor_membership app_private.memberships%rowtype;
  promoted_membership_id uuid;
  claim record;
  stored_actor_id uuid;
begin
  current_auth_user_id := nullif(current_setting('app.auth_user_id', true), '')::uuid;
  select * into actor_account
  from app_private.accounts
  where auth_user_id = current_auth_user_id
  for update;
  if not found then
    raise exception 'active account required' using errcode = '42501';
  end if;

  select * into claim from app_private.claim_idempotent_request(
    requested_idempotency_key,
    requested_request_hash,
    requested_request_id,
    actor_account.account_id
  );
  select request.actor_id into stored_actor_id
  from app_private.idempotent_requests request
  where request.idempotency_key = requested_idempotency_key;
  if stored_actor_id <> actor_account.account_id then
    raise exception 'idempotency key was already used for a different request'
      using errcode = '23505';
  end if;
  if claim.state = 'completed' then
    return (claim.response ->> 'account_id')::uuid;
  end if;
  if actor_account.status <> 'active' then
    raise exception 'active account required' using errcode = '42501';
  end if;
  if requested_confirmation is not true then
    raise exception 'Account deletion confirmation required' using errcode = '22023';
  end if;

  select * into actor_membership
  from app_private.memberships
  where account_id = actor_account.account_id and ended_at is null
  for update;
  if found then
    if exists (
      select 1 from app_private.group_admins
      where membership_id = actor_membership.membership_id
    ) and not exists (
      select 1
      from app_private.group_admins admin
      join app_private.memberships membership
        on membership.membership_id = admin.membership_id
      where membership.group_id = actor_membership.group_id
        and membership.ended_at is null
        and membership.membership_id <> actor_membership.membership_id
    ) then
      select membership_id into promoted_membership_id
      from app_private.memberships
      where group_id = actor_membership.group_id
        and ended_at is null
        and membership_id <> actor_membership.membership_id
      order by joined_at, membership_id
      limit 1;
      if promoted_membership_id is not null then
        insert into app_private.group_admins (membership_id, granted_at)
          values (promoted_membership_id, requested_at);
      end if;
    end if;

    update app_private.group_invitations
    set status = 'revoked'
    where issued_by_membership_id = actor_membership.membership_id
      and status = 'issued';
    perform app_private.end_membership(
      actor_membership.membership_id,
      'account_deleted',
      requested_at
    );
  end if;

  update app_private.group_invitations
  set status = 'revoked',
      email = 'deleted-' || actor_account.account_id::text || '@deleted.invalid'
  where email = actor_account.email
    and status = 'issued';

  update app_private.accounts
  set status = 'deleted',
      email = 'deleted-' || account_id::text || '@deleted.invalid',
      adult_attested_at = null,
      access_cutoff = requested_at
  where account_id = actor_account.account_id;

  perform app_private.complete_idempotent_request(
    requested_idempotency_key,
    requested_request_hash,
    jsonb_build_object('account_id', actor_account.account_id, 'identity', 'Former member')
  );
  return actor_account.account_id;
end;
$$;

revoke all on function app_private.delete_account_command(uuid, text, uuid, boolean, timestamptz)
  from public, anon, authenticated;
grant execute on function app_private.delete_account_command(uuid, text, uuid, boolean, timestamptz)
  to service_role;

insert into app_private.schema_versions (version) values (9);
