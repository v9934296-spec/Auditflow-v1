create function public.enforce_page_watch_capacity()
returns trigger language plpgsql set search_path = '' as $$
begin
  perform pg_catalog.pg_advisory_xact_lock(781836274001);
  if exists (select 1 from public.page_watches where user_id = new.user_id and url = new.url) then
    return new;
  end if;
  if (select count(*) from public.page_watches where user_id = new.user_id) >= 5
    or (select count(*) from public.page_watches) >= 100 then
    raise exception using errcode = 'P0001', message = 'page_watch_capacity';
  end if;
  return new;
end;
$$;

create trigger enforce_page_watch_capacity
before insert on public.page_watches
for each row execute function public.enforce_page_watch_capacity();
