-- Deferred slice: Proof photos and peer verification, lean v1 (owner-approved 2026-10-13).
-- Every check-in carries one Activity photo and one Member-presence photo taken with the
-- camera. A report is Verified when another member verifies it or after 24 unquestioned
-- hours; a Questioned report goes to a 48-hour strict-majority Group decision. Only Verified
-- completions count toward the weekly outcome. Timed Workout sessions remain deferred.

create type app_private.proof_review_status as enum (
  'pending', 'verified', 'questioned', 'unsupported', 'rejected'
);
create type app_private.proof_vote as enum ('accept', 'reject', 'cannot_assess');

-- Check-ins created before this slice keep counting as self-reported Verified completions.
alter table app_private.workout_checkins
  add column review_status app_private.proof_review_status not null default 'verified',
  add column activity_photo_path text,
  add column presence_photo_path text,
  add column verified_at timestamptz,
  add column questioned_at timestamptz,
  add column decided_at timestamptz,
  add column hidden_at timestamptz,
  add column removed_at timestamptz,
  add column media_deleted_at timestamptz;

create table app_private.proof_uploads (
  path text primary key,
  account_id uuid not null references app_private.accounts(account_id) on delete cascade,
  kind text not null check (kind in ('activity', 'presence')),
  created_at timestamptz not null,
  used_at timestamptz,
  deleted_at timestamptz,
  constraint proof_uploads_path check (path ~ '^[0-9a-f-]{36}/[0-9a-f-]{36}\.jpg$')
);

create table app_private.proof_decision_audience (
  workout_checkin_id uuid not null references app_private.workout_checkins(workout_checkin_id) on delete cascade,
  membership_id uuid not null references app_private.memberships(membership_id) on delete cascade,
  primary key (workout_checkin_id, membership_id)
);

create table app_private.proof_votes (
  workout_checkin_id uuid not null,
  membership_id uuid not null,
  vote app_private.proof_vote not null,
  voted_at timestamptz not null,
  primary key (workout_checkin_id, membership_id),
  foreign key (workout_checkin_id, membership_id)
    references app_private.proof_decision_audience (workout_checkin_id, membership_id)
    on delete cascade
);

create table app_private.proof_reports (
  workout_checkin_id uuid not null references app_private.workout_checkins(workout_checkin_id) on delete cascade,
  membership_id uuid not null references app_private.memberships(membership_id) on delete cascade,
  reported_at timestamptz not null,
  primary key (workout_checkin_id, membership_id)
);

do $$
begin
  if exists (select 1 from information_schema.schemata where schema_name = 'storage') then
    execute $sql$
      insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
      values ('proof-photos', 'proof-photos', false, 2097152, array['image/jpeg'])
      on conflict (id) do nothing
    $sql$;
  end if;
end;
$$;

create or replace function app_private.actor_current_membership()
returns app_private.memberships
language sql stable security definer set search_path = '' as $$
  select m.* from app_private.memberships m
  where m.account_id = app_private.actor_account_id() and m.ended_at is null
  limit 1;
$$;

create or replace function app_private.create_proof_upload(
  requested_kind text, requested_at timestamptz
) returns text
language plpgsql security definer set search_path = '' as $$
declare
  actor uuid := app_private.actor_account_id();
  new_path text;
begin
  if actor is null or (app_private.actor_current_membership()).membership_id is null then
    raise exception 'current membership required' using errcode = '42501';
  end if;
  if (select count(*) from app_private.proof_uploads
      where account_id = actor and created_at > requested_at - interval '1 hour') >= 40 then
    raise exception 'upload limit reached' using errcode = '42501';
  end if;
  new_path := actor::text || '/' || gen_random_uuid()::text || '.jpg';
  insert into app_private.proof_uploads (path, account_id, kind, created_at)
  values (new_path, actor, requested_kind, requested_at);
  return new_path;
end;
$$;

create or replace function app_private.submit_proof_checkin(
  requested_idempotency_key uuid,
  requested_request_hash text,
  requested_request_id uuid,
  requested_workout_checkin_id uuid,
  requested_activity_type app_private.workout_activity_type,
  requested_completed_at timestamptz,
  requested_duration_minutes integer,
  requested_perceived_intensity app_private.perceived_intensity,
  requested_self_report_attested boolean,
  requested_activity_photo_path text,
  requested_presence_photo_path text,
  requested_media_consent boolean,
  requested_at timestamptz
) returns table (workout_checkin_id uuid, current_week_count integer)
language plpgsql security definer set search_path = '' as $$
declare
  actor uuid := app_private.actor_account_id();
  result_id uuid;
  result_count integer;
begin
  if requested_media_consent is not true then
    raise exception 'media-sharing consent required' using errcode = '22023';
  end if;
  select s.workout_checkin_id, s.current_week_count into result_id, result_count
  from app_private.submit_workout_checkin(
    requested_idempotency_key, requested_request_hash, requested_request_id,
    requested_workout_checkin_id, requested_activity_type, requested_completed_at,
    requested_duration_minutes, requested_perceived_intensity,
    requested_self_report_attested, requested_at
  ) s;

  -- Idempotent replay returns the stored result without attaching photos again.
  if exists (select 1 from app_private.workout_checkins c
             where c.workout_checkin_id = result_id and c.activity_photo_path is null) then
    update app_private.proof_uploads set used_at = requested_at
    where account_id = actor and used_at is null and deleted_at is null
      and ((path = requested_activity_photo_path and kind = 'activity')
        or (path = requested_presence_photo_path and kind = 'presence'));
    if not found or (select count(*) from app_private.proof_uploads
        where used_at = requested_at and account_id = actor
          and path in (requested_activity_photo_path, requested_presence_photo_path)) <> 2 then
      raise exception 'both proof photos required' using errcode = '22023';
    end if;
    update app_private.workout_checkins
    set review_status = 'pending', activity_photo_path = requested_activity_photo_path,
      presence_photo_path = requested_presence_photo_path, verified_at = null
    where workout_checkins.workout_checkin_id = result_id;
  end if;
  return query select result_id, result_count;
end;
$$;

-- Close a Questioned report when a strict majority exists, everyone has responded, or time ends.
create or replace function app_private.resolve_proof_decision(
  requested_checkin_id uuid, requested_at timestamptz
) returns app_private.proof_review_status
language plpgsql security definer set search_path = '' as $$
declare
  item app_private.workout_checkins%rowtype;
  eligible integer;
  accepts integer;
  rejects integer;
  responded integer;
  outcome app_private.proof_review_status;
begin
  select * into item from app_private.workout_checkins
  where workout_checkin_id = requested_checkin_id for update;
  if item.review_status <> 'questioned' then return item.review_status; end if;
  select count(*) into eligible
  from app_private.proof_decision_audience a
  join app_private.memberships m on m.membership_id = a.membership_id and m.ended_at is null
  where a.workout_checkin_id = requested_checkin_id;
  select count(*) filter (where v.vote = 'accept'), count(*) filter (where v.vote = 'reject'),
    count(*)
  into accepts, rejects, responded
  from app_private.proof_votes v
  join app_private.memberships m on m.membership_id = v.membership_id and m.ended_at is null
  where v.workout_checkin_id = requested_checkin_id;

  if accepts * 2 > eligible then
    outcome := 'verified';
  elsif rejects * 2 > eligible then
    outcome := 'rejected';
  elsif responded >= eligible or requested_at >= item.questioned_at + interval '48 hours' then
    outcome := 'unsupported';
  else
    return 'questioned';
  end if;

  update app_private.workout_checkins
  set review_status = outcome, decided_at = requested_at,
    verified_at = case when outcome = 'verified' then requested_at end
  where workout_checkin_id = requested_checkin_id;
  if outcome = 'rejected' then
    perform app_private.add_consequence_obligation(
      md5('rejected_report:' || requested_checkin_id::text)::uuid,
      item.membership_id, 'rejected_report', requested_checkin_id, requested_at
    );
  end if;
  return outcome;
end;
$$;

create or replace function app_private.review_proof_checkin(
  requested_checkin_id uuid, requested_action text, requested_at timestamptz
) returns app_private.proof_review_status
language plpgsql security definer set search_path = '' as $$
declare
  viewer app_private.memberships := app_private.actor_current_membership();
  item app_private.workout_checkins%rowtype;
  author app_private.memberships%rowtype;
begin
  select * into item from app_private.workout_checkins
  where workout_checkin_id = requested_checkin_id for update;
  select * into author from app_private.memberships where membership_id = item.membership_id;
  if viewer.membership_id is null or item.workout_checkin_id is null
     or author.group_id <> viewer.group_id or author.membership_id = viewer.membership_id
     or author.ended_at is not null or item.hidden_at is not null
     or viewer.joined_at > item.submitted_at then
    raise exception 'review unavailable' using errcode = '42501';
  end if;
  if item.review_status <> 'pending'
     or requested_at >= item.submitted_at + interval '24 hours' then
    raise exception 'review window closed' using errcode = 'P0002';
  end if;
  if requested_action = 'verify' then
    update app_private.workout_checkins
    set review_status = 'verified', verified_at = requested_at, decided_at = requested_at
    where workout_checkin_id = requested_checkin_id;
    return 'verified';
  elsif requested_action = 'question' then
    update app_private.workout_checkins
    set review_status = 'questioned', questioned_at = requested_at
    where workout_checkin_id = requested_checkin_id;
    insert into app_private.proof_decision_audience (workout_checkin_id, membership_id)
    select requested_checkin_id, m.membership_id
    from app_private.memberships m
    where m.group_id = author.group_id and m.ended_at is null
      and m.membership_id <> author.membership_id;
    return 'questioned';
  end if;
  raise exception 'unknown review action' using errcode = '22023';
end;
$$;

create or replace function app_private.vote_proof_checkin(
  requested_checkin_id uuid, requested_vote app_private.proof_vote, requested_at timestamptz
) returns app_private.proof_review_status
language plpgsql security definer set search_path = '' as $$
declare
  viewer app_private.memberships := app_private.actor_current_membership();
  item app_private.workout_checkins%rowtype;
begin
  select * into item from app_private.workout_checkins
  where workout_checkin_id = requested_checkin_id for update;
  if viewer.membership_id is null or not exists (
    select 1 from app_private.proof_decision_audience
    where workout_checkin_id = requested_checkin_id and membership_id = viewer.membership_id
  ) then
    raise exception 'vote unavailable' using errcode = '42501';
  end if;
  if item.review_status <> 'questioned'
     or requested_at >= item.questioned_at + interval '48 hours' then
    raise exception 'decision closed' using errcode = 'P0002';
  end if;
  insert into app_private.proof_votes (workout_checkin_id, membership_id, vote, voted_at)
  values (requested_checkin_id, viewer.membership_id, requested_vote, requested_at)
  on conflict (workout_checkin_id, membership_id)
    do update set vote = excluded.vote, voted_at = excluded.voted_at;
  return app_private.resolve_proof_decision(requested_checkin_id, requested_at);
end;
$$;

create or replace function app_private.withdraw_proof_checkin(
  requested_checkin_id uuid, requested_at timestamptz
) returns app_private.proof_review_status
language plpgsql security definer set search_path = '' as $$
declare viewer app_private.memberships := app_private.actor_current_membership();
begin
  update app_private.workout_checkins
  set review_status = 'unsupported', decided_at = requested_at
  where workout_checkin_id = requested_checkin_id and membership_id = viewer.membership_id
    and review_status = 'questioned';
  if not found then
    raise exception 'withdraw unavailable' using errcode = '42501';
  end if;
  return 'unsupported';
end;
$$;

-- A Content report hides the pair from members immediately; a Group admin restores or removes it.
create or replace function app_private.report_proof_checkin(
  requested_checkin_id uuid, requested_at timestamptz
) returns boolean
language plpgsql security definer set search_path = '' as $$
declare
  viewer app_private.memberships := app_private.actor_current_membership();
  author app_private.memberships%rowtype;
begin
  select m.* into author from app_private.workout_checkins c
  join app_private.memberships m on m.membership_id = c.membership_id
  where c.workout_checkin_id = requested_checkin_id and c.removed_at is null
    and c.media_deleted_at is null and c.activity_photo_path is not null;
  if viewer.membership_id is null or author.membership_id is null
     or author.group_id <> viewer.group_id or author.membership_id = viewer.membership_id then
    raise exception 'report unavailable' using errcode = '42501';
  end if;
  insert into app_private.proof_reports (workout_checkin_id, membership_id, reported_at)
  values (requested_checkin_id, viewer.membership_id, requested_at)
  on conflict do nothing;
  update app_private.workout_checkins set hidden_at = coalesce(hidden_at, requested_at)
  where workout_checkin_id = requested_checkin_id;
  return true;
end;
$$;

create or replace function app_private.moderate_proof_checkin(
  requested_checkin_id uuid, requested_action text, requested_at timestamptz
) returns boolean
language plpgsql security definer set search_path = '' as $$
declare viewer app_private.memberships := app_private.actor_current_membership();
begin
  if viewer.membership_id is null
     or not exists (select 1 from app_private.group_admins where membership_id = viewer.membership_id)
     or not exists (
       select 1 from app_private.workout_checkins c
       join app_private.memberships m on m.membership_id = c.membership_id
       where c.workout_checkin_id = requested_checkin_id and m.group_id = viewer.group_id
         and c.hidden_at is not null and c.removed_at is null
     ) then
    raise exception 'moderation unavailable' using errcode = '42501';
  end if;
  if requested_action = 'restore' then
    update app_private.workout_checkins set hidden_at = null
    where workout_checkin_id = requested_checkin_id;
    delete from app_private.proof_reports where workout_checkin_id = requested_checkin_id;
  elsif requested_action = 'remove' then
    update app_private.workout_checkins set removed_at = requested_at
    where workout_checkin_id = requested_checkin_id;
  else
    raise exception 'unknown moderation action' using errcode = '22023';
  end if;
  return true;
end;
$$;

create or replace function app_private.advance_proof_reviews(requested_at timestamptz)
returns integer
language plpgsql security definer set search_path = '' as $$
declare changed integer; item record;
begin
  update app_private.workout_checkins
  set review_status = 'verified', verified_at = submitted_at + interval '24 hours',
    decided_at = submitted_at + interval '24 hours'
  where review_status = 'pending' and requested_at >= submitted_at + interval '24 hours';
  get diagnostics changed = row_count;
  for item in
    select workout_checkin_id from app_private.workout_checkins
    where review_status = 'questioned'
  loop
    if app_private.resolve_proof_decision(item.workout_checkin_id, requested_at)
       <> 'questioned' then
      changed := changed + 1;
    end if;
  end loop;
  return changed;
end;
$$;

-- Wall and review queue for the caller's Group, newest first.
create or replace function app_private.proof_feed(requested_at timestamptz)
returns table (
  workout_checkin_id uuid,
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
  presence_photo_path text
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
  select c.workout_checkin_id,
    coalesce(a.display_name, 'Member ' || left(m.membership_id::text, 8)),
    m.membership_id = viewer.membership_id,
    c.activity_type::text, c.duration_minutes, c.perceived_intensity::text,
    c.completed_at, c.submitted_at, c.review_status::text,
    case when c.review_status = 'pending' then c.submitted_at + interval '24 hours' end,
    case when c.review_status = 'questioned' then c.questioned_at + interval '48 hours' end,
    c.hidden_at is not null,
    v.vote::text,
    (select count(*)::integer from app_private.proof_votes pv
     where pv.workout_checkin_id = c.workout_checkin_id and pv.vote = 'accept'),
    (select count(*)::integer from app_private.proof_votes pv
     where pv.workout_checkin_id = c.workout_checkin_id and pv.vote = 'reject'),
    (select count(*)::integer from app_private.proof_decision_audience pa
     join app_private.memberships am on am.membership_id = pa.membership_id and am.ended_at is null
     where pa.workout_checkin_id = c.workout_checkin_id),
    c.review_status = 'pending' and m.membership_id <> viewer.membership_id
      and c.hidden_at is null and viewer.joined_at <= c.submitted_at
      and requested_at < c.submitted_at + interval '24 hours',
    c.review_status = 'questioned' and c.hidden_at is null
      and requested_at < c.questioned_at + interval '48 hours'
      and exists (select 1 from app_private.proof_decision_audience pa
        where pa.workout_checkin_id = c.workout_checkin_id
          and pa.membership_id = viewer.membership_id),
    c.activity_photo_path, c.presence_photo_path
  from app_private.workout_checkins c
  join app_private.memberships m on m.membership_id = c.membership_id
  join app_private.accounts a on a.account_id = m.account_id
  left join app_private.proof_votes v
    on v.workout_checkin_id = c.workout_checkin_id and v.membership_id = viewer.membership_id
  where m.group_id = viewer.group_id and m.ended_at is null
    and c.activity_photo_path is not null and c.removed_at is null and c.media_deleted_at is null
    and (c.hidden_at is null or admin or m.membership_id = viewer.membership_id)
    and (
      (c.review_status in ('pending', 'questioned')
        and (viewer.joined_at <= c.submitted_at or m.membership_id = viewer.membership_id))
      or (c.review_status = 'verified' and requested_at < c.verified_at + interval '90 days')
    )
  order by c.submitted_at desc
  limit 100;
end;
$$;

-- Media whose retention has ended; the API deletes the objects then marks them deleted.
create or replace function app_private.proof_media_due(requested_at timestamptz)
returns table (path text)
language sql stable security definer set search_path = '' as $$
  select p.path from app_private.workout_checkins c
  join app_private.memberships m on m.membership_id = c.membership_id
  join app_private.accounts a on a.account_id = m.account_id
  cross join lateral (values (c.activity_photo_path), (c.presence_photo_path)) p(path)
  where c.activity_photo_path is not null and c.media_deleted_at is null
    and (c.review_status in ('unsupported', 'rejected') or c.removed_at is not null
      or m.ended_at is not null or a.status <> 'active'
      or (c.review_status = 'verified' and requested_at >= c.verified_at + interval '90 days'))
  union
  select u.path from app_private.proof_uploads u
  where u.deleted_at is null and u.used_at is null
    and requested_at >= u.created_at + interval '1 day'
  limit 200;
$$;

create or replace function app_private.mark_proof_media_deleted(
  requested_paths text[], requested_at timestamptz
) returns integer
language plpgsql security definer set search_path = '' as $$
declare changed integer;
begin
  update app_private.proof_uploads set deleted_at = requested_at
  where path = any(requested_paths) and deleted_at is null;
  update app_private.workout_checkins set media_deleted_at = requested_at
  where media_deleted_at is null
    and (activity_photo_path = any(requested_paths) or presence_photo_path = any(requested_paths));
  get diagnostics changed = row_count;
  return changed;
end;
$$;

-- Only Verified completions count; a week waits for its open reviews (at most 72 hours).
create or replace function app_private.finalize_ended_member_weeks(
  requested_at timestamptz
) returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare finalized_count integer; missed_item record; completed_count integer;
begin
  perform app_private.advance_proof_reviews(requested_at);
  finalized_count := 0;
  for missed_item in
    select mw.member_week_id, mw.membership_id, m.account_id, mw.target
    from app_private.member_weeks mw
    join app_private.memberships m on m.membership_id = mw.membership_id
    join app_private.accountability_weeks aw using (accountability_week_id)
    where mw.status = 'active' and m.ended_at is null and requested_at >= aw.ends_at
      and not exists (
        select 1 from app_private.workout_checkins open_review
        where open_review.member_week_id = mw.member_week_id
          and open_review.review_status in ('pending', 'questioned')
      )
      and not exists (
        select 1
        from app_private.member_weeks earlier_mw
        join app_private.accountability_weeks earlier_aw using (accountability_week_id)
        where earlier_mw.membership_id = mw.membership_id
          and earlier_mw.status = 'active'
          and earlier_aw.ends_at <= requested_at
          and (earlier_aw.ends_at, earlier_mw.member_week_id)
            < (aw.ends_at, mw.member_week_id)
      )
    order by aw.ends_at, mw.member_week_id
    for update of mw skip locked
  loop
    select count(*)::integer into completed_count from app_private.workout_checkins
      where member_week_id = missed_item.member_week_id and review_status = 'verified';
    if completed_count >= missed_item.target then
      update app_private.member_weeks set status = 'attained'
        where member_week_id = missed_item.member_week_id and status = 'active';
      update app_private.memberships set target_streak = target_streak + 1
        where membership_id = missed_item.membership_id;
      if (select target_streak from app_private.memberships
          where membership_id = missed_item.membership_id) in (1, 2, 4, 8) then
        perform app_private.award_card_unlock(
          gen_random_uuid(), missed_item.account_id,
          (select target_streak from app_private.memberships
           where membership_id = missed_item.membership_id),
          missed_item.member_week_id::text, requested_at
        );
      end if;
    else
      update app_private.member_weeks set status = 'missed'
        where member_week_id = missed_item.member_week_id and status = 'active';
      update app_private.memberships set target_streak = 0
        where membership_id = missed_item.membership_id;
      perform app_private.add_consequence_obligation(
        md5('missed_target:' || missed_item.member_week_id::text)::uuid,
        missed_item.membership_id, 'missed_target', missed_item.member_week_id, requested_at
      );
    end if;
    finalized_count := finalized_count + 1;
  end loop;
  return finalized_count;
end;
$$;

-- Progress counts reports still in review; Unsupported and Rejected reports drop out.
drop function app_private.current_week_progress(uuid, timestamptz);
create function app_private.current_week_progress(
  requested_group_id uuid,
  requested_at timestamptz
) returns table (
  membership_id uuid,
  display_name text,
  locked_target integer,
  completed_workout_count integer,
  activity_types text[]
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not app_private.is_current_member(requested_group_id) then
    raise exception 'current Group membership required' using errcode = '42501';
  end if;
  return query
  select m.membership_id,
    coalesce(a.display_name, 'Member ' || left(m.membership_id::text, 8)),
    mw.target, count(wc.workout_checkin_id)::integer,
    coalesce(
      array_agg(wc.activity_type::text order by wc.completed_at, wc.workout_checkin_id)
        filter (where wc.workout_checkin_id is not null),
      array[]::text[]
    )
  from app_private.memberships m
  join app_private.accounts a on a.account_id = m.account_id
  join app_private.member_weeks mw on mw.membership_id = m.membership_id
  join app_private.accountability_weeks aw
    on aw.accountability_week_id = mw.accountability_week_id
  left join app_private.workout_checkins wc on wc.member_week_id = mw.member_week_id
    and wc.review_status not in ('unsupported', 'rejected')
  where m.group_id = requested_group_id
    and m.ended_at is null
    and requested_at >= aw.starts_at and requested_at < aw.ends_at
  group by m.membership_id, a.display_name, mw.target
  order by m.membership_id;
end;
$$;

drop function app_private.finalized_weekly_history(uuid);
create function app_private.finalized_weekly_history(
  requested_group_id uuid
) returns table (
  membership_id uuid,
  display_name text,
  starts_at timestamptz,
  ends_at timestamptz,
  locked_target integer,
  completed_workout_count integer,
  outcome app_private.member_week_status
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  viewer_joined_at timestamptz;
begin
  select m.joined_at into viewer_joined_at
  from app_private.memberships m
  where m.account_id = app_private.actor_account_id()
    and m.group_id = requested_group_id
    and m.ended_at is null;
  if viewer_joined_at is null then
    raise exception 'current Group membership required' using errcode = '42501';
  end if;

  return query
  select m.membership_id,
    case when a.status = 'deleted' then 'Former member'
      else coalesce(a.display_name, 'Member ' || left(m.membership_id::text, 8)) end,
    aw.starts_at, aw.ends_at, mw.target,
    count(wc.workout_checkin_id)::integer, mw.status
  from app_private.memberships m
  join app_private.accounts a on a.account_id = m.account_id
  join app_private.member_weeks mw on mw.membership_id = m.membership_id
  join app_private.accountability_weeks aw
    on aw.accountability_week_id = mw.accountability_week_id
  left join app_private.workout_checkins wc on wc.member_week_id = mw.member_week_id
    and wc.review_status = 'verified'
  where m.group_id = requested_group_id
    and mw.status in ('attained', 'missed')
    and aw.ends_at > viewer_joined_at
  group by m.membership_id, a.status, a.display_name, aw.starts_at, aw.ends_at, mw.target, mw.status
  order by aw.ends_at desc, m.membership_id;
end;
$$;

create or replace function app_private.push_recipients()
returns table (account_id uuid, since timestamptz)
language sql stable security definer set search_path = '' as $$
  select ps.account_id, min(ps.created_at)
  from app_private.web_push_subscriptions ps
  join app_private.accounts a on a.account_id = ps.account_id and a.status = 'active'
  group by ps.account_id;
$$;

-- Push: peers are asked to review; voters hear about a Group decision; authors hear outcomes.
create or replace function app_private.enqueue_push_notifications(requested_at timestamptz)
returns integer
language plpgsql security definer set search_path = '' as $$
declare enqueued integer := 0; added integer;
begin

  insert into app_private.web_push_outbox (account_id, dedupe_key, title, body)
  select recipient.account_id,
    'workout:' || wc.workout_checkin_id || ':' || recipient.account_id,
    coalesce(author_account.display_name, 'A Group member') || ' logged a workout',
    case when wc.activity_photo_path is null
      then (select count(*) from app_private.workout_checkins c
            where c.member_week_id = wc.member_week_id)
        || ' of ' || mw.target || ' this week. Your move.'
      else 'Check the proof and verify it on the Wall.' end
  from app_private.workout_checkins wc
  join app_private.member_weeks mw on mw.member_week_id = wc.member_week_id
  join app_private.memberships author on author.membership_id = wc.membership_id
  join app_private.accounts author_account on author_account.account_id = author.account_id
  join app_private.memberships peer on peer.group_id = author.group_id
    and peer.ended_at is null and peer.membership_id <> author.membership_id
    and peer.joined_at <= wc.submitted_at
  join app_private.push_recipients() recipient on recipient.account_id = peer.account_id
  where wc.submitted_at > requested_at - interval '1 day'
    and wc.submitted_at >= recipient.since
  on conflict (dedupe_key) do nothing;
  get diagnostics added = row_count;
  enqueued := enqueued + added;

  insert into app_private.web_push_outbox (account_id, dedupe_key, title, body)
  select recipient.account_id,
    'questioned:' || wc.workout_checkin_id || ':' || recipient.account_id,
    coalesce(author_account.display_name, 'A Group member') || '''s workout was questioned',
    'Vote within 48 hours: accept or reject the proof.'
  from app_private.workout_checkins wc
  join app_private.memberships author on author.membership_id = wc.membership_id
  join app_private.accounts author_account on author_account.account_id = author.account_id
  join app_private.proof_decision_audience pa on pa.workout_checkin_id = wc.workout_checkin_id
  join app_private.memberships voter on voter.membership_id = pa.membership_id
    and voter.ended_at is null
  join app_private.push_recipients() recipient on recipient.account_id = voter.account_id
  where wc.review_status = 'questioned' and wc.questioned_at >= recipient.since
  on conflict (dedupe_key) do nothing;
  get diagnostics added = row_count;
  enqueued := enqueued + added;

  insert into app_private.web_push_outbox (account_id, dedupe_key, title, body)
  select recipient.account_id,
    'proof-outcome:' || wc.workout_checkin_id,
    case wc.review_status
      when 'questioned' then 'Your workout was questioned'
      when 'rejected' then 'Your workout was rejected'
      else 'Your workout did not count' end,
    case wc.review_status
      when 'questioned' then 'Your Group is voting on your proof.'
      when 'rejected' then 'It does not count, and you owe a Consequence card.'
      else 'The Group decision ended without accepting it.' end
  from app_private.workout_checkins wc
  join app_private.memberships author on author.membership_id = wc.membership_id
    and author.ended_at is null
  join app_private.push_recipients() recipient on recipient.account_id = author.account_id
  where wc.review_status in ('questioned', 'rejected', 'unsupported')
    and coalesce(wc.decided_at, wc.questioned_at) > requested_at - interval '1 day'
    and coalesce(wc.decided_at, wc.questioned_at) >= recipient.since
  on conflict (dedupe_key) do update
    set title = excluded.title, body = excluded.body, sent_at = null
    where app_private.web_push_outbox.title <> excluded.title;
  get diagnostics added = row_count;
  enqueued := enqueued + added;

  insert into app_private.web_push_outbox (account_id, dedupe_key, title, body)
  select m.account_id, 'reminder:' || mw.member_week_id, 'Less than 24 hours left',
    'You have ' || done.count || ' of ' || mw.target || ' workouts. No excuses.'
  from app_private.member_weeks mw
  join app_private.accountability_weeks aw on aw.accountability_week_id = mw.accountability_week_id
  join app_private.memberships m on m.membership_id = mw.membership_id and m.ended_at is null
  join app_private.push_recipients() s on s.account_id = m.account_id
  cross join lateral (
    select count(*)::integer as count from app_private.workout_checkins c
    where c.member_week_id = mw.member_week_id
      and c.review_status not in ('unsupported', 'rejected')
  ) done
  where mw.status = 'active'
    and requested_at >= aw.ends_at - interval '24 hours' and requested_at < aw.ends_at
    and done.count < mw.target
  on conflict (dedupe_key) do nothing;
  get diagnostics added = row_count;
  enqueued := enqueued + added;

  insert into app_private.web_push_outbox (account_id, dedupe_key, title, body)
  select m.account_id, 'result:' || mw.member_week_id,
    case when mw.status = 'attained' then 'Week Met' else 'Week Missed' end,
    case when mw.status = 'attained' then 'Target hit. Keep it going.'
      else 'Target missed. Your Group can see it.' end
  from app_private.member_weeks mw
  join app_private.accountability_weeks aw on aw.accountability_week_id = mw.accountability_week_id
  join app_private.memberships m on m.membership_id = mw.membership_id and m.ended_at is null
  join app_private.push_recipients() s on s.account_id = m.account_id
  where mw.status in ('attained', 'missed')
    and aw.ends_at > requested_at - interval '5 days' and aw.ends_at >= s.since
  on conflict (dedupe_key) do nothing;
  get diagnostics added = row_count;
  return enqueued + added;
end;
$$;

alter table app_private.proof_uploads enable row level security;
alter table app_private.proof_decision_audience enable row level security;
alter table app_private.proof_votes enable row level security;
alter table app_private.proof_reports enable row level security;
revoke all on table app_private.proof_uploads, app_private.proof_decision_audience,
  app_private.proof_votes, app_private.proof_reports from public, anon, authenticated;
revoke all on function app_private.push_recipients() from public, anon, authenticated;
revoke all on function app_private.actor_current_membership(),
  app_private.create_proof_upload(text, timestamptz),
  app_private.submit_proof_checkin(uuid, text, uuid, uuid, app_private.workout_activity_type,
    timestamptz, integer, app_private.perceived_intensity, boolean, text, text, boolean, timestamptz),
  app_private.resolve_proof_decision(uuid, timestamptz),
  app_private.review_proof_checkin(uuid, text, timestamptz),
  app_private.vote_proof_checkin(uuid, app_private.proof_vote, timestamptz),
  app_private.withdraw_proof_checkin(uuid, timestamptz),
  app_private.report_proof_checkin(uuid, timestamptz),
  app_private.moderate_proof_checkin(uuid, text, timestamptz),
  app_private.advance_proof_reviews(timestamptz),
  app_private.proof_feed(timestamptz),
  app_private.proof_media_due(timestamptz),
  app_private.mark_proof_media_deleted(text[], timestamptz),
  app_private.current_week_progress(uuid, timestamptz),
  app_private.finalized_weekly_history(uuid)
  from public, anon, authenticated;
grant select, insert, update, delete on table app_private.proof_uploads,
  app_private.proof_decision_audience, app_private.proof_votes, app_private.proof_reports
  to service_role;
grant update on table app_private.workout_checkins to service_role;
grant execute on function app_private.actor_current_membership(),
  app_private.create_proof_upload(text, timestamptz),
  app_private.submit_proof_checkin(uuid, text, uuid, uuid, app_private.workout_activity_type,
    timestamptz, integer, app_private.perceived_intensity, boolean, text, text, boolean, timestamptz),
  app_private.resolve_proof_decision(uuid, timestamptz),
  app_private.review_proof_checkin(uuid, text, timestamptz),
  app_private.vote_proof_checkin(uuid, app_private.proof_vote, timestamptz),
  app_private.withdraw_proof_checkin(uuid, timestamptz),
  app_private.report_proof_checkin(uuid, timestamptz),
  app_private.moderate_proof_checkin(uuid, text, timestamptz),
  app_private.advance_proof_reviews(timestamptz),
  app_private.proof_feed(timestamptz),
  app_private.proof_media_due(timestamptz),
  app_private.mark_proof_media_deleted(text[], timestamptz)
  to service_role;
grant execute on function app_private.current_week_progress(uuid, timestamptz),
  app_private.finalized_weekly_history(uuid)
  to authenticated, service_role;

insert into app_private.schema_versions (version) values (19);
