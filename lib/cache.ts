// Small in-memory TTL cache with in-flight request de-duplication.
// On serverless platforms each instance has its own cache; that's fine for free-tier rate limits
// because upstream calls are additionally protected by the outbound rate limiter.

interface Entry<T> {
  value: T;
  expires: number;
  storedAt: number;
}

const store = new Map<string, Entry<unknown>>();
const inflight = new Map<string, Promise<unknown>>();
const MAX_ENTRIES = 2000;

export function cacheGet<T>(key: string): { value: T; storedAt: number } | null {
  const e = store.get(key);
  if (!e) return null;
  if (Date.now() > e.expires) {
    store.delete(key);
    return null;
  }
  return { value: e.value as T, storedAt: e.storedAt };
}

/** Returns a stale value even if expired (used as graceful fallback when upstream fails). */
export function cacheGetStale<T>(key: string): { value: T; storedAt: number } | null {
  const e = store.get(key);
  return e ? { value: e.value as T, storedAt: e.storedAt } : null;
}

export function cacheSet<T>(key: string, value: T, ttlMs: number) {
  if (store.size >= MAX_ENTRIES) {
    const first = store.keys().next().value;
    if (first !== undefined) store.delete(first);
  }
  store.set(key, { value, expires: Date.now() + ttlMs, storedAt: Date.now() });
}

/**
 * Get-or-compute with TTL. Concurrent callers for the same key share one upstream request.
 * Returns whether the value came from cache and when it was originally fetched.
 */
export async function cached<T>(
  key: string,
  ttlMs: number,
  fn: () => Promise<T>,
): Promise<{ value: T; cached: boolean; storedAt: number }> {
  const hit = cacheGet<T>(key);
  if (hit) return { value: hit.value, cached: true, storedAt: hit.storedAt };
  const running = inflight.get(key) as Promise<T> | undefined;
  if (running) {
    const value = await running;
    return { value, cached: true, storedAt: Date.now() };
  }
  const p = fn();
  inflight.set(key, p);
  try {
    const value = await p;
    cacheSet(key, value, ttlMs);
    return { value, cached: false, storedAt: Date.now() };
  } catch (err) {
    const stale = cacheGetStale<T>(key);
    if (stale) return { value: stale.value, cached: true, storedAt: stale.storedAt };
    throw err;
  } finally {
    inflight.delete(key);
  }
}

export function cacheStats() {
  return { entries: store.size, inflight: inflight.size };
}
