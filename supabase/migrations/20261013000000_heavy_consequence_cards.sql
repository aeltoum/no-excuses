-- Catalog release 2: owner-approved heavy physical Consequence cards with no lower-impact
-- variant. Release 1 cards are retired, not deleted, so history keeps its references.
alter table app_private.consequence_cards
  alter column lower_impact_instructions drop not null,
  drop constraint consequence_cards_content,
  add constraint consequence_cards_content check (
    length(btrim(title)) between 1 and 80
    and length(btrim(instructions)) between 1 and 300
    and (lower_impact_instructions is null
      or length(btrim(lower_impact_instructions)) between 1 and 300)
  );

select app_private.retire_consequence_card(card_id, '2026-10-13Z')
from app_private.consequence_cards
where release_id = 'c0000000-0000-4000-8000-000000000001' and retired_at is null;

insert into app_private.card_catalog_releases (release_id, version, released_at)
values ('c0000000-0000-4000-8000-000000000002', 2, '2026-10-13Z');

insert into app_private.consequence_cards
  (card_id, release_id, catalog_key, title, instructions, lower_impact_instructions, progression)
select ('c2000000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid,
  'c0000000-0000-4000-8000-000000000002', key, title, instructions, null, n > 6
from (values
  (1, 'v2_burpees', '50 burpees', 'Complete 50 burpees, any sets.'),
  (2, 'v2_push_ups', '100 push-ups', 'Complete 100 push-ups, any sets.'),
  (3, 'v2_five_k', '5 km run', 'Run 5 km in one session on the same day.'),
  (4, 'v2_air_squats', '150 air squats', 'Complete 150 air squats, any sets.'),
  (5, 'v2_plank', '5 minute plank', 'Accumulate 5 minutes of plank, any sets.'),
  (6, 'v2_walking_lunges', '100 walking lunges', 'Complete 100 walking lunges, any sets.'),
  (7, 'v2_wall_sit', '10 minute wall sit', 'Accumulate 10 minutes of wall sit, any sets.'),
  (8, 'v2_jumping_jacks', '200 jumping jacks', 'Complete 200 jumping jacks, any sets.'),
  (9, 'v2_mile_trial', '1 mile time trial', 'Run 1 mile as fast as you can and share your time with the Group.'),
  (10, 'v2_core_double', '100 sit-ups + 100 flutter kicks', 'Complete 100 sit-ups and 100 flutter kicks, any sets.'),
  (11, 'v2_cardio_30', '30 minutes nonstop cardio', 'Do 30 minutes of continuous cardio with no breaks.'),
  (12, 'v2_murph_lite', 'Murph lite', 'Complete 50 pull-ups or rows, 100 push-ups, and 150 squats, partitioned any way.'),
  (13, 'v2_mountain_climbers', '300 mountain climbers', 'Complete 300 mountain climbers, any sets.'),
  (14, 'v2_bike_row', '10 km bike or 3 km row', 'Bike 10 km or row 3 km in one session.')
) as seed(n, key, title, instructions);

insert into app_private.schema_versions (version) values (17);
