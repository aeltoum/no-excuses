create or replace function app_private.set_weekly_target_command(
  requested_idempotency_key uuid, requested_request_hash text, requested_request_id uuid,
  requested_target integer
) returns table (membership_id uuid, weekly_target integer)
language plpgsql
security definer
set search_path = ''
as $$
declare
  stored_response jsonb;
  updated_membership_id uuid;
begin
  stored_response := app_private.claim_group_command(
    requested_idempotency_key, requested_request_hash, requested_request_id);
  if stored_response is not null then
    return query select
      (stored_response ->> 'membership_id')::uuid,
      (stored_response ->> 'weekly_target')::integer;
    return;
  end if;
  if requested_target < 1 then
    raise exception 'weekly target must be positive' using errcode = '22023';
  end if;

  update app_private.memberships
  set recurring_target = requested_target
  where account_id = app_private.actor_account_id()
    and ended_at is null
  returning memberships.membership_id into updated_membership_id;
  if updated_membership_id is null then
    raise exception 'Group action unavailable' using errcode = '42501';
  end if;

  perform app_private.complete_idempotent_request(
    requested_idempotency_key, requested_request_hash,
    jsonb_build_object(
      'membership_id', updated_membership_id,
      'weekly_target', requested_target));
  return query select updated_membership_id, requested_target;
end;
$$;

revoke all on function app_private.set_weekly_target_command(uuid, text, uuid, integer)
  from public, anon, authenticated;
grant execute on function app_private.set_weekly_target_command(uuid, text, uuid, integer)
  to service_role;

insert into app_private.schema_versions (version) values (8);
