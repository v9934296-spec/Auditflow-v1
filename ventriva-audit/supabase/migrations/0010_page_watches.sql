create table public.page_watches (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  url text not null check (length(url) <= 2048),
  title text,
  snapshot text,
  digest text,
  history jsonb not null default '[]',
  last_checked_at timestamptz,
  last_error text,
  next_check_at timestamptz not null default now(),
  unique (user_id, url)
);
create index page_watches_due on public.page_watches (next_check_at, id);
alter table public.page_watches enable row level security;
revoke all on public.page_watches from anon, authenticated;
grant select on public.page_watches to authenticated;
grant all on public.page_watches to service_role;
create policy "read own page watches" on public.page_watches
  for select to authenticated using ((select auth.uid()) = user_id);
