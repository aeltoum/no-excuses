-- Operator card voids (owner-approved 2026-11-22, DECK-1). Amends the operator console rule
-- "operators never decide cards": an operator may void ONE owed Consequence card for a current
-- member, with a reason, for a wrongly assigned, unsafe, or defective card. A void is soft and
-- audited: the backlog item and any live offer, attempt, and pending claim close as 'voided'
-- (no expiry follow-up), so the owed count drops by one and the next owed card is offered as
-- usual. Streaks, Crowns, Card unlocks, and finalized history do not change.

alter table app_private.consequence_obligations
  drop constraint consequence_obligations_status_check,
  add constraint consequence_obligations_status_check
    check (status in ('open', 'completed', 'closed_on_departure', 'waived', 'voided'));
alter table app_private.card_offers
  drop constraint card_offers_status_check,
  add constraint card_offers_status_check check (
    status in ('initial', 'redrawn', 'selected', 'replaced', 'closed_on_departure', 'voided'));
alter table app_private.consequence_attempts
  drop constraint consequence_attempts_status_check,
  add constraint consequence_attempts_status_check check (status in (
    'active', 'safety_paused', 'review', 'completed', 'not_completed', 'closed_on_departure', 'voided')),
  drop constraint consequence_attempts_terminal,
  add constraint consequence_attempts_terminal check (
    (status in ('active', 'safety_paused', 'review') and terminal_at is null)
    or (status in ('completed', 'not_completed', 'closed_on_departure', 'voided')
      and terminal_at is not null));
alter table app_private.consequence_claims
  drop constraint consequence_claims_status_check,
  add constraint consequence_claims_status_check check (status in (
    'pending', 'approved', 'rejected', 'timed_out', 'replaced', 'closed_on_departure', 'voided'));

-- Audit: who voided which owed card, when, and why.
create table app_private.operator_card_voids (
  obligation_id uuid primary key
    references app_private.consequence_obligations(obligation_id) on delete restrict,
  voided_by uuid references app_private.accounts(account_id) on delete set null,
  reason text not null check (length(reason) between 1 and 200),
  voided_at timestamptz not null
);
alter table app_private.operator_card_voids enable row level security;
revoke all on table app_private.operator_card_voids from public, anon, authenticated;
grant select, insert on table app_private.operator_card_voids to service_role;

create or replace function app_private.operator_void_card(
  requested_obligation_id uuid, requested_reason text, requested_at timestamptz
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  operator uuid := app_private.actor_operator();
  reason text := btrim(coalesce(requested_reason, ''));
begin
  if length(reason) not between 1 and 200 then
    raise exception 'reason required' using errcode = '22023';
  end if;
  perform 1 from app_private.consequence_obligations o
  join app_private.memberships m on m.membership_id = o.membership_id and m.ended_at is null
  where o.obligation_id = requested_obligation_id and o.status = 'open'
  for update of o;
  if not found then
    raise exception 'card unavailable' using errcode = 'P0002';
  end if;
  update app_private.consequence_claims set status = 'voided', finalized_at = requested_at
  where status = 'pending' and attempt_id in (
    select attempt_id from app_private.consequence_attempts
    where obligation_id = requested_obligation_id);
  update app_private.consequence_attempts set status = 'voided', terminal_at = requested_at
  where obligation_id = requested_obligation_id and status in ('active', 'safety_paused', 'review');
  update app_private.card_offers set status = 'voided'
  where obligation_id = requested_obligation_id and status in ('initial', 'redrawn', 'selected');
  update app_private.consequence_obligations set status = 'voided', closed_at = requested_at
  where obligation_id = requested_obligation_id;
  insert into app_private.operator_card_voids (obligation_id, voided_by, reason, voided_at)
  values (requested_obligation_id, operator, reason, requested_at);
  return app_private.operator_console(requested_at);
end;
$$;

-- The console also lists each current member's owed cards, oldest first.
alter function app_private.operator_console(timestamptz) rename to operator_console_core;
create or replace function app_private.operator_console(requested_at timestamptz)
returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  return app_private.operator_console_core(requested_at) || jsonb_build_object(
    'cards', coalesce((
      select jsonb_agg(jsonb_build_object(
        'obligationId', o.obligation_id, 'membershipId', o.membership_id,
        'member', app_private.member_label(o.membership_id), 'group', g.name,
        'reason', o.source_kind, 'createdAt', o.created_at,
        'card', (select c.title from app_private.consequence_attempts a
          join app_private.consequence_cards c using (card_id)
          where a.obligation_id = o.obligation_id
            and a.status in ('active', 'safety_paused', 'review')),
        'expiresAt', (select a.expires_at from app_private.consequence_attempts a
          where a.obligation_id = o.obligation_id
            and a.status in ('active', 'safety_paused', 'review'))
      ) order by g.name, app_private.member_label(o.membership_id), o.created_at, o.obligation_id)
      from app_private.consequence_obligations o
      join app_private.memberships m on m.membership_id = o.membership_id and m.ended_at is null
      join app_private.groups g on g.group_id = m.group_id
      where o.status = 'open'
    ), '[]'::jsonb)
  );
end;
$$;

revoke all on function app_private.operator_console_core(timestamptz),
  app_private.operator_console(timestamptz),
  app_private.operator_void_card(uuid, text, timestamptz)
  from public, anon, authenticated;
grant execute on function app_private.operator_console_core(timestamptz),
  app_private.operator_console(timestamptz),
  app_private.operator_void_card(uuid, text, timestamptz)
  to service_role;

insert into app_private.schema_versions (version) values (62);
