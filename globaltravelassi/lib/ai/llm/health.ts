/**
 * Circuit breaker and health snapshot per provider. In-process: it protects this server instance from calling a
 * provider that keeps failing. It is not shared between instances, and the snapshot says so.
 */
export interface ProviderHealthSnapshot {
  providerId: string;
  calls: number;
  failures: number;
  consecutiveFailures: number;
  lastSuccessAt: string | null;
  lastFailureAt: string | null;
  /** Error class and a short message only. Never the request, the response or a secret. */
  lastError: string | null;
  /** When the breaker is open, the time it closes again. Null when closed. */
  openUntil: string | null;
}

export interface CircuitBreakerOptions {
  failureThreshold: number;
  cooldownMs: number;
  now: () => Date;
}

export class CircuitBreaker {
  private readonly state = new Map<string, ProviderHealthSnapshot>();

  constructor(private readonly options: CircuitBreakerOptions) {}

  private entry(providerId: string): ProviderHealthSnapshot {
    let e = this.state.get(providerId);
    if (!e) {
      e = { providerId, calls: 0, failures: 0, consecutiveFailures: 0, lastSuccessAt: null, lastFailureAt: null, lastError: null, openUntil: null };
      this.state.set(providerId, e);
    }
    return e;
  }

  /** True when the provider may be called now. An open breaker whose cooldown has passed lets one call through. */
  allows(providerId: string): boolean {
    const e = this.entry(providerId);
    if (e.openUntil === null) return true;
    return this.options.now().getTime() >= Date.parse(e.openUntil);
  }

  recordSuccess(providerId: string): void {
    const e = this.entry(providerId);
    const at = this.options.now().toISOString();
    e.calls += 1;
    e.consecutiveFailures = 0;
    e.lastSuccessAt = at;
    e.openUntil = null;
  }

  recordFailure(providerId: string, errorName: string, message: string): void {
    const e = this.entry(providerId);
    const now = this.options.now();
    e.calls += 1;
    e.failures += 1;
    e.consecutiveFailures += 1;
    e.lastFailureAt = now.toISOString();
    e.lastError = `${errorName}: ${message.slice(0, 120)}`;
    if (e.consecutiveFailures >= this.options.failureThreshold) {
      e.openUntil = new Date(now.getTime() + this.options.cooldownMs).toISOString();
    }
  }

  snapshot(): ProviderHealthSnapshot[] {
    return [...this.state.values()].map((e) => ({ ...e }));
  }
}

/** Health label for the owner's dashboard, derived from the snapshot. */
export function healthLabel(s: ProviderHealthSnapshot | undefined, now: Date): "not_used" | "healthy" | "degraded" | "unavailable" {
  if (!s || s.calls === 0) return "not_used";
  if (s.openUntil && Date.parse(s.openUntil) > now.getTime()) return "unavailable";
  if (s.consecutiveFailures > 0) return "degraded";
  return "healthy";
}
