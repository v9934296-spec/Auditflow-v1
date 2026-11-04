import { indexRepo } from "@/lib/analysis/files";
import { extractTarball, IngestLimitError } from "@/lib/analysis/ingest";
import { AnthropicProvider } from "@/lib/analysis/llm/anthropic";
import { analyzeRepository, type AnalysisResult, type PreviousFinding } from "@/lib/analysis/pipeline";
import type { Finding } from "@/lib/analysis/types";
import { LIMITS } from "@/lib/config/plans";
import type { AuditRow, FindingRow, RepositoryRow } from "@/lib/db/types";
import { serverEnv } from "@/lib/env";
import { changedFiles, downloadTarball, repoScopedToken, resolveHeadSha } from "@/lib/github/app";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { refundEntitlement } from "./entitlements";

/** Errors the user can act on; the run is not retried. */
export class PermanentAuditError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PermanentAuditError";
  }
}

const LOCKED_REMEDIATION = "Unlock the full audit to see the evidence and step-by-step fix.";

export function rowToFinding(r: FindingRow): PreviousFinding {
  return {
    id: r.id,
    ruleId: r.rule_id,
    source: r.source as Finding["source"],
    category: r.category,
    severity: r.severity,
    tier: r.evidence_tier,
    confidence: r.confidence,
    title: r.title,
    description: r.description,
    remediation: r.remediation,
    filePath: r.file_path ?? undefined,
    startLine: r.start_line ?? undefined,
    endLine: r.end_line ?? undefined,
    snippet: r.snippet ?? undefined,
    evidence: r.evidence,
    fingerprint: r.fingerprint,
    priority: r.priority,
    ai: r.ai_assessment ?? undefined,
    change: r.change ?? undefined,
  };
}

/** Free scans persist full detail only for the top N findings — the paywall is enforced in the data, not the UI. */
export function findingToRow(f: Finding, auditId: string, userId: string, detailed: boolean) {
  return {
    audit_id: auditId,
    user_id: userId,
    fingerprint: f.fingerprint,
    rule_id: f.ruleId,
    source: f.source,
    category: f.category,
    severity: f.severity,
    priority: f.priority,
    evidence_tier: f.tier,
    confidence: f.confidence,
    title: f.title,
    description: detailed ? f.description : f.description.split(". ")[0] + ".",
    file_path: detailed ? (f.filePath ?? null) : null,
    start_line: detailed ? (f.startLine ?? null) : null,
    end_line: detailed ? (f.endLine ?? null) : null,
    snippet: detailed ? (f.snippet ?? null) : null,
    remediation: detailed ? f.remediation : LOCKED_REMEDIATION,
    evidence: detailed ? { ...f.evidence, ...(f.readinessArea ? { readinessArea: f.readinessArea } : {}) } : { method: "Locked in free scan." },
    ai_assessment: detailed ? (f.ai ?? null) : null,
    change: f.change ?? null,
  };
}

async function persist(audit: AuditRow, repo: RepositoryRow, sha: string, result: AnalysisResult): Promise<void> {
  const db = supabaseAdmin();
  const limits = LIMITS[audit.kind];
  const detailLimit = limits.detailedFindingsLimit;

  // Replace any partial rows from an earlier attempt.
  await db.from("tickets").delete().eq("audit_id", audit.id);
  await db.from("findings").delete().eq("audit_id", audit.id);

  const rows = result.findings.map((f, i) => findingToRow(f, audit.id, audit.user_id, detailLimit === null || i < detailLimit));
  const idByFingerprint = new Map<string, string>();
  for (let i = 0; i < rows.length; i += 500) {
    const { data, error } = await db.from("findings").insert(rows.slice(i, i + 500)).select("id, fingerprint");
    if (error) throw error;
    for (const r of data as { id: string; fingerprint: string }[]) idByFingerprint.set(r.fingerprint, r.id);
  }

  const ticketRows = result.tickets
    .map((t) => ({ audit_id: audit.id, user_id: audit.user_id, finding_id: idByFingerprint.get(t.findingFingerprints[0] ?? ""), priority: t.priority, title: t.title, body_markdown: t.bodyMarkdown }))
    .filter((t): t is typeof t & { finding_id: string } => !!t.finding_id);
  for (let i = 0; i < ticketRows.length; i += 500) {
    const { error } = await db.from("tickets").insert(ticketRows.slice(i, i + 500));
    if (error) throw error;
  }

  if (result.usage.length) {
    const { error } = await db.from("usage_ledger").insert(
      result.usage.map((u) => ({ user_id: audit.user_id, audit_id: audit.id, provider: u.provider, model: u.model, input_tokens: u.inputTokens, output_tokens: u.outputTokens, cost_usd: u.costUsd })),
    );
    if (error) throw error;
  }

  const { categories, readiness, counts, coverageNote } = result.scorecard;
  const { error } = await db
    .from("audits")
    .update({
      status: "completed",
      commit_sha: sha,
      rubric_version: result.scorecard.rubricVersion,
      overall_score: result.scorecard.overall,
      verdict: result.scorecard.verdict,
      category_scores: { categories, readiness, counts, coverageNote },
      coverage: result.coverage,
      summary: result.summary,
      ai_cost_usd: Number(result.aiCostUsd.toFixed(4)),
      input_tokens: result.usage.reduce((a, u) => a + u.inputTokens, 0),
      output_tokens: result.usage.reduce((a, u) => a + u.outputTokens, 0),
      completed_at: new Date().toISOString(),
      error: null,
    })
    .eq("id", audit.id);
  if (error) throw error;

  // Alerts: new critical/high issues in rechecks & monitoring.
  if (audit.kind === "monitor" || audit.kind === "recheck") {
    const regressions = result.findings.filter((f) => f.change === "regressed" && (f.priority === "P0" || f.priority === "P1"));
    if (regressions.length) {
      await db.from("alerts").insert(
        regressions.slice(0, 20).map((f) => ({ user_id: audit.user_id, repository_id: repo.id, audit_id: audit.id, severity: f.severity, message: `${f.priority}: ${f.title}` })),
      );
    }
  }
}

export async function runAudit(auditId: string): Promise<{ status: "completed" | "skipped"; score?: number | null }> {
  const db = supabaseAdmin();
  const env = serverEnv();
  const { data: auditData, error } = await db.from("audits").select("*").eq("id", auditId).single();
  if (error) throw error;
  const audit = auditData as AuditRow;
  if (audit.status === "completed" || audit.status === "failed") return { status: "skipped" };

  await db.from("audits").update({ status: "running", started_at: new Date().toISOString() }).eq("id", auditId);

  const { data: repoData, error: repoErr } = await db.from("repositories").select("*").eq("id", audit.repository_id).single();
  if (repoErr) throw repoErr;
  const repo = repoData as RepositoryRow;
  const limits = LIMITS[audit.kind];

  let token: string;
  try {
    token = await repoScopedToken(repo.installation_id, repo.github_repo_id);
  } catch {
    throw new PermanentAuditError("GitHub access to this repository was revoked or the app was uninstalled. Reconnect GitHub and try again.");
  }
  const sha = await resolveHeadSha(token, repo.full_name, repo.default_branch);

  let previous: PreviousFinding[] | undefined;
  let changed: Set<string> | undefined;
  if (audit.previous_audit_id) {
    const { data: prevAudit } = await db.from("audits").select("commit_sha").eq("id", audit.previous_audit_id).single();
    const { data: prevRows, error: prevErr } = await db.from("findings").select("*").eq("audit_id", audit.previous_audit_id);
    if (prevErr) throw prevErr;
    previous = (prevRows as FindingRow[]).map(rowToFinding);
    if (prevAudit?.commit_sha) changed = (await changedFiles(token, repo.full_name, prevAudit.commit_sha as string, sha)) ?? undefined;
  }

  let workspace;
  try {
    workspace = await extractTarball(await downloadTarball(token, repo.full_name, sha, limits.maxTarballBytes), limits);
  } catch (e) {
    if (e instanceof IngestLimitError || /above this tier's limit/.test((e as Error).message)) throw new PermanentAuditError((e as Error).message);
    throw e;
  }

  try {
    const index = await indexRepo(workspace.dir);
    const provider = limits.aiEnabled ? new AnthropicProvider(env.ANTHROPIC_API_KEY) : undefined;
    const globalBudgetGuard = async (estimateUsd: number) => {
      const { data: spent, error: spendErr } = await db.rpc("ai_spend_today");
      if (spendErr) return false; // fail closed
      return Number(spent) + estimateUsd <= env.DAILY_AI_SPEND_CAP_USD;
    };
    const result = await analyzeRepository(index, { kind: audit.kind, ingest: workspace.stats, provider, globalBudgetGuard, previous, changedFiles: changed });
    await persist(audit, repo, sha, result);
    if (audit.kind === "monitor") await db.from("repositories").update({ last_monitor_scan_at: new Date().toISOString() }).eq("id", repo.id);
    return { status: "completed", score: result.scorecard.overall };
  } finally {
    await workspace.cleanup();
  }
}

/** Called once retries are exhausted (or on a permanent error). */
export async function failAudit(auditId: string, err: unknown): Promise<void> {
  const db = supabaseAdmin();
  const { data } = await db.from("audits").select("user_id, credit_consumed, status").eq("id", auditId).single();
  if (!data || data.status === "completed") return;
  const message = err instanceof PermanentAuditError ? err.message : "The audit failed due to a system error. Your credit has been refunded.";
  await db.from("audits").update({ status: "failed", error: message, completed_at: new Date().toISOString() }).eq("id", auditId);
  await refundEntitlement(data.user_id as string, (data.credit_consumed as string | null) ?? null);
}
