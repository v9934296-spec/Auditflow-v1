-- Atomic publication of one completed audit. One PostgREST RPC = one Postgres transaction.
-- The service role owns execution; authenticated clients cannot call this function.
create or replace function public.complete_audit(
  p_audit_id uuid,
  p_payload jsonb
) returns boolean
language plpgsql
set search_path = public
as $$
declare
  a public.audits%rowtype;
  f jsonb;
  t jsonb;
  u jsonb;
  alert jsonb;
  matched_id uuid;
begin
  if jsonb_typeof(p_payload) is distinct from 'object'
     or jsonb_typeof(p_payload->'findings') is distinct from 'array'
     or jsonb_typeof(p_payload->'tickets') is distinct from 'array'
     or jsonb_typeof(p_payload->'usage') is distinct from 'array'
     or jsonb_typeof(p_payload->'alerts') is distinct from 'array'
     or nullif(p_payload->>'sha', '') is null
     or nullif(p_payload->>'rubricVersion', '') is null
     or nullif(p_payload->>'verdict', '') is null
     or jsonb_typeof(p_payload->'categoryScores') is distinct from 'object'
     or jsonb_typeof(p_payload->'coverage') is distinct from 'object'
  then
    raise exception 'INVALID_AUDIT_PAYLOAD';
  end if;

  select * into a from public.audits where id = p_audit_id for update;
  if not found or a.status <> 'running' then
    return false;
  end if;

  -- Prior partial data is replaced, but every delete and insert rolls back on any error.
  delete from public.tickets where audit_id = a.id;
  delete from public.findings where audit_id = a.id;
  delete from public.usage_ledger where audit_id = a.id;
  delete from public.alerts where audit_id = a.id;

  for f in select value from jsonb_array_elements(p_payload->'findings') loop
    insert into public.findings (
      audit_id, user_id, fingerprint, rule_id, source, category, severity,
      priority, evidence_tier, confidence, title, description, file_path,
      start_line, end_line, snippet, remediation, evidence, ai_assessment, change
    ) values (
      a.id, a.user_id, f->>'fingerprint', f->>'rule_id', f->>'source',
      f->>'category', (f->>'severity')::public.finding_severity,
      (f->>'priority')::public.finding_priority, (f->>'evidence_tier')::public.evidence_tier,
      f->>'confidence', f->>'title', f->>'description', f->>'file_path',
      (f->>'start_line')::int, (f->>'end_line')::int, f->>'snippet',
      f->>'remediation', coalesce(f->'evidence', '{}'::jsonb),
      f->'ai_assessment', (f->>'change')::public.finding_change
    );
  end loop;

  for t in select value from jsonb_array_elements(p_payload->'tickets') loop
    select id into matched_id
      from public.findings where audit_id = a.id and fingerprint = t->>'fingerprint'
      order by id desc limit 1;
    if matched_id is null then
      raise exception 'AUDIT_TICKET_FINDING_MISSING';
    end if;
    insert into public.tickets (audit_id, user_id, finding_id, priority, title, body_markdown)
      values (a.id, a.user_id, matched_id, (t->>'priority')::public.finding_priority,
        t->>'title', t->>'body_markdown');
  end loop;

  for u in select value from jsonb_array_elements(p_payload->'usage') loop
    insert into public.usage_ledger (
      audit_id, user_id, provider, model, input_tokens, output_tokens, cost_usd
    ) values (
      a.id, a.user_id, u->>'provider', u->>'model',
      (u->>'input_tokens')::int, (u->>'output_tokens')::int,
      (u->>'cost_usd')::numeric
    );
  end loop;

  for alert in select value from jsonb_array_elements(p_payload->'alerts') loop
    insert into public.alerts (audit_id, user_id, repository_id, severity, message)
      values (a.id, a.user_id, a.repository_id,
        (alert->>'severity')::public.finding_severity, alert->>'message');
  end loop;

  update public.audits set
    status = 'completed',
    commit_sha = p_payload->>'sha',
    rubric_version = p_payload->>'rubricVersion',
    overall_score = (p_payload->>'overall')::int,
    verdict = p_payload->>'verdict',
    category_scores = p_payload->'categoryScores',
    coverage = p_payload->'coverage',
    summary = p_payload->>'summary',
    ai_cost_usd = (p_payload->>'aiCostUsd')::numeric,
    input_tokens = (p_payload->>'inputTokens')::int,
    output_tokens = (p_payload->>'outputTokens')::int,
    completed_at = now(),
    error = null
  where id = a.id;

  if a.kind = 'monitor' then
    update public.repositories set last_monitor_scan_at = now() where id = a.repository_id;
  end if;
  return true;
end;
$$;

revoke all on function public.complete_audit(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.complete_audit(uuid, jsonb) to service_role;
