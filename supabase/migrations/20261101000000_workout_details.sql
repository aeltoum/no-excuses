-- Structured Workout details (owner-approved 2026-10-20). Strength posts may list lifts from a
-- fixed catalog (exercise, equipment, sets, reps, weight in kg); cardio posts may record the
-- cardio activity, distance in km, and total time. Mixed posts may carry both. Details are
-- optional, added by the author within an hour of posting, and never change afterwards.
-- Catalog values only: no free text.

alter table app_private.workout_checkins add column details jsonb;

create or replace function app_private.valid_workout_details(
  requested_activity app_private.workout_activity_type, requested_details jsonb
) returns boolean
language plpgsql stable set search_path = '' as $$
declare lift jsonb; cardio jsonb;
begin
  if jsonb_typeof(requested_details) <> 'object'
     or exists (select 1 from jsonb_object_keys(requested_details) k where k not in ('lifts', 'cardio'))
     or requested_details = '{}'::jsonb then
    return false;
  end if;
  if requested_details ? 'lifts' then
    if requested_activity not in ('strength', 'mixed')
       or jsonb_typeof(requested_details -> 'lifts') <> 'array'
       or jsonb_array_length(requested_details -> 'lifts') not between 1 and 12 then
      return false;
    end if;
    for lift in select value from jsonb_array_elements(requested_details -> 'lifts') loop
      if jsonb_typeof(lift) <> 'object'
         or exists (select 1 from jsonb_object_keys(lift) k
                    where k not in ('exercise', 'equipment', 'sets', 'reps', 'weightKg'))
         or not (lift ->> 'exercise' = any (array[
           'back_squat', 'front_squat', 'goblet_squat', 'deadlift', 'romanian_deadlift',
           'bench_press', 'incline_bench_press', 'overhead_press', 'barbell_row', 'dumbbell_row',
           'pull_up', 'chin_up', 'dip', 'push_up', 'lunge', 'hip_thrust', 'leg_press',
           'lat_pulldown', 'cable_row', 'bicep_curl', 'tricep_extension', 'kettlebell_swing']))
         or not (lift ->> 'equipment' = any (array[
           'barbell', 'dumbbell', 'kettlebell', 'machine', 'cable', 'bodyweight', 'band']))
         or jsonb_typeof(lift -> 'sets') is distinct from 'number'
         or jsonb_typeof(lift -> 'reps') is distinct from 'number'
         or (lift ? 'weightKg' and jsonb_typeof(lift -> 'weightKg') <> 'number') then
        return false;
      end if;
      -- Numbers are checked only once their types are known.
      if (lift -> 'sets')::numeric not between 1 and 20
         or (lift -> 'reps')::numeric not between 1 and 100
         or (lift -> 'sets')::numeric <> trunc((lift -> 'sets')::numeric)
         or (lift -> 'reps')::numeric <> trunc((lift -> 'reps')::numeric)
         or coalesce((lift -> 'weightKg')::numeric, 1) not between 0.5 and 500 then
        return false;
      end if;
    end loop;
  end if;
  if requested_details ? 'cardio' then
    cardio := requested_details -> 'cardio';
    if requested_activity not in ('cardio', 'mixed')
       or jsonb_typeof(cardio) <> 'object'
       or exists (select 1 from jsonb_object_keys(cardio) k
                  where k not in ('activity', 'distanceKm', 'timeSeconds'))
       or not (cardio ->> 'activity' = any (array[
         'run', 'walk', 'cycle', 'row', 'swim', 'elliptical', 'stairs', 'hike']))
       or not (cardio ? 'distanceKm' or cardio ? 'timeSeconds')
       or (cardio ? 'distanceKm' and jsonb_typeof(cardio -> 'distanceKm') <> 'number')
       or (cardio ? 'timeSeconds' and jsonb_typeof(cardio -> 'timeSeconds') <> 'number') then
      return false;
    end if;
    if coalesce((cardio -> 'distanceKm')::numeric, 1) not between 0.05 and 500
       or coalesce((cardio -> 'timeSeconds')::numeric, 60) not between 30 and 86400
       or coalesce((cardio -> 'timeSeconds')::numeric, 60)
         <> trunc(coalesce((cardio -> 'timeSeconds')::numeric, 60)) then
      return false;
    end if;
  end if;
  return true;
-- A wrongly shaped value can make a check itself fail; that is still invalid.
exception when others then
  return false;
end;
$$;

create or replace function app_private.set_checkin_details(
  requested_checkin_id uuid, requested_details jsonb, requested_at timestamptz
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  viewer app_private.memberships := app_private.actor_current_membership();
  item app_private.workout_checkins%rowtype;
begin
  select * into item from app_private.workout_checkins
  where workout_checkin_id = requested_checkin_id and membership_id = viewer.membership_id
  for update;
  if viewer.membership_id is null or item.workout_checkin_id is null
     or requested_at >= item.submitted_at + interval '1 hour' then
    raise exception 'details unavailable' using errcode = '42501';
  end if;
  -- A retry of the same details is fine; different details after the first are not.
  if item.details is not null then
    if item.details = requested_details then return item.details; end if;
    raise exception 'details already recorded' using errcode = '23505';
  end if;
  if not app_private.valid_workout_details(item.activity_type, requested_details) then
    raise exception 'invalid workout details' using errcode = '22023';
  end if;
  update app_private.workout_checkins set details = requested_details
  where workout_checkin_id = requested_checkin_id;
  return requested_details;
end;
$$;

-- Details for the posts the viewer's feed can show.
create or replace function app_private.proof_details(requested_at timestamptz)
returns table (workout_checkin_id uuid, details jsonb)
language sql stable security definer set search_path = '' as $$
  select f.workout_checkin_id, c.details
  from app_private.proof_feed(requested_at) f
  join app_private.workout_checkins c on c.workout_checkin_id = f.workout_checkin_id
  where c.details is not null;
$$;

revoke all on function app_private.valid_workout_details(app_private.workout_activity_type, jsonb),
  app_private.set_checkin_details(uuid, jsonb, timestamptz),
  app_private.proof_details(timestamptz)
  from public, anon, authenticated;
grant execute on function app_private.valid_workout_details(app_private.workout_activity_type, jsonb),
  app_private.set_checkin_details(uuid, jsonb, timestamptz),
  app_private.proof_details(timestamptz)
  to service_role;

insert into app_private.schema_versions (version) values (35);
