-- Consequence gate (owner-approved 2026-10-15).
-- Members who owe a card cannot log workouts until they submit proof for it. Members can no
-- longer self-pause a card; they request a pause and other Group members approve it first.

-- True while the member owes a card that has neither proof under review nor an approved pause.
create or replace function app_private.consequence_logging_blocked(requested_membership_id uuid)
returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from app_private.consequence_obligations
    where membership_id = requested_membership_id and status = 'open'
  ) and not exists (
    select 1 from app_private.consequence_attempts a
    join app_private.consequence_obligations o on o.obligation_id = a.obligation_id
    where o.membership_id = requested_membership_id and a.status in ('review', 'safety_paused')
  );
$$;

create or replace function app_private.enforce_consequence_log_gate()
returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if app_private.consequence_logging_blocked(new.membership_id) then
    raise exception 'finish your Consequence card before logging workouts' using errcode = '42501';
  end if;
  return new;
end;
$$;

create trigger workout_checkins_consequence_gate
  before insert on app_private.workout_checkins
  for each row execute function app_private.enforce_consequence_log_gate();

create table app_private.consequence_pause_requests (
  pause_request_id uuid primary key,
  attempt_id uuid not null references app_private.consequence_attempts(attempt_id) on delete restrict,
  approvals_needed integer not null check (approvals_needed > 0),
  requested_at timestamptz not null,
  status text not null default 'pending' check (status in ('pending', 'approved', 'denied')),
  resolved_at timestamptz,
  check ((status = 'pending') = (resolved_at is null))
);

create unique index consequence_pause_requests_one_pending
  on app_private.consequence_pause_requests (attempt_id) where status = 'pending';

create table app_private.consequence_pause_votes (
  pause_request_id uuid not null
    references app_private.consequence_pause_requests(pause_request_id) on delete restrict,
  membership_id uuid not null references app_private.memberships(membership_id) on delete restrict,
  approve boolean not null,
  voted_at timestamptz not null,
  primary key (pause_request_id, membership_id)
);

revoke all on table app_private.consequence_pause_requests, app_private.consequence_pause_votes
  from public, anon, authenticated;
grant select, insert, update on table app_private.consequence_pause_requests,
  app_private.consequence_pause_votes to service_role;

-- Previous home and command bodies stay as the base; the wrappers below extend them.
alter function app_private.consequence_home(timestamptz) rename to consequence_home_base;
alter function app_private.consequence_command(text, uuid, text, timestamptz)
  rename to consequence_command_base;

create or replace function app_private.consequence_home(requested_at timestamptz)
returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  viewer app_private.memberships := app_private.actor_current_membership();
  result jsonb := app_private.consequence_home_base(requested_at);
  pending app_private.consequence_pause_requests%rowtype;
begin
  if result->'attempt' is not null and result->'attempt' <> 'null'::jsonb then
    select * into pending from app_private.consequence_pause_requests
    where attempt_id = (result->'attempt'->>'attemptId')::uuid and status = 'pending';
    result := jsonb_set(result, '{attempt,pauseRequest}', case
      when pending.pause_request_id is null then 'null'::jsonb
      else jsonb_build_object(
        'approvals', (select count(*) from app_private.consequence_pause_votes v
          where v.pause_request_id = pending.pause_request_id and v.approve),
        'rejections', (select count(*) from app_private.consequence_pause_votes v
          where v.pause_request_id = pending.pause_request_id and not v.approve),
        'approvalsNeeded', pending.approvals_needed)
      end);
  end if;
  return result || jsonb_build_object(
    'logBlocked', app_private.consequence_logging_blocked(viewer.membership_id),
    'pauseReviews', coalesce((select jsonb_agg(jsonb_build_object(
        'pauseRequestId', pr.pause_request_id,
        'memberName', coalesce(acc.display_name, 'Member ' || left(owner.membership_id::text, 8)),
        'title', card.title,
        'myVote', case when vote.approve is null then null
          when vote.approve then 'approve' else 'reject' end) order by pr.requested_at)
      from app_private.consequence_pause_requests pr
      join app_private.consequence_attempts att
        on att.attempt_id = pr.attempt_id and att.status = 'active'
      join app_private.consequence_cards card on card.card_id = att.card_id
      join app_private.consequence_obligations ob on ob.obligation_id = att.obligation_id
      join app_private.memberships owner on owner.membership_id = ob.membership_id
      join app_private.accounts acc on acc.account_id = owner.account_id
      left join app_private.consequence_pause_votes vote
        on vote.pause_request_id = pr.pause_request_id and vote.membership_id = viewer.membership_id
      where pr.status = 'pending' and owner.group_id = viewer.group_id
        and owner.membership_id <> viewer.membership_id), '[]'::jsonb)
  );
end;
$$;

create or replace function app_private.consequence_command(
  requested_action text, requested_target uuid, requested_choice text, requested_at timestamptz
) returns jsonb
language plpgsql security definer set search_path = '' as $$
#variable_conflict use_variable
declare
  viewer app_private.memberships := app_private.actor_current_membership();
  request app_private.consequence_pause_requests%rowtype;
  owner app_private.memberships%rowtype;
  others integer;
begin
  if viewer.membership_id is null then
    raise exception 'current Group membership required' using errcode = '42501';
  end if;
  if requested_action = 'pause' then
    -- Pausing now needs Group approval; see request_pause.
    raise exception 'Consequence action unavailable' using errcode = '42501';
  elsif requested_action = 'request_pause' then
    select o.* into owner from app_private.consequence_attempts a
    join app_private.consequence_obligations ob on ob.obligation_id = a.obligation_id
    join app_private.memberships o on o.membership_id = ob.membership_id
    where a.attempt_id = requested_target and a.status = 'active';
    if owner.membership_id is distinct from viewer.membership_id then
      raise exception 'Consequence action unavailable' using errcode = '42501';
    end if;
    select count(*) into others from app_private.memberships
    where group_id = owner.group_id and ended_at is null and membership_id <> owner.membership_id;
    if others = 0 then
      raise exception 'Consequence action unavailable' using errcode = '42501';
    end if;
    insert into app_private.consequence_pause_requests
      (pause_request_id, attempt_id, approvals_needed, requested_at)
    values (gen_random_uuid(), requested_target, least(2, others), requested_at);
  elsif requested_action = 'vote_pause' then
    if requested_choice not in ('approve', 'reject') then
      raise exception 'Consequence action unavailable' using errcode = '42501';
    end if;
    select pr.* into request from app_private.consequence_pause_requests pr
    join app_private.consequence_attempts a on a.attempt_id = pr.attempt_id and a.status = 'active'
    where pr.pause_request_id = requested_target and pr.status = 'pending'
    for update of pr;
    select o.* into owner from app_private.consequence_attempts a
    join app_private.consequence_obligations ob on ob.obligation_id = a.obligation_id
    join app_private.memberships o on o.membership_id = ob.membership_id
    where a.attempt_id = request.attempt_id;
    if request.pause_request_id is null or owner.group_id <> viewer.group_id
      or owner.membership_id = viewer.membership_id then
      raise exception 'Consequence action unavailable' using errcode = '42501';
    end if;
    insert into app_private.consequence_pause_votes
      (pause_request_id, membership_id, approve, voted_at)
    values (request.pause_request_id, viewer.membership_id, requested_choice = 'approve',
      requested_at);
    if (select count(*) from app_private.consequence_pause_votes
        where pause_request_id = request.pause_request_id and approve) >= request.approvals_needed then
      update app_private.consequence_pause_requests set status = 'approved', resolved_at = requested_at
      where pause_request_id = request.pause_request_id;
      perform app_private.pause_consequence_for_safety(
        gen_random_uuid(), request.attempt_id, requested_at);
    elsif (select count(*) from app_private.consequence_pause_votes
        where pause_request_id = request.pause_request_id and not approve) >= request.approvals_needed then
      update app_private.consequence_pause_requests set status = 'denied', resolved_at = requested_at
      where pause_request_id = request.pause_request_id;
    end if;
  else
    perform app_private.consequence_command_base(
      requested_action, requested_target, requested_choice, requested_at);
  end if;
  return app_private.consequence_home(requested_at);
end;
$$;

revoke all on function app_private.consequence_logging_blocked(uuid),
  app_private.enforce_consequence_log_gate(),
  app_private.consequence_home(timestamptz),
  app_private.consequence_command(text, uuid, text, timestamptz),
  app_private.consequence_home_base(timestamptz),
  app_private.consequence_command_base(text, uuid, text, timestamptz)
  from public, anon, authenticated;
grant execute on function app_private.consequence_home(timestamptz),
  app_private.consequence_command(text, uuid, text, timestamptz)
  to service_role;

insert into app_private.schema_versions (version) values (21);
