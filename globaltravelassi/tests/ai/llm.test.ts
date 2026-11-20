import { describe, it, expect, vi } from "vitest";
import { loadProviderConfig, type ProviderConfig } from "@/lib/ai/llm/config";
import { LLMGateway, InMemoryUsageStore } from "@/lib/ai/llm/gateway";
import { MockProvider } from "@/lib/ai/llm/mock-provider";
import { OpenAICompatibleProvider } from "@/lib/ai/llm/openai-compatible";
import { ProviderError, ProviderUnavailableError, type LLMProvider, type LLMRequest } from "@/lib/ai/llm/types";
import { ScriptedProvider } from "./helpers";

const req: LLMRequest = { system: "s", user: "u", maxOutputTokens: 100, timeoutMs: 1000, mockOutput: { ok: 1 } };
const base = (id: string, costTier: ProviderConfig["costTier"], extra: Partial<ProviderConfig> = {}): ProviderConfig => ({
  id,
  kind: "mock",
  costTier,
  enabled: true,
  ownerApproved: costTier !== "paid",
  dailyRequestLimit: 100,
  ...extra,
});

describe("provider configuration", () => {
  it("defaults to mock only: no local, hosted or paid provider is enabled", () => {
    const providers = loadProviderConfig({});
    const enabled = providers.filter((p) => p.enabled).map((p) => p.id);
    expect(enabled).toEqual(["mock"]);
  });

  it("a paid provider stays disabled unless the owner lists it", () => {
    const off = loadProviderConfig({ AI_PAID_API_KEY: "should-not-matter" }).find((p) => p.id === "paid-placeholder");
    expect(off?.enabled).toBe(false);
    const on = loadProviderConfig({ AI_OWNER_APPROVED_PAID_PROVIDERS: "paid-placeholder", AI_PAID_DAILY_LIMIT: "10" }).find(
      (p) => p.id === "paid-placeholder",
    );
    expect(on?.enabled).toBe(true);
    expect(on?.ownerApproved).toBe(true);
  });

  it("switching provider is a configuration change: enabling local Ollama adds it to the chain", () => {
    const providers = loadProviderConfig({ AI_LOCAL_ENABLED: "true", AI_LOCAL_MODEL: "qwen2.5:7b" });
    const local = providers.find((p) => p.id === "local-ollama");
    expect(local?.enabled).toBe(true);
    expect(local?.model).toBe("qwen2.5:7b");
    expect(local?.costTier).toBe("local");
  });
});

describe("LLM gateway", () => {
  it("uses the first enabled provider in order", async () => {
    const first = new MockProvider("first");
    const second = new MockProvider("second");
    const gw = new LLMGateway({
      providers: [
        { config: base("first", "free"), provider: first },
        { config: base("second", "free"), provider: second },
      ],
      usage: new InMemoryUsageStore(),
      now: () => new Date("2026-11-20T10:00:00Z"),
    });
    const res = await gw.complete(req);
    expect(res.providerId).toBe("first");
  });

  it("never uses a paid provider the owner has not approved", async () => {
    const paid = new MockProvider("paid");
    const events: string[] = [];
    const gw = new LLMGateway({
      providers: [
        { config: base("paid", "paid", { ownerApproved: false }), provider: paid },
        { config: base("mock", "free"), provider: new MockProvider("mock") },
      ],
      usage: new InMemoryUsageStore(),
      now: () => new Date("2026-11-20T10:00:00Z"),
      onEvent: (e) => events.push(e.type),
    });
    const res = await gw.complete(req);
    expect(res.providerId).toBe("mock");
    expect(events).toContain("provider.blocked_paid");
  });

  it("respects the daily quota and moves to the next free provider", async () => {
    const usage = new InMemoryUsageStore();
    const now = () => new Date("2026-11-20T10:00:00Z");
    const gw = new LLMGateway({
      providers: [
        { config: base("limited", "free", { dailyRequestLimit: 2 }), provider: new MockProvider("limited") },
        { config: base("backup", "free"), provider: new MockProvider("backup") },
      ],
      usage,
      now,
    });
    const ids = [];
    for (let i = 0; i < 3; i++) ids.push((await gw.complete(req)).providerId);
    expect(ids).toEqual(["limited", "limited", "backup"]);
  });

  it("the quota resets on a new day", async () => {
    let t = new Date("2026-11-20T23:59:00Z");
    const gw = new LLMGateway({
      providers: [{ config: base("only", "free", { dailyRequestLimit: 1 }), provider: new MockProvider("only") }],
      usage: new InMemoryUsageStore(),
      now: () => t,
    });
    await gw.complete(req);
    await expect(gw.complete(req)).rejects.toBeInstanceOf(ProviderUnavailableError);
    t = new Date("2026-11-21T00:01:00Z");
    await expect(gw.complete(req)).resolves.toBeDefined();
  });

  it("falls over to the next provider on a retryable error", async () => {
    const flaky: LLMProvider = {
      id: "flaky",
      kind: "mock",
      complete: vi.fn(async () => {
        throw new ProviderError("HTTP 503", true, "flaky");
      }),
    };
    const gw = new LLMGateway({
      providers: [
        { config: base("flaky", "free"), provider: flaky },
        { config: base("mock", "free"), provider: new MockProvider("mock") },
      ],
      usage: new InMemoryUsageStore(),
      now: () => new Date("2026-11-20T10:00:00Z"),
    });
    expect((await gw.complete(req)).providerId).toBe("mock");
  });

  it("a non-retryable error is raised immediately, without trying other providers", async () => {
    const bad: LLMProvider = {
      id: "bad",
      kind: "mock",
      complete: async () => {
        throw new ProviderError("HTTP 400", false, "bad");
      },
    };
    const backup = new ScriptedProvider("backup", () => "{}");
    const gw = new LLMGateway({
      providers: [
        { config: base("bad", "free"), provider: bad },
        { config: base("backup", "free"), provider: backup },
      ],
      usage: new InMemoryUsageStore(),
      now: () => new Date("2026-11-20T10:00:00Z"),
    });
    await expect(gw.complete(req)).rejects.toBeInstanceOf(ProviderError);
    expect(backup.calls).toBe(0);
  });

  it("records token usage per provider and day", async () => {
    const usage = new InMemoryUsageStore();
    const gw = new LLMGateway({
      providers: [{ config: base("mock", "free"), provider: new MockProvider("mock") }],
      usage,
      now: () => new Date("2026-11-20T10:00:00Z"),
    });
    await gw.complete(req);
    await gw.complete(req);
    expect(await usage.requestsToday("mock", "2026-11-20")).toBe(2);
  });
});

describe("OpenAI-compatible adapter", () => {
  const okBody = { choices: [{ message: { content: '{"ok":true}' } }], usage: { prompt_tokens: 5, completion_tokens: 3 } };

  it("parses a successful reply and sends the secret only in the header", async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify(okBody), { status: 200 }));
    const provider = new OpenAICompatibleProvider({
      id: "hosted-free",
      baseUrl: "https://example.test/v1",
      model: "m",
      getSecret: () => "SECRET-VALUE",
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    const res = await provider.complete(req);
    expect(res.text).toBe('{"ok":true}');
    expect(res.tokensIn).toBe(5);
    const [, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect((init.headers as Record<string, string>).authorization).toBe("Bearer SECRET-VALUE");
    expect(String(init.body)).not.toContain("SECRET-VALUE");
  });

  it("local providers send no authorization header", async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify(okBody), { status: 200 }));
    const provider = new OpenAICompatibleProvider({ id: "local", baseUrl: "http://localhost:11434/v1", model: "m", fetchImpl: fetchImpl as unknown as typeof fetch });
    await provider.complete(req);
    const [, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect((init.headers as Record<string, string>).authorization).toBeUndefined();
  });

  it("classifies rate limits and server errors as retryable, client errors as not", async () => {
    const make = (status: number) =>
      new OpenAICompatibleProvider({
        id: "p",
        baseUrl: "https://x.test/v1",
        model: "m",
        fetchImpl: (async () => new Response("{}", { status })) as unknown as typeof fetch,
      });
    await expect(make(429).complete(req)).rejects.toMatchObject({ retryable: true });
    await expect(make(503).complete(req)).rejects.toMatchObject({ retryable: true });
    await expect(make(400).complete(req)).rejects.toMatchObject({ retryable: false });
  });

  it("a timeout is retryable and the error text contains no secret", async () => {
    const provider = new OpenAICompatibleProvider({
      id: "p",
      baseUrl: "https://x.test/v1",
      model: "m",
      getSecret: () => "SECRET-VALUE",
      fetchImpl: ((_url: string, init: RequestInit) =>
        new Promise((_, reject) => {
          init.signal?.addEventListener("abort", () => {
            const e = new Error("aborted");
            e.name = "AbortError";
            reject(e);
          });
        })) as unknown as typeof fetch,
    });
    try {
      await provider.complete({ ...req, timeoutMs: 5 });
      throw new Error("should have timed out");
    } catch (error) {
      expect(error).toBeInstanceOf(ProviderError);
      expect((error as ProviderError).retryable).toBe(true);
      expect((error as Error).message).not.toContain("SECRET-VALUE");
    }
  });
});
