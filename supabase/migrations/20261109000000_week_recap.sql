-- Week recap (owner-asked 2026-10-20): replaces the five-day missed-week note. For the first day
-- after a week ends, Home shows each settled member week, met or missed. Any current member may
-- react with one emoji of their choice, and change or clear it. The affected member gets a push
-- per reactor; their own reaction sends nothing.

alter table app_private.missed_week_responses
  drop constraint missed_week_responses_response_check;
update app_private.missed_week_responses set response = case response
  when 'next_week' then '💪' when 'got_you' then '🤝' when 'bounce_back' then '🔁'
  when 'rest_up' then '😴' when 'no_excuses' then '😤' else response end;
-- The API checks for a single emoji; the database bounds size and bars text.
alter table app_private.missed_week_responses add constraint missed_week_responses_emoji check (
  char_length(response) between 1 and 16 and response !~ '[[:alnum:][:space:]]'
);

-- A week shows while it is settled and less than a day past its end.
create or replace function app_private.recap_week_open(
  requested_member_week_id uuid, requested_group_id uuid, requested_joined_at timestamptz,
  requested_at timestamptz
) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from app_private.member_weeks mw
    join app_private.accountability_weeks aw on aw.accountability_week_id = mw.accountability_week_id
    join app_private.memberships m on m.membership_id = mw.membership_id
    where mw.member_week_id = requested_member_week_id
      and mw.status in ('attained', 'missed')
      and m.group_id = requested_group_id and m.ended_at is null
      and requested_at >= aw.ends_at and requested_at < aw.ends_at + interval '1 day'
      and aw.ends_at > requested_joined_at
  );
$$;

create or replace function app_private.home_recap(requested_at timestamptz)
returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare viewer app_private.memberships := app_private.actor_current_membership();
begin
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'memberWeekId', mw.member_week_id,
      'membershipId', m.membership_id,
      'name', app_private.member_label(m.membership_id),
      'mine', m.membership_id = viewer.membership_id,
      'met', mw.status = 'attained',
      'completed', (select count(*)::integer from app_private.workout_checkins c
        where c.member_week_id = mw.member_week_id and c.review_status = 'verified'),
      'target', mw.target,
      'activityTypes', coalesce((
        select jsonb_agg(c.activity_type::text order by c.completed_at)
        from app_private.workout_checkins c
        where c.member_week_id = mw.member_week_id and c.review_status = 'verified'
      ), '[]'::jsonb),
      'endsAt', aw.ends_at,
      'reactions', coalesce((
        select jsonb_agg(jsonb_build_object('emoji', r.response, 'count', r.total)
          order by r.total desc, r.first_at)
        from (
          select response, count(*)::integer as total, min(created_at) as first_at
          from app_private.missed_week_responses
          where member_week_id = mw.member_week_id group by response
        ) r
      ), '[]'::jsonb),
      'myReaction', (
        select response from app_private.missed_week_responses
        where member_week_id = mw.member_week_id and membership_id = viewer.membership_id
      )
    ) order by mw.status = 'attained' desc, m.membership_id <> viewer.membership_id, m.joined_at)
    from app_private.member_weeks mw
    join app_private.accountability_weeks aw on aw.accountability_week_id = mw.accountability_week_id
    join app_private.memberships m on m.membership_id = mw.membership_id
    where app_private.recap_week_open(mw.member_week_id, viewer.group_id, viewer.joined_at, requested_at)
  ), '[]'::jsonb);
end;
$$;

create or replace function app_private.home_extras(requested_at timestamptz)
returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  return app_private.home_extras_exceptions(requested_at)
    || jsonb_build_object(
      'recap', app_private.home_recap(requested_at),
      'season', app_private.season_home(requested_at),
      'unlocks', app_private.home_unlocks(requested_at),
      'unreadNotifications', app_private.notification_unread(requested_at),
      'safety', app_private.home_safety(requested_at),
      'session', app_private.my_session(requested_at)
    );
end;
$$;

-- Sets, changes, or (with null) clears the viewer's one reaction on a recap week.
create or replace function app_private.react_to_recap(
  requested_member_week_id uuid, requested_emoji text, requested_at timestamptz
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare viewer app_private.memberships := app_private.actor_current_membership();
begin
  if viewer.membership_id is null or not app_private.recap_week_open(
    requested_member_week_id, viewer.group_id, viewer.joined_at, requested_at
  ) then
    raise exception 'reaction unavailable' using errcode = '42501';
  end if;
  if requested_emoji is null then
    delete from app_private.missed_week_responses
    where member_week_id = requested_member_week_id and membership_id = viewer.membership_id;
  else
    insert into app_private.missed_week_responses
      (member_week_id, membership_id, response, created_at)
    values (requested_member_week_id, viewer.membership_id, requested_emoji, requested_at)
    on conflict (member_week_id, membership_id)
      do update set response = excluded.response;
  end if;
  return app_private.home_extras(requested_at);
end;
$$;

-- The 'missed-response:' key keeps these under the member's social-push mute.
create or replace function app_private.enqueue_missed_response_push(requested_at timestamptz)
returns integer
language plpgsql security definer set search_path = '' as $$
declare added integer;
begin
  with due as (
    update app_private.missed_week_responses r set pushed_at = requested_at
    from app_private.member_weeks mw
    where mw.member_week_id = r.member_week_id and r.pushed_at is null
      and r.membership_id <> mw.membership_id
    returning r.member_week_id, r.membership_id, r.response, mw.membership_id as affected,
      mw.status = 'attained' as met
  )
  insert into app_private.web_push_outbox (account_id, dedupe_key, title, body)
  select m.account_id, 'missed-response:' || due.member_week_id || ':' || due.membership_id,
    app_private.member_label(due.membership_id) || ' reacted ' || due.response,
    case when due.met then 'To your week. Target hit.'
      else 'To your missed week. New week, new plates.' end
  from due
  join app_private.memberships m on m.membership_id = due.affected and m.ended_at is null
  join app_private.push_recipients() s on s.account_id = m.account_id
  on conflict (dedupe_key) do nothing;
  get diagnostics added = row_count;
  return added;
end;
$$;

drop function app_private.respond_to_missed_week(uuid, text, timestamptz);
drop function app_private.home_missed(timestamptz);

revoke all on function app_private.recap_week_open(uuid, uuid, timestamptz, timestamptz),
  app_private.home_recap(timestamptz),
  app_private.home_extras(timestamptz),
  app_private.react_to_recap(uuid, text, timestamptz),
  app_private.enqueue_missed_response_push(timestamptz)
  from public, anon, authenticated;
grant execute on function app_private.recap_week_open(uuid, uuid, timestamptz, timestamptz),
  app_private.home_recap(timestamptz),
  app_private.home_extras(timestamptz),
  app_private.react_to_recap(uuid, text, timestamptz),
  app_private.enqueue_missed_response_push(timestamptz)
  to service_role;

insert into app_private.schema_versions (version) values (43);
