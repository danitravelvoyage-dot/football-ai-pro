export interface RetryPolicy {
  maxAttempts: number;
  baseDelayMs: number;
  maxDelayMs: number;
}

export const DEFAULT_RETRY_POLICY: RetryPolicy = { maxAttempts: 3, baseDelayMs: 2_000, maxDelayMs: 300_000 };

/** Exponential backoff: attempt 1 waits base, attempt 2 waits 2x base, and so on, capped. */
export function backoffDelayMs(attempt: number, policy: RetryPolicy = DEFAULT_RETRY_POLICY): number {
  const exponent = Math.max(0, attempt - 1);
  return Math.min(policy.maxDelayMs, policy.baseDelayMs * 2 ** exponent);
}

export function shouldRetry(attempt: number, retryable: boolean, policy: RetryPolicy = DEFAULT_RETRY_POLICY): boolean {
  return retryable && attempt < policy.maxAttempts;
}
