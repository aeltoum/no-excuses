-- Consequence video proof (owner-approved 2026-10-19).
-- Every new Consequence claim carries a short clip recorded in the app. The server issues a
-- one-time challenge (a 3-digit code and a simple action) for the member's own active card.
-- The upload must be requested within 2 minutes of issue and the claim submitted within 10.
-- Clips attached to a claim stay for good; uploads never attached are cleaned up after 1 day.

alter table app_private.consequence_claims add column clip_path text;

create table app_private.consequence_challenges (
  challenge_id uuid primary key,
  attempt_id uuid not null references app_private.consequence_attempts(attempt_id) on delete cascade,
  account_id uuid not null references app_private.accounts(account_id) on delete cascade,
  code text not null check (code ~ '^[0-9]{3}$'),
  action text not null,
  issued_at timestamptz not null,
  expires_at timestamptz not null,
  replaced_at timestamptz,
  clip_path text unique,
  upload_requested_at timestamptz,
  used_at timestamptz,
  deleted_at timestamptz,
  check (expires_at = issued_at + interval '2 minutes'),
  check (clip_path is null
    or clip_path ~ '^[0-9a-f-]{36}/[0-9a-f-]{36}\.(mp4|webm)$'),
  check ((clip_path is null) = (upload_requested_at is null))
);

create unique index consequence_challenges_one_open
  on app_private.consequence_challenges (attempt_id)
  where replaced_at is null and used_at is null;

do $$
begin
  if exists (select 1 from information_schema.schemata where schema_name = 'storage') then
    execute $sql$
      insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
      values ('consequence-clips', 'consequence-clips', false, 12582912,
        array['video/mp4', 'video/webm'])
      on conflict (id) do nothing
    $sql$;
  end if;
end;
$$;

-- Replaces any open challenge on the caller's own active card with a fresh one.
create or replace function app_private.issue_consequence_challenge(
  requested_attempt_id uuid, requested_at timestamptz
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  actor uuid := app_private.actor_account_id();
  new_id uuid := gen_random_uuid();
  new_code text := lpad(floor(random() * 1000)::integer::text, 3, '0');
  new_action text := (array[
    'Hold up ' || (2 + floor(random() * 4))::integer || ' fingers',
    'Give a thumbs up', 'Touch your nose', 'Wave at the camera'
  ])[1 + floor(random() * 4)::integer];
begin
  if actor is null or not exists (
    select 1 from app_private.consequence_attempts a
    join app_private.consequence_obligations o on o.obligation_id = a.obligation_id
    join app_private.memberships m on m.membership_id = o.membership_id
    where a.attempt_id = requested_attempt_id and a.status = 'active'
      and requested_at < a.expires_at and m.account_id = actor and m.ended_at is null
  ) then
    raise exception 'Consequence action unavailable' using errcode = '42501';
  end if;
  if (select count(*) from app_private.consequence_challenges
      where account_id = actor and issued_at > requested_at - interval '1 hour') >= 20 then
    raise exception 'challenge limit reached' using errcode = '42501';
  end if;
  update app_private.consequence_challenges set replaced_at = requested_at
  where attempt_id = requested_attempt_id and replaced_at is null and used_at is null;
  insert into app_private.consequence_challenges
    (challenge_id, attempt_id, account_id, code, action, issued_at, expires_at)
  values (new_id, requested_attempt_id, actor, new_code, new_action, requested_at,
    requested_at + interval '2 minutes');
  return jsonb_build_object('challengeId', new_id, 'code', new_code, 'action', new_action,
    'issuedAt', requested_at, 'expiresAt', requested_at + interval '2 minutes');
end;
$$;

-- The clip's storage path, issued only while the caller's challenge is open and unexpired.
create or replace function app_private.create_consequence_clip_upload(
  requested_challenge_id uuid, requested_extension text, requested_at timestamptz
) returns text
language plpgsql security definer set search_path = '' as $$
declare
  actor uuid := app_private.actor_account_id();
  item app_private.consequence_challenges%rowtype;
begin
  select * into item from app_private.consequence_challenges
  where challenge_id = requested_challenge_id for update;
  if actor is null or item.account_id is distinct from actor
     or item.replaced_at is not null or item.used_at is not null
     or requested_at >= item.expires_at or requested_extension not in ('mp4', 'webm') then
    raise exception 'valid Consequence challenge required' using errcode = '42501';
  end if;
  if item.clip_path is null then
    item.clip_path := actor::text || '/' || item.challenge_id::text || '.' || requested_extension;
    update app_private.consequence_challenges
    set clip_path = item.clip_path, upload_requested_at = requested_at
    where challenge_id = item.challenge_id;
  end if;
  return item.clip_path;
end;
$$;

-- Attestation-only claims are no longer accepted.
create or replace function app_private.submit_consequence_claim(
  requested_claim_id uuid, requested_attempt_id uuid, requested_completed_at timestamptz,
  requested_attested boolean, requested_at timestamptz
) returns uuid language plpgsql security definer set search_path = '' as $$
begin
  raise exception 'video proof required' using errcode = '22023';
end;
$$;

create or replace function app_private.submit_consequence_claim(
  requested_claim_id uuid, requested_attempt_id uuid, requested_completed_at timestamptz,
  requested_attested boolean, requested_clip_path text, requested_at timestamptz
) returns uuid language plpgsql security definer set search_path = '' as $$
declare owner app_private.memberships%rowtype; attempt app_private.consequence_attempts%rowtype;
  uploaded boolean;
begin
  select m.* into owner
  from app_private.consequence_attempts a
  join app_private.consequence_obligations o on o.obligation_id = a.obligation_id
  join app_private.memberships m on m.membership_id = o.membership_id
  where a.attempt_id = requested_attempt_id and a.status = 'active'
    and requested_at <= a.expires_at for update of a;
  select * into attempt from app_private.consequence_attempts
  where attempt_id = requested_attempt_id;
  if owner.membership_id is null or not requested_attested
     or requested_completed_at > requested_at
     or requested_completed_at < attempt.selected_at then
    raise exception 'timely attested completion claim required' using errcode = '22023';
  end if;
  -- The clip must really be in storage: a video within the bucket limit, uploaded after issue.
  if exists (select 1 from information_schema.tables
      where table_schema = 'storage' and table_name = 'objects') then
    execute $sql$
      select exists (select 1 from storage.objects o
        join app_private.consequence_challenges c on c.clip_path = o.name
        where o.bucket_id = 'consequence-clips' and o.name = $1
          and (o.metadata->>'size')::bigint between 1 and 12582912
          and o.metadata->>'mimetype' in ('video/mp4', 'video/webm')
          and o.created_at >= c.issued_at and o.created_at <= $2)
    $sql$ into uploaded using requested_clip_path, requested_at;
    if not uploaded then
      raise exception 'video proof required' using errcode = '22023';
    end if;
  end if;
  update app_private.consequence_challenges set used_at = requested_at
  where clip_path = requested_clip_path and attempt_id = requested_attempt_id
    and account_id = owner.account_id and replaced_at is null and used_at is null
    and deleted_at is null and upload_requested_at < expires_at
    and requested_at < issued_at + interval '10 minutes';
  if not found then
    raise exception 'video proof required' using errcode = '22023';
  end if;
  insert into app_private.consequence_claims (
    claim_id, attempt_id, completed_at, attested, submitted_at, review_ends_at, clip_path
  ) values (requested_claim_id, requested_attempt_id, requested_completed_at, true,
    requested_at, requested_at + interval '48 hours', requested_clip_path);
  insert into app_private.consequence_review_audience (claim_id, membership_id)
  select requested_claim_id, membership_id from app_private.memberships
  where group_id = owner.group_id and ended_at is null and membership_id <> owner.membership_id;
  update app_private.consequence_attempts set status = 'review' where attempt_id = requested_attempt_id;
  return requested_claim_id;
end;
$$;

-- Previous home and command wrappers stay as the base; these add clip paths and the clip claim.
alter function app_private.consequence_home(timestamptz) rename to consequence_home_pause;
alter function app_private.consequence_command(text, uuid, text, timestamptz)
  rename to consequence_command_pause;

create or replace function app_private.consequence_home(requested_at timestamptz)
returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare result jsonb := app_private.consequence_home_pause(requested_at);
begin
  if result->'attempt' is not null and result->'attempt' <> 'null'::jsonb then
    result := jsonb_set(result, '{attempt,clipPath}', coalesce(to_jsonb((
      select clip_path from app_private.consequence_claims
      where attempt_id = (result->'attempt'->>'attemptId')::uuid)), 'null'::jsonb));
  end if;
  return jsonb_set(result, '{reviews}', coalesce((
    select jsonb_agg(review || jsonb_build_object('clipPath', claim.clip_path) order by position)
    from jsonb_array_elements(result->'reviews') with ordinality as r(review, position)
    left join app_private.consequence_claims claim
      on claim.claim_id = (review->>'claimId')::uuid), '[]'::jsonb));
end;
$$;

create or replace function app_private.consequence_command(
  requested_action text, requested_target uuid, requested_choice text, requested_at timestamptz
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare viewer app_private.memberships := app_private.actor_current_membership();
begin
  if requested_action <> 'claim' then
    perform app_private.consequence_command_pause(
      requested_action, requested_target, requested_choice, requested_at);
    return app_private.consequence_home(requested_at);
  end if;
  if viewer.membership_id is null or not exists (
    select 1 from app_private.consequence_attempts a
    join app_private.consequence_obligations o on o.obligation_id = a.obligation_id
    where a.attempt_id = requested_target and o.membership_id = viewer.membership_id
  ) then
    raise exception 'Consequence action unavailable' using errcode = '42501';
  end if;
  perform app_private.submit_consequence_claim(
    gen_random_uuid(), requested_target, requested_at, true, requested_choice, requested_at);
  perform app_private.finalize_consequence_claim(
    (select claim_id from app_private.consequence_claims where attempt_id = requested_target),
    requested_at);
  return app_private.consequence_home(requested_at);
end;
$$;

-- Clips never attached to a claim, a day after their upload was requested.
create or replace function app_private.consequence_clips_due(requested_at timestamptz)
returns table (path text)
language sql stable security definer set search_path = '' as $$
  select c.clip_path from app_private.consequence_challenges c
  where c.clip_path is not null and c.used_at is null and c.deleted_at is null
    and requested_at >= c.upload_requested_at + interval '1 day'
  limit 200;
$$;

create or replace function app_private.mark_consequence_clips_deleted(
  requested_paths text[], requested_at timestamptz
) returns integer
language plpgsql security definer set search_path = '' as $$
declare changed integer;
begin
  update app_private.consequence_challenges set deleted_at = requested_at
  where clip_path = any(requested_paths) and used_at is null and deleted_at is null;
  get diagnostics changed = row_count;
  return changed;
end;
$$;

alter table app_private.consequence_challenges enable row level security;
revoke all on table app_private.consequence_challenges from public, anon, authenticated;
grant select, insert, update on table app_private.consequence_challenges to service_role;
revoke all on function app_private.issue_consequence_challenge(uuid, timestamptz),
  app_private.create_consequence_clip_upload(uuid, text, timestamptz),
  app_private.submit_consequence_claim(uuid, uuid, timestamptz, boolean, text, timestamptz),
  app_private.consequence_home(timestamptz),
  app_private.consequence_command(text, uuid, text, timestamptz),
  app_private.consequence_home_pause(timestamptz),
  app_private.consequence_command_pause(text, uuid, text, timestamptz),
  app_private.consequence_clips_due(timestamptz),
  app_private.mark_consequence_clips_deleted(text[], timestamptz)
  from public, anon, authenticated;
grant execute on function app_private.issue_consequence_challenge(uuid, timestamptz),
  app_private.create_consequence_clip_upload(uuid, text, timestamptz),
  app_private.submit_consequence_claim(uuid, uuid, timestamptz, boolean, text, timestamptz),
  app_private.consequence_home(timestamptz),
  app_private.consequence_command(text, uuid, text, timestamptz),
  app_private.consequence_clips_due(timestamptz),
  app_private.mark_consequence_clips_deleted(text[], timestamptz)
  to service_role;

insert into app_private.schema_versions (version) values (28);
