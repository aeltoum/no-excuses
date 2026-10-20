-- Consequence review timeout (owner-approved 2026-10-19).
-- A claim whose 48-hour review ends with no rejections now counts as approved, so silent
-- friends no longer send the member back to redo the same card. Reviewers who have not
-- responded get a reminder 12 hours before the review ends.

create or replace function app_private.finalize_consequence_claim(
  requested_claim_id uuid, requested_at timestamptz
) returns text language plpgsql security definer set search_path = '' as $$
declare approvals integer; rejections integer; eligible_count integer; required_count integer;
  claim_status text; attempt uuid; obligation uuid; review_deadline timestamptz;
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
  update app_private.consequence_attempts
    set status = case when claim_status = 'approved' then 'completed' else 'not_completed' end,
        terminal_at = requested_at where attempt_id = attempt;
  update app_private.card_offers set status = 'replaced'
    where offer_id = (select offer_id from app_private.consequence_attempts where attempt_id = attempt);
  if claim_status = 'approved' then
    update app_private.consequence_obligations set status = 'completed', closed_at = requested_at
      where obligation_id = obligation and status = 'open';
  end if;
  if claim_status <> 'approved' then
    perform app_private.create_card_offer(gen_random_uuid(), obligation,
      gen_random_uuid()::text, requested_at);
  else
    select o.obligation_id into obligation
    from app_private.consequence_obligations o
    join app_private.memberships m using (membership_id)
    where o.membership_id = (
      select membership_id from app_private.consequence_obligations
      where obligation_id = obligation
    ) and o.status = 'open' and m.ended_at is null
    order by o.created_at, o.obligation_id limit 1;
    if obligation is not null then
      perform app_private.create_card_offer(gen_random_uuid(), obligation,
        gen_random_uuid()::text, requested_at);
    end if;
  end if;
  return claim_status;
end;
$$;

alter function app_private.enqueue_consequence_push(timestamptz)
  rename to enqueue_consequence_push_base;

create or replace function app_private.enqueue_consequence_push(requested_at timestamptz)
returns integer
language plpgsql security definer set search_path = '' as $$
declare added integer;
begin
  insert into app_private.web_push_outbox (account_id, dedupe_key, title, body)
  select reviewer.account_id, 'card-claim-reminder:' || cl.claim_id || ':' || reviewer.account_id,
    '12 hours left to review ' || coalesce(acc.display_name, 'a Group member') || '’s card',
    'Approve or reject ' || c.title || '. With no rejections it counts as done.'
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
  where cl.status = 'pending' and requested_at >= cl.review_ends_at - interval '12 hours'
    and requested_at < cl.review_ends_at
    and not exists (select 1 from app_private.consequence_review_responses resp
      where resp.claim_id = cl.claim_id and resp.membership_id = aud.membership_id)
  on conflict (dedupe_key) do nothing;
  get diagnostics added = row_count;
  return app_private.enqueue_consequence_push_base(requested_at) + added;
end;
$$;

revoke all on function app_private.enqueue_consequence_push(timestamptz),
  app_private.enqueue_consequence_push_base(timestamptz)
  from public, anon, authenticated;
grant execute on function app_private.enqueue_consequence_push(timestamptz) to service_role;

insert into app_private.schema_versions (version) values (29);
