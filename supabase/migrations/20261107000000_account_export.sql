-- Account data export (owner-approved 2026-10-20): a member downloads their own data as
-- JSON. It covers only what they created or what is about them; other members' content and
-- private moderation details stay out. Photos are listed by date, not as files.

create or replace function app_private.account_export(requested_at timestamptz)
returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare actor app_private.accounts%rowtype;
begin
  select * into actor from app_private.accounts where account_id = app_private.actor_account_id();
  if actor.account_id is null then
    raise exception 'active account required' using errcode = '42501';
  end if;
  return jsonb_build_object(
    'exportedAt', requested_at,
    'account', jsonb_build_object(
      'email', actor.email, 'displayName', actor.display_name, 'createdAt', actor.created_at,
      'adultAttestedAt', actor.adult_attested_at,
      'notifications', jsonb_build_object('socialPush', actor.social_push,
        'dailyDigest', actor.daily_digest, 'digestHour', actor.digest_hour)
    ),
    'consents', coalesce((
      select jsonb_agg(jsonb_build_object('purpose', purpose, 'version', version,
        'grantedAt', granted_at, 'withdrawnAt', withdrawn_at) order by granted_at)
      from app_private.consents where account_id = actor.account_id
    ), '[]'::jsonb),
    'memberships', coalesce((
      select jsonb_agg(jsonb_build_object(
        'group', g.name, 'joinedAt', m.joined_at, 'endedAt', m.ended_at,
        'endReason', m.end_reason, 'recurringTarget', m.recurring_target,
        'targetStreak', m.target_streak,
        'weeks', coalesce((
          select jsonb_agg(jsonb_build_object(
            'startsAt', aw.starts_at, 'endsAt', aw.ends_at, 'target', mw.target,
            'status', mw.status) order by aw.starts_at)
          from app_private.member_weeks mw
          join app_private.accountability_weeks aw on aw.accountability_week_id = mw.accountability_week_id
          where mw.membership_id = m.membership_id
        ), '[]'::jsonb),
        'workouts', coalesce((
          select jsonb_agg(jsonb_build_object(
            'activityType', c.activity_type, 'completedAt', c.completed_at,
            'submittedAt', c.submitted_at, 'durationMinutes', c.duration_minutes,
            'intensity', c.perceived_intensity, 'reviewStatus', c.review_status,
            'details', c.details, 'caption', c.caption,
            'photos', c.activity_photo_path is not null and c.media_deleted_at is null
              and c.removed_at is null) order by c.submitted_at)
          from app_private.workout_checkins c where c.membership_id = m.membership_id
        ), '[]'::jsonb),
        'messages', coalesce((
          select jsonb_agg(jsonb_build_object('body', pm.body, 'at', pm.created_at,
            'hidden', pm.hidden_at is not null) order by pm.created_at)
          from app_private.proof_messages pm where pm.membership_id = m.membership_id
        ), '[]'::jsonb),
        'reactionsGiven', (select count(*)::integer from app_private.proof_reactions
          where membership_id = m.membership_id),
        'nudgesSent', (select count(*)::integer from app_private.nudges
          where from_membership_id = m.membership_id),
        'exceptionRequests', coalesce((
          select jsonb_agg(jsonb_build_object('weekStartsAt', r.week_starts_at,
            'category', r.category, 'note', r.note, 'status', r.status,
            'submittedAt', r.submitted_at) order by r.submitted_at)
          from app_private.exception_requests r where r.membership_id = m.membership_id
        ), '[]'::jsonb),
        'consequences', coalesce((
          select jsonb_agg(jsonb_build_object('reason', o.source_kind, 'status', o.status,
            'createdAt', o.created_at, 'closedAt', o.closed_at) order by o.created_at)
          from app_private.consequence_obligations o where o.membership_id = m.membership_id
        ), '[]'::jsonb),
        'crowns', coalesce((
          select jsonb_agg(jsonb_build_object('category', r.category, 'score', r.score,
            'season', cw.season_number, 'week', cw.week_number) order by cw.crowned_at)
          from app_private.pwa_crown_results r
          join app_private.pwa_crown_weeks cw on cw.accountability_week_id = r.accountability_week_id
          where r.membership_id = m.membership_id and r.winner
        ), '[]'::jsonb)
      ) order by m.joined_at)
      from app_private.memberships m
      join app_private.groups g on g.group_id = m.group_id
      where m.account_id = actor.account_id
    ), '[]'::jsonb),
    'cardUnlocks', coalesce((
      select jsonb_agg(jsonb_build_object('card', c.title, 'milestone', u.milestone,
        'unlockedAt', u.unlocked_at) order by u.unlocked_at)
      from app_private.card_unlocks u
      join app_private.consequence_cards c on c.card_id = u.card_id
      where u.account_id = actor.account_id
    ), '[]'::jsonb)
  );
end;
$$;

revoke all on function app_private.account_export(timestamptz) from public, anon, authenticated;
grant execute on function app_private.account_export(timestamptz) to service_role;

insert into app_private.schema_versions (version) values (41);
