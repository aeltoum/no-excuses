-- Closed Group decisions show their verdict on the Wall. A questioned post whose decision
-- closed (strict majority, everyone responded, or 48 hours passed) reports decision_outcome:
-- 'upheld' while it stays Verified, 'rejected' once a strict majority rejected it. A Rejected
-- post stays on the Wall as a text-only verdict: its photos are never returned.

drop function app_private.proof_feed(timestamptz);
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
    case when c.review_status = 'rejected' then null else c.activity_photo_path end,
    case when c.review_status = 'rejected' then null else c.presence_photo_path end,
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
      -- A Rejected verdict stays visible for a week after the decision closed.
      or (c.review_status = 'rejected' and c.questioned_at is not null
        and requested_at < c.decided_at + interval '7 days')
    )
  order by c.submitted_at desc
  limit 100;
end;
$$;
revoke all on function app_private.proof_feed(timestamptz) from public, anon, authenticated;
grant execute on function app_private.proof_feed(timestamptz) to service_role;

insert into app_private.schema_versions (version) values (52);
