import type { CheckResult } from "./readiness/detectors";
import { CATEGORIES, type Category, type Coverage, type EvidenceTier, type Finding, type ReadinessArea, type Severity } from "./types";

/**
 * Deterministic, versioned scoring rubric. The LLM never produces a score.
 * Changing any constant here requires bumping RUBRIC_VERSION so historical audits stay comparable.
 */
export const RUBRIC_VERSION = "2026.10-v1";

export const SEVERITY_PENALTY: Record<Severity, number> = { critical: 40, high: 20, medium: 8, low: 3, info: 0 };
export const TIER_WEIGHT: Record<EvidenceTier, number> = { verified: 1, suspected: 0.6, not_tested: 0 };
/** One rule can never cost more than this multiple of its own penalty (stops 50 lint hits zeroing a category). */
export const MAX_RULE_MULTIPLIER = 2;

export const CATEGORY_WEIGHTS: Record<Category, number> = {
  security: 0.35,
  launch_readiness: 0.25,
  reliability: 0.15,
  testing: 0.15,
  maintainability: 0.1,
  architecture: 0,
  performance: 0,
};

/** Categories this rubric version can assess at all. Others are always reported as "not assessed". */
export const ASSESSABLE: ReadonlySet<Category> = new Set(["security", "launch_readiness", "reliability", "testing", "maintainability"]);

/** If any of these fail, the audit cannot clear an app for launch. */
export const CORE_SCANNERS: ReadonlySet<string> = new Set(["secrets", "osv", "semgrep", "readiness"]);

export type Verdict = "not_launch_ready" | "launch_with_fixes" | "launch_ready_in_scope" | "insufficient_coverage";

export const VERDICT_LABELS: Record<Verdict, string> = {
  not_launch_ready: "Not launch ready",
  launch_with_fixes: "Launch with fixes",
  launch_ready_in_scope: "Launch ready (within assessed scope)",
  insufficient_coverage: "Insufficient coverage to judge",
};

export interface CategoryScore {
  category: Category;
  /** null = not assessed. Never shown as passing. */
  score: number | null;
  findings: number;
  reason?: string;
}

export type AreaStatus = "blocked" | "issues" | "ready" | "not_applicable";

export interface ReadinessArea_ {
  area: ReadinessArea;
  status: AreaStatus;
  passed: number;
  failed: number;
  notApplicable: number;
  checks: { id: string; label: string; status: CheckResult["status"]; detail: string; fingerprint?: string }[];
}

export interface Scorecard {
  rubricVersion: string;
  overall: number | null;
  verdict: Verdict;
  categories: CategoryScore[];
  readiness: ReadinessArea_[];
  counts: Record<"P0" | "P1" | "P2" | "P3", number>;
  coverageNote: string;
}

function effectiveWeight(f: Finding): number {
  if (f.ai?.verdict === "likely_false_positive") return 0;
  if (f.ai?.verdict === "likely_true_positive") return 1;
  return TIER_WEIGHT[f.tier];
}

export function categoryScore(findings: Finding[]): number {
  const byRule = new Map<string, number>();
  for (const f of findings) {
    const p = SEVERITY_PENALTY[f.severity] * effectiveWeight(f);
    const cap = SEVERITY_PENALTY[f.severity] * MAX_RULE_MULTIPLIER;
    byRule.set(f.ruleId, Math.min(cap, (byRule.get(f.ruleId) ?? 0) + p));
  }
  const total = [...byRule.values()].reduce((a, b) => a + b, 0);
  return Math.max(0, Math.round(100 - total));
}

function categoryAssessed(cat: Category, coverage: Coverage): { assessed: boolean; reason?: string } {
  if (!ASSESSABLE.has(cat)) return { assessed: false, reason: `Not assessed by rubric ${RUBRIC_VERSION}: requires runtime profiling or human architectural review.` };
  const ran = (n: string) => coverage.scanners.some((s) => s.name === n && s.status === "ran");
  if (cat === "security" && !ran("secrets")) return { assessed: false, reason: "Secret scanning did not run." };
  if (!ran("readiness") && cat !== "security") return { assessed: false, reason: "Readiness checks did not run." };
  return { assessed: true };
}

export function buildReadiness(checks: CheckResult[], findings: Finding[]): ReadinessArea_[] {
  const areas: ReadinessArea[] = ["auth", "billing", "onboarding", "deployment_config", "operations"];
  const byFingerprintKey = new Map(findings.map((f) => [f.ruleId, f]));
  return areas.map((area) => {
    const cs = checks.filter((c) => c.area === area);
    const failed = cs.filter((c) => c.status === "fail");
    const blocked = failed.some((c) => c.finding?.severity === "critical");
    const status: AreaStatus = cs.length === 0 || cs.every((c) => c.status === "not_applicable") ? "not_applicable" : blocked ? "blocked" : failed.length ? "issues" : "ready";
    return {
      area,
      status,
      passed: cs.filter((c) => c.status === "pass").length,
      failed: failed.length,
      notApplicable: cs.filter((c) => c.status === "not_applicable").length,
      checks: cs.map((c) => ({ id: c.id, label: c.label, status: c.status, detail: c.detail, fingerprint: c.finding ? byFingerprintKey.get(c.finding.ruleId)?.fingerprint : undefined })),
    };
  });
}

export function score(findings: Finding[], checks: CheckResult[], coverage: Coverage): Scorecard {
  const counts = { P0: 0, P1: 0, P2: 0, P3: 0 };
  const live = findings.filter((f) => f.ai?.verdict !== "likely_false_positive" && f.change !== "fixed");
  for (const f of live) counts[f.priority]++;

  const categories: CategoryScore[] = CATEGORIES.map((category) => {
    const { assessed, reason } = categoryAssessed(category, coverage);
    const fs = live.filter((f) => f.category === category);
    return assessed ? { category, score: categoryScore(fs), findings: fs.length } : { category, score: null, findings: fs.length, reason };
  });

  const scored = categories.filter((c): c is CategoryScore & { score: number } => c.score !== null && CATEGORY_WEIGHTS[c.category] > 0);
  const weightSum = scored.reduce((a, c) => a + CATEGORY_WEIGHTS[c.category], 0);
  let overall = weightSum > 0 ? Math.round(scored.reduce((a, c) => a + c.score * CATEGORY_WEIGHTS[c.category], 0) / weightSum) : null;

  let verdict: Verdict;
  if (overall === null) verdict = "insufficient_coverage";
  else if (counts.P0 > 0) {
    verdict = "not_launch_ready";
    overall = Math.min(overall, 49);
  } else if (counts.P1 > 0) {
    verdict = "launch_with_fixes";
    overall = Math.min(overall, 79);
  } else if (coverage.sourceCoverage < 0.6 || coverage.scanners.some((sc) => CORE_SCANNERS.has(sc.name) && sc.status === "failed")) verdict = "insufficient_coverage";
  else verdict = "launch_ready_in_scope";

  const pct = Math.round(coverage.sourceCoverage * 100);
  const notAssessed = categories.filter((c) => c.score === null).map((c) => c.category);
  const failed = coverage.scanners.filter((sc) => sc.status === "failed").map((sc) => sc.name);
  const coverageNote = `${failed.length ? `Scanner(s) failed: ${failed.join(", ")}; their areas are unverified. ` : ""}${pct}% of source files were inspected by at least one code scanner. Not assessed: ${notAssessed.join(", ") || "none"}.${coverage.truncated ? " The repository exceeded this tier's size limits, so some files were not analyzed." : ""}`;

  return { rubricVersion: RUBRIC_VERSION, overall, verdict, categories, readiness: buildReadiness(checks, findings), counts, coverageNote };
}
