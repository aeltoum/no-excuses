create or replace function app_private.read_notification_center(requested_at timestamptz)
returns table (
  notification_id uuid,
  class app_private.notification_class,
  priority smallint,
  template_key text,
  state app_private.notification_state,
  created_at timestamptz,
  relevant_until timestamptz
)
language sql stable security definer set search_path = '' as $$
  select item.notification_id, item.class, item.priority, item.template_key,
    item.state, item.created_at, item.relevant_until
  from app_private.notification_items item
  join app_private.accounts account on account.account_id = item.recipient_account_id
  where item.recipient_account_id = app_private.actor_account_id()
    and account.status = 'active'
    and item.state in ('unread', 'read')
    and item.created_at <= requested_at
    and item.relevant_until > requested_at
    and exists (
      select 1 from app_private.memberships membership
      where membership.account_id = item.recipient_account_id
        and membership.ended_at is null
    )
  order by
    case item.state when 'unread' then 0 else 1 end,
    item.priority,
    item.created_at desc,
    item.notification_id
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
  if item.state not in ('unread', 'read') then return '/notifications?notice=resolved'; end if;
  return case
    when item.route_kind = 'home' then '/home'
    when item.route_kind = 'season' then '/season'
    when item.route_kind = 'task' and item.route_id is not null then '/tasks/' || item.route_id
    when item.route_kind = 'notification' then '/notifications?id=' || item.notification_id
    else '/home?notice=unavailable'
  end;
end;
$$;

revoke all on function app_private.read_notification_center(timestamptz) from public, anon;
grant execute on function app_private.read_notification_center(timestamptz) to authenticated, service_role;

insert into app_private.schema_versions (version) values (14);
