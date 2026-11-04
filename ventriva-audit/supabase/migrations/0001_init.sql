-- Ventriva Audit — initial schema
-- Security model:
--   * Every table has RLS enabled.
--   * Authenticated users may only SELECT their own rows.
--   * All writes happen server-side with the service role (API routes, webhooks, Trigger.dev worker).
--   * Billing/entitlement mutations go through SECURITY DEFINER functions with row locks.

create extension if not exists "pgcrypto";

-- ───────────────────────── Enums ─────────────────────────
create type audit_kind as enum ('free_scan', 'full_audit', 'recheck', 'monitor');
create type audit_status as enum ('queued', 'running', 'completed', 'failed');
create type finding_severity as enum ('critical', 'high', 'medium', 'low', 'info');
create type finding_priority as enum ('P0', 'P1', 'P2', 'P3');
create type evidence_tier as enum ('verified', 'suspected', 'not_tested');
create type finding_change as enum ('new', 'unresolved', 'fixed', 'regressed');
create type plan_tier as enum ('free', 'pro');

-- ───────────────────────── Profiles ─────────────────────────
create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  email text not null,
  stripe_customer_id text unique,
  created_at timestamptz not null default now()
);

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email) values (new.id, coalesce(new.email, ''));
  insert into public.entitlements (user_id) values (new.id);
  return new;
end;
$$;

-- ───────────────────────── Entitlements ─────────────────────────
create table public.entitlements (
  user_id uuid primary key references auth.users (id) on delete cascade,
  plan plan_tier not null default 'free',
  free_scans_used int not null default 0 check (free_scans_used >= 0),
  audit_credits int not null default 0 check (audit_credits >= 0),
  rechecks_used int not null default 0 check (rechecks_used >= 0),
  period_start timestamptz,
  period_end timestamptz,
  updated_at timestamptz not null default now()
);

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ───────────────────────── Billing ─────────────────────────
create table public.subscriptions (
  id text primary key, -- Stripe subscription id
  user_id uuid not null references auth.users (id) on delete cascade,
  status text not null,
  price_id text not null,
  current_period_start timestamptz not null,
  current_period_end timestamptz not null,
  cancel_at_period_end boolean not null default false,
  updated_at timestamptz not null default now()
);
create index subscriptions_user_idx on public.subscriptions (user_id);

create table public.stripe_events (
  id text primary key, -- Stripe event id (idempotency)
  type text not null,
  processed_at timestamptz not null default now()
);

-- ───────────────────────── GitHub ─────────────────────────
create table public.github_installations (
  id bigint primary key, -- GitHub installation id
  user_id uuid not null references auth.users (id) on delete cascade,
  account_login text not null,
  account_type text not null,
  suspended_at timestamptz,
  created_at timestamptz not null default now()
);
create index github_installations_user_idx on public.github_installations (user_id);

create table public.repositories (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  installation_id bigint not null references public.github_installations (id) on delete cascade,
  github_repo_id bigint not null,
  full_name text not null,
  default_branch text not null,
  is_private boolean not null,
  monitoring_enabled boolean not null default false,
  last_monitor_scan_at timestamptz,
  created_at timestamptz not null default now(),
  unique (user_id, github_repo_id)
);
create index repositories_installation_idx on public.repositories (installation_id);

-- ───────────────────────── Audits ─────────────────────────
create table public.audits (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  repository_id uuid not null references public.repositories (id) on delete cascade,
  previous_audit_id uuid references public.audits (id) on delete set null,
  kind audit_kind not null,
  status audit_status not null default 'queued',
  commit_sha text,
  rubric_version text,
  overall_score int check (overall_score between 0 and 100),
  verdict text,
  category_scores jsonb,
  coverage jsonb,
  summary text,
  ai_cost_usd numeric(10, 4) not null default 0,
  input_tokens int not null default 0,
  output_tokens int not null default 0,
  credit_consumed text, -- which entitlement was consumed, for refunds
  trigger_run_id text,
  error text,
  created_at timestamptz not null default now(),
  started_at timestamptz,
  completed_at timestamptz
);
create index audits_user_created_idx on public.audits (user_id, created_at desc);
create index audits_repo_created_idx on public.audits (repository_id, created_at desc);

create table public.findings (
  id uuid primary key default gen_random_uuid(),
  audit_id uuid not null references public.audits (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  fingerprint text not null,
  rule_id text not null,
  source text not null, -- scanner name
  category text not null,
  severity finding_severity not null,
  priority finding_priority not null,
  evidence_tier evidence_tier not null,
  confidence text not null check (confidence in ('high', 'medium', 'low')),
  title text not null,
  description text not null,
  file_path text,
  start_line int,
  end_line int,
  snippet text, -- redacted
  remediation text not null,
  evidence jsonb not null default '{}'::jsonb,
  ai_assessment jsonb,
  change finding_change,
  created_at timestamptz not null default now()
);
create index findings_audit_idx on public.findings (audit_id);
create index findings_fingerprint_idx on public.findings (fingerprint);

create table public.tickets (
  id uuid primary key default gen_random_uuid(),
  audit_id uuid not null references public.audits (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  finding_id uuid not null references public.findings (id) on delete cascade,
  priority finding_priority not null,
  title text not null,
  body_markdown text not null,
  created_at timestamptz not null default now()
);
create index tickets_audit_idx on public.tickets (audit_id);

-- ───────────────────────── Cost + alerts ─────────────────────────
create table public.usage_ledger (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  audit_id uuid references public.audits (id) on delete set null,
  provider text not null,
  model text not null,
  input_tokens int not null,
  output_tokens int not null,
  cost_usd numeric(10, 6) not null,
  created_at timestamptz not null default now()
);
create index usage_ledger_created_idx on public.usage_ledger (created_at);

create table public.alerts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  repository_id uuid not null references public.repositories (id) on delete cascade,
  audit_id uuid references public.audits (id) on delete set null,
  severity finding_severity not null,
  message text not null,
  read_at timestamptz,
  created_at timestamptz not null default now()
);
create index alerts_user_idx on public.alerts (user_id, created_at desc);

-- ───────────────────────── RLS ─────────────────────────
alter table public.profiles enable row level security;
alter table public.entitlements enable row level security;
alter table public.subscriptions enable row level security;
alter table public.stripe_events enable row level security;
alter table public.github_installations enable row level security;
alter table public.repositories enable row level security;
alter table public.audits enable row level security;
alter table public.findings enable row level security;
alter table public.tickets enable row level security;
alter table public.usage_ledger enable row level security;
alter table public.alerts enable row level security;

create policy "own profile" on public.profiles for select to authenticated using (id = (select auth.uid()));
create policy "own entitlements" on public.entitlements for select to authenticated using (user_id = (select auth.uid()));
create policy "own subscriptions" on public.subscriptions for select to authenticated using (user_id = (select auth.uid()));
create policy "own installations" on public.github_installations for select to authenticated using (user_id = (select auth.uid()));
create policy "own repositories" on public.repositories for select to authenticated using (user_id = (select auth.uid()));
create policy "own audits" on public.audits for select to authenticated using (user_id = (select auth.uid()));
create policy "own findings" on public.findings for select to authenticated using (user_id = (select auth.uid()));
create policy "own tickets" on public.tickets for select to authenticated using (user_id = (select auth.uid()));
create policy "own alerts" on public.alerts for select to authenticated using (user_id = (select auth.uid()));
-- stripe_events and usage_ledger: no policies → service role only.

-- ───────────────────────── Entitlement functions ─────────────────────────
-- Atomically consume an entitlement. Returns the entitlement that was consumed, or raises.
-- p_kind: 'free_scan' | 'full_audit' | 'recheck'
create or replace function public.consume_entitlement(p_user_id uuid, p_kind audit_kind, p_rechecks_per_period int)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  e public.entitlements%rowtype;
begin
  select * into e from public.entitlements where user_id = p_user_id for update;
  if not found then
    raise exception 'ENTITLEMENT_MISSING';
  end if;

  if p_kind = 'free_scan' then
    if e.free_scans_used >= 1 then
      raise exception 'FREE_SCAN_USED';
    end if;
    update public.entitlements set free_scans_used = free_scans_used + 1, updated_at = now() where user_id = p_user_id;
    return 'free_scan';
  elsif p_kind = 'full_audit' then
    if e.audit_credits < 1 then
      raise exception 'NO_AUDIT_CREDITS';
    end if;
    update public.entitlements set audit_credits = audit_credits - 1, updated_at = now() where user_id = p_user_id;
    return 'audit_credit';
  elsif p_kind = 'recheck' then
    if e.plan <> 'pro' or e.period_end is null or e.period_end < now() then
      raise exception 'PRO_REQUIRED';
    end if;
    if e.rechecks_used >= p_rechecks_per_period then
      raise exception 'RECHECKS_EXHAUSTED';
    end if;
    update public.entitlements set rechecks_used = rechecks_used + 1, updated_at = now() where user_id = p_user_id;
    return 'recheck';
  elsif p_kind = 'monitor' then
    if e.plan <> 'pro' or e.period_end is null or e.period_end < now() then
      raise exception 'PRO_REQUIRED';
    end if;
    return 'monitor';
  end if;

  raise exception 'UNKNOWN_KIND';
end;
$$;

-- Refund an entitlement when an audit fails for system reasons.
create or replace function public.refund_entitlement(p_user_id uuid, p_consumed text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_consumed = 'free_scan' then
    update public.entitlements set free_scans_used = greatest(free_scans_used - 1, 0), updated_at = now() where user_id = p_user_id;
  elsif p_consumed = 'audit_credit' then
    update public.entitlements set audit_credits = audit_credits + 1, updated_at = now() where user_id = p_user_id;
  elsif p_consumed = 'recheck' then
    update public.entitlements set rechecks_used = greatest(rechecks_used - 1, 0), updated_at = now() where user_id = p_user_id;
  end if;
end;
$$;

create or replace function public.grant_audit_credit(p_user_id uuid, p_count int)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.entitlements set audit_credits = audit_credits + p_count, updated_at = now() where user_id = p_user_id;
end;
$$;

-- Only the service role may call these.
revoke all on function public.consume_entitlement(uuid, audit_kind, int) from public, anon, authenticated;
revoke all on function public.refund_entitlement(uuid, text) from public, anon, authenticated;
revoke all on function public.grant_audit_credit(uuid, int) from public, anon, authenticated;
revoke all on function public.handle_new_user() from public, anon, authenticated;
grant execute on function public.consume_entitlement(uuid, audit_kind, int) to service_role;
grant execute on function public.refund_entitlement(uuid, text) to service_role;
grant execute on function public.grant_audit_credit(uuid, int) to service_role;

-- Spend guard: total AI spend today across all users.
create or replace function public.ai_spend_today()
returns numeric
language sql
security definer
set search_path = public
as $$
  select coalesce(sum(cost_usd), 0) from public.usage_ledger where created_at >= date_trunc('day', now());
$$;
revoke all on function public.ai_spend_today() from public, anon, authenticated;
grant execute on function public.ai_spend_today() to service_role;
