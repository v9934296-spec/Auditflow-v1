import { expect, it, vi } from "vitest";
import { runAudit } from "@/lib/audits/run";
import { analyzeRepository } from "@/lib/analysis/pipeline";
import { score } from "@/lib/analysis/scoring";
import type { Coverage, Finding } from "@/lib/analysis/types";
import { supabaseAdmin } from "@/lib/supabase/admin";

vi.mock("@/lib/analysis/pipeline", () => ({ analyzeRepository: vi.fn() }));
vi.mock("@/lib/analysis/files", () => ({ indexRepo: vi.fn() }));
vi.mock("@/lib/analysis/ingest", () => ({
  extractTarball: vi.fn().mockResolvedValue({ cleanup: vi.fn() }),
}));
vi.mock("@/lib/analysis/llm/anthropic", () => ({ AnthropicProvider: class {} }));
vi.mock("@/lib/env", () => ({ serverEnv: () => ({}) }));
vi.mock("@/lib/github/app", () => ({
  repoScopedToken: vi.fn(),
  resolveHeadSha: vi.fn(),
  downloadTarball: vi.fn(),
}));
vi.mock("@/lib/supabase/admin", () => ({ supabaseAdmin: vi.fn() }));
vi.mock("@/lib/audits/entitlements", () => ({ refundEntitlement: vi.fn() }));

it.each(["monitor", "recheck", "full_audit"] as const)("persists eligible alerts for a %s audit", async (kind) => {
  const findings: Finding[] = ([
    { change: "new", priority: "P0", severity: "critical", title: "New critical" },
    { change: "new", priority: "P1", severity: "high", title: "New high" },
    { change: "regressed", priority: "P1", severity: "high", title: "Returned high" },
    { change: "unresolved", priority: "P0", severity: "critical", title: "Existing critical" },
    { change: "new", priority: "P2", severity: "medium", title: "New medium" },
  ] satisfies Pick<Finding, "change" | "priority" | "severity" | "title">[]).map((finding) => ({
    ruleId: "test.alert",
    source: "semgrep",
    category: "security",
    tier: "verified",
    confidence: "high",
    description: "Test finding.",
    remediation: "Fix the test finding.",
    evidence: { method: "Test fixture" },
    fingerprint: finding.title,
    ...finding,
  }));
  const coverage: Coverage = {
    filesTotal: 0, filesAnalyzed: 0, filesIngested: 0, filesInspected: 0, filesSkipped: 0,
    skippedReasons: {}, languages: {}, scanners: [], sourceCoverage: 0, truncated: false, notes: [],
  };
  vi.mocked(analyzeRepository).mockResolvedValue({
    findings, coverage, checks: [], tickets: [], usage: [], scorecard: score(findings, [], coverage),
    summary: "", summaryByAi: false, aiCostUsd: 0, aiNote: null,
  });

  const insertAlerts = vi.fn().mockResolvedValue({ error: null });
  const audit = { id: "audit", user_id: "user", repository_id: "repo", status: "queued", kind };
  const repo = { id: "repo" };
  const from = vi.fn((table: string) => {
    const deleteOrUpdate = () => ({ eq: () => Promise.resolve({ error: null }) });
    return {
      delete: deleteOrUpdate,
      update: deleteOrUpdate,
      select: () => ({ eq: () => ({ single: () => ({ data: table === "audits" ? audit : repo }) }) }),
      insert: table === "alerts" ? insertAlerts : () => ({ select: () => ({ data: [], error: null }) }),
    };
  });
  vi.mocked(supabaseAdmin).mockReturnValue({ from } as unknown as ReturnType<typeof supabaseAdmin>);

  await runAudit(audit.id);

  if (kind === "full_audit") {
    expect(insertAlerts).not.toHaveBeenCalled();
  } else {
    expect(insertAlerts).toHaveBeenCalledExactlyOnceWith(findings.slice(0, 3).map((finding) => ({
      user_id: "user",
      repository_id: "repo",
      audit_id: "audit",
      severity: finding.severity,
      message: `${finding.priority}: ${finding.title}`,
    })));
  }
});
