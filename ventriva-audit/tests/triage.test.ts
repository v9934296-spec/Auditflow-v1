import { describe, expect, it } from "vitest";
import { Budget, type LlmProvider, type LlmRequest } from "@/lib/analysis/llm/provider";
import { triageFindings, selectForTriage } from "@/lib/analysis/llm/triage";
import { finalize, type RawFinding } from "@/lib/analysis/types";

const mk = (i: number, extra: Partial<RawFinding> = {}) =>
  finalize({ ruleId: `semgrep.r${i}`, source: "semgrep", category: "security", severity: "high", tier: "suspected", confidence: "medium", title: `t${i}`, description: "d", remediation: "r", filePath: `f${i}.ts`, startLine: 1, snippet: `   1 | const API_SECRET = "abcdefghijk${i}"`, evidence: { method: "m" }, ...extra });

class FakeProvider implements LlmProvider {
  name = "fake";
  calls: LlmRequest[] = [];
  constructor(private respond: (req: LlmRequest) => string) {}
  async complete(req: LlmRequest) {
    this.calls.push(req);
    return { text: this.respond(req), inputTokens: 1000, outputTokens: 200, model: req.model };
  }
}

describe("triage", () => {
  it("applies assessments by id and ignores ids outside the batch", async () => {
    const findings = [mk(1), mk(2)];
    const p = new FakeProvider(() => JSON.stringify({ assessments: [{ id: 0, verdict: "likely_false_positive", confidence: "high", explanation: "test file", remediation: "none" }, { id: 7, verdict: "likely_true_positive", confidence: "high", explanation: "x", remediation: "y" }] }));
    const out = await triageFindings(findings, p, new Budget(1, 100_000), 10);
    expect(out.triaged).toBe(1);
    expect(findings[0]!.ai?.verdict).toBe("likely_false_positive");
    expect(findings[1]!.ai).toBeUndefined();
  });

  it("redacts secrets before sending to the provider", async () => {
    const p = new FakeProvider(() => JSON.stringify({ assessments: [] }));
    await triageFindings([mk(1)], p, new Budget(1, 100_000), 10);
    expect(p.calls[0]!.user).not.toContain("abcdefghijk1");
  });

  it("stops at the budget ceiling and reports why", async () => {
    const findings = Array.from({ length: 40 }, (_, i) => mk(i));
    const p = new FakeProvider(() => JSON.stringify({ assessments: [] }));
    const budget = new Budget(1, 2_500);
    const out = await triageFindings(findings, p, budget, 40);
    expect(out.stoppedReason).toMatch(/ceiling/);
    expect(budget.inputTokens).toBeLessThanOrEqual(2_500);
  });

  it("respects the global daily guard", async () => {
    const p = new FakeProvider(() => "{}");
    const out = await triageFindings([mk(1)], p, new Budget(1, 100_000, async () => false), 10);
    expect(out.stoppedReason).toMatch(/daily/);
    expect(p.calls).toHaveLength(0);
  });

  it("survives malformed model output without inventing assessments", async () => {
    const f = [mk(1)];
    const out = await triageFindings(f, new FakeProvider(() => "not json"), new Budget(1, 100_000), 10);
    expect(out.triaged).toBe(0);
    expect(f[0]!.ai).toBeUndefined();
  });

  it("only selects suspected findings with evidence", () => {
    expect(selectForTriage([mk(1), mk(2, { tier: "verified" }), mk(3, { snippet: undefined })], 10)).toHaveLength(1);
  });
});
