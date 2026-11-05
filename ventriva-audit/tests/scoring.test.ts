import { describe, expect, it } from "vitest";
import { categoryScore, score, SEVERITY_PENALTY, MAX_RULE_MULTIPLIER } from "@/lib/analysis/scoring";
import { finalize, type Coverage, type RawFinding } from "@/lib/analysis/types";

const base: RawFinding = { ruleId: "x", source: "semgrep", category: "security", severity: "medium", tier: "verified", confidence: "high", title: "t", description: "d", remediation: "r", evidence: { method: "m" } };
const coverage: Coverage = {
  filesTotal: 10,
  filesAnalyzed: 10,
  filesIngested: 10,
  filesInspected: 10,
  filesSkipped: 0,
  skippedReasons: {},
  languages: { TypeScript: 10 },
  scanners: [
    { name: "secrets", status: "ran" },
    { name: "readiness", status: "ran" },
    { name: "semgrep", status: "ran", inspectedFiles: ["a.ts"] },
    { name: "osv", status: "ran" },
  ],
  sourceCoverage: 1,
  truncated: false,
  notes: [],
};

function ai(verdict: "likely_false_positive" | "likely_true_positive") {
  return { verdict, confidence: "high" as const, explanation: "", remediation: "", model: "m" };
}

describe("scoring", () => {
  it("caps the penalty one rule can apply", () => {
    const many = Array.from({ length: 30 }, (_, i) => finalize({ ...base, snippet: String(i) }));
    expect(categoryScore(many)).toBe(100 - SEVERITY_PENALTY.medium * MAX_RULE_MULTIPLIER);
  });
  it("discounts suspected findings and does not let AI labels change the score", () => {
    const suspected = finalize({ ...base, tier: "suspected" });
    const expected = Math.round(100 - SEVERITY_PENALTY.medium * 0.6);
    expect(categoryScore([suspected])).toBe(expected);
    expect(categoryScore([{ ...suspected, ai: ai("likely_false_positive") }])).toBe(expected);
    expect(categoryScore([{ ...suspected, ai: ai("likely_true_positive") }])).toBe(expected);
    const dismissed = score([{ ...finalize({ ...base, severity: "critical" }), ai: ai("likely_false_positive") }], [], coverage);
    const plain = score([finalize({ ...base, severity: "critical" })], [], coverage);
    expect(dismissed.overall).toBe(plain.overall);
    expect(dismissed.verdict).toBe(plain.verdict);
    expect(dismissed.counts).toEqual(plain.counts);
    expect(dismissed.verdict).toBe("not_launch_ready");
  });
  it("is deterministic", () => {
    const fs = [finalize({ ...base, severity: "high" }), finalize({ ...base, ruleId: "y", category: "testing" })];
    expect(score(fs, [], coverage)).toEqual(score(fs, [], coverage));
  });
  it("blocks launch on any P0 and caps the overall score", () => {
    const card = score([finalize({ ...base, severity: "critical", category: "testing" })], [], coverage);
    expect(card.verdict).toBe("not_launch_ready");
    expect(card.overall).toBeLessThanOrEqual(49);
  });
  it("refuses a 'ready' verdict when coverage is low", () => {
    const card = score([], [], { ...coverage, sourceCoverage: 0.2 });
    expect(card.verdict).toBe("insufficient_coverage");
  });
  it("refuses a 'ready' verdict when a core scanner failed", () => {
    const card = score([], [], { ...coverage, scanners: coverage.scanners.map((s) => s.name === "osv" ? { ...s, status: "failed" as const, reason: "network" } : s) });
    expect(card.verdict).toBe("insufficient_coverage");
    expect(card.overall).toBeNull();
    expect(card.coverageNote).toMatch(/osv failed/);
  });
  it("refuses a clean launch when Semgrep is skipped", () => {
    const card = score([], [], { ...coverage, scanners: coverage.scanners.map((s) => s.name === "semgrep" ? { ...s, status: "skipped" as const, reason: "Semgrep CLI is not installed in this worker." } : s) });
    expect(card.verdict).toBe("insufficient_coverage");
    expect(card.overall).toBeNull();
  });
  it("withholds a launch score when only 3 of 10 source files were inspected", () => {
    const card = score([], [], { ...coverage, filesInspected: 3, sourceCoverage: 0.3 });
    expect(card.verdict).toBe("insufficient_coverage");
    expect(card.overall).toBeNull();
    expect(card.coverageNote).toMatch(/30%/);
  });
  it("does not clear launch when one eligible file was left uninspected", () => {
    const card = score([], [], { ...coverage, filesInspected: 9, sourceCoverage: 0.9 });
    expect(card.verdict).toBe("insufficient_coverage");
    expect(card.overall).toBeNull();
  });
  it("does not publish a security score when dependency scanning failed", () => {
    const card = score([], [], { ...coverage, scanners: coverage.scanners.map((s) => s.name === "osv" ? { ...s, status: "failed" as const, reason: "network" } : s) });
    expect(card.categories.find((c) => c.category === "security")!.score).toBeNull();
  });
  it("refuses a clean launch when extraction is truncated", () => {
    const card = score([], [], { ...coverage, truncated: true });
    expect(card.verdict).toBe("insufficient_coverage");
    expect(card.overall).toBeNull();
    expect(card.coverageNote).toMatch(/truncated/);
  });
  it("refuses a clean launch when OSV coverage is partial", () => {
    const card = score([], [], { ...coverage, scanners: coverage.scanners.map((s) => s.name === "osv" ? { ...s, status: "partial" as const, reason: "1 advisory lookup(s) failed or returned a malformed response." } : s) });
    expect(card.verdict).toBe("insufficient_coverage");
    expect(card.overall).toBeNull();
  });
  it("keeps a confirmed critical finding when coverage is incomplete", () => {
    const card = score([finalize({ ...base, severity: "critical" })], [], { ...coverage, truncated: true, scanners: coverage.scanners.map((s) => s.name === "semgrep" ? { ...s, status: "skipped" as const, reason: "missing" } : s) });
    expect(card.verdict).toBe("not_launch_ready");
    expect(card.counts.P0).toBe(1);
    expect(card.overall).toBeNull();
  });
  it("allows a skipped OSV scan only when no lockfile exists", () => {
    const card = score([], [], { ...coverage, scanners: coverage.scanners.map((s) => s.name === "osv" ? { ...s, status: "skipped" as const, reason: "No supported lockfile found (package-lock.json, pnpm-lock.yaml, yarn.lock, pinned requirements.txt)." } : s) });
    expect(card.verdict).toBe("launch_ready_in_scope");
  });
  it("never scores categories that were not assessed", () => {
    const card = score([], [], coverage);
    expect(card.categories.find((c) => c.category === "performance")!.score).toBeNull();
    expect(card.categories.find((c) => c.category === "architecture")!.score).toBeNull();
  });
});
