import type { CheckResult } from "./readiness/detectors";
import { CATEGORIES, type Category, type Coverage, type EvidenceTier, type Finding, type ReadinessArea, type Severity } from "./types";

/**
 * Deterministic, versioned scoring rubric. The LLM never produces a score.
 * Changing any constant here requires bumping RUBRIC_VERSION so historical audits stay comparable.
 */
export const RUBRIC_VERSION = "2026.11-v1";

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

/** Required for a launch-ready verdict. OSV may be skipped only when the repo has no supported lockfile. */
export const CORE_SCANNERS: ReadonlySet<string> = new Set(["secrets", "osv", "semgrep", "readiness"]);

const OSV_NOT_APPLICABLE = /no supported lockfile/i;

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

/** Scanner evidence only. AI labels are advisory and must not change this weight. */
function effectiveWeight(f: Finding): number {
  return TIER_WEIGHT[f.tier];
}

/**
 * Why this coverage cannot support a launch verdict, or null when the inspection finished.
 * A skipped OSV scan is acceptable only when no supported lockfile exists.
 */
export function launchEvidenceGap(coverage: Coverage): string | null {
  const reasons: string[] = [];
  if (coverage.truncated) reasons.push("repository extraction was truncated");
  for (const name of ["secrets", "semgrep", "readiness"]) {
    const run = coverage.scanners.find((s) => s.name === name);
    if (!run) reasons.push(`${name} did not run`);
    else if (run.status !== "ran") reasons.push(`${name} ${run.status}${run.reason ? ` (${run.reason})` : ""}`);
  }
  const osv = coverage.scanners.find((s) => s.name === "osv");
  if (!osv) reasons.push("osv did not run");
  else if (osv.status === "skipped" && !OSV_NOT_APPLICABLE.test(osv.reason ?? "")) reasons.push(`osv skipped${osv.reason ? ` (${osv.reason})` : ""}`);
  else if (osv.status !== "ran" && osv.status !== "skipped") reasons.push(`osv ${osv.status}${osv.reason ? ` (${osv.reason})` : ""}`);
  if (coverage.sourceCoverage < 1) reasons.push(`only ${Math.round(coverage.sourceCoverage * 100)}% of eligible source files were positively inspected by a code scanner`);
  return reasons.length ? reasons.join("; ") : null;
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
  if (cat === "security" && !ran("semgrep")) return { assessed: false, reason: "Semgrep did not complete, so code-level security was not assessed." };
  if (cat === "security") {
    const osv = coverage.scanners.find((s) => s.name === "osv");
    const osvDone = !!osv && (osv.status === "ran" || (osv.status === "skipped" && OSV_NOT_APPLICABLE.test(osv.reason ?? "")));
    if (!osvDone) return { assessed: false, reason: "Dependency scanning did not complete." };
  }
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
  const live = findings.filter((f) => f.change !== "fixed");
  for (const f of live) counts[f.priority]++;

  const categories: CategoryScore[] = CATEGORIES.map((category) => {
    const { assessed, reason } = categoryAssessed(category, coverage);
    const fs = live.filter((f) => f.category === category);
    return assessed ? { category, score: categoryScore(fs), findings: fs.length } : { category, score: null, findings: fs.length, reason };
  });

  const scored = categories.filter((c): c is CategoryScore & { score: number } => c.score !== null && CATEGORY_WEIGHTS[c.category] > 0);
  const weightSum = scored.reduce((a, c) => a + CATEGORY_WEIGHTS[c.category], 0);
  let overall = weightSum > 0 ? Math.round(scored.reduce((a, c) => a + c.score * CATEGORY_WEIGHTS[c.category], 0) / weightSum) : null;

  const gap = launchEvidenceGap(coverage);
  let verdict: Verdict;
  if (gap || overall === null) {
    verdict = counts.P0 > 0 ? "not_launch_ready" : "insufficient_coverage";
    overall = null;
  } else if (counts.P0 > 0) {
    verdict = "not_launch_ready";
    overall = Math.min(overall, 49);
  } else if (counts.P1 > 0) {
    verdict = "launch_with_fixes";
    overall = Math.min(overall, 79);
  } else verdict = "launch_ready_in_scope";

  const pct = Math.round(coverage.sourceCoverage * 100);
  const notAssessed = categories.filter((c) => c.score === null).map((c) => c.category);
  const coverageNote = `${gap ? `Inspection incomplete: ${gap}. ` : ""}${pct}% of source files were positively inspected by Semgrep or ESLint. ${coverage.filesIngested.toLocaleString()} files were ingested and ${coverage.filesInspected.toLocaleString()} source files were positively inspected. Not assessed: ${notAssessed.join(", ") || "none"}.`;

  return { rubricVersion: RUBRIC_VERSION, overall, verdict, categories, readiness: buildReadiness(checks, findings), counts, coverageNote };
}
