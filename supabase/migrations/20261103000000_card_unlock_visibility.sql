-- Card unlocks made visible (owner-approved 2026-10-20). Unlocks at Target streaks of 1, 2, 4,
-- and 8 weeks already add a progression card to friends' Card pools; members now see the cards
-- they have added and get one push per unlock.

create or replace function app_private.home_unlocks(requested_at timestamptz)
returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'title', c.title, 'milestone', u.milestone, 'unlockedAt', u.unlocked_at,
    'recent', u.unlocked_at > requested_at - interval '7 days'
  ) order by u.unlocked_at desc), '[]'::jsonb)
  from app_private.card_unlocks u
  join app_private.consequence_cards c on c.card_id = u.card_id
  where u.account_id = app_private.actor_account_id() and c.retired_at is null;
$$;

create or replace function app_private.home_extras(requested_at timestamptz)
returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  return app_private.home_extras_exceptions(requested_at)
    || jsonb_build_object(
      'missed', app_private.home_missed(requested_at),
      'season', app_private.season_home(requested_at),
      'unlocks', app_private.home_unlocks(requested_at)
    );
end;
$$;

create or replace function app_private.enqueue_unlock_push(requested_at timestamptz)
returns integer
language plpgsql security definer set search_path = '' as $$
declare added integer;
begin
  insert into app_private.web_push_outbox (account_id, dedupe_key, title, body)
  select u.account_id, 'unlock:' || u.card_unlock_id,
    u.milestone || '-week streak: card unlocked',
    '“' || c.title || '” is now in your crew’s Consequence deck.'
  from app_private.card_unlocks u
  join app_private.consequence_cards c on c.card_id = u.card_id
  join app_private.push_recipients() s on s.account_id = u.account_id
  where u.unlocked_at > requested_at - interval '1 day' and u.unlocked_at >= s.since
  on conflict (dedupe_key) do nothing;
  get diagnostics added = row_count;
  return added;
end;
$$;

revoke all on function app_private.home_unlocks(timestamptz),
  app_private.home_extras(timestamptz),
  app_private.enqueue_unlock_push(timestamptz)
  from public, anon, authenticated;
grant execute on function app_private.home_unlocks(timestamptz),
  app_private.home_extras(timestamptz),
  app_private.enqueue_unlock_push(timestamptz)
  to service_role;

insert into app_private.schema_versions (version) values (37);
