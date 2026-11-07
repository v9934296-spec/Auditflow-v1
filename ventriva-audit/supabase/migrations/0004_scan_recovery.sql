alter table public.audits add column credit_period_start timestamptz;

-- The entitlement lock serializes manual requests for the same account.
create function public.queue_user_audit(
  p_user_id uuid, p_repository_id uuid, p_kind public.audit_kind, p_previous_audit_id uuid,
  p_rechecks_per_period int, p_max_concurrent int, p_max_per_hour int
) returns public.audits
language plpgsql
set search_path = public
as $$
declare
  queued public.audits;
  consumed text;
  billing_period timestamptz;
begin
  select period_start into billing_period from public.entitlements
    where user_id = p_user_id for update;
  if (select count(*) from public.audits where user_id = p_user_id and status in ('queued', 'running')) >= p_max_concurrent then
    raise exception 'AUDIT_ALREADY_RUNNING';
  end if;
  if (select count(*) from public.audits where user_id = p_user_id and created_at >= now() - interval '1 hour') >= p_max_per_hour then
    raise exception 'AUDIT_HOURLY_LIMIT';
  end if;

  consumed := public.consume_entitlement(p_user_id, p_kind, p_rechecks_per_period);
  insert into public.audits (user_id, repository_id, kind, previous_audit_id, credit_consumed, credit_period_start)
    values (p_user_id, p_repository_id, p_kind, p_previous_audit_id, consumed,
            case when consumed = 'recheck' then billing_period end)
    returning * into queued;
  return queued;
end;
$$;

-- A duplicate failure delivery, or one arriving after completion, has no effect.
create function public.fail_audit(p_audit_id uuid, p_error text)
returns void
language plpgsql
set search_path = public
as $$
declare
  failed public.audits;
begin
  update public.audits set status = 'failed', error = p_error, completed_at = now()
    where id = p_audit_id and status in ('queued', 'running')
    returning * into failed;
  if not found then return; end if;

  if failed.credit_consumed = 'recheck' then
    -- For older audits without a recorded billing period, use their creation time.
    update public.entitlements set rechecks_used = greatest(rechecks_used - 1, 0), updated_at = now()
      where user_id = failed.user_id and
        (period_start = failed.credit_period_start or
         (failed.credit_period_start is null and failed.created_at >= period_start));
  else
    perform public.refund_entitlement(failed.user_id, failed.credit_consumed);
  end if;
end;
$$;

create function public.recover_stale_audits()
returns int
language plpgsql
set search_path = public
as $$
declare
  stale_id uuid;
  recovered int := 0;
begin
  -- The worker has a 15-minute attempt limit. Allow time for queueing and retries.
  for stale_id in
    select id from public.audits
    where status in ('queued', 'running')
      and coalesce(started_at, created_at) < now() - interval '1 hour'
    order by coalesce(started_at, created_at), id
    limit 100 for update skip locked
  loop
    perform public.fail_audit(stale_id, 'The audit timed out. You can start a new scan.');
    recovered := recovered + 1;
  end loop;
  return recovered;
end;
$$;

revoke all on function public.queue_user_audit(uuid, uuid, public.audit_kind, uuid, int, int, int) from public, anon, authenticated;
revoke all on function public.fail_audit(uuid, text) from public, anon, authenticated;
revoke all on function public.recover_stale_audits() from public, anon, authenticated;
grant execute on function public.queue_user_audit(uuid, uuid, public.audit_kind, uuid, int, int, int) to service_role;
grant execute on function public.fail_audit(uuid, text) to service_role;
grant execute on function public.recover_stale_audits() to service_role;
