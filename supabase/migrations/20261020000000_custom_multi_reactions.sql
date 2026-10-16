-- Reactions become any emoji, and a member may leave several distinct emoji on one proof.
-- Existing preset reactions carry over as their emoji.
alter table app_private.proof_reactions drop constraint proof_reactions_reaction_check;
alter table app_private.proof_reactions drop constraint proof_reactions_pkey;
update app_private.proof_reactions set reaction = case reaction
  when 'strong' then '💪' when 'fire' then '🔥' when 'cheer' then '👏' else reaction end;
-- The API checks for a single emoji; the database bounds size and bars text.
alter table app_private.proof_reactions add constraint proof_reactions_emoji check (
  char_length(reaction) between 1 and 16 and reaction !~ '[[:alnum:][:space:]]'
);
alter table app_private.proof_reactions
  add primary key (workout_checkin_id, membership_id, reaction);

drop function app_private.react_to_proof(uuid, text, timestamptz);
drop function app_private.proof_reaction_summary(timestamptz);

-- Adds or removes one of the viewer's emoji on another member's proof.
create function app_private.react_to_proof(
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
      and c.removed_at is null and c.media_deleted_at is null
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
  -- Only a member's first reaction on a proof pushes; more emoji ride along silently.
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

-- Emoji are ordered by when each first appeared on the proof.
create function app_private.proof_reaction_summary(requested_at timestamptz)
returns table (workout_checkin_id uuid, counts jsonb, my_reactions text[])
language plpgsql stable security definer set search_path = '' as $$
declare viewer app_private.memberships := app_private.actor_current_membership();
begin
  if viewer.membership_id is null then
    raise exception 'current Group membership required' using errcode = '42501';
  end if;
  return query
  select r.workout_checkin_id,
    jsonb_agg(jsonb_build_object('emoji', r.reaction, 'count', r.total) order by r.first_at),
    coalesce(array_agg(r.reaction order by r.first_at) filter (where r.mine), '{}')
  from (
    select pr.workout_checkin_id, pr.reaction, count(*)::integer as total,
      min(pr.created_at) as first_at,
      bool_or(pr.membership_id = viewer.membership_id) as mine
    from app_private.proof_reactions pr
    join app_private.workout_checkins c on c.workout_checkin_id = pr.workout_checkin_id
    join app_private.memberships author on author.membership_id = c.membership_id
    join app_private.memberships reactor on reactor.membership_id = pr.membership_id
    where author.group_id = viewer.group_id and reactor.ended_at is null
      and c.submitted_at > requested_at - interval '91 days'
    group by pr.workout_checkin_id, pr.reaction
  ) r
  group by r.workout_checkin_id;
end;
$$;

revoke all on function app_private.react_to_proof(uuid, text, boolean, timestamptz),
  app_private.proof_reaction_summary(timestamptz)
  from public, anon, authenticated;
grant execute on function app_private.react_to_proof(uuid, text, boolean, timestamptz),
  app_private.proof_reaction_summary(timestamptz)
  to service_role;

insert into app_private.schema_versions (version) values (24);
