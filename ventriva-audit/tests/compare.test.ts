import { describe, expect, it } from "vitest";
import { findingsThatAlert, findingToRow, rowToFinding } from "@/lib/audits/run";
import { selectLatestBaseline } from "@/lib/audits/service";
import type { FindingRow } from "@/lib/db/types";
import { comparisonFromFiles } from "@/lib/github/app";
import { compareWithPrevious, reusePriorAssessments, wasVerifiedFixed } from "@/lib/analysis/pipeline";
import { score, type Scorecard } from "@/lib/analysis/scoring";
import { buildTickets } from "@/lib/analysis/tickets";
import { finalize, identifyFindings, legacyFingerprintOf, type Coverage, type Finding, type RawFinding, type ScannerRun } from "@/lib/analysis/types";

const raw = (over: Partial<RawFinding> = {}): RawFinding => ({
  ruleId: "semgrep.xss",
  source: "semgrep",
  category: "security",
  severity: "high",
  tier: "verified",
  confidence: "high",
  title: "xss",
  description: "",
  remediation: "Escape the output.",
  evidence: { method: "m" },
  filePath: "src/a.ts",
  startLine: 10,
  endLine: 10,
  snippet: "   8 | const a = 1\n   9 |\n  10 | danger(input)\n  11 | return",
  ...over,
});

/** A stored historical row: fingerprint was hashed from the rendered excerpt. */
function historical(over: Partial<RawFinding> = {}, change?: Finding["change"]): Finding {
  const base = raw(over);
  const finding = finalize(base);
  return { ...finding, fingerprint: legacyFingerprintOf(base), change };
}

function current(over: Partial<RawFinding> = {}): Finding {
  return identifyFindings([raw(over)])[0]!;
}

function run(status: ScannerRun["status"], inspected?: string[], name = "semgrep"): ScannerRun {
  return { name, status, ...(inspected ? { inspectedFiles: inspected } : {}) };
}

describe("compareWithPrevious", () => {
  it("keeps an open finding unresolved and does not call a brand-new finding a regression", () => {
    const prev = [historical(), historical({ ruleId: "semgrep.other", title: "other" })];
    const cur = [current(), current({ ruleId: "semgrep.fresh", title: "fresh", snippet: "  4 | other()" })];
    const out = compareWithPrevious(cur, prev, [run("ran", ["src/a.ts"])]);
    const by = Object.fromEntries(out.map((f) => [f.ruleId, f.change]));
    expect(by["semgrep.xss"]).toBe("unresolved");
    expect(by["semgrep.fresh"]).toBe("new");
    expect(by["semgrep.other"]).toBe("fixed");
    expect(by["semgrep.fresh"]).not.toBe("regressed");
  });

  it("does not mark a finding fixed when the scanner ran but skipped its file", () => {
    const out = compareWithPrevious([], [historical()], [run("ran", ["src/other.ts"])]);
    expect(out).toHaveLength(1);
    expect(out[0]!.change).toBe("not_retested");
    expect(out[0]!.change).not.toBe("fixed");
    expect(out[0]!.evidence.method).toMatch(/Not re-tested/);
  });

  it("marks a finding fixed only after the same file was inspected and the finding is gone", () => {
    const out = compareWithPrevious([], [historical()], [run("ran", ["src/a.ts"])]);
    expect(out.map((f) => f.change)).toEqual(["fixed"]);
  });

  it("fail-closes skipped, failed, and partial scanners", () => {
    for (const status of ["skipped", "failed", "partial"] as const) {
      const out = compareWithPrevious([], [historical()], [run(status, ["src/a.ts"])]);
      expect(out[0]!.change, status).toBe("not_retested");
      expect(out.some((f) => f.change === "fixed")).toBe(false);
    }
  });

  it("does not claim a fix when the scanner did not run", () => {
    const prev = [historical({ ruleId: "osv.GHSA-1", source: "osv", filePath: "package-lock.json", fingerprintKey: "package-lock.json|leftpad|GHSA-1", snippet: undefined, startLine: undefined, endLine: undefined })];
    const out = compareWithPrevious([], prev, [{ name: "osv", status: "failed" }]);
    expect(out[0]!.change).toBe("not_retested");
    expect(out[0]!.evidence.method).toMatch(/Not re-tested/);
  });

  it("treats a moved line and a whitespace-only edit as the same finding", () => {
    const prev = [historical()];
    const moved = current({
      startLine: 11,
      endLine: 11,
      snippet: "   9 | const a = 1\n  10 |\n  11 | danger(  input)\n  12 | return",
    });
    const out = compareWithPrevious([moved], prev, [run("ran", ["src/a.ts"])]);
    expect(out).toHaveLength(1);
    expect(out[0]!.change).toBe("unresolved");
    expect(out.some((f) => f.change === "fixed" || f.change === "regressed")).toBe(false);
  });

  it("keeps two occurrences of the same rule distinct", () => {
    const first = raw({ startLine: 10, endLine: 10, snippet: "  10 | danger(input)" });
    const second = raw({ startLine: 20, endLine: 20, snippet: "  20 | danger(other)" });
    const prev = identifyFindings([first, second]).map((f) => ({ ...f, fingerprint: legacyFingerprintOf(f) }));
    const cur = identifyFindings([
      { ...first, startLine: 12, snippet: "  12 | danger(input)" },
      { ...second, startLine: 30, snippet: "  30 | danger(other)" },
    ]);
    expect(new Set(cur.map((f) => f.fingerprint)).size).toBe(2);
    const out = compareWithPrevious(cur, prev, [run("ran", ["src/a.ts"])]);
    expect(out).toHaveLength(2);
    expect(out.every((f) => f.change === "unresolved")).toBe(true);
  });

  it("follows a rename only when the comparison supplies a path mapping", () => {
    const prev = [historical()];
    const cur = current({ filePath: "src/b.ts", snippet: "  11 | danger(input)" });
    const scanners = [run("ran", ["src/b.ts"])];
    const mapped = compareWithPrevious([cur], prev, scanners, new Map([["src/a.ts", "src/b.ts"]]));
    expect(mapped.map((f) => f.change)).toEqual(["unresolved"]);

    const unmapped = compareWithPrevious([cur], prev, scanners);
    expect(unmapped.map((f) => f.change).sort()).toEqual(["new", "not_retested"]);
    expect(unmapped.some((f) => f.change === "fixed")).toBe(false);
  });

  it("classifies a returned issue as regressed only after a verified fix", () => {
    const prev = [historical({}, "fixed")];
    const out = compareWithPrevious([current()], prev, [run("ran", ["src/a.ts"])]);
    expect(out.map((f) => f.change)).toEqual(["regressed"]);

    const unseen = compareWithPrevious([current({ ruleId: "semgrep.new", snippet: "   2 | eval(x)" })], [], [run("ran", ["src/a.ts"])]);
    expect(unseen.map((f) => f.change)).toEqual(["new"]);
  });

  it("keeps a verified fix across clean audits and classifies a later return as regressed", () => {
    const scanned = [run("ran", ["src/a.ts"])];
    const detected = compareWithPrevious([current()], [], scanned);
    expect(detected.map((f) => f.change)).toEqual(["new"]);

    const fixed = compareWithPrevious([], detected, scanned);
    expect(fixed.map((f) => f.change)).toEqual(["fixed"]);
    expect(wasVerifiedFixed(fixed[0]!)).toBe(true);

    const clean = compareWithPrevious([], fixed, scanned);
    const stillClean = compareWithPrevious([], clean, scanned);
    expect(clean.map((f) => f.change)).toEqual(["fixed"]);
    expect(stillClean.map((f) => f.change)).toEqual(["fixed"]);

    const returned = compareWithPrevious([current()], stillClean, scanned);
    expect(returned.map((f) => f.change)).toEqual(["regressed"]);
  });

  it("does not invent a new verified fix when coverage is incomplete, and keeps an earlier one", () => {
    const scanned = [run("ran", ["src/a.ts"])];
    const fixed = compareWithPrevious([], [historical()], scanned);
    expect(fixed[0]!.change).toBe("fixed");

    const gap = compareWithPrevious([], fixed, [run("skipped", ["src/a.ts"])]);
    expect(gap[0]!.change).toBe("not_retested");
    expect(gap[0]!.change).not.toBe("fixed");
    expect(gap[0]!.evidence.facts?.verifiedFix).toBe(true);
    expect(gap[0]!.evidence.method).toMatch(/Previously verified fixed/);
    expect(gap[0]!.evidence.method).toMatch(/Not re-tested/);

    const returned = compareWithPrevious([current()], gap, scanned);
    expect(returned.map((f) => f.change)).toEqual(["regressed"]);

    const confirmedAgain = compareWithPrevious([], gap, scanned);
    expect(confirmedAgain.map((f) => f.change)).toEqual(["fixed"]);
  });

  it("does not let a retained fix change the score, tickets, or alerts", () => {
    const scanned = [run("ran", ["src/a.ts"])];
    const fixed = compareWithPrevious([], [historical({ severity: "critical" })], scanned);
    expect(fixed[0]!.change).toBe("fixed");
    const coverage: Coverage = {
      filesTotal: 1, filesAnalyzed: 1, filesIngested: 1, filesInspected: 1, filesSkipped: 0, skippedReasons: {},
      languages: { TypeScript: 1 },
      scanners: [
        { name: "secrets", status: "ran", inspectedFiles: ["src/a.ts"] },
        { name: "readiness", status: "ran", inspectedFiles: ["src/a.ts"] },
        { name: "semgrep", status: "ran", inspectedFiles: ["src/a.ts"] },
        { name: "osv", status: "ran" },
      ],
      sourceCoverage: 1, truncated: false, notes: [],
    };
    expect(score(fixed, [], coverage).counts.P0).toBe(0);
    expect(buildTickets(fixed)).toHaveLength(0);
    expect(findingsThatAlert(fixed)).toHaveLength(0);
    expect(findingsThatAlert([{ ...fixed[0]!, change: "regressed" }])).toHaveLength(1);
  });

  it("does not reuse an AI assessment when the diff is missing or the file changed", () => {
    const prior = { ...historical(), ai: { verdict: "likely_false_positive" as const, confidence: "high" as const, explanation: "old", remediation: "ignore", model: "m" } };
    const cur = current();
    expect(reusePriorAssessments([cur], [prior], null)[0]!.ai).toBeUndefined();
    expect(reusePriorAssessments([cur], [prior], undefined)[0]!.ai).toBeUndefined();
    expect(reusePriorAssessments([cur], [prior], new Set(["src/a.ts"]))[0]!.ai).toBeUndefined();
    expect(reusePriorAssessments([cur], [prior], new Set())[0]!.ai?.explanation).toBe("old");
    expect(reusePriorAssessments([cur], [prior], new Set(["README.md"]))[0]!.ai?.explanation).toBe("old");

    const pathless = { ...historical({ filePath: undefined, snippet: undefined, startLine: undefined, endLine: undefined, fingerprintKey: "repo-check" }), ai: prior.ai };
    const pathlessCurrent = current({ filePath: undefined, snippet: undefined, startLine: undefined, endLine: undefined, fingerprintKey: "repo-check" });
    expect(reusePriorAssessments([pathlessCurrent], [pathless], new Set())[0]!.ai?.explanation).toBe("old");
    expect(reusePriorAssessments([pathlessCurrent], [pathless], new Set(["README.md"]))[0]!.ai).toBeUndefined();
  });

  it("keeps a not-retested finding in the score and out of the fixed tickets", () => {
    const open = { ...current(), change: "not_retested" as const, severity: "critical" as const, priority: "P0" as const };
    const coverage: Coverage = {
      filesTotal: 1,
      filesAnalyzed: 1,
      filesIngested: 1,
      filesInspected: 1,
      filesSkipped: 0,
      skippedReasons: {},
      languages: { TypeScript: 1 },
      scanners: [
        { name: "secrets", status: "ran", inspectedFiles: ["src/a.ts"] },
        { name: "readiness", status: "ran", inspectedFiles: ["src/a.ts"] },
        { name: "semgrep", status: "ran", inspectedFiles: ["src/a.ts"] },
        { name: "osv", status: "ran" },
      ],
      sourceCoverage: 1,
      truncated: false,
      notes: [],
    };
    const card: Scorecard = score([open], [], coverage);
    expect(card.counts.P0).toBe(1);
    expect(card.verdict).toBe("not_launch_ready");
    const tickets = buildTickets([open]);
    expect(tickets).toHaveLength(1);
    expect(tickets[0]!.bodyMarkdown).toMatch(/not a verified fix/i);
    expect(tickets[0]!.bodyMarkdown).not.toMatch(/status:\s*fixed/i);
  });
});

describe("stored baseline history", () => {
  function stored(finding: Finding, auditId: string) {
    const row = findingToRow(finding, auditId, "00000000-0000-0000-0000-000000000001", true);
    return rowToFinding({ ...row, id: `row-${auditId}`, created_at: "2026-01-01T00:00:00.000Z" } as FindingRow);
  }

  it("round-trips a verified fix and lets the latest baseline classify a return as regressed", () => {
    const scanned = [run("ran", ["src/a.ts"])];
    const detected = compareWithPrevious([current()], [], scanned);
    const fixed = compareWithPrevious([], detected.map((f) => stored(f, "audit-a")), scanned);
    const clean = compareWithPrevious([], fixed.map((f) => stored(f, "audit-b")), scanned);
    const secondClean = compareWithPrevious([], clean.map((f) => stored(f, "audit-c")), scanned);
    expect(secondClean.map((f) => f.change)).toEqual(["fixed"]);

    const audits = [
      { id: "audit-a", status: "completed", kind: "full_audit", completed_at: "2026-01-01T00:00:00.000Z" },
      { id: "audit-b", status: "completed", kind: "recheck", completed_at: "2026-01-02T00:00:00.000Z" },
      { id: "audit-c", status: "completed", kind: "monitor", completed_at: "2026-01-03T00:00:00.000Z" },
      { id: "audit-d", status: "failed", kind: "recheck", completed_at: "2026-01-04T00:00:00.000Z" },
      { id: "audit-e", status: "completed", kind: "free_scan", completed_at: "2026-01-05T00:00:00.000Z" },
    ];
    expect(selectLatestBaseline(audits)?.id).toBe("audit-c");

    const baseline = secondClean.map((f) => stored(f, "audit-c"));
    expect(baseline[0]!.evidence.facts?.verifiedFix).toBe(true);
    const returned = compareWithPrevious([current()], baseline, scanned);
    expect(returned.map((f) => f.change)).toEqual(["regressed"]);
  });
});

describe("comparisonFromFiles", () => {
  it("keeps rename pairs and treats a missing or oversized file list as unknown", () => {
    const parsed = comparisonFromFiles([
      { filename: "src/b.ts", previous_filename: "src/a.ts" },
      { filename: "README.md" },
    ]);
    expect(parsed.files).toEqual(new Set(["src/b.ts", "src/a.ts", "README.md"]));
    expect(parsed.renames.get("src/a.ts")).toBe("src/b.ts");
    expect(comparisonFromFiles(null).files).toBeNull();
    expect(comparisonFromFiles(Array.from({ length: 300 }, (_, i) => ({ filename: `f${i}.ts` }))).files).toBeNull();
  });
});
