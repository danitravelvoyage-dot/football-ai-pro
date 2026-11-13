import { acquireOutbound, RateLimitedError } from "@/lib/rateLimit";

export class ProviderError extends Error {
  constructor(
    public provider: string,
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

export interface FetchOptions {
  /** Local token bucket (requests/minute) for providers whose responses are not shared-cached. */
  perMinute?: number;
  /**
   * Use the platform's shared data cache (on Vercel it is shared across all server instances).
   * Only successful (200) responses are cached, so errors and rate-limit replies never are.
   */
  revalidateSec?: number;
  /** On HTTP 429, wait for the provider-specified delay (if short) and retry once. */
  retryOn429?: boolean;
  timeoutMs?: number;
  /** Longest provider-requested wait to honour before giving up (default 10s). */
  maxWaitMs?: number;
  /** Called with the response headers of successful responses (e.g. to read quota counters). */
  onHeaders?: (h: Headers) => void;
}

const MAX_WAIT_MS = 10_000;
// When the provider told us to back off, every request to it waits (or fails fast) until then.
const blockedUntil = new Map<string, number>();

function retryAfterMs(res: Response, message: string): number {
  const m = /wait\s+(\d+)\s*sec/i.exec(message);
  if (m) return Number(m[1]) * 1000 + 250;
  for (const h of ["retry-after", "x-requestcounter-reset"]) {
    const v = Number(res.headers.get(h));
    if (Number.isFinite(v) && v > 0) return v * 1000 + 250;
  }
  return 60_000;
}

async function errorMessage(res: Response): Promise<string> {
  try {
    const body = (await res.json()) as { message?: string };
    if (body?.message) return body.message;
  } catch {
    /* ignore */
  }
  return res.statusText;
}

/** GET JSON with shared caching, provider-directed back-off, timeout and typed errors. */
export async function fetchJson<T>(
  provider: string,
  url: string,
  headers: Record<string, string>,
  opts: FetchOptions = {},
): Promise<{ data: T; fetchedAt: string }> {
  for (let attempt = 0; attempt < 2; attempt++) {
    const maxWait = opts.maxWaitMs ?? MAX_WAIT_MS;
    const wait = (blockedUntil.get(provider) ?? 0) - Date.now();
    if (wait > 0) {
      if (!opts.retryOn429 || wait > maxWait) throw new RateLimitedError(provider, wait);
      await new Promise((r) => setTimeout(r, wait));
    }
    if (opts.perMinute) await acquireOutbound(provider, opts.perMinute);
    const res = await fetch(url, {
      headers,
      signal: AbortSignal.timeout(opts.timeoutMs ?? 10_000),
      ...(opts.revalidateSec ? { cache: "force-cache" as const, next: { revalidate: opts.revalidateSec } } : { cache: "no-store" as const }),
    });
    if (res.status === 429) {
      const msg = await errorMessage(res);
      const delay = retryAfterMs(res, msg);
      blockedUntil.set(provider, Date.now() + delay);
      if (attempt === 0 && opts.retryOn429 && delay <= maxWait) continue;
      throw new RateLimitedError(provider, delay);
    }
    if (!res.ok) throw new ProviderError(provider, res.status, await errorMessage(res));
    opts.onHeaders?.(res.headers);
    // The Date header is the upstream's original response time, even when served from the shared cache.
    const date = Date.parse(res.headers.get("date") ?? "");
    return { data: (await res.json()) as T, fetchedAt: new Date(Number.isFinite(date) ? date : Date.now()).toISOString() };
  }
  throw new RateLimitedError(provider, MAX_WAIT_MS);
}

/** Uncached GET with a local token bucket (used by quota-based providers). */
export async function getJson<T>(provider: string, url: string, headers: Record<string, string>, perMinute: number): Promise<T> {
  return (await fetchJson<T>(provider, url, headers, { perMinute })).data;
}
