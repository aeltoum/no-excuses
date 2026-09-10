create table app_private.card_catalog_releases (
  release_id uuid primary key,
  version integer not null unique check (version > 0),
  released_at timestamptz not null
);

create table app_private.consequence_cards (
  card_id uuid primary key,
  release_id uuid not null references app_private.card_catalog_releases(release_id) on delete restrict,
  catalog_key text not null unique,
  title text not null,
  instructions text not null,
  lower_impact_instructions text not null,
  progression boolean not null,
  retired_at timestamptz,
  constraint consequence_cards_content check (
    length(btrim(title)) between 1 and 80
    and length(btrim(instructions)) between 1 and 300
    and length(btrim(lower_impact_instructions)) between 1 and 300
  )
);

create table app_private.card_unlocks (
  card_unlock_id uuid primary key,
  account_id uuid not null references app_private.accounts(account_id) on delete restrict,
  card_id uuid not null references app_private.consequence_cards(card_id) on delete restrict,
  milestone smallint not null check (milestone in (1, 2, 4, 8)),
  unlocked_at timestamptz not null,
  unique (account_id, card_id),
  unique (account_id, milestone)
);

create table app_private.consequence_obligations (
  obligation_id uuid primary key,
  membership_id uuid not null references app_private.memberships(membership_id) on delete restrict,
  source_kind text not null check (source_kind in ('missed_target', 'rejected_report', 'card_expiry')),
  source_id uuid not null,
  created_at timestamptz not null,
  status text not null default 'open' check (status in ('open', 'completed', 'closed_on_departure')),
  closed_at timestamptz,
  constraint consequence_obligations_terminal check (
    (status = 'open' and closed_at is null)
    or (status <> 'open' and closed_at is not null)
  ),
  unique (source_kind, source_id)
);

create table app_private.card_offers (
  offer_id uuid primary key,
  obligation_id uuid not null references app_private.consequence_obligations(obligation_id) on delete restrict,
  created_at timestamptz not null,
  entropy text not null,
  status text not null default 'initial' check (
    status in ('initial', 'redrawn', 'selected', 'replaced', 'closed_on_departure')
  )
);

create unique index card_offers_one_live_per_obligation
  on app_private.card_offers (obligation_id)
  where status in ('initial', 'redrawn', 'selected');

create table app_private.offered_cards (
  offer_id uuid not null references app_private.card_offers(offer_id) on delete restrict,
  phase text not null check (phase in ('initial', 'redraw')),
  position smallint not null check (position between 1 and 3),
  card_id uuid not null references app_private.consequence_cards(card_id) on delete restrict,
  primary key (offer_id, phase, position),
  unique (offer_id, phase, card_id)
);

create table app_private.offered_card_contributors (
  offer_id uuid not null,
  phase text not null,
  position smallint not null,
  membership_id uuid not null references app_private.memberships(membership_id) on delete restrict,
  primary key (offer_id, phase, position, membership_id),
  foreign key (offer_id, phase, position)
    references app_private.offered_cards(offer_id, phase, position) on delete restrict
);

create table app_private.consequence_attempts (
  attempt_id uuid primary key,
  offer_id uuid not null unique references app_private.card_offers(offer_id) on delete restrict,
  obligation_id uuid not null references app_private.consequence_obligations(obligation_id) on delete restrict,
  card_id uuid not null references app_private.consequence_cards(card_id) on delete restrict,
  selected_at timestamptz not null,
  expires_at timestamptz not null,
  status text not null default 'active' check (
    status in ('active', 'safety_paused', 'review', 'completed', 'not_completed', 'closed_on_departure')
  ),
  terminal_at timestamptz,
  constraint consequence_attempts_deadline check (expires_at = selected_at + interval '48 hours'),
  constraint consequence_attempts_terminal check (
    (status in ('active', 'safety_paused', 'review') and terminal_at is null)
    or (status in ('completed', 'not_completed', 'closed_on_departure') and terminal_at is not null)
  )
);

create unique index consequence_attempts_one_live_per_obligation
  on app_private.consequence_attempts (obligation_id)
  where status in ('active', 'safety_paused', 'review');

create table app_private.consequence_safety_pauses (
  safety_pause_id uuid primary key,
  attempt_id uuid not null references app_private.consequence_attempts(attempt_id) on delete restrict,
  starts_at timestamptz not null,
  ends_at timestamptz,
  check (ends_at is null or ends_at >= starts_at)
);

create unique index consequence_safety_pauses_one_open
  on app_private.consequence_safety_pauses (attempt_id) where ends_at is null;

create table app_private.consequence_claims (
  claim_id uuid primary key,
  attempt_id uuid not null unique references app_private.consequence_attempts(attempt_id) on delete restrict,
  completed_at timestamptz not null,
  attested boolean not null check (attested),
  submitted_at timestamptz not null,
  review_ends_at timestamptz not null,
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected', 'timed_out', 'closed_on_departure')),
  finalized_at timestamptz,
  constraint consequence_claims_review_deadline check (review_ends_at = submitted_at + interval '48 hours'),
  constraint consequence_claims_terminal check (
    (status = 'pending' and finalized_at is null)
    or (status <> 'pending' and finalized_at is not null)
  )
);

create table app_private.consequence_review_audience (
  claim_id uuid not null references app_private.consequence_claims(claim_id) on delete restrict,
  membership_id uuid not null references app_private.memberships(membership_id) on delete restrict,
  eligible boolean not null default true,
  primary key (claim_id, membership_id)
);

create table app_private.consequence_review_responses (
  response_id uuid primary key,
  claim_id uuid not null references app_private.consequence_claims(claim_id) on delete restrict,
  membership_id uuid not null references app_private.memberships(membership_id) on delete restrict,
  response text not null check (response in ('approve', 'reject', 'cannot_assess')),
  responded_at timestamptz not null,
  unique (claim_id, membership_id)
);

create or replace function app_private.award_card_unlock(
  requested_unlock_id uuid,
  requested_account_id uuid,
  requested_milestone integer,
  requested_entropy text,
  requested_at timestamptz
) returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare existing_id uuid; selected_card_id uuid;
begin
  if requested_milestone not in (1, 2, 4, 8) then
    raise exception 'Card unlock milestone must be 1, 2, 4, or 8' using errcode = '22023';
  end if;
  perform 1 from app_private.accounts where account_id = requested_account_id for update;
  select card_unlock_id into existing_id from app_private.card_unlocks
  where account_id = requested_account_id and milestone = requested_milestone;
  if found then return existing_id; end if;
  select c.card_id into selected_card_id
  from app_private.consequence_cards c
  where c.progression and c.retired_at is null and not exists (
    select 1 from app_private.card_unlocks u
    where u.account_id = requested_account_id and u.card_id = c.card_id
  ) order by md5(requested_entropy || c.card_id::text) limit 1;
  if selected_card_id is null then
    raise exception 'no unowned progression Card available' using errcode = 'P0002';
  end if;
  insert into app_private.card_unlocks
    (card_unlock_id, account_id, card_id, milestone, unlocked_at)
  values (requested_unlock_id, requested_account_id, selected_card_id,
    requested_milestone, requested_at);
  return requested_unlock_id;
end;
$$;

create or replace function app_private.add_consequence_obligation(
  requested_obligation_id uuid,
  requested_membership_id uuid,
  requested_source_kind text,
  requested_source_id uuid,
  requested_at timestamptz
) returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  existing_id uuid;
  open_count integer;
begin
  select obligation_id into existing_id
  from app_private.consequence_obligations
  where source_kind = requested_source_kind and source_id = requested_source_id;
  if found then return existing_id; end if;

  perform 1 from app_private.memberships
  where membership_id = requested_membership_id and ended_at is null for update;
  if not found then return null; end if;

  select count(*) into open_count
  from app_private.consequence_obligations
  where membership_id = requested_membership_id and status = 'open';
  if open_count >= 5 then return null; end if;

  insert into app_private.consequence_obligations (
    obligation_id, membership_id, source_kind, source_id, created_at
  ) values (
    requested_obligation_id, requested_membership_id, requested_source_kind, requested_source_id, requested_at
  );
  return requested_obligation_id;
end;
$$;

create or replace function app_private.create_card_offer(
  requested_offer_id uuid,
  requested_obligation_id uuid,
  requested_entropy text,
  requested_at timestamptz
) returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  owner_membership app_private.memberships%rowtype;
begin
  select m.* into owner_membership
  from app_private.consequence_obligations o
  join app_private.memberships m on m.membership_id = o.membership_id
  where o.obligation_id = requested_obligation_id and o.status = 'open'
  for update of o;
  if not found or owner_membership.ended_at is not null then
    raise exception 'open Consequence obligation required' using errcode = 'P0002';
  end if;
  if exists (
    select 1 from app_private.card_offers
    where obligation_id = requested_obligation_id and status in ('initial', 'redrawn', 'selected')
  ) then
    raise exception 'active Card offer already exists' using errcode = '23505';
  end if;

  insert into app_private.card_offers (offer_id, obligation_id, created_at, entropy)
    values (requested_offer_id, requested_obligation_id, requested_at, requested_entropy);
  with pool as (
    select c.card_id
    from app_private.consequence_cards c
    where c.retired_at is null and (
      not c.progression or exists (
        select 1
        from app_private.card_unlocks u
        join app_private.memberships contributor on contributor.account_id = u.account_id
        where u.card_id = c.card_id
          and contributor.group_id = owner_membership.group_id
          and contributor.ended_at is null
          and contributor.membership_id <> owner_membership.membership_id
      )
    )
  ), ranked as (
    select card_id, row_number() over (order by md5(requested_entropy || card_id::text)) as position
    from pool
  )
  insert into app_private.offered_cards (offer_id, phase, position, card_id)
  select requested_offer_id, 'initial', position, card_id from ranked where position <= 3;

  if (select count(*) from app_private.offered_cards where offer_id = requested_offer_id) <> 3 then
    raise exception 'Card pool must contain at least three eligible cards' using errcode = '23514';
  end if;

  insert into app_private.offered_card_contributors (offer_id, phase, position, membership_id)
  select oc.offer_id, oc.phase, oc.position, contributor.membership_id
  from app_private.offered_cards oc
  join app_private.card_unlocks u on u.card_id = oc.card_id
  join app_private.memberships contributor on contributor.account_id = u.account_id
  where oc.offer_id = requested_offer_id
    and contributor.group_id = owner_membership.group_id
    and contributor.ended_at is null
    and contributor.membership_id <> owner_membership.membership_id;
  return requested_offer_id;
end;
$$;

create or replace function app_private.redraw_card_offer(
  requested_offer_id uuid,
  requested_entropy text
) returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare owner_membership app_private.memberships%rowtype;
begin
  select m.* into owner_membership
  from app_private.card_offers offer
  join app_private.consequence_obligations o on o.obligation_id = offer.obligation_id
  join app_private.memberships m on m.membership_id = o.membership_id
  where offer.offer_id = requested_offer_id and offer.status = 'initial'
  for update of offer;
  if not found then raise exception 'initial Card offer required' using errcode = 'P0002'; end if;

  with pool as (
    select c.card_id
    from app_private.consequence_cards c
    where c.retired_at is null
      and not exists (
        select 1 from app_private.offered_cards original
        where original.offer_id = requested_offer_id and original.phase = 'initial'
          and original.card_id = c.card_id
      )
      and (not c.progression or exists (
        select 1 from app_private.card_unlocks u
        join app_private.memberships contributor on contributor.account_id = u.account_id
        where u.card_id = c.card_id and contributor.group_id = owner_membership.group_id
          and contributor.ended_at is null
          and contributor.membership_id <> owner_membership.membership_id
      ))
  ), ranked as (
    select card_id, row_number() over (order by md5(requested_entropy || card_id::text)) as position
    from pool
  )
  insert into app_private.offered_cards (offer_id, phase, position, card_id)
  select requested_offer_id, 'redraw', position, card_id from ranked where position <= 3;
  if (select count(*) from app_private.offered_cards where offer_id = requested_offer_id and phase = 'redraw') <> 3 then
    raise exception 'redraw requires three replacement cards' using errcode = '23514';
  end if;
  update app_private.card_offers set status = 'redrawn', entropy = requested_entropy
  where offer_id = requested_offer_id;
  return requested_offer_id;
end;
$$;

create or replace function app_private.select_consequence_card(
  requested_attempt_id uuid,
  requested_offer_id uuid,
  requested_card_id uuid,
  requested_at timestamptz
) returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare phase_name text; obligation uuid;
begin
  select case when status = 'redrawn' then 'redraw' else 'initial' end, obligation_id
    into phase_name, obligation
  from app_private.card_offers
  where offer_id = requested_offer_id and status in ('initial', 'redrawn') for update;
  if not found or not exists (
    select 1 from app_private.offered_cards
    where offer_id = requested_offer_id and phase = phase_name and card_id = requested_card_id
  ) then raise exception 'offered Card required' using errcode = '22023'; end if;
  insert into app_private.consequence_attempts (
    attempt_id, offer_id, obligation_id, card_id, selected_at, expires_at
  ) values (
    requested_attempt_id, requested_offer_id, obligation, requested_card_id,
    requested_at, requested_at + interval '48 hours'
  );
  update app_private.card_offers set status = 'selected' where offer_id = requested_offer_id;
  return requested_attempt_id;
end;
$$;

create or replace function app_private.pause_consequence_for_safety(
  requested_pause_id uuid, requested_attempt_id uuid, requested_at timestamptz
) returns uuid language plpgsql security definer set search_path = '' as $$
begin
  update app_private.consequence_attempts set status = 'safety_paused'
  where attempt_id = requested_attempt_id and status = 'active';
  if not found then raise exception 'active Consequence card required' using errcode = 'P0002'; end if;
  insert into app_private.consequence_safety_pauses (safety_pause_id, attempt_id, starts_at)
    values (requested_pause_id, requested_attempt_id, requested_at);
  return requested_pause_id;
end;
$$;

create or replace function app_private.resume_consequence_from_safety(
  requested_attempt_id uuid, requested_at timestamptz
) returns uuid language plpgsql security definer set search_path = '' as $$
declare obligation uuid;
begin
  update app_private.consequence_attempts
  set status = 'not_completed', terminal_at = requested_at
  where attempt_id = requested_attempt_id and status = 'safety_paused'
  returning obligation_id into obligation;
  if not found then raise exception 'Safety-paused Consequence card required' using errcode = 'P0002'; end if;
  update app_private.consequence_safety_pauses set ends_at = requested_at
  where attempt_id = requested_attempt_id and ends_at is null;
  update app_private.card_offers set status = 'replaced'
  where offer_id = (select offer_id from app_private.consequence_attempts where attempt_id = requested_attempt_id);
  return obligation;
end;
$$;

create or replace function app_private.submit_consequence_claim(
  requested_claim_id uuid, requested_attempt_id uuid, requested_completed_at timestamptz,
  requested_attested boolean, requested_at timestamptz
) returns uuid language plpgsql security definer set search_path = '' as $$
declare owner app_private.memberships%rowtype;
begin
  select m.* into owner
  from app_private.consequence_attempts a
  join app_private.consequence_obligations o on o.obligation_id = a.obligation_id
  join app_private.memberships m on m.membership_id = o.membership_id
  where a.attempt_id = requested_attempt_id and a.status = 'active'
    and requested_at <= a.expires_at for update of a;
  if not found or not requested_attested or requested_completed_at > requested_at then
    raise exception 'timely attested completion claim required' using errcode = '22023';
  end if;
  insert into app_private.consequence_claims (
    claim_id, attempt_id, completed_at, attested, submitted_at, review_ends_at
  ) values (requested_claim_id, requested_attempt_id, requested_completed_at, true,
    requested_at, requested_at + interval '48 hours');
  insert into app_private.consequence_review_audience (claim_id, membership_id)
  select requested_claim_id, membership_id from app_private.memberships
  where group_id = owner.group_id and ended_at is null and membership_id <> owner.membership_id;
  update app_private.consequence_attempts set status = 'review' where attempt_id = requested_attempt_id;
  return requested_claim_id;
end;
$$;

create or replace function app_private.finalize_consequence_claim(
  requested_claim_id uuid, requested_at timestamptz
) returns text language plpgsql security definer set search_path = '' as $$
declare approvals integer; rejections integer; eligible_count integer; required_count integer;
  claim_status text; attempt uuid; obligation uuid;
begin
  select status, attempt_id into claim_status, attempt
  from app_private.consequence_claims where claim_id = requested_claim_id for update;
  if claim_status <> 'pending' then return claim_status; end if;
  select count(*) into eligible_count from app_private.consequence_review_audience
    where claim_id = requested_claim_id and eligible;
  required_count := least(2, eligible_count);
  select count(*) filter (where response = 'approve'), count(*) filter (where response = 'reject')
    into approvals, rejections from app_private.consequence_review_responses r
    join app_private.consequence_review_audience a using (claim_id, membership_id)
    where r.claim_id = requested_claim_id and a.eligible;
  if required_count > 0 and approvals >= required_count then claim_status := 'approved';
  elsif required_count > 0 and rejections >= required_count then claim_status := 'rejected';
  elsif requested_at >= (select review_ends_at from app_private.consequence_claims where claim_id = requested_claim_id)
    then claim_status := 'timed_out';
  else return 'pending'; end if;
  update app_private.consequence_claims set status = claim_status, finalized_at = requested_at
    where claim_id = requested_claim_id;
  select obligation_id into obligation from app_private.consequence_attempts where attempt_id = attempt;
  update app_private.consequence_attempts
    set status = case when claim_status = 'approved' then 'completed' else 'not_completed' end,
        terminal_at = requested_at where attempt_id = attempt;
  update app_private.card_offers set status = 'replaced'
    where offer_id = (select offer_id from app_private.consequence_attempts where attempt_id = attempt);
  if claim_status = 'approved' then
    update app_private.consequence_obligations set status = 'completed', closed_at = requested_at
      where obligation_id = obligation and status = 'open';
  end if;
  return claim_status;
end;
$$;

create or replace function app_private.respond_to_consequence_claim(
  requested_response_id uuid, requested_claim_id uuid, requested_membership_id uuid,
  requested_response text, requested_at timestamptz
) returns text language plpgsql security definer set search_path = '' as $$
begin
  if not exists (select 1 from app_private.consequence_review_audience
    where claim_id = requested_claim_id and membership_id = requested_membership_id and eligible)
  then raise exception 'eligible Consequence reviewer required' using errcode = '42501'; end if;
  insert into app_private.consequence_review_responses
    (response_id, claim_id, membership_id, response, responded_at)
  values (requested_response_id, requested_claim_id, requested_membership_id, requested_response, requested_at);
  return app_private.finalize_consequence_claim(requested_claim_id, requested_at);
end;
$$;

create or replace function app_private.expire_consequence_attempt(
  requested_attempt_id uuid, requested_expiry_obligation_id uuid, requested_at timestamptz
) returns uuid language plpgsql security definer set search_path = '' as $$
declare obligation uuid; owner uuid;
begin
  update app_private.consequence_attempts set status = 'not_completed', terminal_at = requested_at
  where attempt_id = requested_attempt_id and status = 'active' and expires_at <= requested_at
  returning obligation_id into obligation;
  if not found then return null; end if;
  select membership_id into owner from app_private.consequence_obligations where obligation_id = obligation;
  update app_private.card_offers set status = 'replaced'
    where offer_id = (select offer_id from app_private.consequence_attempts where attempt_id = requested_attempt_id);
  perform app_private.add_consequence_obligation(
    requested_expiry_obligation_id, owner, 'card_expiry', requested_attempt_id, requested_at
  );
  return obligation;
end;
$$;

create or replace function app_private.close_departed_consequences(
  requested_membership_id uuid, requested_at timestamptz
) returns integer language plpgsql security definer set search_path = '' as $$
declare closed_count integer;
begin
  update app_private.consequence_claims set status = 'closed_on_departure', finalized_at = requested_at
  where status = 'pending' and attempt_id in (
    select a.attempt_id from app_private.consequence_attempts a
    join app_private.consequence_obligations o using (obligation_id)
    where o.membership_id = requested_membership_id
  );
  update app_private.consequence_attempts set status = 'closed_on_departure', terminal_at = requested_at
  where obligation_id in (select obligation_id from app_private.consequence_obligations
    where membership_id = requested_membership_id) and status in ('active', 'safety_paused', 'review');
  update app_private.card_offers set status = 'closed_on_departure'
  where obligation_id in (select obligation_id from app_private.consequence_obligations
    where membership_id = requested_membership_id) and status in ('initial', 'redrawn', 'selected');
  update app_private.consequence_obligations set status = 'closed_on_departure', closed_at = requested_at
  where membership_id = requested_membership_id and status = 'open';
  get diagnostics closed_count = row_count;
  return closed_count;
end;
$$;

create or replace function app_private.on_consequence_membership_departure()
returns trigger language plpgsql security definer set search_path = '' as $$
declare pending_claim record;
begin
  if old.ended_at is null and new.ended_at is not null then
    perform app_private.close_departed_consequences(new.membership_id, new.ended_at);
    update app_private.consequence_review_audience
      set eligible = false
      where membership_id = new.membership_id and eligible;
    for pending_claim in
      select claim_id from app_private.consequence_claims where status = 'pending'
    loop
      perform app_private.finalize_consequence_claim(pending_claim.claim_id, new.ended_at);
    end loop;
  end if;
  return new;
end;
$$;

create trigger memberships_consequence_departure
after update of ended_at on app_private.memberships
for each row execute function app_private.on_consequence_membership_departure();

create or replace function app_private.finalize_ended_member_weeks(
  requested_at timestamptz
) returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare finalized_count integer; missed_item record;
begin
  with completed_counts as (
    select mw.member_week_id, count(wc.workout_checkin_id)::integer as completed_count
    from app_private.member_weeks mw
    join app_private.memberships m on m.membership_id = mw.membership_id
    join app_private.accountability_weeks aw
      on aw.accountability_week_id = mw.accountability_week_id
    left join app_private.workout_checkins wc on wc.member_week_id = mw.member_week_id
    where mw.status = 'active' and m.ended_at is null and requested_at >= aw.ends_at
    group by mw.member_week_id
  )
  update app_private.member_weeks mw
  set status = case when completed_counts.completed_count >= mw.target
    then 'attained'::app_private.member_week_status
    else 'missed'::app_private.member_week_status end
  from completed_counts
  where mw.member_week_id = completed_counts.member_week_id and mw.status = 'active';
  get diagnostics finalized_count = row_count;

  for missed_item in
    select member_week_id, membership_id from app_private.member_weeks where status = 'missed'
  loop
    perform app_private.add_consequence_obligation(
      md5('missed_target:' || missed_item.member_week_id::text)::uuid,
      missed_item.membership_id, 'missed_target', missed_item.member_week_id, requested_at
    );
  end loop;
  return finalized_count;
end;
$$;

insert into app_private.card_catalog_releases (release_id, version, released_at)
values ('c0000000-0000-4000-8000-000000000001', 1, '2026-09-10Z');

insert into app_private.consequence_cards
  (card_id, release_id, catalog_key, title, instructions, lower_impact_instructions, progression)
select ('c1000000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid,
  'c0000000-0000-4000-8000-000000000001', key, title, instructions, lower_impact, n > 6
from (values
  (1, 'march', 'March in place', 'March gently for two minutes.', 'March seated for two minutes.'),
  (2, 'wall_push', 'Wall push-ups', 'Do ten controlled wall push-ups.', 'Use a more upright wall position.'),
  (3, 'chair_stands', 'Chair stands', 'Do eight controlled chair stands.', 'Use hands for support.'),
  (4, 'step_touches', 'Step touches', 'Do two minutes of side step touches.', 'Tap each foot while seated.'),
  (5, 'calf_raises', 'Calf raises', 'Do twelve controlled calf raises.', 'Hold a stable surface.'),
  (6, 'shoulder_rolls', 'Shoulder rolls', 'Do twenty slow shoulder rolls.', 'Use a smaller comfortable range.'),
  (7, 'gentle_squats', 'Gentle squats', 'Do ten comfortable squats.', 'Use a chair-supported range.'),
  (8, 'knee_lifts', 'Knee lifts', 'Alternate knee lifts for two minutes.', 'Alternate seated knee lifts.'),
  (9, 'wall_sit', 'Short wall sit', 'Hold a comfortable wall sit for twenty seconds.', 'Use a shallow bend.'),
  (10, 'arm_reaches', 'Arm reaches', 'Alternate overhead reaches for two minutes.', 'Reach forward below shoulder height.'),
  (11, 'side_leg_lifts', 'Side leg lifts', 'Do eight controlled lifts per side.', 'Use a stable surface and smaller range.'),
  (12, 'heel_taps', 'Heel taps', 'Alternate heel taps for two minutes.', 'Perform seated.'),
  (13, 'counter_push', 'Counter push-ups', 'Do ten controlled counter push-ups.', 'Use a wall instead.'),
  (14, 'balance_shift', 'Balance shifts', 'Shift weight side to side for two minutes.', 'Hold a stable surface.')
) as seed(n, key, title, instructions, lower_impact);

revoke all on table app_private.card_catalog_releases, app_private.consequence_cards,
  app_private.card_unlocks, app_private.consequence_obligations, app_private.card_offers,
  app_private.offered_cards, app_private.offered_card_contributors,
  app_private.consequence_attempts, app_private.consequence_safety_pauses,
  app_private.consequence_claims, app_private.consequence_review_audience,
  app_private.consequence_review_responses from public, anon, authenticated;
revoke all on function app_private.award_card_unlock(uuid, uuid, integer, text, timestamptz),
  app_private.add_consequence_obligation(uuid, uuid, text, uuid, timestamptz),
  app_private.create_card_offer(uuid, uuid, text, timestamptz),
  app_private.redraw_card_offer(uuid, text),
  app_private.select_consequence_card(uuid, uuid, uuid, timestamptz),
  app_private.pause_consequence_for_safety(uuid, uuid, timestamptz),
  app_private.resume_consequence_from_safety(uuid, timestamptz),
  app_private.submit_consequence_claim(uuid, uuid, timestamptz, boolean, timestamptz),
  app_private.finalize_consequence_claim(uuid, timestamptz),
  app_private.respond_to_consequence_claim(uuid, uuid, uuid, text, timestamptz),
  app_private.expire_consequence_attempt(uuid, uuid, timestamptz),
  app_private.close_departed_consequences(uuid, timestamptz)
  from public, anon, authenticated;
grant select, insert, update on table app_private.card_catalog_releases,
  app_private.consequence_cards, app_private.card_unlocks,
  app_private.consequence_obligations, app_private.card_offers,
  app_private.offered_cards, app_private.offered_card_contributors,
  app_private.consequence_attempts, app_private.consequence_safety_pauses,
  app_private.consequence_claims, app_private.consequence_review_audience,
  app_private.consequence_review_responses to service_role;
grant execute on function app_private.award_card_unlock(uuid, uuid, integer, text, timestamptz),
  app_private.add_consequence_obligation(uuid, uuid, text, uuid, timestamptz),
  app_private.create_card_offer(uuid, uuid, text, timestamptz),
  app_private.redraw_card_offer(uuid, text),
  app_private.select_consequence_card(uuid, uuid, uuid, timestamptz),
  app_private.pause_consequence_for_safety(uuid, uuid, timestamptz),
  app_private.resume_consequence_from_safety(uuid, timestamptz),
  app_private.submit_consequence_claim(uuid, uuid, timestamptz, boolean, timestamptz),
  app_private.finalize_consequence_claim(uuid, timestamptz),
  app_private.respond_to_consequence_claim(uuid, uuid, uuid, text, timestamptz),
  app_private.expire_consequence_attempt(uuid, uuid, timestamptz),
  app_private.close_departed_consequences(uuid, timestamptz)
  to service_role;

insert into app_private.schema_versions (version) values (11);
