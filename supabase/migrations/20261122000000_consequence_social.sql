-- Approved Consequence clips take reactions and comments like workout posts, and Rejected
-- workouts keep taking reactions after their photos are cleaned up (owner request 2026-11-02).

-- A Rejected post stays on the Wall, so its reactions do too, photos or not.
create or replace function app_private.react_to_proof(
  requested_checkin_id uuid, requested_reaction text, requested_on boolean,
  requested_at timestamptz
) returns text
language plpgsql security definer set search_path = '' as $$
declare viewer app_private.memberships := app_private.actor_current_membership();
begin
  if viewer.membership_id is null then
    raise exception 'current Group membership required' using errcode = '42501';
  end if;
  if not exists (
    select 1 from app_private.workout_checkins c
    join app_private.memberships m on m.membership_id = c.membership_id
    where c.workout_checkin_id = requested_checkin_id and m.group_id = viewer.group_id
      and m.ended_at is null and m.membership_id <> viewer.membership_id
      and c.activity_photo_path is not null and c.hidden_at is null
      and c.removed_at is null
      and (c.media_deleted_at is null or c.review_status = 'rejected')
  ) then
    raise exception 'Reaction unavailable' using errcode = '42501';
  end if;
  if not requested_on then
    delete from app_private.proof_reactions
    where workout_checkin_id = requested_checkin_id and membership_id = viewer.membership_id
      and reaction = requested_reaction;
    return requested_reaction;
  end if;
  if (select count(*) from app_private.proof_reactions
      where workout_checkin_id = requested_checkin_id
        and membership_id = viewer.membership_id) >= 6 then
    raise exception 'Up to 6 reactions per post' using errcode = '23514';
  end if;
  insert into app_private.proof_reactions
    (workout_checkin_id, membership_id, reaction, created_at, pushed_at)
  values (requested_checkin_id, viewer.membership_id, requested_reaction, requested_at,
    (select min(coalesce(pr.pushed_at, pr.created_at)) from app_private.proof_reactions pr
     where pr.workout_checkin_id = requested_checkin_id
       and pr.membership_id = viewer.membership_id))
  on conflict (workout_checkin_id, membership_id, reaction) do nothing;
  return requested_reaction;
end;
$$;

-- The member whose card an approved claim cleared, when the viewer's Group can see it.
create or replace function app_private.consequence_post_author(
  requested_claim_id uuid, viewer app_private.memberships
) returns uuid
language sql stable security definer set search_path = '' as $$
  select m.membership_id
  from app_private.consequence_claims cl
  join app_private.consequence_attempts ca on ca.attempt_id = cl.attempt_id
  join app_private.consequence_obligations o on o.obligation_id = ca.obligation_id
  join app_private.memberships m on m.membership_id = o.membership_id
  where cl.claim_id = requested_claim_id and cl.status = 'approved'
    and m.group_id = viewer.group_id and m.ended_at is null;
$$;

create table app_private.consequence_reactions (
  claim_id uuid not null references app_private.consequence_claims(claim_id) on delete cascade,
  membership_id uuid not null references app_private.memberships(membership_id) on delete cascade,
  reaction text not null,
  created_at timestamptz not null,
  primary key (claim_id, membership_id, reaction)
);
alter table app_private.consequence_reactions enable row level security;
revoke all on table app_private.consequence_reactions from public, anon, authenticated;
grant select, insert, update, delete on table app_private.consequence_reactions to service_role;

-- Comments share proof_messages, so reports, moderation, and export keep working.
alter table app_private.proof_messages
  alter column workout_checkin_id drop not null,
  add column claim_id uuid references app_private.consequence_claims(claim_id) on delete cascade,
  add constraint proof_messages_one_post check (num_nonnulls(workout_checkin_id, claim_id) = 1);
create index proof_messages_claim on app_private.proof_messages (claim_id, created_at)
  where claim_id is not null;

create or replace function app_private.enforce_safety_block()
returns trigger language plpgsql security definer set search_path = '' as $$
declare sender uuid; recipient uuid; claim uuid;
begin
  if tg_table_name = 'nudges' then
    sender := new.from_membership_id;
    recipient := new.to_membership_id;
  else
    sender := new.membership_id;
    -- Only consequence_reactions and proof_messages carry claim_id.
    if tg_table_name <> 'proof_reactions' then
      claim := new.claim_id;
    end if;
    if claim is not null then
      select o.membership_id into recipient
      from app_private.consequence_claims cl
      join app_private.consequence_attempts ca on ca.attempt_id = cl.attempt_id
      join app_private.consequence_obligations o on o.obligation_id = ca.obligation_id
      where cl.claim_id = claim;
    else
      select membership_id into recipient from app_private.workout_checkins
      where workout_checkin_id = new.workout_checkin_id;
    end if;
  end if;
  if app_private.blocked_between(sender, recipient) then
    raise exception 'blocked' using errcode = '42501';
  end if;
  return new;
end;
$$;
create trigger consequence_reactions_safety_block before insert on app_private.consequence_reactions
  for each row execute function app_private.enforce_safety_block();

create or replace function app_private.react_to_consequence(
  requested_claim_id uuid, requested_reaction text, requested_on boolean,
  requested_at timestamptz
) returns text
language plpgsql security definer set search_path = '' as $$
declare
  viewer app_private.memberships := app_private.actor_current_membership();
  author uuid;
begin
  if viewer.membership_id is null then
    raise exception 'current Group membership required' using errcode = '42501';
  end if;
  author := app_private.consequence_post_author(requested_claim_id, viewer);
  if author is null or author = viewer.membership_id then
    raise exception 'Reaction unavailable' using errcode = '42501';
  end if;
  if not requested_on then
    delete from app_private.consequence_reactions
    where claim_id = requested_claim_id and membership_id = viewer.membership_id
      and reaction = requested_reaction;
    return requested_reaction;
  end if;
  if (select count(*) from app_private.consequence_reactions
      where claim_id = requested_claim_id and membership_id = viewer.membership_id) >= 6 then
    raise exception 'Up to 6 reactions per post' using errcode = '23514';
  end if;
  insert into app_private.consequence_reactions (claim_id, membership_id, reaction, created_at)
  values (requested_claim_id, viewer.membership_id, requested_reaction, requested_at)
  on conflict (claim_id, membership_id, reaction) do nothing;
  return requested_reaction;
end;
$$;

create or replace function app_private.consequence_reactors(
  requested_claim_id uuid, requested_at timestamptz
) returns table (reaction text, display_name text, mine boolean, created_at timestamptz)
language plpgsql stable security definer set search_path = '' as $$
declare viewer app_private.memberships := app_private.actor_current_membership();
begin
  if viewer.membership_id is null then
    raise exception 'current Group membership required' using errcode = '42501';
  end if;
  if app_private.consequence_post_author(requested_claim_id, viewer) is null then
    raise exception 'Reactions unavailable' using errcode = 'P0002';
  end if;
  return query
  select cr.reaction,
    coalesce(a.display_name, 'Member ' || left(reactor.membership_id::text, 8)),
    reactor.membership_id = viewer.membership_id, cr.created_at
  from app_private.consequence_reactions cr
  join app_private.memberships reactor on reactor.membership_id = cr.membership_id
  join app_private.accounts a on a.account_id = reactor.account_id
  where cr.claim_id = requested_claim_id and reactor.ended_at is null
  order by cr.created_at, reactor.membership_id;
end;
$$;

create or replace function app_private.post_consequence_message(
  requested_message_id uuid, requested_claim_id uuid, requested_body text,
  requested_at timestamptz
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  viewer app_private.memberships := app_private.require_conduct();
  cleaned text := btrim(coalesce(requested_body, ''));
begin
  if length(cleaned) not between 1 and 200 then
    raise exception 'message must be 1 to 200 characters' using errcode = '22023';
  end if;
  if app_private.consequence_post_author(requested_claim_id, viewer) is null then
    raise exception 'message unavailable' using errcode = '42501';
  end if;
  if (select count(*) from app_private.proof_messages
      where membership_id = viewer.membership_id
        and created_at > requested_at - interval '1 hour') >= 30 then
    raise exception 'message limit reached' using errcode = '42501';
  end if;
  insert into app_private.proof_messages
    (proof_message_id, claim_id, membership_id, body, created_at)
  values (requested_message_id, requested_claim_id, viewer.membership_id, cleaned, requested_at)
  on conflict (proof_message_id) do nothing;
  return requested_message_id;
end;
$$;

-- Reactions and comments for each clip on the viewer's Wall.
create or replace function app_private.consequence_social(requested_at timestamptz)
returns table (claim_id uuid, counts jsonb, my_reactions text[], messages jsonb)
language plpgsql stable security definer set search_path = '' as $$
declare viewer app_private.memberships := app_private.actor_current_membership();
begin
  if viewer.membership_id is null then
    raise exception 'current Group membership required' using errcode = '42501';
  end if;
  return query
  select f.claim_id,
    coalesce((
      select jsonb_agg(jsonb_build_object('emoji', r.reaction, 'count', r.total) order by r.first_at)
      from (
        select cr.reaction, count(*)::integer as total, min(cr.created_at) as first_at
        from app_private.consequence_reactions cr
        join app_private.memberships reactor on reactor.membership_id = cr.membership_id
        where cr.claim_id = f.claim_id and reactor.ended_at is null
        group by cr.reaction
      ) r
    ), '[]'::jsonb),
    coalesce((
      select array_agg(cr.reaction order by cr.created_at)
      from app_private.consequence_reactions cr
      where cr.claim_id = f.claim_id and cr.membership_id = viewer.membership_id
    ), '{}'),
    coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', pm.proof_message_id, 'name', app_private.member_label(pm.membership_id),
        'mine', pm.membership_id = viewer.membership_id, 'body', pm.body, 'at', pm.created_at
      ) order by pm.created_at)
      from app_private.proof_messages pm
      join app_private.memberships writer on writer.membership_id = pm.membership_id
        and writer.ended_at is null
      where pm.claim_id = f.claim_id and pm.hidden_at is null
        and pm.membership_id not in (select app_private.block_peers(viewer.membership_id))
    ), '[]'::jsonb)
  from app_private.consequence_feed(requested_at) f;
end;
$$;

revoke all on function
  app_private.consequence_post_author(uuid, app_private.memberships),
  app_private.react_to_consequence(uuid, text, boolean, timestamptz),
  app_private.consequence_reactors(uuid, timestamptz),
  app_private.post_consequence_message(uuid, uuid, text, timestamptz),
  app_private.consequence_social(timestamptz)
  from public, anon, authenticated;
grant execute on function
  app_private.consequence_post_author(uuid, app_private.memberships),
  app_private.react_to_consequence(uuid, text, boolean, timestamptz),
  app_private.consequence_reactors(uuid, timestamptz),
  app_private.post_consequence_message(uuid, uuid, text, timestamptz),
  app_private.consequence_social(timestamptz)
  to service_role;

insert into app_private.schema_versions (version) values (55);
