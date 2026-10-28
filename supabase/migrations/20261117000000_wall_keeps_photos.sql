-- Verified Proof posts and their photos stay on the Group Wall with no time limit (owner
-- decision 2026-10-28). Unsupported or Rejected media, removal, moderation, a departed author,
-- Account deletion and inactive accounts still take a post off the Wall as before.

create or replace function app_private.proof_feed(requested_at timestamptz)
returns table (
  workout_checkin_id uuid,
  author_membership_id uuid,
  author_name text,
  mine boolean,
  activity_type text,
  duration_minutes integer,
  perceived_intensity text,
  completed_at timestamptz,
  submitted_at timestamptz,
  review_status text,
  review_closes_at timestamptz,
  decision_closes_at timestamptz,
  hidden boolean,
  my_vote text,
  accept_votes integer,
  reject_votes integer,
  eligible_voters integer,
  can_review boolean,
  can_vote boolean,
  activity_photo_path text,
  presence_photo_path text,
  can_delete boolean
)
language plpgsql stable security definer set search_path = '' as $$
declare
  viewer app_private.memberships := app_private.actor_current_membership();
  admin boolean;
begin
  if viewer.membership_id is null then
    raise exception 'current Group membership required' using errcode = '42501';
  end if;
  admin := exists (select 1 from app_private.group_admins where membership_id = viewer.membership_id);
  return query
  select c.workout_checkin_id, m.membership_id,
    coalesce(a.display_name, 'Member ' || left(m.membership_id::text, 8)),
    m.membership_id = viewer.membership_id,
    c.activity_type::text, c.duration_minutes, c.perceived_intensity::text,
    c.completed_at, c.submitted_at,
    case when app_private.proof_decision_open(c) then 'questioned'
      else c.review_status::text end,
    case when c.review_status = 'verified' and c.questioned_at is null and c.decided_at is null
        and requested_at < c.submitted_at + interval '24 hours'
      then c.submitted_at + interval '24 hours' end,
    case when app_private.proof_decision_open(c) then c.questioned_at + interval '48 hours' end,
    c.hidden_at is not null,
    v.vote::text,
    (select count(*)::integer from app_private.proof_votes pv
     where pv.workout_checkin_id = c.workout_checkin_id and pv.vote = 'accept'),
    (select count(*)::integer from app_private.proof_votes pv
     where pv.workout_checkin_id = c.workout_checkin_id and pv.vote = 'reject'),
    (select count(*)::integer from app_private.proof_decision_audience pa
     join app_private.memberships am on am.membership_id = pa.membership_id and am.ended_at is null
     where pa.workout_checkin_id = c.workout_checkin_id),
    c.review_status = 'verified' and c.questioned_at is null and c.decided_at is null
      and m.membership_id <> viewer.membership_id and c.hidden_at is null
      and requested_at < c.submitted_at + interval '24 hours',
    app_private.proof_decision_open(c) and c.hidden_at is null
      and requested_at < c.questioned_at + interval '48 hours'
      and exists (select 1 from app_private.proof_decision_audience pa
        where pa.workout_checkin_id = c.workout_checkin_id
          and pa.membership_id = viewer.membership_id),
    c.activity_photo_path, c.presence_photo_path,
    m.membership_id = viewer.membership_id and mw.status = 'active' and requested_at < aw.ends_at
  from app_private.workout_checkins c
  join app_private.memberships m on m.membership_id = c.membership_id
  join app_private.member_weeks mw on mw.member_week_id = c.member_week_id
  join app_private.accountability_weeks aw on aw.accountability_week_id = mw.accountability_week_id
  join app_private.accounts a on a.account_id = m.account_id
  left join app_private.proof_votes v
    on v.workout_checkin_id = c.workout_checkin_id and v.membership_id = viewer.membership_id
  where m.group_id = viewer.group_id and m.ended_at is null
    and c.activity_photo_path is not null and c.removed_at is null and c.media_deleted_at is null
    and (c.hidden_at is null or admin or m.membership_id = viewer.membership_id)
    and c.review_status = 'verified'
  order by c.submitted_at desc
  limit 100;
end;
$$;

-- Reactions and the reactors list follow the Wall: no age cutoff.
create or replace function app_private.proof_reaction_summary(requested_at timestamptz)
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
    group by pr.workout_checkin_id, pr.reaction
  ) r
  group by r.workout_checkin_id;
end;
$$;

create or replace function app_private.proof_reactors(requested_checkin_id uuid, requested_at timestamptz)
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

insert into app_private.schema_versions (version) values (50);
