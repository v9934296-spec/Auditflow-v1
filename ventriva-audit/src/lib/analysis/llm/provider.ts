import { modelCostUsd } from "@/lib/config/plans";

/** Provider-agnostic interface: the pipeline never imports a vendor SDK directly. */
export interface LlmRequest {
  model: string;
  system: string;
  user: string;
  maxOutputTokens: number;
  /** JSON schema for structured output; when omitted the response is free text. */
  jsonSchema?: Record<string, unknown>;
}

export interface LlmResponse {
  text: string;
  inputTokens: number;
  outputTokens: number;
  model: string;
}

export interface LlmProvider {
  name: string;
  complete(req: LlmRequest): Promise<LlmResponse>;
}

export class BudgetExceededError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BudgetExceededError";
  }
}

export interface UsageRecord {
  provider: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
}

/**
 * Hard per-audit spending guard. Every call is pre-checked against a pessimistic estimate
 * and the actual usage is recorded afterwards. Once a ceiling is hit, no further calls run.
 */
export class Budget {
  inputTokens = 0;
  outputTokens = 0;
  costUsd = 0;
  readonly records: UsageRecord[] = [];
  exhaustedReason: string | null = null;

  constructor(
    readonly maxCostUsd: number,
    readonly maxInputTokens: number,
    /** Optional global guard (e.g. daily platform-wide cap). Return false to block. */
    private readonly globalGuard?: (estimateUsd: number) => Promise<boolean>,
  ) {}

  static estimateTokens(text: string): number {
    return Math.ceil(text.length / 3.2);
  }

  async reserve(req: LlmRequest): Promise<void> {
    if (this.exhaustedReason) throw new BudgetExceededError(this.exhaustedReason);
    const estIn = Budget.estimateTokens(req.system + req.user + JSON.stringify(req.jsonSchema ?? ""));
    const estCost = modelCostUsd(req.model, estIn, req.maxOutputTokens);
    if (this.inputTokens + estIn > this.maxInputTokens) this.exhaustedReason = `Input token ceiling (${this.maxInputTokens}) reached.`;
    else if (this.costUsd + estCost > this.maxCostUsd) this.exhaustedReason = `Per-audit AI spend ceiling ($${this.maxCostUsd.toFixed(2)}) reached.`;
    else if (this.globalGuard && !(await this.globalGuard(estCost))) this.exhaustedReason = "Platform-wide daily AI spend cap reached.";
    if (this.exhaustedReason) throw new BudgetExceededError(this.exhaustedReason);
  }

  record(provider: string, res: LlmResponse): UsageRecord {
    const costUsd = modelCostUsd(res.model, res.inputTokens, res.outputTokens);
    this.inputTokens += res.inputTokens;
    this.outputTokens += res.outputTokens;
    this.costUsd += costUsd;
    const rec = { provider, model: res.model, inputTokens: res.inputTokens, outputTokens: res.outputTokens, costUsd };
    this.records.push(rec);
    return rec;
  }

  async call(provider: LlmProvider, req: LlmRequest): Promise<LlmResponse> {
    await this.reserve(req);
    const res = await provider.complete(req);
    this.record(provider.name, res);
    return res;
  }
}
