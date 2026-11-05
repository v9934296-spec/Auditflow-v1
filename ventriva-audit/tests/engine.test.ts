import { describe, expect, it } from "vitest";
import { memoryIndex } from "@/lib/analysis/files";
import { analyzeRepository } from "@/lib/analysis/pipeline";
import type { FetchLike } from "@/lib/analysis/scanners/osv";
import { healthyRepo, vulnerableRepo } from "./helpers/fixtures";

const noVulns: FetchLike = async (url) => {
  if (url.endsWith("/querybatch")) return new Response(JSON.stringify({ results: new Array(1000).fill({}) }));
  return new Response("{}", { status: 404 });
};

describe("full pipeline — vulnerable vibe-coded app", async () => {
  const result = await analyzeRepository(memoryIndex(vulnerableRepo()), { kind: "full_audit", fetchImpl: noVulns, disableSemgrep: true });
  const rules = result.findings.map((f) => f.ruleId);

  it("detects the critical launch blockers with verified evidence", () => {
    expect(rules).toContain("secrets.env-file-committed");
    expect(rules).toContain("secrets.supabase-service-role-key");
    expect(rules).toContain("secrets.stripe-live-secret");
    expect(rules).toContain("readiness.stripe-webhook-unverified");
    expect(rules).toContain("readiness.supabase-rls-missing");
    const rls = result.findings.find((f) => f.ruleId === "readiness.supabase-rls-missing")!;
    expect(rls.priority).toBe("P0");
    expect(rls.tier).toBe("verified");
    expect(rls.evidence.facts?.tables).toEqual(["projects"]);
  });

  it("flags readiness gaps", () => {
    expect(rules).toContain("readiness.api-route-no-auth");
    expect(rules).toContain("readiness.build-script");
    expect(rules).toContain("readiness.lockfile");
    expect(rules).toContain("readiness.error-tracking");
    expect(rules).toContain("readiness.tests-exist");
    expect(rules).toContain("readiness.next-ignores-build-errors");
    expect(rules).toContain("readiness.legal-pages");
  });

  it("never stores raw secrets in snippets", () => {
    const blob = JSON.stringify(result.findings);
    expect(blob).not.toMatch(/sk_live_[0-9A-Za-z]{20,}/);
    expect(blob).not.toMatch(/eyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/);
  });

  it("scores as not launch ready, keeps the P0s, and withholds a numeric score while Semgrep was skipped", () => {
    expect(result.scorecard.verdict).toBe("not_launch_ready");
    expect(result.scorecard.counts.P0).toBeGreaterThan(0);
    expect(result.scorecard.overall).toBeNull();
    const arch = result.scorecard.categories.find((c) => c.category === "architecture")!;
    expect(arch.score).toBeNull();
    expect(result.scorecard.readiness.find((r) => r.area === "billing")!.status).toBe("blocked");
  });

  it("generates complete, ordered tickets", () => {
    expect(result.tickets.length).toBeGreaterThan(5);
    expect(result.tickets[0]!.priority).toBe("P0");
    for (const section of ["## Problem", "## Evidence", "## Impact", "## Relevant files", "## Recommended implementation", "## Acceptance criteria", "## Required tests", "## Verification", "## Scope restrictions"]) {
      expect(result.tickets[0]!.bodyMarkdown).toContain(section);
    }
  });

  it("reports AI as unavailable without a provider instead of pretending", () => {
    expect(result.aiNote).toMatch(/unavailable/);
    expect(result.aiCostUsd).toBe(0);
  });
});

describe("full pipeline — healthy app", async () => {
  const result = await analyzeRepository(memoryIndex(healthyRepo()), { kind: "full_audit", fetchImpl: noVulns, disableSemgrep: true });

  it("has no P0 blockers", () => {
    expect(result.scorecard.counts.P0).toBe(0);
    expect(result.scorecard.verdict).not.toBe("not_launch_ready");
  });

  it("passes the core readiness checks", () => {
    const status = Object.fromEntries(result.checks.map((c) => [c.id, c.status]));
    for (const id of ["auth-provider", "supabase-rls", "payment-provider", "stripe-webhook-signature", "stripe-webhook-idempotency", "api-route-auth", "legal-pages", "lockfile", "error-tracking", "rate-limiting", "tests-exist", "tests-in-ci", "ci", "env-example", "env-validation", "health-endpoint"]) {
      expect([id, status[id]]).toEqual([id, "pass"]);
    }
  });

  it("does not clear launch while Semgrep was skipped", () => {
    expect(result.coverage.scanners.find((s) => s.name === "semgrep")!.status).toBe("skipped");
    expect(result.scorecard.verdict).toBe("insufficient_coverage");
    expect(result.scorecard.overall).toBeNull();
  });
});

describe("incomplete dependency lookup", async () => {
  const repo = memoryIndex({
    "package-lock.json": JSON.stringify({ packages: { "node_modules/leftpad": { version: "1.0.0" } } }),
    "main.go": "package main\nfunc main() {}\n",
  });
  const result = await analyzeRepository(repo, {
    kind: "full_audit",
    disableSemgrep: true,
    fetchImpl: async () => {
      throw new Error("timeout");
    },
  });

  it("records an API timeout as a failed dependency scan instead of zero vulnerabilities", () => {
    const osv = result.coverage.scanners.find((s) => s.name === "osv")!;
    expect(osv.status).toBe("failed");
    expect(osv.reason).toMatch(/timeout/);
    expect(result.findings.filter((f) => f.source === "osv")).toHaveLength(0);
    expect(result.scorecard.verdict).not.toBe("launch_ready_in_scope");
    expect(result.scorecard.verdict).not.toBe("launch_with_fixes");
  });

  it("names languages outside the code scanners and does not put them in the coverage ratio", () => {
    expect(result.coverage.filesInspected).toBe(0);
    expect(result.coverage.sourceCoverage).toBe(0);
    expect(result.coverage.notes.join(" ")).toMatch(/Go/);
  });
});

describe("unsupported languages stay outside the coverage ratio", async () => {
  const result = await analyzeRepository(memoryIndex({
    "package-lock.json": JSON.stringify({ packages: {} }),
    "app.ts": "export const ready = 1;\n",
    "main.go": "package main\nfunc main() {}\n",
  }), { kind: "full_audit", fetchImpl: noVulns, disableSemgrep: true });

  it("counts the inspected TypeScript file and names Go as uncovered", () => {
    expect(result.coverage.filesInspected).toBe(1);
    expect(result.coverage.sourceCoverage).toBe(1);
    expect(result.coverage.notes.join(" ")).toMatch(/Go/);
    expect(result.scorecard.verdict).not.toBe("launch_ready_in_scope");
  });
});

describe("free scan", async () => {
  const result = await analyzeRepository(memoryIndex(vulnerableRepo()), { kind: "free_scan", fetchImpl: noVulns, disableSemgrep: true });
  it("runs no AI, no ESLint, and produces no tickets", () => {
    expect(result.usage).toHaveLength(0);
    expect(result.tickets).toHaveLength(0);
    expect(result.coverage.scanners.find((s) => s.name === "eslint")!.status).toBe("skipped");
  });
  it("still finds the P0s", () => {
    expect(result.scorecard.counts.P0).toBeGreaterThan(0);
  });
});
