import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, expect, it, vi } from "vitest";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

const fixture = vi.hoisted(() => ({ audit: {} as Record<string, unknown>, findings: [] as Record<string, unknown>[], tables: {} as Record<string, unknown> }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }), notFound: () => { throw new Error("not found"); } }));
vi.mock("@/lib/supabase/server", () => ({
  requireUser: async () => ({ id: "fixture-user" }),
  supabaseServer: async () => ({ from: (table: string) => {
    const result = () => ({ data: Object.hasOwn(fixture.tables, table) ? fixture.tables[table] : table === "audits" ? fixture.audit : fixture.findings, error: null });
    const chain: Record<string, unknown> = {};
    for (const method of ["select", "eq", "order", "limit", "is"]) chain[method] = () => chain;
    chain.maybeSingle = async () => result();
    chain.single = async () => result();
    chain.then = (resolve: (value: unknown) => unknown) => Promise.resolve(result()).then(resolve);
    return chain;
  } }),
}));
vi.mock("@/lib/supabase/admin", () => ({ supabaseAdmin: () => ({ from: () => {
  const chain: Record<string, unknown> = {};
  for (const method of ["update", "eq", "is"]) chain[method] = () => chain;
  chain.then = (resolve: (value: unknown) => unknown) => Promise.resolve({ error: null }).then(resolve);
  return chain;
} }) }));

import AuditReport from "@/app/dashboard/audits/[id]/page";
import Dashboard from "@/app/dashboard/page";
import RepoHistory from "@/app/dashboard/repos/[id]/page";

beforeEach(() => {
  fixture.tables = {};
  fixture.audit = {
    id: "fixture-audit", kind: "full_audit", status: "completed", verdict: "launch_with_fixes", overall_score: 72,
    repositories: { id: "fixture-repo", full_name: "example/fixture" }, summary: "Fixture inspection summary",
    rubric_version: "2026.11-v2", commit_sha: "abcdef123456", ai_cost_usd: 0, completed_at: null,
    coverage: { filesTotal: 1, filesIngested: 1, filesAnalyzed: 1, filesInspected: 1, filesSkipped: 0, skippedReasons: {}, languages: { TypeScript: 1 }, scanners: ["secrets", "osv", "semgrep", "readiness"].map(name => ({ name, status: "ran", inspectedFiles: ["src/example.ts"] })), sourceCoverage: 1, sourceInventory: { inspected: ["src/example.ts"], notInspected: [], unsupported: [] }, truncated: false, notes: [] },
    category_scores: {
      categories: [
        { category: "security", score: 60, findings: 2 }, { category: "launch_readiness", score: 76, findings: 0 },
        { category: "reliability", score: 82, findings: 0 }, { category: "maintainability", score: 91, findings: 0 },
        { category: "testing", score: 70, findings: 0 }, { category: "architecture", score: null, findings: 0, reason: "Not assessed in this fixture." },
        { category: "performance", score: null, findings: 0, reason: "Runtime profiling was not performed." },
      ],
      readiness: [{ area: "auth", status: "issues", passed: 1, failed: 1, notApplicable: 0, checks: [
        { id: "fixture-auth", status: "fail", label: "Authentication evidence", detail: "Demonstration finding requiring review." },
        { id: "fixture-session", status: "pass", label: "Session verification pattern" },
      ] }],
      counts: { P0: 99, P1: 99, P2: 99, P3: 99 }, coverageNote: "Fixture scope: demonstration data, not a customer audit.",
    },
  };
  fixture.findings = [
    { id: "p1-a", priority: "P1", change: "new", title: "First fixture finding", evidence_tier: "suspected", evidence: { method: "Fixture static check" }, confidence: "medium", description: "Fixture description", remediation: "Review fixture evidence" },
    { id: "p1-b", priority: "P1", change: "unresolved", title: "Second fixture finding", evidence_tier: "suspected", evidence: { method: "Fixture static check" }, confidence: "medium" },
    { id: "p0-fixed", priority: "P0", change: "fixed", title: "Historical fixed fixture", evidence_tier: "verified", evidence: { method: "Fixture recheck" } },
  ];
});

async function render() {
  return renderToStaticMarkup(createElement("div", null, await AuditReport({ params: Promise.resolve({ id: "fixture-audit" }) })));
}

async function capture(name: string, html: string) {
  const directory = process.env.AUDITFLOW_CAPTURE_DIR;
  if (!directory) return;
  await mkdir(directory, { recursive: true });
  await writeFile(path.join(directory, `${name}.html`), html);
}

it("links to the actual open priority group and keeps evidence and exports in the report", async () => {
  const html = await render();
  expect(html).toContain("Review 2 high-risk findings");
  expect(html).toContain('href="#findings-P1"');
  expect(html).toContain('id="findings-P1"');
  expect(html).not.toContain('id="findings-P0"');
  expect(html).not.toContain("Review 99");
  expect(html).toContain("Fixture static check");
  expect(html).toContain("Review fixture evidence");
  expect(html).toContain("/api/audits/fixture-audit/export?format=md");
  expect(html).toContain("/api/audits/fixture-audit/export?format=json");
  expect(html).toContain("7.2");
  await capture("report-scored", html);
});

it("keeps the zero-findings scope link valid for a legacy report without coverage", async () => {
  fixture.findings = [];
  fixture.audit.coverage = null;
  fixture.audit.summary = null;
  const html = await render();
  expect(html).toContain('href="#inspection-scope"');
  expect(html).toContain('id="inspection-scope"');
  await capture("report-legacy", html);
  expect(html).toContain("Coverage details were not recorded");
  expect(html).toContain('>Inspection report</h1>');
  expect(html).toContain("No open findings within the assessed scope");
});

it("retains dashboard actions and uses the same score display for repository rows", async () => {
  fixture.tables = {
    entitlements: { plan: "free", free_scans_used: 0, audit_credits: 1, rechecks_used: 0 },
    github_installations: [{ id: 1, account_login: "fixture-owner" }],
    repositories: [{ id: "fixture-repo", full_name: "example/fixture", default_branch: "main", is_private: true, monitoring_enabled: false }],
    audits: [{ ...fixture.audit, repository_id: "fixture-repo", created_at: new Date().toISOString() }], alerts: [],
  };
  const html = renderToStaticMarkup(await Dashboard({ searchParams: Promise.resolve({}) }));
  expect(html).toContain("example/fixture");
  expect(html).toContain("7.2/10");
  expect(html).toContain("Run full audit");
  expect(html).toContain("Free scan");
  expect(html).toContain("/api/github/install");
  expect(html).toContain("/dashboard/repos/fixture-repo");
  await capture("dashboard", html);
});

it("keeps dashboard onboarding and history empty states available", async () => {
  fixture.tables = { entitlements: null, github_installations: [], repositories: [], audits: [], alerts: [] };
  const html = renderToStaticMarkup(await Dashboard({ searchParams: Promise.resolve({}) }));
  expect(html).toContain("Connect GitHub to start");
  expect(html).toContain("/api/github/install");
  await capture("dashboard-empty", html);
  fixture.tables = { repositories: { id: "fixture-repo", full_name: "example/fixture" }, audits: [] };
  const history = renderToStaticMarkup(await RepoHistory({ params: Promise.resolve({ id: "fixture-repo" }) }));
  expect(history).toContain("No inspections yet");
});

it("converts history labels while keeping stored trend values and report destinations", async () => {
  fixture.tables = { repositories: { id: "fixture-repo", full_name: "example/fixture" }, audits: [
    { ...fixture.audit, id: "later", overall_score: 72, created_at: new Date().toISOString() },
    { ...fixture.audit, id: "older", overall_score: 41, created_at: new Date().toISOString() },
  ] };
  const html = renderToStaticMarkup(await RepoHistory({ params: Promise.resolve({ id: "fixture-repo" }) }));
  expect(html).toContain("4.1");
  expect(html).toContain("7.2");
  expect(html).toContain("out of 10");
  expect(html).toContain("5.0 (blocked)");
  expect(html).toContain("/dashboard/audits/later");
  expect(fixture.audit.overall_score).toBe(72);
  await capture("history", html);
});

it("shows the real scanner gap without a grade, ring or loss of the findings", async () => {
  fixture.audit.overall_score = null;
  fixture.audit.verdict = "not_launch_ready";
  fixture.audit.coverage = { scanners: [{ name: "semgrep", status: "skipped", reason: "Fixture CLI unavailable" }], filesIngested: 1, filesAnalyzed: 1, filesInspected: 0, filesSkipped: 0, skippedReasons: {}, languages: {}, sourceCoverage: 0, truncated: false, notes: [] };
  const html = await render();
  expect(html).toContain("Not graded");
  expect(html).toContain("Semgrep skipped");
  expect(html).not.toContain('class="report-rating"');
  expect(html).toContain("First fixture finding");
  expect(html).toContain('id="inspection-scope"');
  await capture("report-incomplete", html);
});

it("preserves queued and failed report flows without showing a completed score", async () => {
  fixture.audit.status = "queued";
  const queued = await render();
  expect(queued).toContain("Waiting for a worker");
  await capture("report-queued", queued);
  fixture.audit.status = "failed";
  fixture.audit.error = "Fixture worker unavailable";
  const html = await render();
  expect(html).toContain("Fixture worker unavailable");
  expect(html).toContain("Back to dashboard");
  expect(html).not.toContain("report-next-action");
  await capture("report-failed", html);
});
