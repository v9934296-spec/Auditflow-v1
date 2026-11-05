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
import { finalize, type AiAssessment, type Coverage, type Finding, type Priority, type ScannerRun } from "./types";
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
  /** Files changed since the previous audit's commit; AI re-triage is limited to these. */
  changedFiles?: Set<string>;
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

/**
 * Compares current findings with a previous audit.
 * A previous finding is only marked "fixed" if the scanner that produced it ran successfully this time;
 * otherwise it is carried forward as unresolved (not re-tested), so fixes are never claimed without evidence.
 */
export function compareWithPrevious(current: Finding[], previous: PreviousFinding[], scanners: ScannerRun[]): Finding[] {
  const prevByFp = new Map(previous.map((p) => [p.fingerprint, p]));
  const curFps = new Set(current.map((c) => c.fingerprint));
  const ran = new Set(scanners.filter((s) => s.status === "ran").map((s) => s.name));
  const out: Finding[] = current.map((c) => ({ ...c, change: prevByFp.has(c.fingerprint) ? "unresolved" : "regressed" }));
  for (const p of previous) {
    if (curFps.has(p.fingerprint) || p.change === "fixed") continue;
    const { id: _id, ...rest } = p;
    if (ran.has(p.source)) out.push({ ...rest, change: "fixed" });
    else out.push({ ...rest, change: "unresolved", evidence: { ...p.evidence, method: `${p.evidence.method} (Not re-tested: the ${p.source} scanner did not run in this check.)` } });
  }
  return out;
}

export async function analyzeRepository(repo: RepoIndex, opts: AnalyzeOptions): Promise<AnalysisResult> {
  const limits = LIMITS[opts.kind];
  const scanners: ScannerRun[] = [];
  const raw: Finding[] = [];
  const notes: string[] = [];

  const secrets = await scanSecrets(repo);
  scanners.push(secrets.run);
  raw.push(...secrets.findings.map(finalize));

  try {
    const osv = await scanOsv(repo, opts.fetchImpl);
    scanners.push(osv.run);
    raw.push(...osv.findings.map(finalize));
  } catch (e) {
    scanners.push({ name: "osv", status: "failed", reason: (e as Error).message });
    notes.push("Dependency vulnerability lookup failed; dependencies were not assessed.");
  }

  if (!opts.disableSemgrep) {
    const sg = await scanSemgrep(repo);
    scanners.push(sg.run);
    raw.push(...sg.findings.map(finalize));
  } else scanners.push({ name: "semgrep", status: "skipped", reason: "Disabled for this run." });

  if (limits.eslintEnabled) {
    const es = await scanEslint(repo);
    scanners.push(es.run);
    raw.push(...es.findings.map(finalize));
  } else scanners.push({ name: "eslint", status: "skipped", reason: "Included in the full audit." });

  const readinessStarted = Date.now();
  const readiness = await runReadinessChecks(repo);
  scanners.push({ name: "readiness", status: "ran", filesScanned: repo.files.length, durationMs: Date.now() - readinessStarted });
  raw.push(...readiness.findings.map(finalize));

  let findings = dedupe(raw).sort((a, b) => PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority]);

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

  // Carry forward AI assessments for unchanged code (targeted rechecks).
  if (opts.previous?.length) {
    const prevAi = new Map<string, AiAssessment>();
    for (const p of opts.previous) if (p.ai) prevAi.set(p.fingerprint, p.ai);
    for (const f of findings) {
      const unchanged = !f.filePath || !opts.changedFiles || !opts.changedFiles.has(f.filePath);
      const prior = prevAi.get(f.fingerprint);
      if (prior && unchanged) f.ai = prior;
    }
  }

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

  if (opts.previous) findings = compareWithPrevious(findings, opts.previous, scanners);

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
