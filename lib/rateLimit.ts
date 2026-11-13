// Token-bucket rate limiters.
// - `outbound` protects free-tier upstream quotas (e.g. football-data.org ≈10 req/min).
// - `inbound` protects our API routes from abuse (per client IP).

export class TokenBucket {
  private tokens: number;
  private last: number;
  constructor(
    private capacity: number,
    private refillPerMs: number,
  ) {
    this.tokens = capacity;
    this.last = Date.now();
  }
  private refill() {
    const now = Date.now();
    this.tokens = Math.min(this.capacity, this.tokens + (now - this.last) * this.refillPerMs);
    this.last = now;
  }
  tryTake(): boolean {
    this.refill();
    if (this.tokens >= 1) {
      this.tokens -= 1;
      return true;
    }
    return false;
  }
  msUntilNext(): number {
    this.refill();
    return this.tokens >= 1 ? 0 : Math.ceil((1 - this.tokens) / this.refillPerMs);
  }
  remaining(): number {
    this.refill();
    return Math.floor(this.tokens);
  }
}

export class RateLimitedError extends Error {
  constructor(
    public provider: string,
    public retryAfterMs: number,
  ) {
    super(`Rate limit reached for ${provider}; retry in ${Math.ceil(retryAfterMs / 1000)}s`);
  }
}

const outbound = new Map<string, TokenBucket>();

/** Wait (up to maxWaitMs) for a token for the given upstream provider, else throw RateLimitedError. */
export async function acquireOutbound(provider: string, perMinute: number, maxWaitMs = 8000) {
  let b = outbound.get(provider);
  if (!b) {
    b = new TokenBucket(perMinute, perMinute / 60_000);
    outbound.set(provider, b);
  }
  const start = Date.now();
  while (!b.tryTake()) {
    const wait = b.msUntilNext();
    if (Date.now() - start + wait > maxWaitMs) throw new RateLimitedError(provider, wait);
    await new Promise((r) => setTimeout(r, wait));
  }
}

export function outboundRemaining(provider: string): number | null {
  return outbound.get(provider)?.remaining() ?? null;
}

const inbound = new Map<string, TokenBucket>();
export function checkInbound(key: string, perMinute = 60): { ok: boolean; retryAfterMs: number } {
  let b = inbound.get(key);
  if (!b) {
    if (inbound.size > 10_000) inbound.clear(); // bound memory
    b = new TokenBucket(perMinute, perMinute / 60_000);
    inbound.set(key, b);
  }
  const ok = b.tryTake();
  return { ok, retryAfterMs: ok ? 0 : b.msUntilNext() };
}
