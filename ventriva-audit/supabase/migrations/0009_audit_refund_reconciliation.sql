-- Replace the original refund RPC with a purchase-scoped transaction.
drop function if exists public.clawback_audit_credit(text, uuid);

alter table public.audit_credit_fulfillments add column refunded_at timestamptz;

create function public.clawback_audit_credit(p_event_id text, p_session_id text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  purchase public.audit_credit_fulfillments%rowtype;
begin
  -- Use the same lock as checkout fulfillment.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_session_id, 0));

  select * into purchase from public.audit_credit_fulfillments
    where checkout_session_id = p_session_id;
  if not found then
    raise exception 'REFUND_CHECKOUT_NOT_FULFILLED';
  end if;

  insert into public.stripe_events (id, type) values (p_event_id, 'charge.refunded')
    on conflict (id) do nothing;
  if not found or purchase.refunded_at is not null then
    return 'duplicate';
  end if;

  update public.audit_credit_fulfillments set refunded_at = now()
    where checkout_session_id = p_session_id;

  update public.entitlements set audit_credits = audit_credits - 1, updated_at = now()
    where user_id = purchase.user_id and audit_credits > 0;
  if not found then
    return 'no_credit';
  end if;
  return 'decremented';
end;
$$;

revoke all on function public.clawback_audit_credit(text, text) from public, anon, authenticated;
grant execute on function public.clawback_audit_credit(text, text) to service_role;
