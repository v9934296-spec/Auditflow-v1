/**
 * Single source of truth for tiers, limits and processing budgets.
 * Every limit here is enforced server-side (API routes + worker), never only in the UI.
 */
export const PRICING = {
  fullAuditUsd: 29,
  proMonthlyUsd: 19.99,
} as const;

export type AuditKind = "free_scan" | "full_audit" | "recheck" | "monitor";

export interface ProcessingLimits {
  /** Max compressed tarball size downloaded from GitHub. */
  maxTarballBytes: number;
  /** Max number of files extracted for analysis. */
  maxFiles: number;
  /** Max total bytes of extracted source. */
  maxExtractedBytes: number;
  /** Files larger than this are skipped (minified bundles, data dumps). */
  maxFileBytes: number;
  /** Whether Claude triage/write-ups run at all. */
  aiEnabled: boolean;
  /** Max findings sent to the model for triage. */
  maxAiFindings: number;
  /** Hard ceiling on model spend for one audit (USD). */
  maxAiCostUsd: number;
  /** Hard ceiling on input tokens across all model calls for one audit. */
  maxInputTokens: number;
  /** Whether ESLint security analysis runs. */
  eslintEnabled: boolean;
  /** How many findings are shown with full detail (rest are counted). */
  detailedFindingsLimit: number | null;
  /** Whether tickets are generated and exportable. */
  ticketsEnabled: boolean;
}

const MB = 1024 * 1024;

export const LIMITS: Record<AuditKind, ProcessingLimits> = {
  free_scan: {
    maxTarballBytes: 25 * MB,
    maxFiles: 2_000,
    maxExtractedBytes: 40 * MB,
    maxFileBytes: 512 * 1024,
    aiEnabled: false,
    maxAiFindings: 0,
    maxAiCostUsd: 0,
    maxInputTokens: 0,
    eslintEnabled: false,
    detailedFindingsLimit: 5,
    ticketsEnabled: false,
  },
  full_audit: {
    maxTarballBytes: 150 * MB,
    maxFiles: 10_000,
    maxExtractedBytes: 200 * MB,
    maxFileBytes: 1 * MB,
    aiEnabled: true,
    maxAiFindings: 60,
    maxAiCostUsd: 2.5,
    maxInputTokens: 400_000,
    eslintEnabled: true,
    detailedFindingsLimit: null,
    ticketsEnabled: true,
  },
  recheck: {
    maxTarballBytes: 150 * MB,
    maxFiles: 10_000,
    maxExtractedBytes: 200 * MB,
    maxFileBytes: 1 * MB,
    aiEnabled: true,
    maxAiFindings: 20,
    maxAiCostUsd: 0.75,
    maxInputTokens: 120_000,
    eslintEnabled: true,
    detailedFindingsLimit: null,
    ticketsEnabled: true,
  },
  monitor: {
    maxTarballBytes: 150 * MB,
    maxFiles: 10_000,
    maxExtractedBytes: 200 * MB,
    maxFileBytes: 1 * MB,
    aiEnabled: false,
    maxAiFindings: 0,
    maxAiCostUsd: 0,
    maxInputTokens: 0,
    eslintEnabled: true,
    detailedFindingsLimit: null,
    ticketsEnabled: true,
  },
};

export const PRO = {
  rechecksPerPeriod: 2,
  /** Minimum gap between push-triggered monitoring scans for one repo. */
  monitorMinIntervalMs: 24 * 60 * 60 * 1000,
} as const;

export const ABUSE = {
  /** Max audits a single user can start per rolling hour (any kind). */
  maxAuditsPerHour: 5,
  /** Max concurrently queued/running audits per user. */
  maxConcurrentAudits: 1,
} as const;

/** USD per million tokens. Keep in sync with https://platform.claude.com/docs/en/about-claude/pricing */
export const MODEL_PRICING: Record<string, { inputPerMTok: number; outputPerMTok: number; longContextThreshold?: number; longInputPerMTok?: number; longOutputPerMTok?: number }> = {
  "claude-haiku-5-5": { inputPerMTok: 0.1, outputPerMTok: 0.5, longContextThreshold: 100_000, longInputPerMTok: 0.5, longOutputPerMTok: 2.5 },
  "claude-sonnet-5-5": { inputPerMTok: 2, outputPerMTok: 10 },
};

export const MODELS = {
  /** Cheap model for per-finding triage. */
  triage: process.env.CLAUDE_TRIAGE_MODEL ?? "claude-haiku-5-5",
  /** Stronger model for the executive summary only. */
  writeup: process.env.CLAUDE_WRITEUP_MODEL ?? "claude-sonnet-5-5",
} as const;

export function modelCostUsd(model: string, inputTokens: number, outputTokens: number): number {
  const p = MODEL_PRICING[model];
  if (!p) throw new Error(`No pricing configured for model ${model}; refusing to run without a cost estimate.`);
  const long = p.longContextThreshold !== undefined && inputTokens > p.longContextThreshold;
  const inRate = long && p.longInputPerMTok !== undefined ? p.longInputPerMTok : p.inputPerMTok;
  const outRate = long && p.longOutputPerMTok !== undefined ? p.longOutputPerMTok : p.outputPerMTok;
  return (inputTokens / 1_000_000) * inRate + (outputTokens / 1_000_000) * outRate;
}
