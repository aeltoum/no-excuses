-- One owed card, lighter cards (owner-approved 2026-11-22, DECK-3).
-- 1. No stacking: a member owes at most ONE Consequence card. A miss, Rejected report, or card
--    expiry while a card is owed adds nothing; an expired card is re-offered as the same debt.
-- 2. Existing backlogs above one collapse to one. The most advanced card is kept (in review,
--    then in play, then on offer, then oldest); the rest close as 'voided' with an audit row in
--    operator_card_voids (voided_by null = system). No rows are deleted.
-- 3. Catalog release 4: 16 structured 10-15 minute bodyweight cards replace release 3, which is
--    retired for new offers only (not deleted): any hand already dealt plays out as dealt.

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
begin
  select obligation_id into existing_id
  from app_private.consequence_obligations
  where source_kind = requested_source_kind and source_id = requested_source_id;
  if found then return existing_id; end if;

  perform 1 from app_private.memberships
  where membership_id = requested_membership_id and ended_at is null for update;
  if not found then return null; end if;

  -- At most one owed card: nothing stacks on top of an open one.
  perform 1 from app_private.consequence_obligations
  where membership_id = requested_membership_id and status = 'open';
  if found then return null; end if;

  insert into app_private.consequence_obligations (
    obligation_id, membership_id, source_kind, source_id, created_at
  ) values (
    requested_obligation_id, requested_membership_id, requested_source_kind, requested_source_id, requested_at
  );
  return requested_obligation_id;
end;
$$;

-- Collapse backlogs above one.
create temporary table one_card_extras as
select obligation_id from (
  select o.obligation_id, row_number() over (
    partition by o.membership_id
    order by
      case
        when exists (select 1 from app_private.consequence_attempts a
          where a.obligation_id = o.obligation_id and a.status = 'review') then 0
        when exists (select 1 from app_private.consequence_attempts a
          where a.obligation_id = o.obligation_id and a.status in ('active', 'safety_paused')) then 1
        when exists (select 1 from app_private.card_offers f
          where f.obligation_id = o.obligation_id and f.status in ('initial', 'redrawn')) then 2
        else 3
      end,
      o.created_at, o.obligation_id
  ) as rank
  from app_private.consequence_obligations o
  where o.status = 'open'
) ranked
where rank > 1;

update app_private.consequence_claims set status = 'voided', finalized_at = now()
where status = 'pending' and attempt_id in (
  select attempt_id from app_private.consequence_attempts
  where obligation_id in (select obligation_id from one_card_extras));
update app_private.consequence_attempts set status = 'voided', terminal_at = now()
where obligation_id in (select obligation_id from one_card_extras)
  and status in ('active', 'safety_paused', 'review');
update app_private.card_offers set status = 'voided'
where obligation_id in (select obligation_id from one_card_extras)
  and status in ('initial', 'redrawn', 'selected');
update app_private.consequence_obligations set status = 'voided', closed_at = now()
where obligation_id in (select obligation_id from one_card_extras);
insert into app_private.operator_card_voids (obligation_id, voided_by, reason, voided_at)
select obligation_id, null, 'One owed card at most: extra stacked card voided (DECK-3)', now()
from one_card_extras;

-- Catalog release 4.
update app_private.consequence_cards set retired_at = now()
where release_id = 'c0000000-0000-4000-8000-000000000003' and retired_at is null;

insert into app_private.card_catalog_releases (release_id, version, released_at)
values ('c0000000-0000-4000-8000-000000000004', 4, now());

insert into app_private.consequence_cards
  (card_id, release_id, catalog_key, title, instructions, lower_impact_instructions, progression)
select ('c4000000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid,
  'c0000000-0000-4000-8000-000000000004', key, title, instructions, lower_impact, n > 6
from (values
  (1, 'v4_emom_squat_push', 'EMOM 12: squats + push-ups',
    'Every minute on the minute for 12 minutes: 10 air squats + 5 push-ups. Rest for the rest of each minute.',
    'Swap push-ups for knee or wall push-ups.'),
  (2, 'v4_four_rounds', '4 rounds: lunges, push-ups, plank',
    '4 rounds: 20 alternating lunges, 10 push-ups, 30 second plank, then 1 minute rest.',
    'Do reverse lunges holding a wall and knee push-ups.'),
  (3, 'v4_amrap_12', 'AMRAP 12: push-ups, squats, sit-ups',
    'As many rounds as possible in 12 minutes: 5 push-ups, 10 air squats, 15 sit-ups. Share your round count.',
    'Knee push-ups and crunches instead of sit-ups.'),
  (4, 'v4_wall_sit_knees', '5 rounds: wall sit + high knees',
    '5 rounds: 1 minute wall sit, 1 minute high knees, 1 minute rest. 15 minutes total.',
    'Shallower wall sit and marching in place instead of high knees.'),
  (5, 'v4_core_circuit', '3 rounds: core circuit',
    '3 rounds of 1 minute each: plank, left side plank, right side plank, glute bridges. 12 minutes, no rest between moves.',
    'Planks and side planks from the knees.'),
  (6, 'v4_full_body_three', '3 rounds: full body',
    '3 rounds: 50 jumping jacks, 20 air squats, 10 push-ups, 20 glute bridges, then 1 minute rest.',
    'Step jacks instead of jumping jacks and knee push-ups.'),
  (7, 'v4_tabata_triple', 'Tabata triple',
    'Three Tabatas, 1 minute rest between: 8 rounds of 20 seconds on, 10 seconds off of squats, then push-ups, then mountain climbers. 14 minutes.',
    'Knee push-ups and slow step-back mountain climbers.'),
  (8, 'v4_ladder_10', 'Squat + push-up ladder to 10',
    'Ladder 1 to 10: 1 squat + 1 push-up, then 2 + 2, up to 10 + 10 (55 of each). Stop at 15 minutes.',
    'Knee push-ups; stop the ladder wherever 15 minutes runs out.'),
  (9, 'v4_emom_lunge_climb', 'EMOM 14: lunges / climbers',
    'Every minute on the minute for 14 minutes. Odd minutes: 12 alternating lunges. Even minutes: 20 mountain climbers.',
    'Reverse lunges holding a wall and slow step-back mountain climbers.'),
  (10, 'v4_burpee_rounds', '6 rounds: 10 burpees',
    '6 rounds: 10 burpees, then 1 minute rest. About 12 minutes.',
    'Step-back burpees with no jump.'),
  (11, 'v4_forty_twenty', '40/20 for 12 minutes',
    '12 minutes of 40 seconds work, 20 seconds rest, cycling: squat jumps, push-ups, plank, jumping jacks.',
    'Air squats instead of squat jumps and step jacks instead of jumping jacks.'),
  (12, 'v4_shadowbox', 'Shadowbox 6 rounds',
    '6 rounds: 90 seconds nonstop shadowboxing (jab, cross, hooks, keep moving), 30 seconds rest. 12 minutes.',
    'Stay planted and punch at a steady pace.'),
  (13, 'v4_push_pyramid', 'Push-up pyramid + squats',
    'Push-up pyramid 2-4-6-8-10-8-6-4-2 with 15 air squats after every set.',
    'Knee or wall push-ups for the whole pyramid.'),
  (14, 'v4_amrap_15', 'AMRAP 15: tens',
    'As many rounds as possible in 15 minutes: 10 lunges, 10 push-ups, 10 sit-ups, 10 jumping jacks. Share your round count.',
    'Knee push-ups, crunches, and step jacks.'),
  (15, 'v4_inchworm_emom', 'EMOM 10: inchworms + squats',
    'Every minute on the minute for 10 minutes: 5 inchworms + 10 air squats.',
    'Bend your knees on the inchworms and walk out only as far as is comfortable.'),
  (16, 'v4_glute_core_rounds', '4 rounds: legs + core',
    '4 rounds: 20 glute bridges, 20 reverse lunges, 20 bicycle crunches, 30 second hollow hold, then 45 seconds rest.',
    'Tuck the knees on the hollow hold and slow the bicycle crunches.')
) as seed(n, key, title, instructions, lower_impact);

drop table one_card_extras;

insert into app_private.schema_versions (version) values (64);
