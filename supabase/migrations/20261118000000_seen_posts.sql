-- Seen posts (#281): a member's mark on a Wall post they have looked at on Home. Marks are
-- insert-only and never re-surface on new reactions or comments. A member's own posts are
-- always seen to them without a stored mark. Marks go when the post leaves the Wall or
-- either membership ends.
create table app_private.proof_seen_marks (
  workout_checkin_id uuid not null references app_private.workout_checkins(workout_checkin_id) on delete cascade,
  membership_id uuid not null references app_private.memberships(membership_id) on delete cascade,
  seen_at timestamptz not null,
  primary key (workout_checkin_id, membership_id)
);
create index proof_seen_marks_membership_idx on app_private.proof_seen_marks (membership_id);
alter table app_private.proof_seen_marks enable row level security;
revoke all on table app_private.proof_seen_marks from public, anon, authenticated;

-- Many ids per call. Ids the viewer can't see on the Wall, own posts and repeats are ignored.
create or replace function app_private.mark_posts_seen(requested_ids uuid[], requested_at timestamptz)
returns integer
language plpgsql security definer set search_path = '' as $$
declare
  viewer app_private.memberships := app_private.actor_current_membership();
  added integer;
begin
  if viewer.membership_id is null then
    raise exception 'current Group membership required' using errcode = '42501';
  end if;
  insert into app_private.proof_seen_marks (workout_checkin_id, membership_id, seen_at)
  select distinct f.workout_checkin_id, viewer.membership_id, requested_at
  from app_private.proof_feed(requested_at) f
  where f.workout_checkin_id = any(requested_ids) and not f.mine
    and f.workout_checkin_id not in (select app_private.block_hidden_posts(requested_at))
  on conflict do nothing;
  get diagnostics added = row_count;
  return added;
end;
$$;

-- A post that leaves the Wall drops its marks.
create or replace function app_private.forget_seen_marks_for_post()
returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.removed_at is not null or new.media_deleted_at is not null
    or new.activity_photo_path is null
    or new.review_status in ('rejected', 'unsupported') then
    delete from app_private.proof_seen_marks where workout_checkin_id = new.workout_checkin_id;
  end if;
  return new;
end;
$$;
create trigger workout_checkins_forget_seen_marks
after update of removed_at, media_deleted_at, activity_photo_path, review_status
on app_private.workout_checkins
for each row execute function app_private.forget_seen_marks_for_post();

-- An ended membership drops the marks it made and the marks on its posts.
create or replace function app_private.forget_seen_marks_for_membership()
returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.ended_at is not null and old.ended_at is null then
    delete from app_private.proof_seen_marks where membership_id = new.membership_id;
    delete from app_private.proof_seen_marks s
    using app_private.workout_checkins c
    where c.workout_checkin_id = s.workout_checkin_id and c.membership_id = new.membership_id;
  end if;
  return new;
end;
$$;
create trigger memberships_forget_seen_marks
after update of ended_at on app_private.memberships
for each row execute function app_private.forget_seen_marks_for_membership();

-- proof_feed gains seen: own posts always, others when marked.
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
  seen boolean
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
    m.membership_id = viewer.membership_id and mw.status = 'active' and requested_at < aw.ends_at,
    m.membership_id = viewer.membership_id or exists (
      select 1 from app_private.proof_seen_marks s
      where s.workout_checkin_id = c.workout_checkin_id and s.membership_id = viewer.membership_id)
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

revoke all on function app_private.proof_feed(timestamptz) from public, anon, authenticated;
grant execute on function app_private.proof_feed(timestamptz) to service_role;
revoke all on function app_private.mark_posts_seen(uuid[], timestamptz),
  app_private.forget_seen_marks_for_post(), app_private.forget_seen_marks_for_membership()
  from public, anon, authenticated;
grant execute on function app_private.mark_posts_seen(uuid[], timestamptz) to service_role;

insert into app_private.schema_versions (version) values (51);
