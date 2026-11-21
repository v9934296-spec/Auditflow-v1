import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { InspectionTag } from "@/components/inspection-tag";
import { ReportSignals, ReportCategoryScores, ReportNextAction } from "@/components/report-signals";
import { inspectionRating } from "@/lib/format";
import type { Coverage } from "@/lib/analysis/types";

function tag(score: number | null, verdict: "launch_with_fixes" | "insufficient_coverage" = "launch_with_fixes") {
  return renderToStaticMarkup(createElement(InspectionTag, { score, verdict, counts: { P0: 0, P1: 2 } }));
}

describe("report score presentation", () => {
  it("converts the existing score exactly to a 10-point display", () => {
    const html = tag(72);
    expect(html).toContain("7.2");
    expect(html).toContain("out of 10");
    expect(html).toContain("Launch with fixes");
  });
  it.each([null, Number.NaN, -1, 101])("withholds missing or invalid scores (%s)", (score) => {
    expect(tag(score)).toContain("Not graded");
    expect(tag(score)).not.toContain("out of 10");
    expect(tag(score)).not.toContain("report-rating");
  });
  it("withholds a legacy numeric score when the verdict says coverage is insufficient", () => {
    expect(tag(95, "insufficient_coverage")).toContain("Not graded");
    expect(tag(95, "insufficient_coverage")).not.toContain("9.5");
  });
  it("preserves a real zero rather than treating it as missing", () => {
    expect(tag(0)).toContain("0.0");
    expect(tag(0)).not.toContain("Not graded");
  });
});

it.each([
  [{ P0: 2, P1: 3, P2: 4, P3: 1 }, "Review 2 potential blockers", "#findings-P0"],
  [{ P0: 0, P1: 1, P2: 3, P3: 0 }, "Review 1 high-risk finding", "#findings-P1"],
  [{ P0: 0, P1: 0, P2: 2, P3: 4 }, "Review 2 important findings", "#findings-P2"],
  [{ P0: 0, P1: 0, P2: 0, P3: 1 }, "Review 1 optional finding", "#findings-P3"],
  [{ P0: 0, P1: 0, P2: 0, P3: 0 }, "Review inspection scope", "#inspection-scope"],
] as const)("directs the next action to recorded evidence (%j)", (counts, title, href) => {
  const html = renderToStaticMarkup(createElement(ReportNextAction, { counts }));
  expect(html).toContain(title);
  expect(html).toContain(`href="${href}"`);
  expect(html).not.toContain("safe to launch");
});

it("uses the same score scale and withheld states across report, dashboard and history", () => {
  expect(inspectionRating(72)).toBe("7.2");
  expect(inspectionRating(0)).toBe("0.0");
  expect(inspectionRating(100)).toBe("10.0");
  for (const value of [null, NaN, Infinity, -1, 101]) expect(inspectionRating(value)).toBeNull();
  expect(inspectionRating(95, "insufficient_coverage")).toBeNull();
});

it("retains a recorded incomplete-scanner explanation without a decorative rating ring", () => {
  const html = renderToStaticMarkup(createElement(InspectionTag, { score: null, verdict: "not_launch_ready", counts: { P0: 2, P1: 1 }, coverageNote: "Semgrep skipped. Score withheld.", meta: ["rubric 2026.11-v2"] }));
  expect(html).toContain("Semgrep skipped. Score withheld.");
  expect(html).toContain("Not launch ready");
  expect(html).toContain("rubric 2026.11-v2");
  expect(html).not.toContain("<svg");
});

it("does not confuse missing coverage with a measured zero or zero findings with safety", () => {
  const html = renderToStaticMarkup(createElement(ReportSignals, { counts: { P0: 0, P1: 0, P2: 0, P3: 0 }, coverage: null }));
  expect(html).toContain("Not recorded");
  expect(html).not.toContain("0%");
  expect(html).toContain("does not establish that uninspected areas are safe");
});

it("shows partial coverage and priority counts without turning them into a quality grade", () => {
  const coverage = { sourceCoverage: 0.429, filesInspected: 3, truncated: true, sourceInventory: { inspected: ["a.ts", "b.ts", "c.ts"], notInspected: ["d.ts", "e.ts", "f.ts", "g.ts"], unsupported: ["app.swift"] } } as Coverage;
  const html = renderToStaticMarkup(createElement(ReportSignals, { counts: { P0: 1, P1: 2, P2: 3, P3: 4 }, coverage }));
  expect(html).toContain("42%");
  expect(html).toContain("3 source files inspected");
  expect(html).toContain("4 eligible files not inspected; 1 source files outside supported languages");
  expect(html).toContain("Repository extraction was truncated");
  expect(html).toContain("priority, not confirmed correctness");
});

it("keeps unassessed categories ungraded and exposes the reason", () => {
  const html = renderToStaticMarkup(createElement(ReportCategoryScores, { categories: [{ category: "security", score: 72, findings: 2 }, { category: "performance", score: null, findings: 0, reason: "Runtime profiling was not performed." }], coverageNote: "Static inspection only." }));
  expect(html).toContain("7.2");
  expect(html).toContain("Not assessed");
  expect(html).toContain("Runtime profiling was not performed");
  expect(html).not.toContain("0.0");
});
