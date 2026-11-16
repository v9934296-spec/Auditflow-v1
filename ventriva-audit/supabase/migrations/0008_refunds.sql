-- Refund clawback: remove one unused audit credit when a one-time audit purchase is refunded.
-- Idempotent via stripe_events.

create or replace function clawback_audit_credit(
  p_event_id text,
  p_user_id uuid
) returns text
language plpgsql
security definer
as $$
declare
  v_existing text;
begin
  -- Idempotency
  select id into v_existing from stripe_events where id = p_event_id;
  if found then
    return 'duplicate';
  end if;

  -- Only decrement if a credit remains
  update profiles
     set audit_credits = audit_credits - 1
   where id = p_user_id
     and audit_credits > 0;

  if not found then
    -- Still record the event so retries are no-ops
    insert into stripe_events (id, type, created_at)
    values (p_event_id, 'charge.refunded', now())
    on conflict do nothing;
    return 'no_credit';
  end if;

  insert into stripe_events (id, type, created_at)
  values (p_event_id, 'charge.refunded', now())
  on conflict do nothing;

  return 'decremented';
end;
$$;
