-- Social pushes (reactions, nudges) are no longer capped per day. Each recipient still gets at
-- most one social push per 15 minutes; items inside that window bundle into the next push.
create or replace function app_private.enqueue_social_push(requested_at timestamptz)
returns integer
language plpgsql security definer set search_path = '' as $$
declare
  enqueued integer := 0;
  recipient record;
  names text;
  total integer;
  last_sent timestamptz;
begin
  for recipient in
    with pending as (
      select author.account_id, coalesce(a.display_name, 'A Group member') as sender,
        'reaction' as kind, pr.created_at
      from app_private.proof_reactions pr
      join app_private.workout_checkins c on c.workout_checkin_id = pr.workout_checkin_id
      join app_private.memberships author on author.membership_id = c.membership_id and author.ended_at is null
      join app_private.memberships reactor on reactor.membership_id = pr.membership_id and reactor.ended_at is null
      join app_private.accounts a on a.account_id = reactor.account_id
      where pr.pushed_at is null
      union all
      select target.account_id, coalesce(a.display_name, 'A Group member'), 'nudge', n.created_at
      from app_private.nudges n
      join app_private.memberships target on target.membership_id = n.to_membership_id and target.ended_at is null
      join app_private.memberships sender on sender.membership_id = n.from_membership_id and sender.ended_at is null
      join app_private.accounts a on a.account_id = sender.account_id
      where n.pushed_at is null
    )
    select p.account_id,
      array_agg(distinct p.sender) as senders,
      count(*)::integer as items,
      bool_and(p.kind = 'nudge') as only_nudges,
      bool_and(p.kind = 'reaction') as only_reactions
    from pending p
    join app_private.push_recipients() r on r.account_id = p.account_id
    where p.created_at >= r.since
    group by p.account_id
  loop
    select max(o.created_at) into last_sent
    from app_private.web_push_outbox o
    where o.account_id = recipient.account_id and o.dedupe_key like 'social:%';
    -- Within 15 minutes of the last social push, wait so later items bundle together.
    continue when last_sent is not null and requested_at < last_sent + interval '15 minutes';
    total := array_length(recipient.senders, 1);
    names := recipient.senders[1] || case
      when total = 2 then ' and ' || recipient.senders[2]
      when total > 2 then ' and ' || (total - 1) || ' others' else '' end;
    insert into app_private.web_push_outbox (account_id, dedupe_key, title, body, created_at)
    values (recipient.account_id,
      'social:' || recipient.account_id || ':' || extract(epoch from requested_at)::bigint,
      case
        when recipient.items > 1 and not recipient.only_nudges and not recipient.only_reactions
          then recipient.items || ' new reactions and nudges'
        when recipient.only_nudges then names || ' nudged you'
        else names || ' reacted to your workout' end,
      case when recipient.only_reactions then 'Open No Excuses to see your proof.'
        else 'You are behind this week. No excuses.' end,
      requested_at)
    on conflict (dedupe_key) do nothing;
    enqueued := enqueued + 1;
    update app_private.proof_reactions pr set pushed_at = requested_at
    from app_private.workout_checkins c, app_private.memberships author
    where pr.pushed_at is null and c.workout_checkin_id = pr.workout_checkin_id
      and author.membership_id = c.membership_id and author.account_id = recipient.account_id;
    update app_private.nudges n set pushed_at = requested_at
    from app_private.memberships target
    where n.pushed_at is null and target.membership_id = n.to_membership_id
      and target.account_id = recipient.account_id;
  end loop;
  return enqueued;
end;
$$;

insert into app_private.schema_versions (version) values (26);
