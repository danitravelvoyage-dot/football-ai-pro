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

    const data = (await response.json()) as {
      choices?: { message?: { content?: string } }[];
      usage?: { prompt_tokens?: number; completion_tokens?: number };
    };
    const text = data.choices?.[0]?.message?.content;
    if (typeof text !== "string") {
      throw new ProviderError("Provider returned no text.", false, this.id);
    }
    return {
      text,
      providerId: this.id,
      model: this.options.model,
      tokensIn: data.usage?.prompt_tokens ?? 0,
      tokensOut: data.usage?.completion_tokens ?? 0,
      source: "live",
    };
  }
}
