insert into app_private.accounts
  (account_id, auth_user_id, email, adult_attested_at)
values
  ('91000000-0000-4000-8000-000000000001',
   '92000000-0000-4000-8000-000000000001', 'settlement-viewer@example.test', now()),
  ('91000000-0000-4000-8000-000000000002',
   '92000000-0000-4000-8000-000000000002', 'settlement-peer@example.test', now());
insert into app_private.groups
  (group_id, name, time_zone, status, activation_at)
values
  ('93000000-0000-4000-8000-000000000001', 'Settlement Group', 'UTC',
   'active', '2026-03-01Z');
insert into app_private.memberships
  (membership_id, account_id, group_id, joined_at, recurring_target)
values
  ('94000000-0000-4000-8000-000000000001',
   '91000000-0000-4000-8000-000000000001',
   '93000000-0000-4000-8000-000000000001', '2026-03-02Z', 2),
  ('94000000-0000-4000-8000-000000000002',
   '91000000-0000-4000-8000-000000000002',
   '93000000-0000-4000-8000-000000000001', '2026-02-20Z', 2);
insert into app_private.accountability_weeks
  (accountability_week_id, group_id, starts_at, ends_at, time_zone, activation_at)
values
  ('95000000-0000-4000-8000-000000000001',
   '93000000-0000-4000-8000-000000000001',
   '2026-03-02Z', '2026-03-09Z', 'UTC', '2026-03-02Z'),
  ('95000000-0000-4000-8000-000000000002',
   '93000000-0000-4000-8000-000000000001',
   '2026-02-23Z', '2026-03-02T12:00Z', 'UTC', '2026-02-23Z'),
  ('95000000-0000-4000-8000-000000000003',
   '93000000-0000-4000-8000-000000000001',
   '2026-02-16Z', '2026-02-23Z', 'UTC', '2026-02-16Z');
insert into app_private.member_weeks
  (member_week_id, membership_id, accountability_week_id, target, target_locked_at, status)
values
  ('96000000-0000-4000-8000-000000000001',
   '94000000-0000-4000-8000-000000000001',
   '95000000-0000-4000-8000-000000000001', 2, '2026-03-02Z', 'active'),
  ('96000000-0000-4000-8000-000000000002',
   '94000000-0000-4000-8000-000000000002',
   '95000000-0000-4000-8000-000000000001', 2, '2026-03-02Z', 'active'),
  ('96000000-0000-4000-8000-000000000003',
   '94000000-0000-4000-8000-000000000002',
   '95000000-0000-4000-8000-000000000002', 2, '2026-02-23Z', 'attained'),
  ('96000000-0000-4000-8000-000000000004',
   '94000000-0000-4000-8000-000000000002',
   '95000000-0000-4000-8000-000000000003', 2, '2026-02-16Z', 'missed');
insert into app_private.workout_checkins
  (workout_checkin_id, member_week_id, membership_id, activity_type,
   completed_at, duration_minutes, perceived_intensity,
   self_report_attested, submitted_at)
values
  ('97000000-0000-4000-8000-000000000001',
   '96000000-0000-4000-8000-000000000001',
   '94000000-0000-4000-8000-000000000001', 'cardio',
   '2026-03-03Z', 30, 'moderate', true, '2026-03-03Z'),
  ('97000000-0000-4000-8000-000000000002',
   '96000000-0000-4000-8000-000000000001',
   '94000000-0000-4000-8000-000000000001', 'strength',
   '2026-03-05Z', 40, 'high', true, '2026-03-05Z'),
  ('97000000-0000-4000-8000-000000000003',
   '96000000-0000-4000-8000-000000000002',
   '94000000-0000-4000-8000-000000000002', 'class',
   '2026-03-04Z', 45, 'moderate', true, '2026-03-04Z');

do $$
begin
  if app_private.finalize_ended_member_weeks('2026-03-08T23:59:59Z') <> 0 then
    raise exception 'weekly settlement ran before accountability-week cutoff';
  end if;
  if app_private.finalize_ended_member_weeks('2026-03-09Z') <> 2 then
    raise exception 'weekly settlement did not finalize both active member-weeks';
  end if;
  if app_private.finalize_ended_member_weeks('2026-03-09Z') <> 0 then
    raise exception 'weekly settlement replay was not idempotent';
  end if;
  if (select status from app_private.member_weeks
      where member_week_id = '96000000-0000-4000-8000-000000000001') <> 'attained'
     or (select status from app_private.member_weeks
         where member_week_id = '96000000-0000-4000-8000-000000000002') <> 'missed' then
    raise exception 'weekly settlement outcomes did not match locked targets and check-ins';
  end if;
  if (select status from app_private.member_weeks
      where member_week_id = '96000000-0000-4000-8000-000000000003') <> 'attained' then
    raise exception 'weekly settlement rewrote a terminal outcome';
  end if;
end $$;

select set_config('app.auth_user_id', '92000000-0000-4000-8000-000000000001', false);
select set_config('app.token_issued_at', '2026-03-10T10:00Z', false);
set role authenticated;
do $$
begin
  if (select count(*) from app_private.finalized_weekly_history(
        '93000000-0000-4000-8000-000000000001')) <> 3 then
    raise exception 'weekly history did not include current and overlapping weeks';
  end if;
  if not exists (
    select from app_private.finalized_weekly_history(
      '93000000-0000-4000-8000-000000000001')
    where membership_id = '94000000-0000-4000-8000-000000000001'
      and outcome = 'attained' and locked_target = 2 and completed_workout_count = 2
  ) or not exists (
    select from app_private.finalized_weekly_history(
      '93000000-0000-4000-8000-000000000001')
    where membership_id = '94000000-0000-4000-8000-000000000002'
      and outcome = 'missed' and locked_target = 2 and completed_workout_count = 1
  ) then
    raise exception 'weekly history did not retain Met and Missed counts';
  end if;
  if exists (
    select from app_private.finalized_weekly_history(
      '93000000-0000-4000-8000-000000000001')
    where ends_at <= '2026-03-02Z'
  ) then
    raise exception 'weekly history exposed fully pre-membership history';
  end if;
  if not exists (
    select from app_private.finalized_weekly_history(
      '93000000-0000-4000-8000-000000000001')
    where ends_at = '2026-03-02T12:00Z'
      and membership_id = '94000000-0000-4000-8000-000000000002'
  ) then
    raise exception 'weekly history hid membership-overlapping history';
  end if;
end $$;
reset role;
