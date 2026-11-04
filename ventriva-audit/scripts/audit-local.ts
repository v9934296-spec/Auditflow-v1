/**
 * Run the analysis engine against a local folder — no database, GitHub or Stripe needed.
 * The folder goes through the same safe-ingest filters used in production.
 *
 *   npx tsx scripts/audit-local.ts <path-to-repo> [--kind free_scan|full_audit] [--ai] [--json]
 *
 * --ai requires ANTHROPIC_API_KEY and spends real money (capped by the full_audit budget).
 */
import { createReadStream } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import * as tar from "tar";
import { indexRepo } from "../src/lib/analysis/files";
import { extractTarball, IGNORED_DIRS } from "../src/lib/analysis/ingest";
import { AnthropicProvider } from "../src/lib/analysis/llm/anthropic";
import { analyzeRepository } from "../src/lib/analysis/pipeline";
import { VERDICT_LABELS } from "../src/lib/analysis/scoring";
import { ticketsToMarkdown } from "../src/lib/analysis/tickets";
import { LIMITS, type AuditKind } from "../src/lib/config/plans";

async function main() {
  const args = process.argv.slice(2);
  const target = args.find((a, i) => !a.startsWith("--") && args[i - 1] !== "--kind");
  if (!target) {
    console.error("Usage: npx tsx scripts/audit-local.ts <path-to-repo> [--kind free_scan|full_audit] [--ai] [--json]");
    process.exit(1);
  }
  const kindArg = args[args.indexOf("--kind") + 1];
  const kind: AuditKind = kindArg === "free_scan" || kindArg === "full_audit" ? kindArg : "full_audit";
  const root = path.resolve(target);

  const scratch = await mkdtemp(path.join(tmpdir(), "local-audit-"));
  const archive = path.join(scratch, "repo.tgz");
  await tar.create(
    { gzip: true, file: archive, cwd: path.dirname(root), portable: true, filter: (p) => !p.split("/").some((seg) => IGNORED_DIRS.has(seg)) },
    [path.basename(root)],
  );
  const ws = await extractTarball(createReadStream(archive), LIMITS[kind]);
  try {
    const provider = args.includes("--ai") && process.env.ANTHROPIC_API_KEY ? new AnthropicProvider(process.env.ANTHROPIC_API_KEY) : undefined;
    const result = await analyzeRepository(await indexRepo(ws.dir), { kind, ingest: ws.stats, provider });
    if (args.includes("--json")) {
      console.log(JSON.stringify({ scorecard: result.scorecard, findings: result.findings, coverage: result.coverage }, null, 2));
      return;
    }
    const c = result.scorecard;
    console.log(`\n${VERDICT_LABELS[c.verdict]}: ${c.overall ?? "n/a"}/100  (P0 ${c.counts.P0}, P1 ${c.counts.P1}, P2 ${c.counts.P2}, P3 ${c.counts.P3})`);
    console.log(result.summary, "\n");
    for (const a of c.readiness) console.log(`${a.area.padEnd(18)} ${a.status.padEnd(15)} pass ${a.passed} / fail ${a.failed}`);
    console.log("");
    for (const cat of c.categories) console.log(`${cat.category.padEnd(18)} ${cat.score ?? "not assessed"}`);
    console.log("\nScanners:", result.coverage.scanners.map((s) => `${s.name}=${s.status}${s.reason ? ` (${s.reason})` : ""}`).join(", "));
    console.log("\nFindings:");
    for (const f of result.findings) console.log(`  [${f.priority}] ${f.title}${f.filePath ? `  (${f.filePath}${f.startLine ? `:${f.startLine}` : ""})` : ""}`);
    if (result.tickets.length) {
      const out = path.join(process.cwd(), "audit-tickets.md");
      await writeFile(out, ticketsToMarkdown(path.basename(root), "local", result.tickets));
      console.log(`\n${result.tickets.length} tickets written to ${out}`);
    }
    if (result.aiCostUsd) console.log(`AI cost: $${result.aiCostUsd.toFixed(4)}`);
  } finally {
    await ws.cleanup();
    await rm(scratch, { recursive: true, force: true });
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
