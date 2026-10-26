-- Next card right away (owner-asked 2026-10-26).
-- Sending proof for a Consequence card no longer holds the member's other owed cards until the
-- review ends: the next owed card is offered at once while friends review the first. A review
-- that ends with no rejections still counts as done (2026-10-19 rule). A card whose proof is
-- under review frees the member's single live offer slot, so later offers never reuse an
-- obligation that is still under review. Home lists the member's own cards in review.

-- Offers the member's oldest owed card that has no card in play, unless an offer is live.
create or replace function app_private.offer_next_card(
  requested_membership_id uuid, requested_offer_id uuid, requested_at timestamptz
) returns uuid language plpgsql security definer set search_path = '' as $$
declare next_obligation uuid;
begin
  if exists (select 1 from app_private.card_offers
      where membership_id = requested_membership_id
        and status in ('initial', 'redrawn', 'selected')) then
    return null;
  end if;
  select o.obligation_id into next_obligation
  from app_private.consequence_obligations o
  join app_private.memberships m on m.membership_id = o.membership_id and m.ended_at is null
  where o.membership_id = requested_membership_id and o.status = 'open'
    and not exists (select 1 from app_private.consequence_attempts a
      where a.obligation_id = o.obligation_id
        and a.status in ('active', 'safety_paused', 'review'))
  order by o.created_at, o.obligation_id limit 1;
  if next_obligation is null then return null; end if;
  perform app_private.create_card_offer(coalesce(requested_offer_id, gen_random_uuid()),
    next_obligation, gen_random_uuid()::text, requested_at);
  return next_obligation;
end;
$$;

-- Same outcome rules as 2026-10-19; the follow-up offer goes through offer_next_card.
create or replace function app_private.finalize_consequence_claim(
  requested_claim_id uuid, requested_at timestamptz
) returns text language plpgsql security definer set search_path = '' as $$
declare approvals integer; rejections integer; eligible_count integer; required_count integer;
  claim_status text; attempt uuid; obligation uuid; owner uuid; review_deadline timestamptz;
  approval_reached_at timestamptz; rejection_reached_at timestamptz;
begin
  select status, attempt_id into claim_status, attempt
  from app_private.consequence_claims where claim_id = requested_claim_id for update;
  if claim_status <> 'pending' then return claim_status; end if;
  select count(*) into eligible_count from app_private.consequence_review_audience
    where claim_id = requested_claim_id and eligible;
  required_count := least(2, eligible_count);
  select review_ends_at into review_deadline from app_private.consequence_claims
    where claim_id = requested_claim_id;
  select count(*) filter (where response = 'approve'), count(*) filter (where response = 'reject')
    into approvals, rejections from app_private.consequence_review_responses r
    join app_private.consequence_review_audience a using (claim_id, membership_id)
    where r.claim_id = requested_claim_id and a.eligible and r.responded_at < review_deadline;
  if required_count = 0 then
    claim_status := 'approved';
  else
    if approvals >= required_count then
      select responded_at into approval_reached_at
      from app_private.consequence_review_responses
      where claim_id = requested_claim_id and response = 'approve'
        and responded_at < review_deadline order by responded_at offset required_count - 1 limit 1;
    end if;
    if rejections >= required_count then
      select responded_at into rejection_reached_at
      from app_private.consequence_review_responses
      where claim_id = requested_claim_id and response = 'reject'
        and responded_at < review_deadline order by responded_at offset required_count - 1 limit 1;
    end if;
    if approval_reached_at is not null
       and (rejection_reached_at is null or approval_reached_at < rejection_reached_at) then
      claim_status := 'approved';
    elsif rejection_reached_at is not null then
      claim_status := 'rejected';
    elsif requested_at >= review_deadline and rejections = 0 then
      claim_status := 'approved';
    elsif requested_at >= review_deadline then
      claim_status := 'timed_out';
    else return 'pending'; end if;
  end if;
  update app_private.consequence_claims set status = claim_status, finalized_at = requested_at
    where claim_id = requested_claim_id;
  select obligation_id into obligation from app_private.consequence_attempts where attempt_id = attempt;
  select membership_id into owner from app_private.consequence_obligations
    where obligation_id = obligation;
  update app_private.consequence_attempts
    set status = case when claim_status = 'approved' then 'completed' else 'not_completed' end,
        terminal_at = requested_at where attempt_id = attempt;
  update app_private.card_offers set status = 'replaced'
    where offer_id = (select offer_id from app_private.consequence_attempts where attempt_id = attempt)
      and status <> 'replaced';
  if claim_status = 'approved' then
    update app_private.consequence_obligations set status = 'completed', closed_at = requested_at
      where obligation_id = obligation and status = 'open';
  end if;
  -- A rejected card comes back once the member has no other card on offer.
  perform app_private.offer_next_card(owner, null, requested_at);
  return claim_status;
end;
$$;

create or replace function app_private.advance_consequences(requested_at timestamptz)
returns integer
language plpgsql security definer set search_path = '' as $$
declare changed integer := 0; item record;
begin
  for item in
    select a.attempt_id from app_private.consequence_attempts a
    where a.status = 'active' and a.expires_at <= requested_at
  loop
    perform app_private.expire_consequence_attempt(
      item.attempt_id, md5('card_expiry:' || item.attempt_id::text)::uuid, requested_at
    );
    changed := changed + 1;
  end loop;
  for item in
    select c.claim_id from app_private.consequence_claims c
    where c.status = 'pending' and c.review_ends_at <= requested_at
  loop
    perform app_private.finalize_consequence_claim(item.claim_id, requested_at);
    changed := changed + 1;
  end loop;
  for item in
    select distinct o.membership_id from app_private.consequence_obligations o
    where o.status = 'open'
  loop
    if app_private.offer_next_card(item.membership_id,
        md5('offer:' || item.membership_id::text || ':' || requested_at::text)::uuid,
        requested_at) is not null then
      changed := changed + 1;
    end if;
  end loop;
  return changed;
end;
$$;

-- Proof sent: the card waits on friends, and the next owed card is offered now.
alter function app_private.consequence_command(text, uuid, text, timestamptz)
  rename to consequence_command_clip;

create or replace function app_private.consequence_command(
  requested_action text, requested_target uuid, requested_choice text, requested_at timestamptz
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare viewer app_private.memberships := app_private.actor_current_membership();
begin
  perform app_private.consequence_command_clip(
    requested_action, requested_target, requested_choice, requested_at);
  if requested_action = 'claim' then
    update app_private.card_offers set status = 'replaced'
    where offer_id = (select offer_id from app_private.consequence_attempts
      where attempt_id = requested_target and status = 'review');
    perform app_private.offer_next_card(viewer.membership_id, null, requested_at);
  end if;
  return app_private.consequence_home(requested_at);
end;
$$;

-- Home: the member's own cards in review. With no card in play, the oldest one fills
-- `attempt` as before, so the review status stays on screen.
alter function app_private.consequence_home(timestamptz) rename to consequence_home_clip;

create or replace function app_private.consequence_home(requested_at timestamptz)
returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  viewer app_private.memberships := app_private.actor_current_membership();
  result jsonb := app_private.consequence_home_clip(requested_at);
  reviewing jsonb;
begin
  select coalesce(jsonb_agg(jsonb_build_object(
      'attemptId', a.attempt_id,
      'status', a.status,
      'title', card.title,
      'instructions', card.instructions,
      'selectedAt', a.selected_at,
      'expiresAt', a.expires_at,
      'claimReviewEndsAt', cl.review_ends_at,
      'approvals', (select count(*) from app_private.consequence_review_responses r
        where r.claim_id = cl.claim_id and r.response = 'approve'),
      'approvalsNeeded', (select least(2, count(*)) from app_private.consequence_review_audience aud
        where aud.claim_id = cl.claim_id and aud.eligible),
      'clipPath', cl.clip_path,
      'pauseRequest', null
    ) order by cl.submitted_at), '[]'::jsonb) into reviewing
  from app_private.consequence_claims cl
  join app_private.consequence_attempts a on a.attempt_id = cl.attempt_id
  join app_private.consequence_obligations o on o.obligation_id = a.obligation_id
  join app_private.consequence_cards card on card.card_id = a.card_id
  where o.membership_id = viewer.membership_id and cl.status = 'pending';
  if (result->'attempt' is null or result->'attempt' = 'null'::jsonb)
     and jsonb_array_length(reviewing) > 0 then
    result := jsonb_set(result, '{attempt}', reviewing->0);
  end if;
  return result || jsonb_build_object('inReview', reviewing);
end;
$$;

-- Members already waiting on a review get their next card at the next sweep.
update app_private.card_offers set status = 'replaced'
where status = 'selected' and offer_id in (
  select offer_id from app_private.consequence_attempts where status = 'review'
);

revoke all on function app_private.offer_next_card(uuid, uuid, timestamptz),
  app_private.consequence_command_clip(text, uuid, text, timestamptz),
  app_private.consequence_home_clip(timestamptz)
  from public, anon, authenticated;
grant execute on function app_private.offer_next_card(uuid, uuid, timestamptz),
  app_private.consequence_command_clip(text, uuid, text, timestamptz),
  app_private.consequence_home_clip(timestamptz) to service_role;

insert into app_private.schema_versions (version) values (46);
