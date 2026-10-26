-- Viewing what a notification points at removes it from the bell list. Delivery is unchanged.
alter table app_private.web_push_outbox add column dismissed_at timestamptz;

create or replace function app_private.dismiss_notifications(requested_ids bigint[], requested_at timestamptz)
returns integer
language plpgsql security definer set search_path = '' as $$
declare changed integer;
begin
  update app_private.web_push_outbox
  set dismissed_at = requested_at
  where account_id = app_private.actor_account_id()
    and outbox_id = any(requested_ids) and dismissed_at is null;
  get diagnostics changed = row_count;
  return changed;
end;
$$;

create or replace function app_private.notification_center(requested_at timestamptz)
returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare actor app_private.accounts%rowtype;
begin
  select * into actor from app_private.accounts where account_id = app_private.actor_account_id();
  if actor.account_id is null then
    raise exception 'active account required' using errcode = '42501';
  end if;
  return jsonb_build_object(
    'items', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', o.outbox_id, 'title', o.title, 'body', o.body, 'at', o.created_at,
        'unread', o.created_at > coalesce(actor.notifications_seen_at, '-infinity'::timestamptz),
        'kind', split_part(o.dedupe_key, ':', 1),
        'ref', split_part(o.dedupe_key, ':', 2)
      ) order by o.created_at desc, o.outbox_id desc)
      from (
        select * from app_private.web_push_outbox
        where account_id = actor.account_id and created_at > requested_at - interval '30 days'
          and created_at > coalesce(actor.notifications_cleared_at, '-infinity'::timestamptz)
          and dismissed_at is null
        order by created_at desc, outbox_id desc limit 60
      ) o
    ), '[]'::jsonb),
    'prefs', jsonb_build_object(
      'socialPush', actor.social_push, 'digest', actor.daily_digest, 'digestHour', actor.digest_hour
    )
  );
end;
$$;

revoke all on function app_private.dismiss_notifications(bigint[], timestamptz)
  from public, anon, authenticated;
grant execute on function app_private.dismiss_notifications(bigint[], timestamptz) to service_role;

insert into app_private.schema_versions (version) values (47);
