-- Atomic one-time audit-credit fulfillment.
-- The checkout session id is the credit idempotency key. The Stripe event id is recorded
-- in the same transaction as the credit increment, so a crash cannot leave an event row
-- that suppresses a credit that was never granted.
--
-- Historical rows: stripe_events written by the previous handler have no fulfillment row.
-- Re-delivery of that same event id returns 'unreconciled' and does not grant a credit.
-- Do not replay those purchases automatically. See docs/stripe-fulfillment.md.

create table public.audit_credit_fulfillments (
  checkout_session_id text primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  stripe_event_id text not null,
  credits int not null default 1 check (credits = 1),
  created_at timestamptz not null default now()
);

alter table public.audit_credit_fulfillments enable row level security;
revoke all on table public.audit_credit_fulfillments from public, anon, authenticated;
grant select, insert on table public.audit_credit_fulfillments to service_role;

create or replace function public.fulfill_audit_checkout(
  p_event_id text,
  p_event_type text,
  p_session_id text,
  p_user_id uuid,
  p_mode text,
  p_payment_status text,
  p_kind text
) returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  credited int;
begin
  if p_event_id is null or length(btrim(p_event_id)) = 0 then
    return 'ineligible';
  end if;

  if p_mode is distinct from 'payment'
     or p_payment_status is distinct from 'paid'
     or p_kind is distinct from 'audit'
     or p_session_id is null
     or length(btrim(p_session_id)) = 0
     or p_user_id is null
     or not exists (select 1 from auth.users where id = p_user_id)
     or not exists (select 1 from public.entitlements where user_id = p_user_id)
  then
    insert into public.stripe_events (id, type) values (p_event_id, p_event_type)
    on conflict (id) do nothing;
    return 'ineligible';
  end if;

  if exists (select 1 from public.audit_credit_fulfillments where checkout_session_id = p_session_id) then
    insert into public.stripe_events (id, type) values (p_event_id, p_event_type)
    on conflict (id) do nothing;
    return 'duplicate';
  end if;

  -- An event row written before this migration is not proof the credit was applied.
  -- Refuse to guess. Operators reconcile those rows explicitly.
  if exists (select 1 from public.stripe_events where id = p_event_id) then
    return 'unreconciled';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_session_id, 0));

  if exists (select 1 from public.audit_credit_fulfillments where checkout_session_id = p_session_id) then
    insert into public.stripe_events (id, type) values (p_event_id, p_event_type)
    on conflict (id) do nothing;
    return 'duplicate';
  end if;

  insert into public.audit_credit_fulfillments (checkout_session_id, user_id, stripe_event_id)
  values (p_session_id, p_user_id, p_event_id);

  update public.entitlements
    set audit_credits = audit_credits + 1, updated_at = now()
    where user_id = p_user_id;
  get diagnostics credited = row_count;
  if credited <> 1 then
    raise exception 'ENTITLEMENT_MISSING';
  end if;

  insert into public.stripe_events (id, type) values (p_event_id, p_event_type);
  return 'granted';
end;
$$;

revoke all on function public.fulfill_audit_checkout(text, text, text, uuid, text, text, text) from public, anon, authenticated;
grant execute on function public.fulfill_audit_checkout(text, text, text, uuid, text, text, text) to service_role;
