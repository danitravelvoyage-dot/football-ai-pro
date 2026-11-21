export type ProviderCostTier = "free" | "local" | "paid";

export interface LLMRequest {
  system: string;
  user: string;
  maxOutputTokens: number;
  timeoutMs: number;
  /**
   * Agent requests set this: the reply must be one JSON object. OpenAI-compatible endpoints get
   * response_format json_object, which small local models need to keep to the contract.
   */
  jsonMode?: boolean;
  /** Consumed only by the mock provider. Never sent to a real model. */
  mockOutput?: unknown;
}

export interface LLMResponse {
  text: string;
  providerId: string;
  model: string;
  tokensIn: number;
  tokensOut: number;
  source: "mock" | "live";
}

export interface LLMProvider {
  readonly id: string;
  readonly kind: "mock" | "openai-compatible";
  complete(request: LLMRequest): Promise<LLMResponse>;
}

/** Error with a flag that tells the orchestrator whether a retry can help. */
export class ProviderError extends Error {
  constructor(
    message: string,
    public readonly retryable: boolean,
    public readonly providerId: string,
  ) {
    super(message);
    this.name = "ProviderError";
  }
}

export class ProviderUnavailableError extends ProviderError {
  constructor(reason: string) {
    super(`No LLM provider is available: ${reason}`, true, "none");
    this.name = "ProviderUnavailableError";
  }
}
