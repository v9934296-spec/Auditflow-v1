import { createHash } from "node:crypto";

export type Severity = "critical" | "high" | "medium" | "low" | "info";
export type Priority = "P0" | "P1" | "P2" | "P3";
export type EvidenceTier = "verified" | "suspected" | "not_tested";
export type Confidence = "high" | "medium" | "low";
export type FindingChange = "new" | "unresolved" | "fixed" | "regressed";

/**
 * Scoring categories. Architecture and performance are listed so the report can
 * state plainly that they were NOT assessed in this rubric version.
 */
export const CATEGORIES = [
  "security",
  "launch_readiness",
  "reliability",
  "maintainability",
  "testing",
  "architecture",
  "performance",
] as const;
export type Category = (typeof CATEGORIES)[number];

export const CATEGORY_LABELS: Record<Category, string> = {
  security: "Security",
  launch_readiness: "Launch readiness",
  reliability: "Reliability",
  maintainability: "Maintainability",
  testing: "Testing",
  architecture: "Architecture",
  performance: "Performance",
};

export type ReadinessArea = "auth" | "billing" | "onboarding" | "deployment_config" | "operations";

export const READINESS_AREA_LABELS: Record<ReadinessArea, string> = {
  auth: "Authentication",
  billing: "Billing",
  onboarding: "Onboarding",
  deployment_config: "Deployment config",
  operations: "Operations",
};

export interface Evidence {
  /** How the evidence was produced, in plain words. */
  method: string;
  /** For absence checks: the patterns that were searched for. */
  searchedFor?: string[];
  /** For absence checks: how many files were inspected. */
  filesInspected?: number;
  /** Extra structured facts (advisory ids, versions, matched rule metadata). */
  facts?: Record<string, string | number | boolean | string[]>;
}

export interface RawFinding {
  ruleId: string;
  source: "secrets" | "osv" | "semgrep" | "eslint" | "readiness" | "repo";
  category: Category;
  readinessArea?: ReadinessArea;
  severity: Severity;
  tier: EvidenceTier;
  confidence: Confidence;
  title: string;
  description: string;
  remediation: string;
  filePath?: string;
  startLine?: number;
  endLine?: number;
  /** Already redacted. */
  snippet?: string;
  evidence: Evidence;
  /** Stable key used to compute the fingerprint (defaults to path+snippet). */
  fingerprintKey?: string;
}

export interface AiAssessment {
  verdict: "likely_true_positive" | "likely_false_positive" | "needs_human_review";
  confidence: Confidence;
  explanation: string;
  remediation: string;
  model: string;
}

export interface Finding extends RawFinding {
  fingerprint: string;
  priority: Priority;
  ai?: AiAssessment;
  change?: FindingChange;
}

export type ScannerStatus = "ran" | "partial" | "skipped" | "failed";

export interface ScannerRun {
  name: string;
  status: ScannerStatus;
  reason?: string;
  filesScanned?: number;
  /** Repo-relative paths this scanner successfully read. Absent means the scanner did not report them. */
  inspectedFiles?: string[];
  durationMs?: number;
}

export interface Coverage {
  filesTotal: number;
  /** Files ingested into the workspace. This is not proof they were inspected. */
  filesAnalyzed: number;
  /** Same count as filesAnalyzed, named for the report so ingestion is not confused with inspection. */
  filesIngested: number;
  /** Source files positively inspected by Semgrep or ESLint. */
  filesInspected: number;
  filesSkipped: number;
  skippedReasons: Record<string, number>;
  languages: Record<string, number>;
  scanners: ScannerRun[];
  /** Fraction (0–1) of source files positively inspected by Semgrep or ESLint. */
  sourceCoverage: number;
  truncated: boolean;
  notes: string[];
}

export function severityToPriority(severity: Severity): Priority {
  switch (severity) {
    case "critical":
      return "P0";
    case "high":
      return "P1";
    case "medium":
      return "P2";
    default:
      return "P3";
  }
}

export function fingerprintOf(f: RawFinding): string {
  const key =
    f.fingerprintKey ??
    [f.filePath ?? "", (f.snippet ?? "").replace(/\s+/g, " ").trim()].join("|");
  return createHash("sha256").update(`${f.ruleId}::${key}`).digest("hex").slice(0, 32);
}

export function finalize(f: RawFinding): Finding {
  return { ...f, fingerprint: fingerprintOf(f), priority: severityToPriority(f.severity) };
}
