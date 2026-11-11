-- Owner-approved 2026-11-11 (retention audit, docs/research/product-ux-retention-audit.md):
-- 1. An owed Consequence card no longer blocks workout logging. The card stays owed and
--    Group-visible; the member's next workout is never refused.
-- 2. Catalog release 3 returns to the CONTEXT.md Consequence card: no more than five
--    minutes, no equipment, a lower-impact adaptation. Release 2 heavy cards are retired
--    for new offers only; any hand already dealt plays out as dealt, so no in-flight
--    claim or proof clip is lost.

drop trigger if exists workout_checkins_consequence_gate on app_private.workout_checkins;

-- Kept so older API builds that still read logBlocked get false.
create or replace function app_private.consequence_logging_blocked(requested_membership_id uuid)
returns boolean
language sql stable security definer set search_path = '' as $$
  select false;
$$;

update app_private.consequence_cards set retired_at = '2026-11-25Z'
where release_id = 'c0000000-0000-4000-8000-000000000002' and retired_at is null;

insert into app_private.card_catalog_releases (release_id, version, released_at)
values ('c0000000-0000-4000-8000-000000000003', 3, '2026-11-25Z');

insert into app_private.consequence_cards
  (card_id, release_id, catalog_key, title, instructions, lower_impact_instructions, progression)
select ('c3000000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid,
  'c0000000-0000-4000-8000-000000000003', key, title, instructions, lower_impact, n > 6
from (values
  (1, 'v3_squats_25', '25 squats', 'Do 25 bodyweight squats at your own pace.', 'Squat to a chair and stand back up.'),
  (2, 'v3_push_ups_15', '15 push-ups', 'Do 15 push-ups, any sets.', 'Do them against a wall or counter.'),
  (3, 'v3_plank_60', '1-minute plank', 'Hold a plank for 60 seconds total, any sets.', 'Hold it from your knees.'),
  (4, 'v3_lunges_20', '20 lunges', 'Do 20 alternating lunges.', 'Do step-backs holding a chair.'),
  (5, 'v3_jacks_50', '50 jumping jacks', 'Do 50 jumping jacks.', 'Do step jacks with no jump.'),
  (6, 'v3_wall_sit_45', '45-second wall sit', 'Hold a wall sit for 45 seconds total.', 'Use a shallow bend.'),
  (7, 'v3_burpees_10', '10 burpees', 'Do 10 burpees at your own pace.', 'Step back instead of jumping.'),
  (8, 'v3_climbers_40', '40 mountain climbers', 'Do 40 mountain climbers, counting each leg.', 'Do them with hands on a bench.'),
  (9, 'v3_glute_bridge_20', '20 glute bridges', 'Do 20 glute bridges with a pause at the top.', 'Do them without the pause.'),
  (10, 'v3_high_knees_60', '60 seconds of high knees', 'Run high knees in place for 60 seconds.', 'March with high knees.'),
  (11, 'v3_side_plank', 'Side plank, 30 seconds a side', 'Hold a side plank for 30 seconds on each side.', 'Hold it from your knees.'),
  (12, 'v3_squat_jumps_10', '10 squat jumps', 'Do 10 squat jumps.', 'Do 10 fast squats with no jump.'),
  (13, 'v3_dead_bug_20', '20 dead bugs', 'Do 20 dead bugs, counting each side.', 'Move only the legs.'),
  (14, 'v3_shadow_box_90', '90 seconds of shadow boxing', 'Shadow box at a steady pace for 90 seconds.', 'Shadow box seated.')
) as seed(n, key, title, instructions, lower_impact);

insert into app_private.schema_versions (version) values (58);
