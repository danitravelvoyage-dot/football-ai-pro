import { describe, it, expect, afterAll, beforeAll } from "vitest";
import { createServer, type Server, type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { OpenAICompatibleProvider } from "@/lib/ai/llm/openai-compatible";
import { LLMGateway, InMemoryUsageStore, retryBackoffMs } from "@/lib/ai/llm/gateway";
import { ProviderError, type LLMProvider, type LLMRequest, type LLMResponse } from "@/lib/ai/llm/types";
import { loadProviderConfig, priceFrom, type ProviderConfig } from "@/lib/ai/llm/config";
import { costOf } from "@/lib/ai/llm/cost";
import { healthLabel } from "@/lib/ai/llm/health";
import { MockProvider } from "@/lib/ai/llm/mock-provider";

/**
 * Adapter contract tests. They run the real adapter over real HTTP against a local test server.
 * The replies below are test fixtures that exist only to exercise the protocol. They are not model output and are
 * never used by the application: production replies come from the configured provider.
 */

const REQ: LLMRequest = { system: "sys", user: "usr", maxOutputTokens: 100, timeoutMs: 2_000 };
const SECRET = "test-key-do-not-use-0123456789";

let server: Server;
let base = "";
let lastBody: unknown = null;
let lastAuth: string | undefined;

beforeAll(async () => {
  server = createServer((req: IncomingMessage, res: ServerResponse) => {
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", () => {
      lastAuth = req.headers.authorization;
      lastBody = raw ? JSON.parse(raw) : null;
      const route = req.url ?? "";
      if (route.includes("/status/429")) return send(res, 429, { error: "slow down" });
      if (route.includes("/status/400")) return send(res, 400, { error: "bad request" });
      if (route.includes("/status/401")) return send(res, 401, { error: `invalid key ${SECRET}` });
      if (route.includes("/status/500")) return send(res, 500, { error: "boom" });
      if (route.includes("/slow")) return setTimeout(() => send(res, 200, ok()), 300);
      if (route.includes("/not-json")) {
        res.writeHead(200, { "content-type": "text/plain" });
        return res.end("<html>gateway page</html>");
      }
      send(res, 200, ok());
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
  const { port } = server.address() as AddressInfo;
  base = `http://127.0.0.1:${port}/v1`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

function send(res: ServerResponse, status: number, body: unknown) {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
}

function ok() {
  return { choices: [{ message: { content: '{"ok":true}' } }], usage: { prompt_tokens: 12, completion_tokens: 7 } };
}

describe("adapter over real HTTP", () => {
  it("sends the chat request and reads the reply and the token counts", async () => {
    const p = new OpenAICompatibleProvider({ id: "t", baseUrl: base, model: "test-model", getSecret: () => SECRET });
    const r = await p.complete(REQ);
    expect(r).toMatchObject({ text: '{"ok":true}', tokensIn: 12, tokensOut: 7, model: "test-model", source: "live" });
    expect((lastBody as { model: string }).model).toBe("test-model");
    expect(lastAuth).toBe(`Bearer ${SECRET}`);
  });

  it("a local provider without a secret sends no authorization header", async () => {
    const p = new OpenAICompatibleProvider({ id: "local", baseUrl: base, model: "m" });
    await p.complete(REQ);
    expect(lastAuth).toBeUndefined();
  });

  it("rate limits and server errors are retryable; a rejected request is not", async () => {
    const p = (path: string) => new OpenAICompatibleProvider({ id: "t", baseUrl: `${base}/status/${path}`, model: "m" });
    await expect(p("429").complete(REQ)).rejects.toMatchObject({ retryable: true });
    await expect(p("500").complete(REQ)).rejects.toMatchObject({ retryable: true });
    await expect(p("400").complete(REQ)).rejects.toMatchObject({ retryable: false });
  });

  it("an error message never contains the secret, even when the server echoes it", async () => {
    const p = new OpenAICompatibleProvider({ id: "t", baseUrl: `${base}/status/401`, model: "m", getSecret: () => SECRET });
    const err = (await p.complete(REQ).catch((e: unknown) => e)) as ProviderError;
    expect(err).toBeInstanceOf(ProviderError);
    expect(err.message).not.toContain(SECRET);
  });

  it("a slow provider times out as a retryable error", async () => {
    const p = new OpenAICompatibleProvider({ id: "t", baseUrl: `${base}/slow`, model: "m" });
    await expect(p.complete({ ...REQ, timeoutMs: 50 })).rejects.toMatchObject({ retryable: true });
  });

  it("a reply that is not JSON is a non-retryable provider error, not a raw parser exception", async () => {
    const p = new OpenAICompatibleProvider({ id: "t", baseUrl: `${base}/not-json`, model: "m" });
    await expect(p.complete(REQ)).rejects.toMatchObject({ retryable: false, name: "ProviderError" });
  });
});

/** Provider that fails in a scripted way. */
class Flaky implements LLMProvider {
  readonly kind = "openai-compatible" as const;
  calls = 0;
  constructor(readonly id: string, private readonly failures: number, private readonly retryable = true) {}
  async complete(): Promise<LLMResponse> {
    this.calls += 1;
    if (this.calls <= this.failures) throw new ProviderError("down", this.retryable, this.id);
    return { text: "{}", providerId: this.id, model: "flaky", tokensIn: 1, tokensOut: 1, source: "live" };
  }
}

const cfg = (id: string, over: Partial<ProviderConfig> = {}): ProviderConfig => ({
  id, kind: "openai-compatible", costTier: "free", enabled: true, ownerApproved: true, dailyRequestLimit: 1000, maxRetries: 0, ...over,
});

function gateway(providers: { config: ProviderConfig; provider: LLMProvider }[], over: { sleep?: (ms: number) => Promise<void>; breaker?: { failureThreshold: number; cooldownMs: number }; clock?: { t: number } } = {}) {
  const clock = over.clock ?? { t: Date.parse("2026-11-21T09:00:00.000Z") };
  const gw = new LLMGateway({
    providers,
    usage: new InMemoryUsageStore(),
    now: () => new Date(clock.t),
    breaker: over.breaker,
    sleep: over.sleep ?? (async () => undefined),
  });
  return { gw, clock };
}

describe("retries and the circuit breaker", () => {
  it("a retryable failure is retried on the same provider with growing backoff, then succeeds", async () => {
    const waits: number[] = [];
    const flaky = new Flaky("local", 2);
    const { gw } = gateway([{ config: cfg("local", { maxRetries: 2 }), provider: flaky }], { sleep: async (ms) => void waits.push(ms) });
    const r = await gw.complete(REQ);
    expect(r.providerId).toBe("local");
    expect(flaky.calls).toBe(3);
    expect(waits).toEqual([500, 1000]);
    expect(retryBackoffMs(10)).toBe(8000);
  });

  it("after three consecutive failures the breaker opens and the provider is skipped until the cooldown ends", async () => {
    const flaky = new Flaky("hosted", 100);
    const mock = new MockProvider("mock");
    const { gw, clock } = gateway(
      [{ config: cfg("hosted"), provider: flaky }, { config: cfg("mock", { costTier: "free" }), provider: mock }],
      { breaker: { failureThreshold: 3, cooldownMs: 60_000 } },
    );
    for (let i = 0; i < 3; i++) await gw.complete({ ...REQ, mockOutput: { ok: 1 } });
    const callsBefore = flaky.calls;
    await gw.complete({ ...REQ, mockOutput: { ok: 1 } });
    expect(flaky.calls).toBe(callsBefore);
    const h = gw.health().find((s) => s.providerId === "hosted");
    expect(h?.openUntil).not.toBeNull();
    expect(healthLabel(h, new Date(clock.t))).toBe("unavailable");

    clock.t += 61_000;
    await gw.complete({ ...REQ, mockOutput: { ok: 1 } });
    expect(flaky.calls).toBe(callsBefore + 1);
  });

  it("a non-retryable failure is raised at once and counts against the provider's health", async () => {
    const flaky = new Flaky("hosted", 1, false);
    const { gw } = gateway([{ config: cfg("hosted"), provider: flaky }]);
    await expect(gw.complete(REQ)).rejects.toMatchObject({ retryable: false });
    const h = gw.health().find((s) => s.providerId === "hosted");
    expect(h).toMatchObject({ failures: 1, consecutiveFailures: 1 });
    expect(healthLabel(h, new Date())).toBe("degraded");
  });

  it("health is not_used for a provider that was never called", () => {
    expect(healthLabel(undefined, new Date())).toBe("not_used");
  });
});

describe("cost tracking from the owner's price list", () => {
  it("cost is unknown until the owner enters both prices, and computed from tokens after", () => {
    expect(costOf(1000, 500, {})).toBeNull();
    expect(costOf(1000, 500, { inPer1k: 0.5, outPer1k: 1.5 })).toBe(1.25);
  });

  it("prices come from configuration only, and an invalid price is treated as unknown", () => {
    expect(priceFrom({ AI_HOSTED_PRICE_IN_PER_1K: "0.2", AI_HOSTED_PRICE_OUT_PER_1K: "0.4" }, "AI_HOSTED")).toEqual({ inPer1k: 0.2, outPer1k: 0.4 });
    expect(priceFrom({ AI_HOSTED_PRICE_IN_PER_1K: "0.2" }, "AI_HOSTED")).toBeUndefined();
    expect(priceFrom({ AI_HOSTED_PRICE_IN_PER_1K: "-1", AI_HOSTED_PRICE_OUT_PER_1K: "1" }, "AI_HOSTED")).toBeUndefined();
    const hosted = loadProviderConfig({ AI_HOSTED_ENABLED: "true", AI_HOSTED_PRICE_IN_PER_1K: "0.2", AI_HOSTED_PRICE_OUT_PER_1K: "0.4" }).find((p) => p.id === "hosted-free");
    expect(hosted?.price).toEqual({ inPer1k: 0.2, outPer1k: 0.4 });
  });
});

describe("secrets stay out of configuration", () => {
  it("the provider configuration holds the name of a secret variable, never its value", () => {
    const env = { AI_HOSTED_ENABLED: "true", AI_HOSTED_API_KEY: "sk-live-value-that-must-not-leak" };
    const text = JSON.stringify(loadProviderConfig(env));
    expect(text).not.toContain("sk-live-value-that-must-not-leak");
    expect(text).toContain("AI_HOSTED_API_KEY");
  });
});
