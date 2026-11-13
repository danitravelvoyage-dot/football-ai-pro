import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchJson } from "@/services/providers/http";
import { RateLimitedError } from "@/lib/rateLimit";

const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });

afterEach(() => vi.unstubAllGlobals());

describe("fetchJson rate-limit handling", () => {
  it("waits the provider-specified time and retries once on 429", async () => {
    const f = vi.fn()
      .mockResolvedValueOnce(json(429, { message: "You reached your request limit. Wait 1 seconds." }))
      .mockResolvedValueOnce(json(200, { ok: true }, { date: "Fri, 13 Nov 2026 20:00:00 GMT" }));
    vi.stubGlobal("fetch", f);
    const r = await fetchJson<{ ok: boolean }>("p1", "https://x", {}, { retryOn429: true });
    expect(r.data.ok).toBe(true);
    expect(r.fetchedAt).toBe("2026-11-13T20:00:00.000Z");
    expect(f).toHaveBeenCalledTimes(2);
  });
  it("fails fast without retry in fast mode, and keeps blocking that provider", async () => {
    const f = vi.fn().mockResolvedValue(json(429, { message: "Wait 30 seconds." }));
    vi.stubGlobal("fetch", f);
    await expect(fetchJson("p2", "https://x", {}, {})).rejects.toBeInstanceOf(RateLimitedError);
    await expect(fetchJson("p2", "https://x", {}, { retryOn429: true })).rejects.toBeInstanceOf(RateLimitedError);
    expect(f).toHaveBeenCalledTimes(1); // second call blocked locally, no extra upstream request
  });
});

describe("fetchJson long waits", () => {
  it("honours a longer provider wait when maxWaitMs allows it", async () => {
    vi.useFakeTimers();
    const f = vi.fn()
      .mockResolvedValueOnce(json(429, { message: "Wait 20 seconds." }))
      .mockResolvedValueOnce(json(200, { ok: 1 }));
    vi.stubGlobal("fetch", f);
    const p = fetchJson<{ ok: number }>("p3", "https://x", {}, { retryOn429: true, maxWaitMs: 45_000 });
    await vi.advanceTimersByTimeAsync(21_000);
    expect((await p).data.ok).toBe(1);
    vi.useRealTimers();
  });
});
