import Anthropic from "@anthropic-ai/sdk";
import type { LlmProvider, LlmRequest, LlmResponse } from "./provider";

export class AnthropicProvider implements LlmProvider {
  readonly name = "anthropic";
  private client: Anthropic;

  constructor(apiKey: string) {
    this.client = new Anthropic({ apiKey, maxRetries: 2, timeout: 90_000 });
  }

  async complete(req: LlmRequest): Promise<LlmResponse> {
    const msg = await this.client.messages.create({
      model: req.model,
      max_tokens: req.maxOutputTokens,
      system: req.system,
      messages: [{ role: "user", content: req.user }],
      ...(req.jsonSchema ? { output_config: { format: { type: "json_schema" as const, schema: req.jsonSchema } } } : {}),
    });
    const text = msg.content
      .filter((b): b is Anthropic.TextBlock => b.type === "text")
      .map((b) => b.text)
      .join("");
    return { text, inputTokens: msg.usage.input_tokens, outputTokens: msg.usage.output_tokens, model: req.model };
  }
}
