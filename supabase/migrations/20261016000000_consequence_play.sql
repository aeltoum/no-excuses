-- Deferred slice: Consequence system play loop (owner-approved 2026-10-13).
-- Members receive Card offers automatically, pick or redraw, complete within 48 hours,
-- and two friends approve the claim. Owed counts are Group-visible.

-- Obligations recorded before cards were playable are waived rather than offered late.
alter table app_private.consequence_obligations
  drop constraint consequence_obligations_status_check,
  add constraint consequence_obligations_status_check
    check (status in ('open', 'completed', 'closed_on_departure', 'waived'));
update app_private.consequence_obligations
set status = 'waived', closed_at = transaction_timestamp()
where status = 'open';

-- Offers the oldest owed card, expires missed deadlines, and closes timed-out reviews.
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
    select distinct on (o.membership_id) o.obligation_id
    from app_private.consequence_obligations o
    join app_private.memberships m on m.membership_id = o.membership_id and m.ended_at is null
    where o.status = 'open'
      and not exists (
        select 1 from app_private.card_offers live
        where live.membership_id = o.membership_id
          and live.status in ('initial', 'redrawn', 'selected')
      )
    order by o.membership_id, o.created_at, o.obligation_id
  loop
    perform app_private.create_card_offer(
      md5('offer:' || item.obligation_id::text || ':' || requested_at::text)::uuid,
      item.obligation_id, gen_random_uuid()::text, requested_at
    );
    changed := changed + 1;
  end loop;
  return changed;
end;
$$;

-- The caller's live card state, friends' claims awaiting them, and Group owed counts.
create or replace function app_private.consequence_home(requested_at timestamptz)
returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  viewer app_private.memberships := app_private.actor_current_membership();
  offer app_private.card_offers%rowtype;
  attempt app_private.consequence_attempts%rowtype;
  claim app_private.consequence_claims%rowtype;
  result jsonb;
begin
  if viewer.membership_id is null then
    raise exception 'current Group membership required' using errcode = '42501';
  end if;
  select * into offer from app_private.card_offers
  where membership_id = viewer.membership_id and status in ('initial', 'redrawn', 'selected');
  if offer.offer_id is not null and offer.status = 'selected' then
    select * into attempt from app_private.consequence_attempts where offer_id = offer.offer_id;
    select * into claim from app_private.consequence_claims where attempt_id = attempt.attempt_id;
  end if;

  result := jsonb_build_object(
    'owed', (select count(*) from app_private.consequence_obligations
      where membership_id = viewer.membership_id and status = 'open'),
    'offer', case when offer.offer_id is null or offer.status = 'selected' then null
      else jsonb_build_object(
        'offerId', offer.offer_id,
        'canRedraw', offer.status = 'initial',
        'cards', (select jsonb_agg(jsonb_build_object(
            'cardId', c.card_id, 'title', c.title, 'instructions', c.instructions,
            'unlockedByFriend', c.progression) order by oc.position)
          from app_private.offered_cards oc
          join app_private.consequence_cards c on c.card_id = oc.card_id
          where oc.offer_id = offer.offer_id
            and oc.phase = case when offer.status = 'redrawn' then 'redraw' else 'initial' end)
      ) end,
    'attempt', case when attempt.attempt_id is null then null
      else jsonb_build_object(
        'attemptId', attempt.attempt_id,
        'status', attempt.status,
        'title', (select title from app_private.consequence_cards where card_id = attempt.card_id),
        'instructions', (select instructions from app_private.consequence_cards
          where card_id = attempt.card_id),
        'selectedAt', attempt.selected_at,
        'expiresAt', attempt.expires_at,
        'claimReviewEndsAt', claim.review_ends_at,
        'approvals', (select count(*) from app_private.consequence_review_responses r
          where r.claim_id = claim.claim_id and r.response = 'approve'),
        'approvalsNeeded', (select least(2, count(*)) from app_private.consequence_review_audience a
          where a.claim_id = claim.claim_id and a.eligible)
      ) end,
    'reviews', coalesce((select jsonb_agg(jsonb_build_object(
        'claimId', cl.claim_id,
        'memberName', coalesce(acc.display_name, 'Member ' || left(owner.membership_id::text, 8)),
        'title', card.title,
        'instructions', card.instructions,
        'completedAt', cl.completed_at,
        'reviewEndsAt', cl.review_ends_at,
        'myResponse', resp.response) order by cl.submitted_at)
      from app_private.consequence_claims cl
      join app_private.consequence_review_audience aud
        on aud.claim_id = cl.claim_id and aud.membership_id = viewer.membership_id and aud.eligible
      join app_private.consequence_attempts att on att.attempt_id = cl.attempt_id
      join app_private.consequence_cards card on card.card_id = att.card_id
      join app_private.consequence_obligations ob on ob.obligation_id = att.obligation_id
      join app_private.memberships owner on owner.membership_id = ob.membership_id
      join app_private.accounts acc on acc.account_id = owner.account_id
      left join app_private.consequence_review_responses resp
        on resp.claim_id = cl.claim_id and resp.membership_id = viewer.membership_id
      where cl.status = 'pending' and requested_at < cl.review_ends_at), '[]'::jsonb),
    'groupOwed', coalesce((select jsonb_object_agg(m.membership_id, owed.count)
      from app_private.memberships m
      cross join lateral (select count(*) as count from app_private.consequence_obligations o
        where o.membership_id = m.membership_id and o.status = 'open') owed
      where m.group_id = viewer.group_id and m.ended_at is null and owed.count > 0), '{}'::jsonb)
  );
  return result;
end;
$$;

-- Actor-checked commands; each returns the refreshed home state.
create or replace function app_private.consequence_command(
  requested_action text, requested_target uuid, requested_choice text, requested_at timestamptz
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  viewer app_private.memberships := app_private.actor_current_membership();
  owned boolean;
begin
  if viewer.membership_id is null then
    raise exception 'current Group membership required' using errcode = '42501';
  end if;
  if requested_action in ('redraw', 'select') then
    owned := exists (select 1 from app_private.card_offers
      where offer_id = requested_target and membership_id = viewer.membership_id);
  elsif requested_action in ('claim', 'pause', 'resume') then
    owned := exists (select 1 from app_private.consequence_attempts a
      join app_private.consequence_obligations o on o.obligation_id = a.obligation_id
      where a.attempt_id = requested_target and o.membership_id = viewer.membership_id);
  elsif requested_action = 'respond' then
    owned := requested_choice in ('approve', 'reject', 'cannot_assess');
  else
    raise exception 'unknown Consequence action' using errcode = '22023';
  end if;
  if not owned then
    raise exception 'Consequence action unavailable' using errcode = '42501';
  end if;

  if requested_action = 'redraw' then
    perform app_private.redraw_card_offer(requested_target, gen_random_uuid()::text);
  elsif requested_action = 'select' then
    perform app_private.select_consequence_card(
      gen_random_uuid(), requested_target, requested_choice::uuid, requested_at);
  elsif requested_action = 'claim' then
    perform app_private.submit_consequence_claim(
      gen_random_uuid(), requested_target, requested_at, true, requested_at);
    perform app_private.finalize_consequence_claim(
      (select claim_id from app_private.consequence_claims where attempt_id = requested_target),
      requested_at);
  elsif requested_action = 'pause' then
    perform app_private.pause_consequence_for_safety(
      gen_random_uuid(), requested_target, requested_at);
  elsif requested_action = 'resume' then
    perform app_private.resume_consequence_from_safety(requested_target, requested_at);
  else
    perform app_private.respond_to_consequence_claim(
      gen_random_uuid(), requested_target, viewer.membership_id, requested_choice, requested_at);
  end if;
  return app_private.consequence_home(requested_at);
end;
$$;

-- Push: a new Card offer, a deadline 12 hours away, and friends' claims to approve.
create or replace function app_private.enqueue_consequence_push(requested_at timestamptz)
returns integer
language plpgsql security definer set search_path = '' as $$
declare enqueued integer := 0; added integer;
begin
  insert into app_private.web_push_outbox (account_id, dedupe_key, title, body)
  select m.account_id, 'card-offer:' || offer.offer_id, 'You owe a Consequence card',
    'Pick one of three cards. You have 48 hours once you choose.'
  from app_private.card_offers offer
  join app_private.memberships m on m.membership_id = offer.membership_id and m.ended_at is null
  join app_private.push_recipients() r on r.account_id = m.account_id
  where offer.status = 'initial' and offer.created_at > requested_at - interval '1 day'
    and offer.created_at >= r.since
  on conflict (dedupe_key) do nothing;
  get diagnostics added = row_count;
  enqueued := enqueued + added;

  insert into app_private.web_push_outbox (account_id, dedupe_key, title, body)
  select m.account_id, 'card-deadline:' || a.attempt_id,
    '12 hours left on ' || c.title, 'Finish it and mark it done, or it costs you another card.'
  from app_private.consequence_attempts a
  join app_private.consequence_cards c on c.card_id = a.card_id
  join app_private.consequence_obligations o on o.obligation_id = a.obligation_id
  join app_private.memberships m on m.membership_id = o.membership_id and m.ended_at is null
  join app_private.push_recipients() r on r.account_id = m.account_id
  where a.status = 'active' and requested_at >= a.expires_at - interval '12 hours'
    and requested_at < a.expires_at
  on conflict (dedupe_key) do nothing;
  get diagnostics added = row_count;
  enqueued := enqueued + added;

  insert into app_private.web_push_outbox (account_id, dedupe_key, title, body)
  select reviewer.account_id, 'card-claim:' || cl.claim_id || ':' || reviewer.account_id,
    coalesce(acc.display_name, 'A Group member') || ' finished ' || c.title,
    'Approve it if you trust it happened.'
  from app_private.consequence_claims cl
  join app_private.consequence_attempts a on a.attempt_id = cl.attempt_id
  join app_private.consequence_cards c on c.card_id = a.card_id
  join app_private.consequence_obligations o on o.obligation_id = a.obligation_id
  join app_private.memberships owner on owner.membership_id = o.membership_id
  join app_private.accounts acc on acc.account_id = owner.account_id
  join app_private.consequence_review_audience aud on aud.claim_id = cl.claim_id and aud.eligible
  join app_private.memberships reviewer on reviewer.membership_id = aud.membership_id
    and reviewer.ended_at is null
  join app_private.push_recipients() r on r.account_id = reviewer.account_id
  where cl.status = 'pending' and cl.submitted_at >= r.since
  on conflict (dedupe_key) do nothing;
  get diagnostics added = row_count;
  return enqueued + added;
end;
$$;

revoke all on function app_private.advance_consequences(timestamptz),
  app_private.consequence_home(timestamptz),
  app_private.consequence_command(text, uuid, text, timestamptz),
  app_private.enqueue_consequence_push(timestamptz)
  from public, anon, authenticated;
grant execute on function app_private.advance_consequences(timestamptz),
  app_private.consequence_home(timestamptz),
  app_private.consequence_command(text, uuid, text, timestamptz),
  app_private.enqueue_consequence_push(timestamptz)
  to service_role;

insert into app_private.schema_versions (version) values (20);
