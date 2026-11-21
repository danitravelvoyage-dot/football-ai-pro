import { ProviderError, ProviderUnavailableError, type LLMProvider, type LLMRequest, type LLMResponse } from "./types";
import type { ProviderConfig } from "./config";
import { CircuitBreaker, type ProviderHealthSnapshot } from "./health";

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
  /** Breaker settings. Defaults: open after 3 consecutive failures, for 60 seconds. */
  breaker?: { failureThreshold: number; cooldownMs: number };
  /** Waits between retries. Injected so tests do not sleep. */
  sleep?: (ms: number) => Promise<void>;
}

/** Backoff before retry number `attempt` (1-based): 500 ms, 1 s, 2 s … capped at 8 s. */
export function retryBackoffMs(attempt: number): number {
  return Math.min(8_000, 500 * 2 ** Math.max(0, attempt - 1));
}

/**
 * Provider-neutral gateway. Tries providers in configured order, retrying a retryable failure on the same provider
 * up to the configured limit before moving on. It never uses a paid provider the owner has not approved, respects
 * daily quotas, and skips a provider whose breaker is open.
 */
export class LLMGateway {
  private readonly breaker: CircuitBreaker;
  private readonly sleep: (ms: number) => Promise<void>;

  constructor(private readonly options: GatewayOptions) {
    this.breaker = new CircuitBreaker({
      failureThreshold: options.breaker?.failureThreshold ?? 3,
      cooldownMs: options.breaker?.cooldownMs ?? 60_000,
      now: options.now,
    });
    this.sleep = options.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  }

  private day(): string {
    return this.options.now().toISOString().slice(0, 10);
  }

  /** Per-provider health for this process: calls, failures, the last error class, and whether the breaker is open. */
  health(): ProviderHealthSnapshot[] {
    return this.breaker.snapshot();
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
      if (!this.breaker.allows(config.id)) {
        skipped.push(`${config.id}:circuit-open`);
        this.options.onEvent?.({ type: "provider.circuit_open", providerId: config.id });
        continue;
      }
      const used = await this.options.usage.requestsToday(config.id, day);
      if (used >= config.dailyRequestLimit) {
        skipped.push(`${config.id}:quota`);
        this.options.onEvent?.({ type: "provider.quota_reached", providerId: config.id });
        continue;
      }

      const maxRetries = Math.max(0, config.maxRetries ?? 0);
      let lastError: ProviderError | null = null;
      for (let attempt = 0; attempt <= maxRetries; attempt++) {
        if (attempt > 0) {
          await this.sleep(retryBackoffMs(attempt));
          this.options.onEvent?.({ type: "provider.retry", providerId: config.id, detail: `attempt ${attempt + 1}` });
        }
        try {
          const response = await provider.complete(request);
          this.breaker.recordSuccess(config.id);
          await this.options.usage.record({ providerId: config.id, day, tokensIn: response.tokensIn, tokensOut: response.tokensOut });
          return response;
        } catch (error) {
          const providerError = error instanceof ProviderError ? error : null;
          this.breaker.recordFailure(config.id, error instanceof Error ? error.name : "Error", error instanceof Error ? error.message : "unknown");
          if (!providerError || !providerError.retryable) throw error;
          lastError = providerError;
        }
      }
      // Retryable failures may move to the next free or local provider, never to a paid one that was not approved.
      skipped.push(`${config.id}:error(${lastError?.message ?? "unknown"})`);
      this.options.onEvent?.({ type: "provider.error", providerId: config.id, detail: lastError?.message });
    }
    throw new ProviderUnavailableError(skipped.join(", ") || "no providers configured");
  }
}
