import { LIMITS, type AuditKind } from "@/lib/config/plans";
import { languageBreakdown, SCANNED_LANGUAGES, type RepoIndex } from "./files";
import { Budget, type LlmProvider, type UsageRecord } from "./llm/provider";
import { deterministicSummary, triageFindings, writeSummary } from "./llm/triage";
import { runReadinessChecks, type CheckResult } from "./readiness/detectors";
import { scanEslint } from "./scanners/eslint";
import { scanOsv, type FetchLike } from "./scanners/osv";
import { scanSecrets } from "./scanners/secrets";
import { scanSemgrep } from "./scanners/semgrep";
import { score, type Scorecard } from "./scoring";
import { buildTickets, type Ticket } from "./tickets";
import { identifyFindings, legacyFingerprintOf, textIdentity, type Coverage, type Finding, type Priority, type RawFinding, type ScannerRun } from "./types";
import type { IngestStats } from "./ingest";

export interface PreviousFinding extends Finding {
  /** Present when loaded from the DB. */
  id?: string;
}

export interface AnalyzeOptions {
  kind: AuditKind;
  ingest?: IngestStats;
  provider?: LlmProvider;
  /** Platform-wide spend guard (daily cap). */
  globalBudgetGuard?: (estimateUsd: number) => Promise<boolean>;
  fetchImpl?: FetchLike;
  /** Findings from the audit being compared against (rechecks/monitoring). */
  previous?: PreviousFinding[];
  /**
   * Files changed since the previous audit's commit.
   * null or omitted means the comparison failed or was incomplete: do not reuse AI assessments.
   * An empty set means the comparison succeeded and nothing changed.
   */
  changedFiles?: ReadonlySet<string> | null;
  /** Previous path to current path. Only trusted when the comparison succeeded. */
  renames?: ReadonlyMap<string, string>;
  /** Skip Semgrep (tests / environments without the CLI). */
  disableSemgrep?: boolean;
}

export interface AnalysisResult {
  findings: Finding[];
  checks: CheckResult[];
  coverage: Coverage;
  scorecard: Scorecard;
  tickets: Ticket[];
  summary: string;
  summaryByAi: boolean;
  usage: UsageRecord[];
  aiCostUsd: number;
  aiNote: string | null;
}

const PRIORITY_RANK: Record<Priority, number> = { P0: 0, P1: 1, P2: 2, P3: 3 };

const CODE_SCANNERS = new Set(["semgrep", "eslint"]);

/** Source files Semgrep or ESLint actually parsed. Language support is not a substitute. */
export function inspectedSourceFiles(sourcePaths: string[], scanners: ScannerRun[]): string[] {
  const source = new Set(sourcePaths);
  const hit = new Set<string>();
  for (const scanner of scanners) {
    if (!CODE_SCANNERS.has(scanner.name) || (scanner.status !== "ran" && scanner.status !== "partial")) continue;
    for (const file of scanner.inspectedFiles ?? []) if (source.has(file)) hit.add(file);
  }
  return [...hit];
}

export function dedupe(findings: Finding[]): Finding[] {
  const map = new Map<string, Finding>();
  for (const f of findings) if (!map.has(f.fingerprint)) map.set(f.fingerprint, f);
  return [...map.values()];
}

interface IssueSide {
  finding: Finding;
  occurrence: number;
}

function issueSides(findings: Finding[]): IssueSide[] {
  const groups = new Map<string, { finding: Finding; index: number }[]>();
  findings.forEach((finding, index) => {
    const key = textIdentity(finding);
    const group = groups.get(key) ?? [];
    group.push({ finding, index });
    groups.set(key, group);
  });
  const occurrence = new Map<Finding, number>();
  for (const group of groups.values()) {
    group.sort((a, b) => (a.finding.startLine ?? 0) - (b.finding.startLine ?? 0) || a.index - b.index);
    group.forEach((item, index) => occurrence.set(item.finding, index));
  }
  return findings.map((finding) => ({ finding, occurrence: occurrence.get(finding) ?? 0 }));
}

function sameIssue(current: IssueSide, previous: IssueSide, renames: ReadonlyMap<string, string>): boolean {
  const left = current.finding;
  const right = previous.finding;
  if (left.fingerprint === right.fingerprint) return true;
  if (legacyFingerprintOf(left) === right.fingerprint || legacyFingerprintOf(right) === left.fingerprint) return true;
  if (left.ruleId !== right.ruleId) return false;
  if (textIdentity(left) === textIdentity(right) && current.occurrence === previous.occurrence) return true;
  const renamed = right.filePath ? renames.get(right.filePath) : undefined;
  return Boolean(
    renamed &&
      left.filePath === renamed &&
      textIdentity(left) === textIdentity(right, renamed) &&
      current.occurrence === previous.occurrence,
  );
}

/** The scanner finished and inspected this finding's file, dependency, or configuration. Partial coverage is not enough. */
export function findingRetested(finding: Finding, scanners: ScannerRun[], renames: ReadonlyMap<string, string> = new Map()): boolean {
  const run = scanners.find((scanner) => scanner.name === finding.source);
  if (!run || run.status !== "ran") return false;
  if (!finding.filePath) return true;
  const path = renames.get(finding.filePath) ?? finding.filePath;
  return run.inspectedFiles?.includes(path) ?? false;
}

function notRetested(previous: PreviousFinding, scanners: ScannerRun[]): Finding {
  const { id: _id, ...rest } = previous;
  const run = scanners.find((scanner) => scanner.name === previous.source);
  const why = !run || run.status !== "ran"
    ? `Not re-tested: the ${previous.source} scanner ${run ? `is ${run.status}` : "did not run"}.`
    : `Not re-tested: the ${previous.source} scanner did not inspect ${previous.filePath ?? "the relevant source"}.`;
  const method = rest.evidence.method.includes("Not re-tested:") ? rest.evidence.method : `${rest.evidence.method} (${why})`;
  return { ...rest, change: "not_retested", evidence: { ...rest.evidence, method } };
}

/**
 * Compares current findings with a previous audit.
 * Fixed requires the same file, dependency, or configuration to have been inspected by a completed scanner.
 * Regressed requires the same issue to have been verified fixed before. Anything else new is new.
 */
export function compareWithPrevious(
  current: Finding[],
  previous: PreviousFinding[],
  scanners: ScannerRun[],
  renames: ReadonlyMap<string, string> = new Map(),
): Finding[] {
  const currentSides = issueSides(current);
  const previousSides = issueSides(previous);
  const matched = new Set<IssueSide>();

  function take(side: IssueSide, pass: (candidate: IssueSide) => boolean): IssueSide | undefined {
    const found = previousSides.find((candidate) => !matched.has(candidate) && pass(candidate));
    if (found) matched.add(found);
    return found;
  }

  const out: Finding[] = currentSides.map((side) => {
    const prior = take(side, (candidate) => sameIssue(side, candidate, renames));
    if (!prior) return { ...side.finding, change: "new" };
    return { ...side.finding, change: prior.finding.change === "fixed" ? "regressed" : "unresolved" };
  });

  for (const side of previousSides) {
    if (matched.has(side)) continue;
    if (side.finding.change === "fixed" && findingRetested(side.finding, scanners, renames)) continue;
    if (findingRetested(side.finding, scanners, renames)) {
      const { id: _id, ...rest } = side.finding as PreviousFinding;
      out.push({ ...rest, change: "fixed" });
    } else {
      out.push(notRetested(side.finding, scanners));
    }
  }
  return out;
}

/**
 * Copies an AI note only when a completed diff shows the finding's file was not changed.
 * A missing diff is not treated as an empty diff.
 */
export function reusePriorAssessments(
  current: Finding[],
  previous: PreviousFinding[],
  changedFiles: ReadonlySet<string> | null | undefined,
  renames: ReadonlyMap<string, string> = new Map(),
): Finding[] {
  if (changedFiles == null) return current;
  const currentSides = issueSides(current);
  const previousSides = issueSides(previous);
  const matched = new Set<IssueSide>();
  return currentSides.map((side) => {
    const prior = previousSides.find((candidate) => !matched.has(candidate) && candidate.finding.ai && sameIssue(side, candidate, renames));
    if (!prior?.finding.ai) return side.finding;
    matched.add(prior);
    const path = side.finding.filePath;
    const renamed = prior.finding.filePath ? renames.has(prior.finding.filePath) : false;
    const unchanged = path ? !changedFiles.has(path) && !renamed : changedFiles.size === 0 && renames.size === 0;
    return unchanged ? { ...side.finding, ai: prior.finding.ai } : side.finding;
  });
}

export async function analyzeRepository(repo: RepoIndex, opts: AnalyzeOptions): Promise<AnalysisResult> {
  const limits = LIMITS[opts.kind];
  const scanners: ScannerRun[] = [];
  const raw: RawFinding[] = [];
  const notes: string[] = [];

  const secrets = await scanSecrets(repo);
  scanners.push(secrets.run);
  raw.push(...secrets.findings);

  try {
    const osv = await scanOsv(repo, opts.fetchImpl);
    scanners.push(osv.run);
    raw.push(...osv.findings);
  } catch (e) {
    scanners.push({ name: "osv", status: "failed", reason: (e as Error).message });
    notes.push("Dependency vulnerability lookup failed; dependencies were not assessed.");
  }

  if (!opts.disableSemgrep) {
    const sg = await scanSemgrep(repo);
    scanners.push(sg.run);
    raw.push(...sg.findings);
  } else scanners.push({ name: "semgrep", status: "skipped", reason: "Disabled for this run." });

  if (limits.eslintEnabled) {
    const es = await scanEslint(repo);
    scanners.push(es.run);
    raw.push(...es.findings);
  } else scanners.push({ name: "eslint", status: "skipped", reason: "Included in the full audit." });

  const readinessStarted = Date.now();
  const readiness = await runReadinessChecks(repo);
  scanners.push({
    name: "readiness",
    status: "ran",
    filesScanned: readiness.inspectedFiles.length,
    inspectedFiles: readiness.inspectedFiles,
    durationMs: Date.now() - readinessStarted,
  });
  raw.push(...readiness.findings);

  let findings = dedupe(identifyFindings(raw)).sort((a, b) => PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority]);

  // Coverage is the union of eligible source files a code scanner positively inspected.
  // Languages outside the scanner set are named in the notes and are not treated as inspected or as eligible.
  const sourceFiles = repo.sourceFiles;
  const eligible = sourceFiles.filter((f) => f.language && SCANNED_LANGUAGES.has(f.language));
  const inspected = inspectedSourceFiles(eligible.map((f) => f.path), scanners);
  const coverage: Coverage = {
    filesTotal: (opts.ingest?.filesExtracted ?? repo.files.length) + Object.values(opts.ingest?.skipped ?? {}).reduce((a, b) => a + b, 0),
    filesAnalyzed: repo.files.length,
    filesIngested: repo.files.length,
    filesInspected: inspected.length,
    filesSkipped: Object.values(opts.ingest?.skipped ?? {}).reduce((a, b) => a + b, 0),
    skippedReasons: opts.ingest?.skipped ?? {},
    languages: languageBreakdown(sourceFiles),
    scanners,
    sourceCoverage: eligible.length === 0 ? 0 : inspected.length / eligible.length,
    truncated: opts.ingest?.truncated ?? false,
    notes,
  };
  const unscanned = Object.keys(coverage.languages).filter((l) => !SCANNED_LANGUAGES.has(l));
  if (unscanned.length) notes.push(`Code-level rules do not cover: ${unscanned.join(", ")}. Secrets, dependencies and readiness checks still ran where those files were present.`);
  if (inspected.length === 0) notes.push("No source file was positively inspected by Semgrep or ESLint.");

  // Carry forward AI assessments only when the diff proves the source is unchanged.
  if (opts.previous?.length) findings = reusePriorAssessments(findings, opts.previous, opts.changedFiles, opts.renames ?? new Map());

  // AI triage (paid tiers only, hard budget)
  const budget = new Budget(limits.maxAiCostUsd, limits.maxInputTokens, opts.globalBudgetGuard);
  let aiNote: string | null = null;
  if (limits.aiEnabled && opts.provider) {
    const pending = findings.filter((f) => !f.ai);
    const outcome = await triageFindings(pending, opts.provider, budget, limits.maxAiFindings);
    if (outcome.stoppedReason) aiNote = `AI review stopped early: ${outcome.stoppedReason} ${outcome.skipped} finding(s) were not AI-reviewed and keep their scanner confidence.`;
  } else if (limits.aiEnabled) {
    aiNote = "AI review unavailable for this run; findings keep their scanner confidence.";
  }
  if (aiNote) notes.push(aiNote);

  if (opts.previous) findings = compareWithPrevious(findings, opts.previous, scanners, opts.renames ?? new Map());

  const scorecard = score(findings, readiness.checks, coverage);
  const tickets = limits.ticketsEnabled ? buildTickets(findings) : [];

  let summary = deterministicSummary(scorecard, findings);
  let summaryByAi = false;
  if (limits.aiEnabled && opts.provider && opts.kind === "full_audit") {
    const s = await writeSummary(scorecard, findings, opts.provider, budget);
    summary = s.text;
    summaryByAi = s.ai;
  }

  return { findings, checks: readiness.checks, coverage, scorecard, tickets, summary, summaryByAi, usage: budget.records, aiCostUsd: budget.costUsd, aiNote };
}
