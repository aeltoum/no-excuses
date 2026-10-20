-- Safety and member-written text (owner-approved 2026-10-20).
-- * Group conduct rules: a member accepts the current version before writing anything the
--   Group can read.
-- * Proof captions: one short factual caption per post, set by its author within an hour.
-- * Messages: short motivational messages on posts, pushed to the post's author.
-- * Safety block: stops reactions, messages, and nudges between two members both ways, and
--   hides their past Wall media and text from each other; posts still in review stay visible
--   so decisions are unaffected. It lasts until the blocker removes it or a membership ends.
-- * Reports: a member reports a message or another member's conduct. A reported message is
--   hidden at once. Reports and blocks open operator-only Moderation cases; the reported
--   member never learns who reported.
-- No automated screening.

alter table app_private.accounts add column conduct_version_accepted smallint;
alter table app_private.workout_checkins
  add column caption text,
  add constraint workout_checkins_caption check (caption is null or length(caption) between 1 and 140);

create table app_private.proof_messages (
  proof_message_id uuid primary key,
  workout_checkin_id uuid not null references app_private.workout_checkins(workout_checkin_id) on delete cascade,
  membership_id uuid not null references app_private.memberships(membership_id) on delete cascade,
  body text not null check (length(body) between 1 and 200),
  created_at timestamptz not null,
  hidden_at timestamptz,
  pushed_at timestamptz
);
create index proof_messages_checkin on app_private.proof_messages (workout_checkin_id, created_at);

create table app_private.safety_blocks (
  blocker_membership_id uuid not null references app_private.memberships(membership_id) on delete cascade,
  blocked_membership_id uuid not null references app_private.memberships(membership_id) on delete cascade,
  created_at timestamptz not null,
  primary key (blocker_membership_id, blocked_membership_id),
  constraint safety_blocks_not_self check (blocker_membership_id <> blocked_membership_id)
);

create table app_private.moderation_cases (
  moderation_case_id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('message_report', 'member_report', 'safety_block', 'proof_report')),
  group_id uuid not null references app_private.groups(group_id) on delete cascade,
  reporter_account_id uuid references app_private.accounts(account_id) on delete set null,
  subject_account_id uuid references app_private.accounts(account_id) on delete set null,
  proof_message_id uuid references app_private.proof_messages(proof_message_id) on delete set null,
  workout_checkin_id uuid references app_private.workout_checkins(workout_checkin_id) on delete set null,
  category text check (category in (
    'sexual_content', 'harassment', 'threats', 'private_information', 'dangerous', 'other')),
  status text not null default 'open' check (status in ('open', 'actioned', 'dismissed')),
  outcome text,
  created_at timestamptz not null,
  resolved_at timestamptz
);
create index moderation_cases_open on app_private.moderation_cases (created_at) where status = 'open';

-- Current Group conduct rules version; raising it asks every member to accept again.
create or replace function app_private.conduct_version()
returns smallint language sql immutable set search_path = '' as $$ select 1::smallint $$;

create or replace function app_private.require_conduct()
returns app_private.memberships
language plpgsql stable security definer set search_path = '' as $$
declare viewer app_private.memberships := app_private.actor_current_membership();
begin
  if viewer.membership_id is null then
    raise exception 'current Group membership required' using errcode = '42501';
  end if;
  if coalesce((select conduct_version_accepted from app_private.accounts
      where account_id = viewer.account_id), 0) < app_private.conduct_version() then
    raise exception 'Group conduct rules not accepted' using errcode = '42501', hint = 'conduct';
  end if;
  return viewer;
end;
$$;

create or replace function app_private.accept_conduct()
returns smallint
language sql security definer set search_path = '' as $$
  update app_private.accounts set conduct_version_accepted = app_private.conduct_version()
  where account_id = app_private.actor_account_id()
  returning conduct_version_accepted;
$$;

-- Members the viewer blocked or was blocked by, within the viewer's Group.
create or replace function app_private.block_peers(requested_membership_id uuid)
returns setof uuid
language sql stable security definer set search_path = '' as $$
  select blocked_membership_id from app_private.safety_blocks
  where blocker_membership_id = requested_membership_id
  union
  select blocker_membership_id from app_private.safety_blocks
  where blocked_membership_id = requested_membership_id;
$$;

create or replace function app_private.blocked_between(left_id uuid, right_id uuid)
returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from app_private.safety_blocks
    where (blocker_membership_id = left_id and blocked_membership_id = right_id)
       or (blocker_membership_id = right_id and blocked_membership_id = left_id)
  );
$$;

-- Reactions and nudges never cross a Safety block.
create or replace function app_private.enforce_safety_block()
returns trigger language plpgsql security definer set search_path = '' as $$
declare sender uuid; recipient uuid;
begin
  if tg_table_name = 'nudges' then
    sender := new.from_membership_id;
    recipient := new.to_membership_id;
  else
    sender := new.membership_id;
    select membership_id into recipient from app_private.workout_checkins
    where workout_checkin_id = new.workout_checkin_id;
  end if;
  if app_private.blocked_between(sender, recipient) then
    raise exception 'blocked' using errcode = '42501';
  end if;
  return new;
end;
$$;
create trigger proof_reactions_safety_block before insert on app_private.proof_reactions
  for each row execute function app_private.enforce_safety_block();
create trigger nudges_safety_block before insert on app_private.nudges
  for each row execute function app_private.enforce_safety_block();
create trigger proof_messages_safety_block before insert on app_private.proof_messages
  for each row execute function app_private.enforce_safety_block();

create or replace function app_private.set_checkin_caption(
  requested_checkin_id uuid, requested_caption text, requested_at timestamptz
) returns text
language plpgsql security definer set search_path = '' as $$
declare
  viewer app_private.memberships := app_private.require_conduct();
  cleaned text := btrim(coalesce(requested_caption, ''));
  item app_private.workout_checkins%rowtype;
begin
  if length(cleaned) not between 1 and 140 then
    raise exception 'caption must be 1 to 140 characters' using errcode = '22023';
  end if;
  select * into item from app_private.workout_checkins
  where workout_checkin_id = requested_checkin_id and membership_id = viewer.membership_id
  for update;
  if item.workout_checkin_id is null or requested_at >= item.submitted_at + interval '1 hour' then
    raise exception 'caption unavailable' using errcode = '42501';
  end if;
  if item.caption is not null then
    if item.caption = cleaned then return cleaned; end if;
    raise exception 'caption already set' using errcode = '23505';
  end if;
  update app_private.workout_checkins set caption = cleaned
  where workout_checkin_id = requested_checkin_id;
  return cleaned;
end;
$$;

create or replace function app_private.post_proof_message(
  requested_message_id uuid, requested_checkin_id uuid, requested_body text,
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
  if not exists (
    select 1 from app_private.workout_checkins c
    join app_private.memberships m on m.membership_id = c.membership_id
    where c.workout_checkin_id = requested_checkin_id and m.group_id = viewer.group_id
      and m.ended_at is null and c.hidden_at is null and c.removed_at is null
  ) then
    raise exception 'message unavailable' using errcode = '42501';
  end if;
  if (select count(*) from app_private.proof_messages
      where membership_id = viewer.membership_id
        and created_at > requested_at - interval '1 hour') >= 30 then
    raise exception 'message limit reached' using errcode = '42501';
  end if;
  insert into app_private.proof_messages
    (proof_message_id, workout_checkin_id, membership_id, body, created_at)
  values (requested_message_id, requested_checkin_id, viewer.membership_id, cleaned, requested_at)
  on conflict (proof_message_id) do nothing;
  return requested_message_id;
end;
$$;

-- Captions and messages the viewer may read, by post; blocked members' text is left out.
create or replace function app_private.proof_text(requested_at timestamptz)
returns table (workout_checkin_id uuid, caption text, messages jsonb)
language plpgsql stable security definer set search_path = '' as $$
declare viewer app_private.memberships := app_private.actor_current_membership();
begin
  return query
  select f.workout_checkin_id,
    case when f.author_membership_id in (select app_private.block_peers(viewer.membership_id))
      then null else c.caption end,
    coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', pm.proof_message_id, 'name', app_private.member_label(pm.membership_id),
        'mine', pm.membership_id = viewer.membership_id, 'body', pm.body, 'at', pm.created_at
      ) order by pm.created_at)
      from app_private.proof_messages pm
      join app_private.memberships author on author.membership_id = pm.membership_id
        and author.ended_at is null
      where pm.workout_checkin_id = f.workout_checkin_id and pm.hidden_at is null
        and pm.membership_id not in (select app_private.block_peers(viewer.membership_id))
    ), '[]'::jsonb)
  from app_private.proof_feed(requested_at) f
  join app_private.workout_checkins c on c.workout_checkin_id = f.workout_checkin_id;
end;
$$;

-- Wall posts hidden from the viewer by a Safety block (verified history only).
create or replace function app_private.block_hidden_posts(requested_at timestamptz)
returns setof uuid
language sql stable security definer set search_path = '' as $$
  select f.workout_checkin_id from app_private.proof_feed(requested_at) f
  where f.review_status = 'verified'
    and f.author_membership_id in (
      select app_private.block_peers((app_private.actor_current_membership()).membership_id));
$$;

create or replace function app_private.set_safety_block(
  requested_membership_id uuid, requested_on boolean, requested_at timestamptz
) returns boolean
language plpgsql security definer set search_path = '' as $$
declare
  viewer app_private.memberships := app_private.actor_current_membership();
  target app_private.memberships%rowtype;
begin
  select * into target from app_private.memberships
  where membership_id = requested_membership_id and group_id = viewer.group_id
    and ended_at is null and membership_id <> viewer.membership_id;
  if viewer.membership_id is null or target.membership_id is null then
    raise exception 'block unavailable' using errcode = '42501';
  end if;
  if not requested_on then
    delete from app_private.safety_blocks
    where blocker_membership_id = viewer.membership_id
      and blocked_membership_id = target.membership_id;
    return false;
  end if;
  insert into app_private.safety_blocks (blocker_membership_id, blocked_membership_id, created_at)
  values (viewer.membership_id, target.membership_id, requested_at)
  on conflict do nothing;
  if found then
    insert into app_private.moderation_cases
      (kind, group_id, reporter_account_id, subject_account_id, created_at)
    values ('safety_block', viewer.group_id, viewer.account_id, target.account_id, requested_at);
  end if;
  return true;
end;
$$;

create or replace function app_private.report_message(
  requested_message_id uuid, requested_category text, requested_at timestamptz
) returns boolean
language plpgsql security definer set search_path = '' as $$
declare
  viewer app_private.memberships := app_private.actor_current_membership();
  message record;
begin
  select pm.proof_message_id, m.account_id, m.membership_id, m.group_id into message
  from app_private.proof_messages pm
  join app_private.memberships m on m.membership_id = pm.membership_id
  where pm.proof_message_id = requested_message_id and m.group_id = viewer.group_id;
  if viewer.membership_id is null or message.proof_message_id is null
     or message.membership_id = viewer.membership_id then
    raise exception 'report unavailable' using errcode = '42501';
  end if;
  update app_private.proof_messages set hidden_at = coalesce(hidden_at, requested_at)
  where proof_message_id = requested_message_id;
  insert into app_private.moderation_cases
    (kind, group_id, reporter_account_id, subject_account_id, proof_message_id, category, created_at)
  values ('message_report', viewer.group_id, viewer.account_id, message.account_id,
    requested_message_id, requested_category, requested_at);
  return true;
end;
$$;

create or replace function app_private.report_member(
  requested_membership_id uuid, requested_category text, requested_at timestamptz
) returns boolean
language plpgsql security definer set search_path = '' as $$
declare
  viewer app_private.memberships := app_private.actor_current_membership();
  target app_private.memberships%rowtype;
begin
  select * into target from app_private.memberships
  where membership_id = requested_membership_id and group_id = viewer.group_id
    and membership_id <> viewer.membership_id;
  if viewer.membership_id is null or target.membership_id is null then
    raise exception 'report unavailable' using errcode = '42501';
  end if;
  if exists (select 1 from app_private.moderation_cases
      where kind = 'member_report' and reporter_account_id = viewer.account_id
        and subject_account_id = target.account_id and status = 'open') then
    return true;
  end if;
  insert into app_private.moderation_cases
    (kind, group_id, reporter_account_id, subject_account_id, category, created_at)
  values ('member_report', viewer.group_id, viewer.account_id, target.account_id,
    requested_category, requested_at);
  return true;
end;
$$;

-- Photo reports also reach the operator, not only the Group admin.
create or replace function app_private.open_proof_report_case()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into app_private.moderation_cases
    (kind, group_id, reporter_account_id, subject_account_id, workout_checkin_id, created_at)
  select 'proof_report', author.group_id, reporter.account_id, author.account_id,
    new.workout_checkin_id, new.reported_at
  from app_private.workout_checkins c
  join app_private.memberships author on author.membership_id = c.membership_id
  join app_private.memberships reporter on reporter.membership_id = new.membership_id
  where c.workout_checkin_id = new.workout_checkin_id;
  return new;
end;
$$;
create trigger proof_reports_case after insert on app_private.proof_reports
  for each row execute function app_private.open_proof_report_case();

-- Messages reach the post's author as an Immediate social push.
create or replace function app_private.enqueue_message_push(requested_at timestamptz)
returns integer
language plpgsql security definer set search_path = '' as $$
declare added integer;
begin
  with due as (
    update app_private.proof_messages pm set pushed_at = requested_at
    where pm.pushed_at is null and pm.hidden_at is null
    returning pm.proof_message_id, pm.workout_checkin_id, pm.membership_id, pm.body
  )
  insert into app_private.web_push_outbox (account_id, dedupe_key, title, body, created_at)
  select author.account_id, 'social:msg:' || due.proof_message_id,
    app_private.member_label(due.membership_id) || ' wrote on your workout',
    left(due.body, 120), requested_at
  from due
  join app_private.workout_checkins c on c.workout_checkin_id = due.workout_checkin_id
  join app_private.memberships author on author.membership_id = c.membership_id
    and author.ended_at is null and author.membership_id <> due.membership_id
  join app_private.push_recipients() s on s.account_id = author.account_id
  on conflict (dedupe_key) do nothing;
  get diagnostics added = row_count;
  return added;
end;
$$;

create or replace function app_private.home_safety(requested_at timestamptz)
returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'conductAccepted', coalesce(a.conduct_version_accepted, 0) >= app_private.conduct_version(),
    'blocked', coalesce((
      select jsonb_agg(b.blocked_membership_id) from app_private.safety_blocks b
      where b.blocker_membership_id = (app_private.actor_current_membership()).membership_id
    ), '[]'::jsonb)
  )
  from app_private.accounts a where a.account_id = app_private.actor_account_id();
$$;

create or replace function app_private.home_extras(requested_at timestamptz)
returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  return app_private.home_extras_exceptions(requested_at)
    || jsonb_build_object(
      'missed', app_private.home_missed(requested_at),
      'season', app_private.season_home(requested_at),
      'unlocks', app_private.home_unlocks(requested_at),
      'unreadNotifications', app_private.notification_unread(requested_at),
      'safety', app_private.home_safety(requested_at)
    );
end;
$$;

alter table app_private.proof_messages enable row level security;
alter table app_private.safety_blocks enable row level security;
alter table app_private.moderation_cases enable row level security;
revoke all on table app_private.proof_messages, app_private.safety_blocks,
  app_private.moderation_cases from public, anon, authenticated;
grant select, insert, update, delete on table app_private.proof_messages,
  app_private.safety_blocks, app_private.moderation_cases to service_role;
revoke all on function app_private.conduct_version(),
  app_private.require_conduct(),
  app_private.accept_conduct(),
  app_private.block_peers(uuid),
  app_private.blocked_between(uuid, uuid),
  app_private.enforce_safety_block(),
  app_private.set_checkin_caption(uuid, text, timestamptz),
  app_private.post_proof_message(uuid, uuid, text, timestamptz),
  app_private.proof_text(timestamptz),
  app_private.block_hidden_posts(timestamptz),
  app_private.set_safety_block(uuid, boolean, timestamptz),
  app_private.report_message(uuid, text, timestamptz),
  app_private.report_member(uuid, text, timestamptz),
  app_private.open_proof_report_case(),
  app_private.enqueue_message_push(timestamptz),
  app_private.home_safety(timestamptz),
  app_private.home_extras(timestamptz)
  from public, anon, authenticated;
grant execute on function app_private.conduct_version(),
  app_private.require_conduct(),
  app_private.accept_conduct(),
  app_private.block_peers(uuid),
  app_private.blocked_between(uuid, uuid),
  app_private.set_checkin_caption(uuid, text, timestamptz),
  app_private.post_proof_message(uuid, uuid, text, timestamptz),
  app_private.proof_text(timestamptz),
  app_private.block_hidden_posts(timestamptz),
  app_private.set_safety_block(uuid, boolean, timestamptz),
  app_private.report_message(uuid, text, timestamptz),
  app_private.report_member(uuid, text, timestamptz),
  app_private.enqueue_message_push(timestamptz),
  app_private.home_safety(timestamptz),
  app_private.home_extras(timestamptz)
  to service_role;

insert into app_private.schema_versions (version) values (39);
