import { ProviderError, ProviderUnavailableError, type LLMProvider, type LLMRequest, type LLMResponse } from "./types";
import type { ProviderConfig } from "./config";

export interface UsageStore {
  requestsToday(providerId: string, day: string): Promise<number>;
  record(entry: { providerId: string; day: string; tokensIn: number; tokensOut: number }): Promise<void>;
}

export class InMemoryUsageStore implements UsageStore {
  private readonly counts = new Map<string, { requests: number; tokens: number }>();

  async requestsToday(providerId: string, day: string): Promise<number> {
    return this.counts.get(`${day}|${providerId}`)?.requests ?? 0;
  }

  async record(entry: { providerId: string; day: string; tokensIn: number; tokensOut: number }): Promise<void> {
    const key = `${entry.day}|${entry.providerId}`;
    const current = this.counts.get(key) ?? { requests: 0, tokens: 0 };
    this.counts.set(key, { requests: current.requests + 1, tokens: current.tokens + entry.tokensIn + entry.tokensOut });
  }
}

export interface GatewayOptions {
  providers: { config: ProviderConfig; provider: LLMProvider }[];
  usage: UsageStore;
  now: () => Date;
  onEvent?: (event: { type: string; providerId: string; detail?: string }) => void;
}

/**
 * Provider-neutral gateway. Tries providers in configured order.
 * It never falls back to a paid provider unless the owner approved it, and it respects daily quotas.
 */
export class LLMGateway {
  constructor(private readonly options: GatewayOptions) {}

  private day(): string {
    return this.options.now().toISOString().slice(0, 10);
  }

  async complete(request: LLMRequest): Promise<LLMResponse> {
    const day = this.day();
    const skipped: string[] = [];

    for (const { config, provider } of this.options.providers) {
      if (!config.enabled) {
        skipped.push(`${config.id}:disabled`);
        continue;
      }
      if (config.costTier === "paid" && !config.ownerApproved) {
        skipped.push(`${config.id}:not-approved`);
        this.options.onEvent?.({ type: "provider.blocked_paid", providerId: config.id });
        continue;
      }
      const used = await this.options.usage.requestsToday(config.id, day);
      if (used >= config.dailyRequestLimit) {
        skipped.push(`${config.id}:quota`);
        this.options.onEvent?.({ type: "provider.quota_reached", providerId: config.id });
        continue;
      }

      try {
        const response = await provider.complete(request);
        await this.options.usage.record({
          providerId: config.id,
          day,
          tokensIn: response.tokensIn,
          tokensOut: response.tokensOut,
        });
        return response;
      } catch (error) {
        if (error instanceof ProviderError && error.retryable) {
          // Retryable failures may move to the next free/local provider, never to a paid one.
          skipped.push(`${config.id}:error(${error.message})`);
          this.options.onEvent?.({ type: "provider.error", providerId: config.id, detail: error.message });
          continue;
        }
        throw error;
      }
    }
    throw new ProviderUnavailableError(skipped.join(", ") || "no providers configured");
  }
}
