import { z } from "zod";
import { MODELS } from "@/lib/config/plans";
import { redact } from "../redact";
import type { Scorecard } from "../scoring";
import { VERDICT_LABELS } from "../scoring";
import type { AiAssessment, Finding, Severity } from "../types";
import { Budget, BudgetExceededError, type LlmProvider } from "./provider";

/**
 * The model's only job is to interpret evidence that deterministic scanners already produced.
 * It cannot add findings, change severities or produce scores.
 */

const TRIAGE_SYSTEM = `You are a senior application security and production-readiness reviewer.
You will receive findings that static analysis tools already produced, each with a redacted code excerpt.
For each finding decide whether the excerpt supports it.

Rules:
- Judge ONLY from the excerpt and description provided. Do not assume code you cannot see.
- If the excerpt is insufficient to decide, answer "needs_human_review".
- Never invent new vulnerabilities, files, line numbers, or library behavior.
- "explanation": at most 2 sentences, plain English, referencing what in the excerpt supports your verdict.
- "remediation": concrete, minimal fix for THIS code (no architectural rewrites), at most 4 sentences.
- Redacted values look like "abcd…[REDACTED n chars]"; treat them as real secrets.`;

const TriageSchema = z.object({
  assessments: z.array(
    z.object({
      id: z.number().int(),
      verdict: z.enum(["likely_true_positive", "likely_false_positive", "needs_human_review"]),
      confidence: z.enum(["high", "medium", "low"]),
      explanation: z.string().max(800),
      remediation: z.string().max(1500),
    }),
  ),
});

const TRIAGE_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["assessments"],
  properties: {
    assessments: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["id", "verdict", "confidence", "explanation", "remediation"],
        properties: {
          id: { type: "integer" },
          verdict: { type: "string", enum: ["likely_true_positive", "likely_false_positive", "needs_human_review"] },
          confidence: { type: "string", enum: ["high", "medium", "low"] },
          explanation: { type: "string" },
          remediation: { type: "string" },
        },
      },
    },
  },
} as const;

const SEV_RANK: Record<Severity, number> = { critical: 0, high: 1, medium: 2, low: 3, info: 4 };
const BATCH = 8;
const MAX_SNIPPET_CHARS = 1_800;

export function selectForTriage(findings: Finding[], max: number): Finding[] {
  return findings
    .filter((f) => f.tier === "suspected" && f.snippet && f.category !== "maintainability")
    .sort((a, b) => SEV_RANK[a.severity] - SEV_RANK[b.severity])
    .slice(0, max);
}

export function buildTriagePrompt(batch: Finding[]): string {
  return batch
    .map((f, i) =>
      [
        `### Finding ${i}`,
        `rule: ${f.ruleId}`,
        `severity (tool): ${f.severity}`,
        `title: ${f.title}`,
        `description: ${f.description}`,
        `file: ${f.filePath ?? "n/a"}${f.startLine ? `:${f.startLine}` : ""}`,
        "excerpt:",
        "```",
        redact((f.snippet ?? "").slice(0, MAX_SNIPPET_CHARS)),
        "```",
      ].join("\n"),
    )
    .join("\n\n");
}

export interface TriageOutcome {
  triaged: number;
  skipped: number;
  stoppedReason: string | null;
}

export async function triageFindings(findings: Finding[], provider: LlmProvider, budget: Budget, maxFindings: number): Promise<TriageOutcome> {
  const selected = selectForTriage(findings, maxFindings);
  let triaged = 0;
  let stoppedReason: string | null = null;

  for (let i = 0; i < selected.length; i += BATCH) {
    const batch = selected.slice(i, i + BATCH);
    try {
      const res = await budget.call(provider, {
        model: MODELS.triage,
        system: TRIAGE_SYSTEM,
        user: `Assess these ${batch.length} findings. Return one assessment per finding id.\n\n${buildTriagePrompt(batch)}`,
        maxOutputTokens: 350 * batch.length,
        jsonSchema: TRIAGE_JSON_SCHEMA as unknown as Record<string, unknown>,
      });
      const parsed = TriageSchema.safeParse(JSON.parse(res.text));
      if (!parsed.success) continue; // malformed output: leave these findings un-triaged rather than guess
      for (const a of parsed.data.assessments) {
        const f = batch[a.id];
        if (!f || f.ai) continue;
        const assessment: AiAssessment = { verdict: a.verdict, confidence: a.confidence, explanation: a.explanation, remediation: a.remediation, model: res.model };
        f.ai = assessment;
        triaged++;
      }
    } catch (e) {
      if (e instanceof BudgetExceededError) {
        stoppedReason = e.message;
        break;
      }
      if (e instanceof SyntaxError) continue;
      throw e;
    }
  }
  return { triaged, skipped: selected.length - triaged, stoppedReason };
}

// ───────────────────────── Executive summary ─────────────────────────

const SUMMARY_SYSTEM = `You write the executive summary of an engineering launch-readiness audit for a solo founder.
Use ONLY the facts provided. Do not add findings, numbers or claims that are not in the input.
Plain English, no hype, no markdown headings. 120–180 words.
Structure: one sentence verdict; the 2–3 most important blockers and why they matter to the business; what to do first; one sentence on what was NOT assessed.
Never describe the app as secure or production-ready in absolute terms; this is a static review within the stated scope.`;

export function deterministicSummary(card: Scorecard, findings: Finding[]): string {
  const live = findings.filter((f) => f.change !== "fixed");
  const top = live.filter((f) => f.priority === "P0" || f.priority === "P1").slice(0, 3);
  const verdict = VERDICT_LABELS[card.verdict];
  const parts = [
    `${verdict}: ${card.counts.P0} critical blocker(s), ${card.counts.P1} high-priority issue(s), ${card.counts.P2 + card.counts.P3} other improvement(s).`,
    top.length ? `Start with: ${top.map((f) => f.title).join("; ")}.` : "No P0 or P1 issues were found within the assessed scope.",
    card.coverageNote,
  ];
  return parts.join(" ");
}

export async function writeSummary(card: Scorecard, findings: Finding[], provider: LlmProvider, budget: Budget): Promise<{ text: string; ai: boolean }> {
  const facts = {
    verdict: VERDICT_LABELS[card.verdict],
    overallScore: card.overall,
    counts: card.counts,
    categories: card.categories.map((c) => ({ category: c.category, score: c.score ?? "not assessed" })),
    readiness: card.readiness.map((r) => ({ area: r.area, status: r.status, failed: r.checks.filter((c) => c.status === "fail").map((c) => c.label) })),
    topFindings: findings
      .filter((f) => f.change !== "fixed" && f.ai?.verdict !== "likely_false_positive")
      .slice(0, 8)
      .map((f) => ({ priority: f.priority, title: f.title, evidence: f.tier })),
    coverage: card.coverageNote,
  };
  try {
    const res = await budget.call(provider, { model: MODELS.writeup, system: SUMMARY_SYSTEM, user: JSON.stringify(facts), maxOutputTokens: 400 });
    const text = res.text.trim();
    return text.length > 40 ? { text, ai: true } : { text: deterministicSummary(card, findings), ai: false };
  } catch (e) {
    if (e instanceof BudgetExceededError) return { text: deterministicSummary(card, findings), ai: false };
    throw e;
  }
}
