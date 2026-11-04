import { tasks } from "@trigger.dev/sdk";
import { ABUSE, PRO, type AuditKind } from "@/lib/config/plans";
import type { AuditRow, RepositoryRow } from "@/lib/db/types";
import { supabaseAdmin } from "@/lib/supabase/admin";
import type { runAuditTask } from "@/trigger/run-audit";
import { consumeEntitlement, refundEntitlement } from "./entitlements";

export class AuditRequestError extends Error {
  constructor(message: string, readonly status = 400) {
    super(message);
    this.name = "AuditRequestError";
  }
}

const USER_KINDS: AuditKind[] = ["free_scan", "full_audit", "recheck"];

async function latestBaseline(repositoryId: string): Promise<AuditRow | null> {
  const { data } = await supabaseAdmin()
    .from("audits")
    .select("*")
    .eq("repository_id", repositoryId)
    .eq("status", "completed")
    .in("kind", ["full_audit", "recheck", "monitor"])
    .order("completed_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return (data as AuditRow | null) ?? null;
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

  const { count: active } = await db.from("audits").select("id", { count: "exact", head: true }).eq("user_id", userId).in("status", ["queued", "running"]);
  if ((active ?? 0) >= ABUSE.maxConcurrentAudits) throw new AuditRequestError("An audit is already running. Wait for it to finish.", 429);

  const since = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  const { count: recent } = await db.from("audits").select("id", { count: "exact", head: true }).eq("user_id", userId).gte("created_at", since);
  if ((recent ?? 0) >= ABUSE.maxAuditsPerHour) throw new AuditRequestError("Too many audits in the last hour. Try again later.", 429);

  let previousAuditId: string | null = null;
  if (kind === "recheck") {
    const base = await latestBaseline(repositoryId);
    if (!base) throw new AuditRequestError("Run a full audit on this repository before requesting a recheck.");
    previousAuditId = base.id;
  }

  const consumed = await consumeEntitlement(userId, kind);
  return enqueue(userId, repo as RepositoryRow, kind, consumed, previousAuditId);
}

async function enqueue(userId: string, repo: RepositoryRow, kind: AuditKind, consumed: string, previousAuditId: string | null): Promise<AuditRow> {
  const db = supabaseAdmin();
  const { data: audit, error } = await db
    .from("audits")
    .insert({ user_id: userId, repository_id: repo.id, kind, status: "queued", credit_consumed: consumed, previous_audit_id: previousAuditId })
    .select("*")
    .single();
  if (error || !audit) {
    await refundEntitlement(userId, consumed);
    throw error ?? new Error("Could not create audit.");
  }
  try {
    const handle = await tasks.trigger<typeof runAuditTask>("run-audit", { auditId: audit.id as string }, { idempotencyKey: `audit-${audit.id as string}`, tags: [`user_${userId}`, `kind_${kind}`] });
    await db.from("audits").update({ trigger_run_id: handle.id }).eq("id", audit.id);
  } catch (e) {
    await db.from("audits").update({ status: "failed", error: "Could not queue the audit. Your credit has been refunded." }).eq("id", audit.id);
    await refundEntitlement(userId, consumed);
    throw e;
  }
  return audit as AuditRow;
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
  await enqueue(repo.user_id, repo, "monitor", consumed, base.id);
  return "started";
}
