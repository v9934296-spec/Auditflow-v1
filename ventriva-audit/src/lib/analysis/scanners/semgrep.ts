import { execFile } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";
import type { RepoIndex } from "../files";
import { excerpt } from "../files";
import { redact } from "../redact";
import type { Category, RawFinding, ScannerRun, Severity } from "../types";

const run = promisify(execFile);

export const SEMGREP_RULES_DIR = path.resolve(process.cwd(), "semgrep-rules");

interface SemgrepResult {
  check_id: string;
  path: string;
  start: { line: number };
  end: { line: number };
  extra: { message: string; severity: string; metadata?: { category?: string; severity?: string; remediation?: string } };
}

const SEVERITIES: Severity[] = ["critical", "high", "medium", "low", "info"];
const CATS: Category[] = ["security", "reliability", "maintainability", "testing", "launch_readiness"];

export function mapSemgrepResults(results: SemgrepResult[], root: string, texts: Map<string, string>): RawFinding[] {
  return results.map((r) => {
    const rel = path.relative(root, path.resolve(root, r.path)).split(path.sep).join("/");
    const ruleShort = r.check_id.split(".").pop() ?? r.check_id;
    const meta = r.extra.metadata ?? {};
    const severity = SEVERITIES.includes(meta.severity as Severity) ? (meta.severity as Severity) : r.extra.severity === "ERROR" ? "high" : r.extra.severity === "WARNING" ? "medium" : "low";
    const category = CATS.includes(meta.category as Category) ? (meta.category as Category) : "security";
    const text = texts.get(rel) ?? "";
    return {
      ruleId: `semgrep.${ruleShort}`,
      source: "semgrep" as const,
      category,
      severity,
      tier: "suspected" as const,
      confidence: severity === "critical" || severity === "high" ? ("medium" as const) : ("low" as const),
      title: r.extra.message.split(".")[0] ?? ruleShort,
      description: r.extra.message,
      remediation: meta.remediation ?? "Review this code path and apply the secure pattern described above.",
      filePath: rel,
      startLine: r.start.line,
      endLine: r.end.line,
      snippet: text ? redact(excerpt(text, r.start.line, r.end.line, 2)) : undefined,
      evidence: { method: `Static pattern match by Semgrep rule ${ruleShort} (code was parsed, never executed).` },
    };
  });
}

export async function scanSemgrep(repo: RepoIndex, opts: { timeoutMs?: number } = {}): Promise<{ findings: RawFinding[]; run: ScannerRun }> {
  const started = Date.now();
  // Minimal env: no credentials reach the scanner, and no network version/metrics checks.
  const env = { PATH: process.env.PATH ?? "", HOME: process.env.HOME ?? "/tmp", SEMGREP_SEND_METRICS: "off", SEMGREP_ENABLE_VERSION_CHECK: "0" } as unknown as NodeJS.ProcessEnv;
  try {
    await run("semgrep", ["--version"], { timeout: 30_000, env });
  } catch {
    return { findings: [], run: { name: "semgrep", status: "skipped", reason: "Semgrep CLI is not installed in this worker." } };
  }
  try {
    const { stdout } = await run(
      "semgrep",
      [
        "scan",
        "--config", SEMGREP_RULES_DIR,
        "--json",
        "--metrics=off",
        "--disable-version-check",
        "--quiet",
        "--timeout", "20",
        "--max-target-bytes", "1000000",
        "--jobs", "2",
        repo.root,
      ],
      { timeout: opts.timeoutMs ?? 300_000, maxBuffer: 64 * 1024 * 1024, env },
    );
    const json = JSON.parse(stdout) as { results: SemgrepResult[]; paths?: { scanned?: string[] } };
    const texts = new Map<string, string>();
    for (const r of json.results) {
      const rel = path.relative(repo.root, path.resolve(repo.root, r.path)).split(path.sep).join("/");
      if (!texts.has(rel)) texts.set(rel, await repo.read(rel));
    }
    return {
      findings: mapSemgrepResults(json.results, repo.root, texts),
      run: { name: "semgrep", status: "ran", filesScanned: json.paths?.scanned?.length, durationMs: Date.now() - started },
    };
  } catch (e) {
    return { findings: [], run: { name: "semgrep", status: "failed", reason: (e as Error).message.slice(0, 300), durationMs: Date.now() - started } };
  }
}
