import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createServer, type Server, type IncomingMessage, type ServerResponse } from "node:http";
import { OpenAICompatibleProvider, estimateTokens } from "@/lib/ai/llm/openai-compatible";
import { LLMGateway, InMemoryUsageStore } from "@/lib/ai/llm/gateway";
import { loadProviderConfig } from "@/lib/ai/llm/config";
import { AgentRuntime } from "@/lib/ai/runtime";
import { getAgent } from "@/lib/ai/registry";

/**
 * The free local provider path, end to end: configuration, the OpenAI-compatible adapter, the gateway and an agent run.
 * A local stub server stands in for a model. It makes no paid call and no real model is used.
 */

type Reply = { status: number; body: unknown; raw?: string };
let server: Server;
let base: string;
let next: Reply;
const seen: { path: string; auth: string | undefined; body: { model?: string; messages?: { role: string }[] } }[] = [];

const findingsJson = JSON.stringify({ findings: [{ insight: "Family visa files need a bank statement.", evidence: "Official checklist, reviewed.", confidence: "medium", sources: ["https://official.example.dz/checklist"] }] });

beforeAll(async () => {
  server = createServer((req: IncomingMessage, res: ServerResponse) => {
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", () => {
      seen.push({ path: req.url ?? "", auth: req.headers.authorization, body: raw ? JSON.parse(raw) : {} });
      res.writeHead(next.status, { "content-type": "application/json" });
      res.end(next.raw ?? JSON.stringify(next.body));
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
  const port = (server.address() as { port: number }).port;
  base = `http://127.0.0.1:${port}/v1`;
});

afterAll(async () => {
  await new Promise<void>((r) => server.close(() => r()));
});

function gatewayFor(env: Record<string, string | undefined>) {
  const config = loadProviderConfig({ AI_LOCAL_ENABLED: "true", AI_LOCAL_BASE_URL: base, AI_LOCAL_MODEL: "stub-model", AI_LOCAL_MAX_RETRIES: "0", ...env }).find((p) => p.id === "local-ollama")!;
  const provider = new OpenAICompatibleProvider({ id: config.id, baseUrl: config.baseUrl ?? "", model: config.model ?? "" });
  const usage = new InMemoryUsageStore();
  const gateway = new LLMGateway({ providers: [{ config, provider }], usage, now: () => new Date("2026-11-21T10:00:00Z"), sleep: async () => undefined });
  return { gateway, usage, config };
}

const input = () => ({
  objective: "List the documents a family visa file needs.",
  language: "en" as const,
  country: "all" as const,
  brief: "Keep it factual.",
  data: {},
  aggregates: [],
  upstream: [],
  context: [],
  knowledge: [],
});

describe("free local provider, end to end", () => {
  it("is disabled by default, so a fresh install makes no model call at all", () => {
    const enabled = loadProviderConfig({}).filter((p) => p.enabled);
    expect(enabled).toEqual([]);
  });

  it("runs a real agent through the adapter and returns the validated output the model produced", async () => {
    seen.length = 0;
    next = { status: 200, body: { choices: [{ message: { content: findingsJson } }], usage: { prompt_tokens: 120, completion_tokens: 60 } } };
    const { gateway, usage } = gatewayFor({});
    const runtime = new AgentRuntime(gateway);
    const result = await runtime.run(getAgent("MarketResearchAgent"), input());
    expect(result.providerId).toBe("local-ollama");
    expect(result.output).toEqual(JSON.parse(findingsJson));
    expect(result.tokensIn).toBe(120);
    expect(result.tokensOut).toBe(60);
    expect(seen).toHaveLength(1);
    expect(seen[0]?.path).toBe("/v1/chat/completions");
    expect(seen[0]?.body.model).toBe("stub-model");
    expect(seen[0]?.auth).toBeUndefined();
    expect(await usage.requestsToday("local-ollama", "2026-11-21")).toBe(1);
  });

  it("records an estimated token count when the endpoint omits usage, instead of zero", async () => {
    seen.length = 0;
    next = { status: 200, body: { choices: [{ message: { content: findingsJson } }] } };
    const { gateway } = gatewayFor({});
    const response = await gateway.complete({ system: "s".repeat(400), user: "u".repeat(400), maxOutputTokens: 100, timeoutMs: 5000 });
    expect(response.tokensIn).toBe(estimateTokens("s".repeat(400) + "u".repeat(400)));
    expect(response.tokensOut).toBe(estimateTokens(findingsJson));
    expect(response.tokensIn).toBeGreaterThan(0);
  });

  it("a persistent server error fails the run honestly, with no output fabricated", async () => {
    seen.length = 0;
    next = { status: 503, body: { error: "unavailable" } };
    const { gateway } = gatewayFor({});
    const runtime = new AgentRuntime(gateway);
    await expect(runtime.run(getAgent("MarketResearchAgent"), input())).rejects.toThrow();
  });

  it("a reply that is not JSON is refused and is not retried", async () => {
    seen.length = 0;
    next = { status: 200, body: null, raw: "<html>gateway error</html>" };
    const { gateway } = gatewayFor({ AI_LOCAL_MAX_RETRIES: "3" });
    await expect(gateway.complete({ system: "s", user: "u", maxOutputTokens: 10, timeoutMs: 5000 })).rejects.toThrow();
    expect(seen).toHaveLength(1);
  });

  it("a model reply that breaks the output contract is refused by the runtime, not stored", async () => {
    seen.length = 0;
    next = { status: 200, body: { choices: [{ message: { content: JSON.stringify({ wrong: true }) } }] } };
    const { gateway } = gatewayFor({});
    const runtime = new AgentRuntime(gateway);
    await expect(runtime.run(getAgent("MarketResearchAgent"), input())).rejects.toThrow(/does not match its contract/);
  });
});

describe("invalid replies and failures never produce an output", () => {
  it("an empty reply is rejected, not stored as an empty result", async () => {
    seen.length = 0;
    next = { status: 200, body: { choices: [{ message: { content: "" } }] } };
    const { gateway } = gatewayFor({});
    const runtime = new AgentRuntime(gateway);
    await expect(runtime.run(getAgent("MarketResearchAgent"), input())).rejects.toThrow();
  });

  it("a reply with no JSON object is rejected", async () => {
    seen.length = 0;
    next = { status: 200, body: { choices: [{ message: { content: "I cannot help with that request." } }] } };
    const { gateway } = gatewayFor({});
    const runtime = new AgentRuntime(gateway);
    await expect(runtime.run(getAgent("MarketResearchAgent"), input())).rejects.toThrow(/no JSON object/);
  });

  it("a down local model does not fall back to the mock, even when the mock flag is set", async () => {
    const { MockProvider } = await import("@/lib/ai/llm/mock-provider");
    seen.length = 0;
    next = { status: 503, body: { error: "down" } };
    const env = { AI_LOCAL_ENABLED: "true", AI_LOCAL_BASE_URL: base, AI_LOCAL_MAX_RETRIES: "0", AI_MOCK_ENABLED: "true" };
    const configs = loadProviderConfig(env);
    const providers = configs.filter((c) => c.enabled).map((config) => ({
      config,
      provider: config.kind === "mock" ? new MockProvider(config.id) : new OpenAICompatibleProvider({ id: config.id, baseUrl: config.baseUrl ?? "", model: config.model ?? "" }),
    }));
    expect(providers.map((p) => p.config.id)).toEqual(["local-ollama"]);
    const gateway = new LLMGateway({ providers, usage: new InMemoryUsageStore(), now: () => new Date(), sleep: async () => undefined });
    await expect(new AgentRuntime(gateway).run(getAgent("MarketResearchAgent"), input())).rejects.toThrow();
    expect(seen).toHaveLength(1);
  });

  it("a hosted-provider key in the environment is never sent to the local endpoint", async () => {
    seen.length = 0;
    next = { status: 200, body: { choices: [{ message: { content: findingsJson } }] } };
    const { gateway } = gatewayFor({ AI_HOSTED_API_KEY: "sk-test-not-real-0000" });
    await new AgentRuntime(gateway).run(getAgent("MarketResearchAgent"), input());
    expect(seen[0]?.auth).toBeUndefined();
  });
});
