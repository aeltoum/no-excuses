create or replace function app_private.current_group_membership()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  actor_account_id uuid;
  current_group_id uuid;
  current_membership_id uuid;
begin
  actor_account_id := app_private.actor_account_id();
  if actor_account_id is null then
    raise exception 'authenticated account required' using errcode = '42501';
  end if;
  select m.group_id, m.membership_id
    into current_group_id, current_membership_id
  from app_private.memberships m
  where m.account_id = actor_account_id
    and m.ended_at is null;

  return jsonb_build_object(
    'membership',
    case when current_membership_id is null then null
      else jsonb_build_object(
        'groupId', current_group_id,
        'membershipId', current_membership_id
      )
    end
  );
end;
$$;

revoke all on function app_private.current_group_membership()
  from public, anon;
grant execute on function app_private.current_group_membership()
  to authenticated, service_role;

insert into app_private.schema_versions (version) values (10);
