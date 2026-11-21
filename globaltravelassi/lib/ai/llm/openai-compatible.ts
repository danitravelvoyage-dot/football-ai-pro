import { ProviderError, type LLMProvider, type LLMRequest, type LLMResponse } from "./types";

export interface OpenAICompatibleOptions {
  id: string;
  baseUrl: string;
  model: string;
  /** Returns the API key on the server. Never logged, never returned to callers. Omit for local models. */
  getSecret?: () => string | undefined;
  fetchImpl?: typeof fetch;
}

/**
 * One adapter for every OpenAI-compatible endpoint: local Ollama, LM Studio, or a free hosted tier.
 * It only makes a network call when the provider is enabled in configuration.
 */
export class OpenAICompatibleProvider implements LLMProvider {
  readonly id: string;
  readonly kind = "openai-compatible" as const;
  private readonly options: OpenAICompatibleOptions;

  constructor(options: OpenAICompatibleOptions) {
    this.id = options.id;
    this.options = options;
  }

  async complete(request: LLMRequest): Promise<LLMResponse> {
    const fetchFn = this.options.fetchImpl ?? fetch;
    const headers: Record<string, string> = { "content-type": "application/json" };
    const key = this.options.getSecret?.();
    if (key) headers.authorization = `Bearer ${key}`;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), request.timeoutMs);
    let response: Response;
    try {
      response = await fetchFn(`${this.options.baseUrl.replace(/\/$/, "")}/chat/completions`, {
        method: "POST",
        headers,
        signal: controller.signal,
        body: JSON.stringify({
          model: this.options.model,
          temperature: 0.2,
          max_tokens: request.maxOutputTokens,
          ...(request.jsonMode ? { response_format: { type: "json_object" } } : {}),
          messages: [
            { role: "system", content: request.system },
            { role: "user", content: request.user },
          ],
        }),
      });
    } catch (error) {
      const aborted = error instanceof Error && error.name === "AbortError";
      throw new ProviderError(aborted ? "Provider timed out." : "Provider request failed.", true, this.id);
    } finally {
      clearTimeout(timer);
    }

    if (!response.ok) {
      const retryable = response.status === 429 || response.status >= 500;
      throw new ProviderError(`Provider returned HTTP ${response.status}.`, retryable, this.id);
    }

    let data: {
      choices?: { message?: { content?: string } }[];
      usage?: { prompt_tokens?: number; completion_tokens?: number };
    };
    try {
      data = (await response.json()) as typeof data;
    } catch {
      // A reply that is not JSON cannot be fixed by retrying the same request.
      throw new ProviderError("Provider returned a reply that is not JSON.", false, this.id);
    }
    const text = data.choices?.[0]?.message?.content;
    if (typeof text !== "string") {
      throw new ProviderError("Provider returned no text.", false, this.id);
    }
    return {
      text,
      providerId: this.id,
      model: this.options.model,
      // Some endpoints omit usage. A zero would silently under-count spend, so the count is estimated from length
      // (about four characters per token) instead. Prices are never estimated: those come only from the owner's list.
      tokensIn: data.usage?.prompt_tokens ?? estimateTokens(request.system + request.user),
      tokensOut: data.usage?.completion_tokens ?? estimateTokens(text),
      source: "live",
    };
  }
}

/** A rough token count from text length, used only when the endpoint reports no usage. */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}
