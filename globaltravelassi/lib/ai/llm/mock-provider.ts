import type { LLMProvider, LLMRequest, LLMResponse } from "./types";

/** Deterministic provider for development and tests. Its output is always labelled as mock. */
export class MockProvider implements LLMProvider {
  readonly id: string;
  readonly kind = "mock" as const;

  constructor(id = "mock") {
    this.id = id;
  }

  async complete(request: LLMRequest): Promise<LLMResponse> {
    const payload = request.mockOutput ?? {};
    const text = JSON.stringify({ ...(payload as Record<string, unknown>), _mock: true });
    return {
      text,
      providerId: this.id,
      model: "mock-deterministic",
      tokensIn: Math.ceil((request.system.length + request.user.length) / 4),
      tokensOut: Math.ceil(text.length / 4),
      source: "mock",
    };
  }
}
