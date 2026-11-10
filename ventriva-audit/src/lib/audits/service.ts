import { tasks } from "@trigger.dev/sdk";
import { ABUSE, PRO, type AuditKind } from "@/lib/config/plans";
import type { AuditRow, RepositoryRow } from "@/lib/db/types";
import { supabaseAdmin } from "@/lib/supabase/admin";
import type { runAuditTask } from "@/trigger/run-audit";
import { consumeEntitlement, ENTITLEMENT_MESSAGES, EntitlementError } from "./entitlements";

export class AuditRequestError extends Error {
  constructor(message: string, readonly status = 400) {
    super(message);
    this.name = "AuditRequestError";
  }
}

const USER_KINDS: AuditKind[] = ["free_scan", "full_audit", "recheck"];

export const BASELINE_KINDS = ["full_audit", "recheck", "monitor"] as const;

/** Latest completed full audit, recheck, or monitoring audit. Free scans and failures are not baselines. */
export function selectLatestBaseline<T extends { status: string; kind: string; completed_at: string | null }>(rows: readonly T[]): T | null {
  let best: T | null = null;
  for (const row of rows) {
    if (row.status !== "completed" || !row.completed_at) continue;
    if (!(BASELINE_KINDS as readonly string[]).includes(row.kind)) continue;
    if (!best || row.completed_at > best.completed_at!) best = row;
  }
  return best;
}

async function latestBaseline(repositoryId: string): Promise<AuditRow | null> {
  const { data } = await supabaseAdmin()
    .from("audits")
    .select("*")
    .eq("repository_id", repositoryId)
    .eq("status", "completed")
    .in("kind", [...BASELINE_KINDS]);
  return selectLatestBaseline((data ?? []) as AuditRow[]);
}

/**
 * Starts an audit on behalf of a signed-in user. Ownership, abuse limits and
 * entitlements are all enforced here, server-side.
 */
export async function startAudit(userId: string, repositoryId: string, kind: AuditKind): Promise<AuditRow> {
  if (!USER_KINDS.includes(kind)) throw new AuditRequestError("Unsupported audit type.");
  const db = supabaseAdmin();

  const { data: repo } = await db.from("repositories").select("*").eq("id", repositoryId).eq("user_id", userId).maybeSingle();
  if (!repo) throw new AuditRequestError("Repository not found.", 404);

  let previousAuditId: string | null = null;
  if (kind === "recheck") {
    const base = await latestBaseline(repositoryId);
    if (!base) throw new AuditRequestError("Run a full audit on this repository before requesting a recheck.");
    previousAuditId = base.id;
  }

  const { data, error } = await db.rpc("queue_user_audit", {
    p_user_id: userId,
    p_repository_id: repositoryId,
    p_kind: kind,
    p_previous_audit_id: previousAuditId,
    p_rechecks_per_period: PRO.rechecksPerPeriod,
    p_max_concurrent: ABUSE.maxConcurrentAudits,
    p_max_per_hour: ABUSE.maxAuditsPerHour,
  }).single();
  if (error) {
    if (error.message === "AUDIT_ALREADY_RUNNING") throw new AuditRequestError("An audit is already running. Wait for it to finish.", 429);
    if (error.message === "AUDIT_HOURLY_LIMIT") throw new AuditRequestError("Too many audits in the last hour. Try again later.", 429);
    if (Object.hasOwn(ENTITLEMENT_MESSAGES, error.message)) throw new EntitlementError(error.message);
    throw error;
  }
  const audit = data as AuditRow;
  await dispatchAudit(audit);
  return audit;
}

async function dispatchAudit(audit: AuditRow): Promise<void> {
  try {
    const handle = await tasks.trigger<typeof runAuditTask>("run-audit", { auditId: audit.id }, { idempotencyKey: `audit-${audit.id}`, tags: [`user_${audit.user_id}`, `kind_${audit.kind}`] });
    const { error } = await supabaseAdmin().from("audits").update({ trigger_run_id: handle.id }).eq("id", audit.id);
    if (error) throw error;
  } catch (e) {
    // A lost response may mean Trigger.dev accepted the job. Let it run if it
    // did, or let the stale-audit task release the credit if it never starts.
    console.error("Could not confirm audit dispatch", audit.id, e);
  }
}

/** Push-triggered monitoring scan (Pro). Rate-limited per repository. */
export async function maybeStartMonitorScan(repo: RepositoryRow, pushedBranch: string): Promise<"started" | "skipped"> {
  if (!repo.monitoring_enabled || pushedBranch !== repo.default_branch) return "skipped";
  if (repo.last_monitor_scan_at && Date.now() - new Date(repo.last_monitor_scan_at).getTime() < PRO.monitorMinIntervalMs) return "skipped";
  const db = supabaseAdmin();
  const { count: active } = await db.from("audits").select("id", { count: "exact", head: true }).eq("repository_id", repo.id).in("status", ["queued", "running"]);
  if ((active ?? 0) > 0) return "skipped";
  const base = await latestBaseline(repo.id);
  if (!base) return "skipped";
  let consumed: string;
  try {
    consumed = await consumeEntitlement(repo.user_id, "monitor");
  } catch {
    return "skipped";
  }
  // Claim the slot first so concurrent pushes can't start duplicates.
  const { data: claimed } = await db
    .from("repositories")
    .update({ last_monitor_scan_at: new Date().toISOString() })
    .eq("id", repo.id)
    .or(`last_monitor_scan_at.is.null,last_monitor_scan_at.lt.${new Date(Date.now() - PRO.monitorMinIntervalMs).toISOString()}`)
    .select("id");
  if (!claimed?.length) return "skipped";
  const { data: audit, error } = await db.from("audits")
    .insert({ user_id: repo.user_id, repository_id: repo.id, kind: "monitor", status: "queued", credit_consumed: consumed, previous_audit_id: base.id })
    .select("*")
    .single();
  if (error) throw error;
  await dispatchAudit(audit as AuditRow);
  return "started";
}
