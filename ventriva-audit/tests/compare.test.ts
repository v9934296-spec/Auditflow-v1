import { describe, expect, it } from "vitest";
import { compareWithPrevious } from "@/lib/analysis/pipeline";
import { finalize, type RawFinding } from "@/lib/analysis/types";

const mk = (ruleId: string, source: RawFinding["source"] = "readiness") =>
  finalize({ ruleId, source, category: "security", severity: "high", tier: "verified", confidence: "high", title: ruleId, description: "", remediation: "", evidence: { method: "m" } });

describe("compareWithPrevious", () => {
  it("classifies unresolved, regressed and fixed", () => {
    const prev = [mk("a"), mk("b")];
    const cur = [mk("a"), mk("c")];
    const out = compareWithPrevious(cur, prev, [{ name: "readiness", status: "ran" }]);
    const by = Object.fromEntries(out.map((f) => [f.ruleId, f.change]));
    expect(by).toEqual({ a: "unresolved", c: "regressed", b: "fixed" });
  });
  it("never claims a fix when the scanner did not run", () => {
    const prev = [mk("dep", "osv")];
    const out = compareWithPrevious([], prev, [{ name: "osv", status: "failed" }]);
    expect(out[0]!.change).toBe("unresolved");
    expect(out[0]!.evidence.method).toMatch(/Not re-tested/);
  });
});
