-- Missed-target events with supportive responses (owner-approved 2026-10-20). For five days
-- after a week ends, each member who missed it shows as a neutral Group-visible event. Any
-- current member, the affected one included, may leave one preset playful or supportive
-- response and change it; there is no free text. The affected member gets a push per responder.

create table app_private.missed_week_responses (
  member_week_id uuid not null references app_private.member_weeks(member_week_id) on delete cascade,
  membership_id uuid not null references app_private.memberships(membership_id) on delete cascade,
  response text not null check (response in ('next_week', 'got_you', 'bounce_back', 'rest_up', 'no_excuses')),
  created_at timestamptz not null,
  pushed_at timestamptz,
  primary key (member_week_id, membership_id)
);

-- The exceptions part keeps its name-qualified shape; home_extras composes the parts.
alter function app_private.home_extras(timestamptz) rename to home_extras_exceptions;

create or replace function app_private.home_missed(requested_at timestamptz)
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
      'completed', (select count(*)::integer from app_private.workout_checkins c
        where c.member_week_id = mw.member_week_id and c.review_status = 'verified'),
      'target', mw.target,
      'endsAt', aw.ends_at,
      'responses', coalesce((
        select jsonb_agg(jsonb_build_object('response', r.response, 'count', r.total)
          order by r.total desc, r.response)
        from (
          select response, count(*)::integer as total
          from app_private.missed_week_responses
          where member_week_id = mw.member_week_id group by response
        ) r
      ), '[]'::jsonb),
      'myResponse', (
        select response from app_private.missed_week_responses
        where member_week_id = mw.member_week_id and membership_id = viewer.membership_id
      )
    ) order by aw.ends_at desc, m.joined_at)
    from app_private.member_weeks mw
    join app_private.accountability_weeks aw on aw.accountability_week_id = mw.accountability_week_id
    join app_private.memberships m on m.membership_id = mw.membership_id
    where m.group_id = viewer.group_id and m.ended_at is null
      and mw.status = 'missed'
      and aw.ends_at > requested_at - interval '5 days'
      and aw.ends_at > viewer.joined_at
  ), '[]'::jsonb);
end;
$$;

create or replace function app_private.home_extras(requested_at timestamptz)
returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  return app_private.home_extras_exceptions(requested_at)
    || jsonb_build_object('missed', app_private.home_missed(requested_at));
end;
$$;

create or replace function app_private.respond_to_missed_week(
  requested_member_week_id uuid, requested_response text, requested_at timestamptz
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare viewer app_private.memberships := app_private.actor_current_membership();
begin
  if viewer.membership_id is null or not exists (
    select 1 from app_private.member_weeks mw
    join app_private.accountability_weeks aw on aw.accountability_week_id = mw.accountability_week_id
    join app_private.memberships m on m.membership_id = mw.membership_id
    where mw.member_week_id = requested_member_week_id and mw.status = 'missed'
      and m.group_id = viewer.group_id and m.ended_at is null
      and aw.ends_at > requested_at - interval '5 days' and aw.ends_at > viewer.joined_at
  ) then
    raise exception 'response unavailable' using errcode = '42501';
  end if;
  if requested_response is null then
    delete from app_private.missed_week_responses
    where member_week_id = requested_member_week_id and membership_id = viewer.membership_id;
  else
    insert into app_private.missed_week_responses
      (member_week_id, membership_id, response, created_at)
    values (requested_member_week_id, viewer.membership_id, requested_response, requested_at)
    on conflict (member_week_id, membership_id)
      do update set response = excluded.response;
  end if;
  return app_private.home_extras(requested_at);
end;
$$;

-- One push to the affected member per responder; their own responses send nothing.
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
    returning r.member_week_id, r.membership_id, mw.membership_id as affected
  )
  insert into app_private.web_push_outbox (account_id, dedupe_key, title, body)
  select m.account_id, 'missed-response:' || due.member_week_id || ':' || due.membership_id,
    app_private.member_label(due.membership_id) || ' has your back',
    'They responded to your missed week. New week, new plates.'
  from due
  join app_private.memberships m on m.membership_id = due.affected and m.ended_at is null
  join app_private.push_recipients() s on s.account_id = m.account_id
  on conflict (dedupe_key) do nothing;
  get diagnostics added = row_count;
  return added;
end;
$$;

alter table app_private.missed_week_responses enable row level security;
revoke all on table app_private.missed_week_responses from public, anon, authenticated;
grant select, insert, update, delete on table app_private.missed_week_responses to service_role;
revoke all on function app_private.home_missed(timestamptz),
  app_private.home_extras(timestamptz),
  app_private.respond_to_missed_week(uuid, text, timestamptz),
  app_private.enqueue_missed_response_push(timestamptz)
  from public, anon, authenticated;
grant execute on function app_private.home_missed(timestamptz),
  app_private.home_extras(timestamptz),
  app_private.respond_to_missed_week(uuid, text, timestamptz),
  app_private.enqueue_missed_response_push(timestamptz)
  to service_role;

insert into app_private.schema_versions (version) values (34);
