-- Rejected posts keep their photos so they stay in their day on the Wall; earlier ones whose
-- photos were already cleaned up still show, without photos. Approved Consequence claims
-- join the Wall as clip posts labelled Consequence (owner decision 2026-11-02).

create or replace function app_private.proof_media_due(requested_at timestamptz)
returns table (path text)
language sql stable security definer set search_path = '' as $$
  select p.path from app_private.workout_checkins c
  join app_private.memberships m on m.membership_id = c.membership_id
  join app_private.accounts a on a.account_id = m.account_id
  cross join lateral (values (c.activity_photo_path), (c.presence_photo_path)) p(path)
  where c.activity_photo_path is not null and c.media_deleted_at is null
    and (c.review_status = 'unsupported' or c.removed_at is not null
      or m.ended_at is not null or a.status <> 'active')
  union
  select u.path from app_private.proof_uploads u
  where u.deleted_at is null and u.used_at is null
    and requested_at >= u.created_at + interval '1 day'
  union
  select u.path from app_private.proof_uploads u
  join app_private.accounts a on a.account_id = u.account_id
  where u.kind = 'avatar' and u.deleted_at is null and a.status <> 'active'
  limit 200;
$$;

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
  can_delete boolean,
  seen boolean,
  decision_outcome text,
  decided_at timestamptz
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
    case when c.media_deleted_at is null then c.activity_photo_path end,
    case when c.media_deleted_at is null then c.presence_photo_path end,
    m.membership_id = viewer.membership_id and mw.status = 'active' and requested_at < aw.ends_at,
    m.membership_id = viewer.membership_id or exists (
      select 1 from app_private.proof_seen_marks s
      where s.workout_checkin_id = c.workout_checkin_id and s.membership_id = viewer.membership_id),
    case
      when c.review_status = 'rejected' then 'rejected'
      when c.questioned_at is null then null
      when c.decided_at is not null or requested_at >= c.questioned_at + interval '48 hours'
        then 'upheld'
    end,
    coalesce(c.decided_at, case when c.questioned_at is not null
      and requested_at >= c.questioned_at + interval '48 hours'
      then c.questioned_at + interval '48 hours' end)
  from app_private.workout_checkins c
  join app_private.memberships m on m.membership_id = c.membership_id
  join app_private.member_weeks mw on mw.member_week_id = c.member_week_id
  join app_private.accountability_weeks aw on aw.accountability_week_id = mw.accountability_week_id
  join app_private.accounts a on a.account_id = m.account_id
  left join app_private.proof_votes v
    on v.workout_checkin_id = c.workout_checkin_id and v.membership_id = viewer.membership_id
  where m.group_id = viewer.group_id and m.ended_at is null
    and c.activity_photo_path is not null and c.removed_at is null
    and (c.hidden_at is null or admin or m.membership_id = viewer.membership_id)
    and (
      (c.review_status = 'verified' and c.media_deleted_at is null)
      -- A Rejected post stays in its day; one whose photos were already cleaned up shows without them.
      or c.review_status = 'rejected'
    )
  order by c.submitted_at desc
  limit 100;
end;
$$;
revoke all on function app_private.proof_feed(timestamptz) from public, anon, authenticated;
grant execute on function app_private.proof_feed(timestamptz) to service_role;
revoke all on function app_private.proof_feed(timestamptz) from public, anon, authenticated;
grant execute on function app_private.proof_feed(timestamptz) to service_role;

-- Approved Consequence claims in the viewer's Group, newest first, with the card done.
create or replace function app_private.consequence_feed(requested_at timestamptz)
returns table (
  claim_id uuid,
  author_membership_id uuid,
  author_name text,
  mine boolean,
  card_title text,
  clip_path text,
  submitted_at timestamptz,
  approved_at timestamptz
)
language plpgsql stable security definer set search_path = '' as $$
declare
  viewer app_private.memberships := app_private.actor_current_membership();
begin
  if viewer.membership_id is null then
    raise exception 'current Group membership required' using errcode = '42501';
  end if;
  return query
  select cl.claim_id, m.membership_id,
    coalesce(a.display_name, 'Member ' || left(m.membership_id::text, 8)),
    m.membership_id = viewer.membership_id,
    cc.title, cl.clip_path, cl.submitted_at, cl.finalized_at
  from app_private.consequence_claims cl
  join app_private.consequence_attempts ca on ca.attempt_id = cl.attempt_id
  join app_private.consequence_cards cc on cc.card_id = ca.card_id
  join app_private.consequence_obligations o on o.obligation_id = ca.obligation_id
  join app_private.memberships m on m.membership_id = o.membership_id
  join app_private.accounts a on a.account_id = m.account_id
  where m.group_id = viewer.group_id and m.ended_at is null and a.status = 'active'
    and cl.status = 'approved' and cl.finalized_at <= requested_at
  order by cl.finalized_at desc
  limit 50;
end;
$$;
revoke all on function app_private.consequence_feed(timestamptz) from public, anon, authenticated;
grant execute on function app_private.consequence_feed(timestamptz) to service_role;

insert into app_private.schema_versions (version) values (54);
