-- M5: Audit subscription updates remain product-scoped and atomic.
-- Ventriva validation entitlements continue to live in the legacy Mongo ledger.
-- Apply to staging before deploying the webhook implementation using this RPC.
-- This migration does NOT migrate customers, charges, subscription IDs, or credits.

alter table public.subscriptions
  add column if not exists last_event_created bigint not null default 0;

create or replace function public.apply_audit_subscription_event(
  p_event_id text,
  p_event_type text,
  p_event_created bigint,
  p_subscription_id text,
  p_customer_id text,
  p_user_id uuid,
  p_price_id text,
  p_expected_price_id text,
  p_status text,
  p_period_start timestamptz,
  p_period_end timestamptz,
  p_cancel_at_period_end boolean
) returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  entitlement_period timestamptz;
  effective_start timestamptz;
  effective_end timestamptz;
  previous_event bigint;
  previous_owner uuid;
begin
  if p_event_id is null or length(btrim(p_event_id)) = 0
    or p_subscription_id is null or length(btrim(p_subscription_id)) = 0
    or p_event_created is null or p_event_created <= 0
    or p_customer_id is null or length(btrim(p_customer_id)) = 0
    or p_user_id is null
    or p_price_id is null or p_price_id <> p_expected_price_id
    or p_status is null or p_status not in
      ('active', 'trialing', 'past_due', 'canceled', 'unpaid', 'incomplete', 'incomplete_expired', 'paused')
    or p_period_start is null or p_period_end is null
    or p_period_end <= p_period_start
    or p_cancel_at_period_end is null
  then
    raise exception 'INVALID_AUDIT_SUBSCRIPTION_EVENT';
  end if;

  -- Serialize updates per account. The linked Stripe customer must be the one
  -- owned by the authenticated Supabase account, never just event metadata.
  perform 1 from public.profiles
    where id = p_user_id and stripe_customer_id = p_customer_id
    for update;
  if not found then
    raise exception 'STRIPE_CUSTOMER_OWNERSHIP_MISMATCH';
  end if;

  -- Processed events and entitlements commit together or roll back together.
  insert into public.stripe_events(id, type) values (p_event_id, p_event_type)
    on conflict (id) do nothing;
  if not found then return 'duplicate'; end if;

  select s.user_id, s.last_event_created
    into previous_owner, previous_event
    from public.subscriptions s
    where s.id = p_subscription_id for update;
  if previous_owner is not null and previous_owner <> p_user_id then
    raise exception 'SUBSCRIPTION_OWNER_MISMATCH';
  end if;
  -- The Stripe object is fetched fresh server-side. Older events cannot
  -- overwrite a newer snapshot even when deliveries arrive out of order.
  if coalesce(previous_event, 0) > p_event_created then return 'stale'; end if;

  insert into public.subscriptions (
    id, user_id, status, price_id, current_period_start, current_period_end,
    cancel_at_period_end, last_event_created, updated_at
  ) values (
    p_subscription_id, p_user_id, p_status, p_price_id, p_period_start,
    p_period_end, p_cancel_at_period_end, p_event_created, now()
  )
  on conflict (id) do update set
    status = excluded.status, price_id = excluded.price_id,
    current_period_start = excluded.current_period_start,
    current_period_end = excluded.current_period_end,
    cancel_at_period_end = excluded.cancel_at_period_end,
    last_event_created = excluded.last_event_created,
    updated_at = now();

  -- Recompute from all AuditFlow subscriptions. Canceling one subscription
  -- must not revoke another active audit Pro subscription for this account.
  select e.period_start into entitlement_period
    from public.entitlements e where e.user_id = p_user_id for update;
  if not found then raise exception 'ENTITLEMENT_MISSING'; end if;
  select s.current_period_start, s.current_period_end
    into effective_start, effective_end
    from public.subscriptions s
    where s.user_id = p_user_id and s.status in ('active','trialing','past_due')
    order by s.current_period_end desc, s.last_event_created desc, s.id desc
    limit 1;

  update public.entitlements
    set plan = case when effective_start is not null then 'pro'::public.plan_tier else 'free'::public.plan_tier end,
        period_start = effective_start,
        period_end = effective_end,
        rechecks_used = case when entitlement_period is distinct from effective_start then 0 else rechecks_used end,
        updated_at = now()
    where user_id = p_user_id;

  if effective_start is null then
    update public.repositories set monitoring_enabled = false where user_id = p_user_id;
  end if;
  return 'applied';
end;
$$;

revoke all on function public.apply_audit_subscription_event(
  text, text, bigint, text, text, uuid, text, text, text, timestamptz, timestamptz, boolean
) from public, anon, authenticated;
grant execute on function public.apply_audit_subscription_event(
  text, text, bigint, text, text, uuid, text, text, text, timestamptz, timestamptz, boolean
) to service_role;
