import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { InspectionTag } from "@/components/inspection-tag";
import { ReportSignals, ReportCategoryScores } from "@/components/report-signals";
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
