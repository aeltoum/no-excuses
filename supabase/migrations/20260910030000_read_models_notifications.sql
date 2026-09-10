create type app_private.notification_class as enum ('social', 'action');
create type app_private.notification_state as enum ('unread', 'read', 'dismissed', 'resolved', 'expired');
create type app_private.delivery_state as enum ('pending', 'delivered', 'suppressed', 'failed');
create type app_private.member_route_kind as enum ('home', 'task', 'notification', 'season');

create table app_private.member_home_projections (
  membership_id uuid primary key references app_private.memberships(membership_id) on delete restrict,
  group_id uuid not null references app_private.groups(group_id) on delete restrict,
  accountability_week_id uuid references app_private.accountability_weeks(accountability_week_id) on delete restrict,
  week_status app_private.member_week_status,
  locked_target integer,
  completed_workout_count integer not null check (completed_workout_count >= 0),
  needs_you_count integer not null check (needs_you_count >= 0),
  rebuilt_at timestamptz not null
);

create table app_private.group_member_projections (
  viewer_membership_id uuid not null references app_private.memberships(membership_id) on delete restrict,
  subject_membership_id uuid not null references app_private.memberships(membership_id) on delete restrict,
  group_id uuid not null references app_private.groups(group_id) on delete restrict,
  locked_target integer,
  completed_workout_count integer not null check (completed_workout_count >= 0),
  week_status app_private.member_week_status,
  rebuilt_at timestamptz not null,
  primary key (viewer_membership_id, subject_membership_id)
);

create table app_private.season_standing_projections (
  viewer_membership_id uuid not null references app_private.memberships(membership_id) on delete restrict,
  season_id uuid not null references app_private.seasons(season_id) on delete restrict,
  subject_membership_id uuid not null references app_private.memberships(membership_id) on delete restrict,
  crowns integer not null check (crowns >= 0),
  rank integer not null check (rank > 0),
  cochampion boolean not null,
  rebuilt_at timestamptz not null,
  primary key (viewer_membership_id, season_id, subject_membership_id)
);

create table app_private.social_interactions (
  interaction_id uuid primary key,
  group_id uuid not null references app_private.groups(group_id) on delete restrict,
  author_membership_id uuid not null references app_private.memberships(membership_id) on delete restrict,
  recipient_membership_id uuid not null references app_private.memberships(membership_id) on delete restrict,
  kind text not null check (kind in ('reaction', 'message')),
  body text,
  created_at timestamptz not null,
  constraint social_distinct_members check (author_membership_id <> recipient_membership_id),
  constraint social_body_shape check (
    (kind = 'reaction' and body in ('strong', 'fire', 'cheer'))
    or (kind = 'message' and length(btrim(body)) between 1 and 280)
  )
);

create table app_private.notification_preferences (
  account_id uuid primary key references app_private.accounts(account_id) on delete restrict,
  push_enabled boolean not null default true,
  immediate_social_enabled boolean not null default true,
  social_digest_enabled boolean not null default true,
  actions_enabled boolean not null default true,
  notification_time_zone text not null,
  digest_local_time time not null default '18:00',
  changed_at timestamptz not null
);

create table app_private.push_subscriptions (
  subscription_id uuid primary key,
  account_id uuid not null references app_private.accounts(account_id) on delete restrict,
  installation_id uuid not null,
  permission text not null check (permission in ('granted', 'denied', 'revoked')),
  endpoint_digest text not null check (endpoint_digest ~ '^[0-9a-f]{64}$'),
  verified_at timestamptz,
  disabled_at timestamptz,
  unique (account_id, installation_id),
  constraint push_health check (
    (permission = 'granted' and verified_at is not null)
    or permission in ('denied', 'revoked')
  )
);

create table app_private.notification_items (
  notification_id uuid primary key,
  recipient_account_id uuid not null references app_private.accounts(account_id) on delete restrict,
  source_identity text not null,
  class app_private.notification_class not null,
  priority smallint not null check (priority between 1 and 3),
  template_key text not null check (length(template_key) between 1 and 80),
  route_kind app_private.member_route_kind not null,
  route_id uuid,
  state app_private.notification_state not null default 'unread',
  created_at timestamptz not null,
  relevant_until timestamptz not null,
  unique (recipient_account_id, source_identity),
  constraint notification_relevance check (created_at < relevant_until)
);

create table app_private.notification_delivery_work (
  work_id uuid primary key,
  notification_id uuid not null references app_private.notification_items(notification_id) on delete restrict,
  not_before timestamptz not null,
  relevance_expires_at timestamptz not null,
  state app_private.delivery_state not null default 'pending',
  attempts integer not null default 0 check (attempts between 0 and 8),
  suppression_reason text,
  delivered_at timestamptz,
  unique (notification_id),
  constraint delivery_terminal_shape check (
    (state = 'delivered' and delivered_at is not null and suppression_reason is null)
    or (state = 'suppressed' and delivered_at is null and suppression_reason is not null)
    or (state in ('pending', 'failed') and delivered_at is null)
  )
);

create table app_private.notification_budgets (
  account_id uuid not null references app_private.accounts(account_id) on delete restrict,
  local_date date not null,
  class app_private.notification_class not null,
  consumed integer not null default 0 check (consumed between 0 and 3),
  primary key (account_id, local_date, class)
);

create table app_private.push_bundles (
  bundle_id uuid primary key,
  recipient_account_id uuid not null references app_private.accounts(account_id) on delete restrict,
  class app_private.notification_class not null,
  local_date date not null,
  created_at timestamptz not null,
  notification_count integer not null check (notification_count > 0),
  template_key text not null,
  unique (recipient_account_id, class, local_date, created_at)
);

create table app_private.push_bundle_items (
  bundle_id uuid not null references app_private.push_bundles(bundle_id) on delete restrict,
  notification_id uuid not null unique references app_private.notification_items(notification_id) on delete restrict,
  primary key (bundle_id, notification_id)
);

create or replace function app_private.rebuild_group_read_models(
  requested_group_id uuid, requested_at timestamptz
) returns table (home_rows integer, group_rows integer, season_rows integer)
language plpgsql security definer set search_path = '' as $$
declare homes integer; groups_count integer; seasons_count integer;
begin
  delete from app_private.season_standing_projections p where p.viewer_membership_id in (
    select membership_id from app_private.memberships where group_id = requested_group_id);
  delete from app_private.group_member_projections where group_id = requested_group_id;
  delete from app_private.member_home_projections where group_id = requested_group_id;

  insert into app_private.member_home_projections
    (membership_id, group_id, accountability_week_id, week_status, locked_target,
     completed_workout_count, needs_you_count, rebuilt_at)
  select m.membership_id, m.group_id, mw.accountability_week_id, mw.status, mw.target,
    count(distinct wc.workout_checkin_id)::integer,
    case when mw.status = 'active' and count(distinct wc.workout_checkin_id) < mw.target
      then 1 else 0 end,
    requested_at
  from app_private.memberships m
  left join app_private.member_weeks mw on mw.membership_id = m.membership_id
    and exists (select 1 from app_private.accountability_weeks w
      where w.accountability_week_id = mw.accountability_week_id
        and requested_at >= w.starts_at and requested_at < w.ends_at)
  left join app_private.workout_checkins wc on wc.member_week_id = mw.member_week_id
  where m.group_id = requested_group_id and m.ended_at is null
  group by m.membership_id, m.group_id, mw.accountability_week_id, mw.status, mw.target;
  get diagnostics homes = row_count;

  insert into app_private.group_member_projections
    (viewer_membership_id, subject_membership_id, group_id, locked_target,
     completed_workout_count, week_status, rebuilt_at)
  select viewer.membership_id, home.membership_id, requested_group_id,
    home.locked_target, home.completed_workout_count, home.week_status, requested_at
  from app_private.memberships viewer
  cross join app_private.member_home_projections home
  where viewer.group_id = requested_group_id and viewer.ended_at is null
    and home.group_id = requested_group_id;
  get diagnostics groups_count = row_count;

  insert into app_private.season_standing_projections
    (viewer_membership_id, season_id, subject_membership_id, crowns, rank, cochampion, rebuilt_at)
  select audience.membership_id, standing.season_id, standing.membership_id,
    standing.crowns, standing.rank, standing.cochampion, requested_at
  from app_private.season_summary_standings standing
  join app_private.seasons season using (season_id)
  join app_private.season_summary_audience audience using (season_id)
  join app_private.memberships viewer on viewer.membership_id = audience.membership_id
  where season.group_id = requested_group_id and viewer.ended_at is null;
  get diagnostics seasons_count = row_count;
  return query select homes, groups_count, seasons_count;
end;
$$;

create or replace function app_private.read_member_home(requested_at timestamptz)
returns table (membership_id uuid, group_id uuid, accountability_week_id uuid,
  week_status app_private.member_week_status, locked_target integer,
  completed_workout_count integer, needs_you_count integer, rebuilt_at timestamptz)
language sql stable security definer set search_path = '' as $$
  select p.membership_id, p.group_id, p.accountability_week_id, p.week_status,
    p.locked_target, p.completed_workout_count, p.needs_you_count, p.rebuilt_at
  from app_private.member_home_projections p
  join app_private.memberships m using (membership_id)
  where m.account_id = app_private.actor_account_id() and m.ended_at is null
    and p.rebuilt_at <= requested_at
$$;

create or replace function app_private.create_social_interaction(
  requested_interaction_id uuid, requested_recipient_membership_id uuid,
  requested_kind text, requested_body text, requested_at timestamptz
) returns uuid language plpgsql security definer set search_path = '' as $$
declare author app_private.memberships%rowtype; recipient app_private.memberships%rowtype; existing app_private.social_interactions%rowtype;
begin
  select * into author from app_private.memberships where account_id = app_private.actor_account_id() and ended_at is null for update;
  select * into recipient from app_private.memberships where membership_id = requested_recipient_membership_id and ended_at is null;
  if author.membership_id is null or recipient.membership_id is null or author.group_id <> recipient.group_id then
    raise exception 'current same-Group memberships required' using errcode = '42501';
  end if;
  select * into existing from app_private.social_interactions where interaction_id = requested_interaction_id;
  if found then
    if existing.author_membership_id = author.membership_id
      and existing.recipient_membership_id = requested_recipient_membership_id
      and existing.kind = requested_kind and existing.body = requested_body then return existing.interaction_id; end if;
    raise exception 'interaction id conflicts with immutable facts' using errcode = '23505';
  end if;
  insert into app_private.social_interactions values
    (requested_interaction_id, author.group_id, author.membership_id,
     requested_recipient_membership_id, requested_kind, requested_body, requested_at);
  insert into app_private.domain_events
    (event_id, aggregate_id, aggregate_version, event_type, occurred_at, payload)
  values (gen_random_uuid(), requested_interaction_id, 0, 'social.interaction_created',
    requested_at, jsonb_build_object('group_id', author.group_id,
      'recipient_membership_id', requested_recipient_membership_id,
      'kind', requested_kind));
  insert into app_private.outbox(event_id)
    select event_id from app_private.domain_events
    where aggregate_id = requested_interaction_id and aggregate_version = 0;
  insert into app_private.notification_items
    (notification_id, recipient_account_id, source_identity, class, priority,
     template_key, route_kind, route_id, created_at, relevant_until)
  values (gen_random_uuid(), recipient.account_id, 'social:' || requested_interaction_id,
    'social', 3, 'social_response', 'notification', requested_interaction_id,
    requested_at, requested_at + interval '7 days');
  insert into app_private.notification_delivery_work
    (work_id, notification_id, not_before, relevance_expires_at)
  select gen_random_uuid(), notification_id, requested_at, relevant_until
  from app_private.notification_items where recipient_account_id = recipient.account_id
    and source_identity = 'social:' || requested_interaction_id;
  return requested_interaction_id;
end;
$$;

create or replace function app_private.schedule_notification(
  requested_notification_id uuid, requested_account_id uuid, requested_source_identity text,
  requested_class app_private.notification_class, requested_priority integer,
  requested_template_key text, requested_route_kind app_private.member_route_kind,
  requested_route_id uuid, requested_created_at timestamptz, requested_relevant_until timestamptz
) returns uuid language plpgsql security definer set search_path = '' as $$
begin
  insert into app_private.notification_items
    (notification_id, recipient_account_id, source_identity, class, priority,
     template_key, route_kind, route_id, created_at, relevant_until)
  values (requested_notification_id, requested_account_id, requested_source_identity,
    requested_class, requested_priority, requested_template_key, requested_route_kind,
    requested_route_id, requested_created_at, requested_relevant_until)
  on conflict (recipient_account_id, source_identity) do nothing;
  insert into app_private.notification_delivery_work
    (work_id, notification_id, not_before, relevance_expires_at)
  select gen_random_uuid(), notification_id, requested_created_at, requested_relevant_until
  from app_private.notification_items
  where recipient_account_id = requested_account_id and source_identity = requested_source_identity
  on conflict (notification_id) do nothing;
  return (select notification_id from app_private.notification_items
    where recipient_account_id = requested_account_id and source_identity = requested_source_identity);
end;
$$;

create or replace function app_private.dispatch_notification_work(requested_at timestamptz)
returns table (bundle_id uuid, recipient_account_id uuid, class app_private.notification_class,
  notification_count integer)
language plpgsql security definer set search_path = '' as $$
declare candidate record; local_day date; found_bundle uuid; allowed boolean; suppress text;
begin
  for candidate in
    select w.work_id, n.*, coalesce(p.push_enabled, true) push_enabled,
      coalesce(case when n.class = 'social' then p.immediate_social_enabled else p.actions_enabled end, true) class_enabled,
      coalesce(p.notification_time_zone, 'UTC') notification_time_zone
    from app_private.notification_delivery_work w
    join app_private.notification_items n using (notification_id)
    left join app_private.notification_preferences p on p.account_id = n.recipient_account_id
    where w.state = 'pending' and w.not_before <= requested_at
    order by n.recipient_account_id, n.class, n.priority, n.created_at
    for update of w
  loop
    suppress := null;
    allowed := exists (select 1 from app_private.memberships m
      join app_private.accounts a using (account_id)
      where a.account_id = candidate.recipient_account_id and a.status = 'active'
        and m.ended_at is null);
    if not allowed then suppress := 'access_ended';
    elsif candidate.state <> 'unread' then suppress := 'item_not_unread';
    elsif candidate.relevant_until <= requested_at then suppress := 'stale';
    elsif not candidate.push_enabled or not candidate.class_enabled then suppress := 'disabled';
    elsif not exists (select 1 from app_private.push_subscriptions s
      where s.account_id = candidate.recipient_account_id and s.permission = 'granted'
        and s.verified_at is not null and s.disabled_at is null) then suppress := 'permission_unavailable';
    end if;
    if suppress is not null then
      update app_private.notification_delivery_work set state = 'suppressed', suppression_reason = suppress
      where work_id = candidate.work_id;
      continue;
    end if;
    local_day := (requested_at at time zone candidate.notification_time_zone)::date;
    insert into app_private.notification_budgets(account_id, local_date, class)
      values (candidate.recipient_account_id, local_day, candidate.class)
      on conflict do nothing;
    perform 1 from app_private.notification_budgets b
      where b.account_id = candidate.recipient_account_id and b.local_date = local_day
        and b.class = candidate.class for update;
    if (select consumed from app_private.notification_budgets b
      where b.account_id = candidate.recipient_account_id and b.local_date = local_day
        and b.class = candidate.class) >= 3 then
      update app_private.notification_delivery_work set state = 'suppressed', suppression_reason = 'daily_cap'
      where work_id = candidate.work_id;
      continue;
    end if;
    select b.bundle_id into found_bundle from app_private.push_bundles b
      where b.recipient_account_id = candidate.recipient_account_id and b.class = candidate.class
        and b.local_date = local_day and b.created_at = requested_at;
    if not found then
      found_bundle := gen_random_uuid();
      insert into app_private.push_bundles values
        (found_bundle, candidate.recipient_account_id, candidate.class, local_day,
         requested_at, 1, candidate.template_key);
      update app_private.notification_budgets b set consumed = b.consumed + 1
      where b.account_id = candidate.recipient_account_id and b.local_date = local_day
        and b.class = candidate.class;
    else
      update app_private.push_bundles b set notification_count = b.notification_count + 1
      where b.bundle_id = found_bundle;
    end if;
    insert into app_private.push_bundle_items values (found_bundle, candidate.notification_id);
    update app_private.notification_delivery_work set state = 'delivered', attempts = attempts + 1,
      delivered_at = requested_at where work_id = candidate.work_id;
  end loop;
  return query select b.bundle_id, b.recipient_account_id, b.class, b.notification_count
    from app_private.push_bundles b where b.created_at = requested_at order by b.recipient_account_id, b.class;
end;
$$;

create or replace function app_private.resolve_member_route(
  requested_notification_id uuid, requested_at timestamptz
) returns text language plpgsql stable security definer set search_path = '' as $$
declare item app_private.notification_items%rowtype;
begin
  select * into item from app_private.notification_items
    where notification_id = requested_notification_id
      and recipient_account_id = app_private.actor_account_id();
  if not found or item.relevant_until <= requested_at then return '/home?notice=unavailable'; end if;
  if not exists (select 1 from app_private.memberships where account_id = item.recipient_account_id and ended_at is null) then
    return '/home?notice=access-ended';
  end if;
  if item.state in ('resolved', 'expired') then return '/notifications?notice=resolved'; end if;
  return case item.route_kind
    when 'home' then '/home'
    when 'season' then '/season'
    when 'task' then '/tasks/' || item.route_id
    else '/notifications?id=' || item.notification_id end;
end;
$$;

alter table app_private.member_home_projections enable row level security;
alter table app_private.group_member_projections enable row level security;
alter table app_private.season_standing_projections enable row level security;
alter table app_private.social_interactions enable row level security;
alter table app_private.notification_preferences enable row level security;
alter table app_private.push_subscriptions enable row level security;
alter table app_private.notification_items enable row level security;
alter table app_private.notification_delivery_work enable row level security;
alter table app_private.notification_budgets enable row level security;
alter table app_private.push_bundles enable row level security;
alter table app_private.push_bundle_items enable row level security;

revoke all on table app_private.member_home_projections, app_private.group_member_projections,
  app_private.season_standing_projections, app_private.social_interactions,
  app_private.notification_preferences, app_private.push_subscriptions,
  app_private.notification_items, app_private.notification_delivery_work,
  app_private.notification_budgets, app_private.push_bundles,
  app_private.push_bundle_items from public, anon, authenticated;
grant select, insert, update, delete on table app_private.member_home_projections,
  app_private.group_member_projections, app_private.season_standing_projections,
  app_private.social_interactions, app_private.notification_preferences,
  app_private.push_subscriptions, app_private.notification_items,
  app_private.notification_delivery_work, app_private.notification_budgets,
  app_private.push_bundles, app_private.push_bundle_items to service_role;

revoke all on function app_private.rebuild_group_read_models(uuid,timestamptz),
  app_private.create_social_interaction(uuid,uuid,text,text,timestamptz),
  app_private.schedule_notification(uuid,uuid,text,app_private.notification_class,integer,text,app_private.member_route_kind,uuid,timestamptz,timestamptz),
  app_private.dispatch_notification_work(timestamptz) from public, anon, authenticated;
grant execute on function app_private.rebuild_group_read_models(uuid,timestamptz),
  app_private.schedule_notification(uuid,uuid,text,app_private.notification_class,integer,text,app_private.member_route_kind,uuid,timestamptz,timestamptz),
  app_private.dispatch_notification_work(timestamptz) to service_role;
grant execute on function app_private.create_social_interaction(uuid,uuid,text,text,timestamptz),
  app_private.read_member_home(timestamptz), app_private.resolve_member_route(uuid,timestamptz)
  to authenticated, service_role;
revoke all on function app_private.read_member_home(timestamptz),
  app_private.resolve_member_route(uuid,timestamptz) from public, anon;

insert into app_private.schema_versions (version) values (13);
