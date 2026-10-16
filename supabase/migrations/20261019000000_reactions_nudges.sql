-- Deferred slice: Lightweight reactions and reminders (owner-approved 2026-10-15).
-- Members react to Group proof with one of the recorded reactions (strong, fire, cheer) and
-- nudge members who are behind their weekly target. Each interaction is an Immediate social
-- push to its recipient only: the first pushes at once, later ones within 15 minutes bundle
-- into one follow-up, and social pushes are capped at three per member per rolling day.
create table app_private.proof_reactions (
  workout_checkin_id uuid not null references app_private.workout_checkins(workout_checkin_id) on delete cascade,
  membership_id uuid not null references app_private.memberships(membership_id) on delete cascade,
  reaction text not null check (reaction in ('strong', 'fire', 'cheer')),
  created_at timestamptz not null default transaction_timestamp(),
  pushed_at timestamptz,
  primary key (workout_checkin_id, membership_id)
);

create table app_private.nudges (
  nudge_id uuid primary key default gen_random_uuid(),
  from_membership_id uuid not null references app_private.memberships(membership_id) on delete cascade,
  to_membership_id uuid not null references app_private.memberships(membership_id) on delete cascade,
  nudge_day date not null,
  created_at timestamptz not null default transaction_timestamp(),
  pushed_at timestamptz,
  constraint nudges_not_self check (from_membership_id <> to_membership_id),
  unique (from_membership_id, to_membership_id, nudge_day)
);
create index proof_reactions_unpushed on app_private.proof_reactions (workout_checkin_id) where pushed_at is null;
create index nudges_unpushed on app_private.nudges (to_membership_id) where pushed_at is null;

-- Sets, changes, or (with null) clears the viewer's reaction on another member's proof.
create or replace function app_private.react_to_proof(
  requested_checkin_id uuid, requested_reaction text, requested_at timestamptz
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
  if requested_reaction is null then
    delete from app_private.proof_reactions
    where workout_checkin_id = requested_checkin_id and membership_id = viewer.membership_id;
  else
    -- Changing a reaction does not push again.
    insert into app_private.proof_reactions (workout_checkin_id, membership_id, reaction, created_at)
    values (requested_checkin_id, viewer.membership_id, requested_reaction, requested_at)
    on conflict (workout_checkin_id, membership_id) do update set reaction = excluded.reaction;
  end if;
  return requested_reaction;
end;
$$;

create or replace function app_private.proof_reaction_summary(requested_at timestamptz)
returns table (workout_checkin_id uuid, counts jsonb, my_reaction text)
language plpgsql stable security definer set search_path = '' as $$
declare viewer app_private.memberships := app_private.actor_current_membership();
begin
  if viewer.membership_id is null then
    raise exception 'current Group membership required' using errcode = '42501';
  end if;
  return query
  select r.workout_checkin_id,
    jsonb_object_agg(r.reaction, r.total),
    max(r.mine)
  from (
    select pr.workout_checkin_id, pr.reaction, count(*)::integer as total,
      max(case when pr.membership_id = viewer.membership_id then pr.reaction end) as mine
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

-- One nudge per sender, recipient, and UTC day, only while the recipient is behind target.
create or replace function app_private.nudge_member(
  requested_membership_id uuid, requested_at timestamptz
) returns boolean
language plpgsql security definer set search_path = '' as $$
declare viewer app_private.memberships := app_private.actor_current_membership();
begin
  if viewer.membership_id is null then
    raise exception 'current Group membership required' using errcode = '42501';
  end if;
  if requested_membership_id = viewer.membership_id or not exists (
    select 1 from app_private.memberships m
    join app_private.member_weeks mw on mw.membership_id = m.membership_id and mw.status = 'active'
    join app_private.accountability_weeks aw on aw.accountability_week_id = mw.accountability_week_id
    where m.membership_id = requested_membership_id and m.group_id = viewer.group_id
      and m.ended_at is null
      and requested_at >= aw.starts_at and requested_at < aw.ends_at
      and (select count(*) from app_private.workout_checkins c
           where c.member_week_id = mw.member_week_id) < mw.target
  ) then
    raise exception 'Nudge unavailable' using errcode = '42501';
  end if;
  insert into app_private.nudges (from_membership_id, to_membership_id, nudge_day, created_at)
  values (viewer.membership_id, requested_membership_id, (requested_at at time zone 'UTC')::date, requested_at)
  on conflict (from_membership_id, to_membership_id, nudge_day) do nothing;
  if not found then
    raise exception 'Already nudged today' using errcode = '23505';
  end if;
  return true;
end;
$$;

-- Memberships the viewer already nudged today, so the button can show as sent.
create or replace function app_private.nudged_today(requested_at timestamptz)
returns setof uuid
language sql stable security definer set search_path = '' as $$
  select n.to_membership_id from app_private.nudges n
  where n.from_membership_id = (app_private.actor_current_membership()).membership_id
    and n.nudge_day = (requested_at at time zone 'UTC')::date;
$$;

create or replace function app_private.enqueue_social_push(requested_at timestamptz)
returns integer
language plpgsql security definer set search_path = '' as $$
declare
  enqueued integer := 0;
  recipient record;
  names text;
  total integer;
  sent_today integer;
  last_sent timestamptz;
begin
  for recipient in
    with pending as (
      select author.account_id, coalesce(a.display_name, 'A Group member') as sender,
        'reaction' as kind, pr.created_at
      from app_private.proof_reactions pr
      join app_private.workout_checkins c on c.workout_checkin_id = pr.workout_checkin_id
      join app_private.memberships author on author.membership_id = c.membership_id and author.ended_at is null
      join app_private.memberships reactor on reactor.membership_id = pr.membership_id and reactor.ended_at is null
      join app_private.accounts a on a.account_id = reactor.account_id
      where pr.pushed_at is null
      union all
      select target.account_id, coalesce(a.display_name, 'A Group member'), 'nudge', n.created_at
      from app_private.nudges n
      join app_private.memberships target on target.membership_id = n.to_membership_id and target.ended_at is null
      join app_private.memberships sender on sender.membership_id = n.from_membership_id and sender.ended_at is null
      join app_private.accounts a on a.account_id = sender.account_id
      where n.pushed_at is null
    )
    select p.account_id,
      array_agg(distinct p.sender) as senders,
      count(*)::integer as items,
      bool_and(p.kind = 'nudge') as only_nudges,
      bool_and(p.kind = 'reaction') as only_reactions
    from pending p
    join app_private.push_recipients() r on r.account_id = p.account_id
    where p.created_at >= r.since
    group by p.account_id
  loop
    select count(*)::integer, max(o.created_at) into sent_today, last_sent
    from app_private.web_push_outbox o
    where o.account_id = recipient.account_id and o.dedupe_key like 'social:%'
      and o.created_at > requested_at - interval '1 day';
    -- Within 15 minutes of the last social push, wait so later items bundle together.
    continue when last_sent is not null and requested_at < last_sent + interval '15 minutes';
    if sent_today < 3 then
      total := array_length(recipient.senders, 1);
      names := recipient.senders[1] || case
        when total = 2 then ' and ' || recipient.senders[2]
        when total > 2 then ' and ' || (total - 1) || ' others' else '' end;
      insert into app_private.web_push_outbox (account_id, dedupe_key, title, body, created_at)
      values (recipient.account_id,
        'social:' || recipient.account_id || ':' || extract(epoch from requested_at)::bigint,
        case
          when recipient.items > 1 and not recipient.only_nudges and not recipient.only_reactions
            then recipient.items || ' new reactions and nudges'
          when recipient.only_nudges then names || ' nudged you'
          else names || ' reacted to your workout' end,
        case when recipient.only_reactions then 'Open No Excuses to see your proof.'
          else 'You are behind this week. No excuses.' end,
        requested_at)
      on conflict (dedupe_key) do nothing;
      enqueued := enqueued + 1;
    end if;
    -- Items over the daily cap stay visible in-app and are not pushed later.
    update app_private.proof_reactions pr set pushed_at = requested_at
    from app_private.workout_checkins c, app_private.memberships author
    where pr.pushed_at is null and c.workout_checkin_id = pr.workout_checkin_id
      and author.membership_id = c.membership_id and author.account_id = recipient.account_id;
    update app_private.nudges n set pushed_at = requested_at
    from app_private.memberships target
    where n.pushed_at is null and target.membership_id = n.to_membership_id
      and target.account_id = recipient.account_id;
  end loop;
  return enqueued;
end;
$$;

revoke all on table app_private.proof_reactions, app_private.nudges
  from public, anon, authenticated;
revoke all on function app_private.react_to_proof(uuid, text, timestamptz),
  app_private.proof_reaction_summary(timestamptz),
  app_private.nudge_member(uuid, timestamptz),
  app_private.nudged_today(timestamptz),
  app_private.enqueue_social_push(timestamptz)
  from public, anon, authenticated;
grant select, insert, update, delete on table app_private.proof_reactions,
  app_private.nudges to service_role;
grant execute on function app_private.react_to_proof(uuid, text, timestamptz),
  app_private.proof_reaction_summary(timestamptz),
  app_private.nudge_member(uuid, timestamptz),
  app_private.nudged_today(timestamptz),
  app_private.enqueue_social_push(timestamptz)
  to service_role;

insert into app_private.schema_versions (version) values (23);
