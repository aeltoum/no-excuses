-- Lists who left each emoji on one proof, for the reactions drawer.
-- Visibility matches proof_reaction_summary: the viewer's Group, active reactors only.
create function app_private.proof_reactors(requested_checkin_id uuid, requested_at timestamptz)
returns table (reaction text, display_name text, mine boolean, created_at timestamptz)
language plpgsql stable security definer set search_path = '' as $$
declare viewer app_private.memberships := app_private.actor_current_membership();
begin
  if viewer.membership_id is null then
    raise exception 'current Group membership required' using errcode = '42501';
  end if;
  if not exists (
    select 1 from app_private.workout_checkins c
    join app_private.memberships author on author.membership_id = c.membership_id
    where c.workout_checkin_id = requested_checkin_id and author.group_id = viewer.group_id
      and c.submitted_at > requested_at - interval '91 days'
  ) then
    raise exception 'Reactions unavailable' using errcode = 'P0002';
  end if;
  return query
  select pr.reaction,
    coalesce(a.display_name, 'Member ' || left(reactor.membership_id::text, 8)),
    reactor.membership_id = viewer.membership_id, pr.created_at
  from app_private.proof_reactions pr
  join app_private.memberships reactor on reactor.membership_id = pr.membership_id
  join app_private.accounts a on a.account_id = reactor.account_id
  where pr.workout_checkin_id = requested_checkin_id and reactor.ended_at is null
  order by pr.created_at, reactor.membership_id;
end;
$$;

revoke all on function app_private.proof_reactors(uuid, timestamptz)
  from public, anon, authenticated;
grant execute on function app_private.proof_reactors(uuid, timestamptz) to service_role;

insert into app_private.schema_versions (version) values (27);
