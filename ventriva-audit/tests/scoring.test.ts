import { describe, expect, it } from "vitest";
import { categoryScore, score, SEVERITY_PENALTY, MAX_RULE_MULTIPLIER } from "@/lib/analysis/scoring";
import { finalize, type Coverage, type RawFinding } from "@/lib/analysis/types";

const base: RawFinding = { ruleId: "x", source: "semgrep", category: "security", severity: "medium", tier: "verified", confidence: "high", title: "t", description: "d", remediation: "r", evidence: { method: "m" } };
const coverage: Coverage = { filesTotal: 10, filesAnalyzed: 10, filesSkipped: 0, skippedReasons: {}, languages: { TypeScript: 10 }, scanners: [{ name: "secrets", status: "ran" }, { name: "readiness", status: "ran" }, { name: "semgrep", status: "ran" }], sourceCoverage: 1, truncated: false, notes: [] };

describe("scoring", () => {
  it("caps the penalty one rule can apply", () => {
    const many = Array.from({ length: 30 }, (_, i) => finalize({ ...base, snippet: String(i) }));
    expect(categoryScore(many)).toBe(100 - SEVERITY_PENALTY.medium * MAX_RULE_MULTIPLIER);
  });
  it("discounts suspected findings and ignores AI-dismissed ones", () => {
    const suspected = finalize({ ...base, tier: "suspected" });
    expect(categoryScore([suspected])).toBe(Math.round(100 - SEVERITY_PENALTY.medium * 0.6));
    const fp = { ...suspected, ai: { verdict: "likely_false_positive" as const, confidence: "high" as const, explanation: "", remediation: "", model: "m" } };
    expect(categoryScore([fp])).toBe(100);
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
    const card = score([], [], { ...coverage, scanners: [...coverage.scanners, { name: "osv", status: "failed", reason: "network" }] });
    expect(card.verdict).toBe("insufficient_coverage");
    expect(card.coverageNote).toMatch(/osv/);
  });
  it("never scores categories that were not assessed", () => {
    const card = score([], [], coverage);
    expect(card.categories.find((c) => c.category === "performance")!.score).toBeNull();
    expect(card.categories.find((c) => c.category === "architecture")!.score).toBeNull();
  });
});
