import { acquireOutbound } from "@/lib/rateLimit";

export class ProviderError extends Error {
  constructor(
    public provider: string,
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

/** GET JSON from an upstream with outbound rate limiting, timeout and typed errors. */
export async function getJson<T>(
  provider: string,
  url: string,
  headers: Record<string, string>,
  perMinute: number,
  timeoutMs = 10_000,
): Promise<T> {
  await acquireOutbound(provider, perMinute);
  const res = await fetch(url, { headers, signal: AbortSignal.timeout(timeoutMs), cache: "no-store" });
  if (!res.ok) {
    let msg = res.statusText;
    try {
      const body = (await res.json()) as { message?: string };
      if (body?.message) msg = body.message;
    } catch {
      /* ignore */
    }
    throw new ProviderError(provider, res.status, msg);
  }
  return (await res.json()) as T;
}
