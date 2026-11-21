import { describe, it, expect } from "vitest";
import { OpenAICompatibleProvider } from "@/lib/ai/llm/openai-compatible";
import { LLMGateway, InMemoryUsageStore } from "@/lib/ai/llm/gateway";
import { loadProviderConfig } from "@/lib/ai/llm/config";
import { AgentRuntime } from "@/lib/ai/runtime";
import { getAgent } from "@/lib/ai/registry";

/**
 * One real inference on the owner's local model. Opt-in: it runs only when LOCAL_AI_LIVE=1, because it needs a running
 * local server (for example Ollama with qwen2.5:0.5b). It never runs in `npm run verify`.
 *
 *   LOCAL_AI_LIVE=1 npx vitest run tests/local
 *
 * It prints what the model actually returned, with the time taken and the token counts the server reported.
 * It makes no paid call, sends no key, and publishes nothing.
 */

const LIVE = process.env.LOCAL_AI_LIVE === "1";
const BASE = process.env.LOCAL_AI_BASE_URL ?? "http://localhost:11434/v1";
const MODEL = process.env.LOCAL_AI_MODEL ?? "qwen2.5:0.5b";

describe.skipIf(!LIVE)("real local model inference (opt-in)", () => {
  it("answers one research task through the real adapter, gateway and agent runtime", async () => {
    const config = loadProviderConfig({ AI_LOCAL_ENABLED: "true", AI_LOCAL_BASE_URL: BASE, AI_LOCAL_MODEL: MODEL, AI_LOCAL_MAX_RETRIES: "0" }).find((p) => p.id === "local-ollama")!;
    const provider = new OpenAICompatibleProvider({ id: config.id, baseUrl: config.baseUrl ?? "", model: config.model ?? "" });
    const usage = new InMemoryUsageStore();
    const gateway = new LLMGateway({ providers: [{ config, provider }], usage, now: () => new Date() });
    const started = performance.now();
    const result = await new AgentRuntime(gateway).run(getAgent("MarketResearchAgent"), {
      objective: "Summarise, in two findings, what a family visa application usually needs to prove.",
      language: "en",
      country: "all",
      brief: "Use only general knowledge. Give a short insight and the evidence for it.",
      data: {},
      aggregates: [],
      upstream: [],
      context: [],
      knowledge: [],
    });
    const elapsedMs = Math.round(performance.now() - started);
    console.log("REAL LOCAL MODEL RESPONSE", JSON.stringify({ model: MODEL, providerId: result.providerId, source: result.source, elapsedMs, tokensIn: result.tokensIn, tokensOut: result.tokensOut, output: result.output }, null, 2));
    expect(result.providerId).toBe("local-ollama");
    expect(result.source).toBe("live");
    expect(result.output).toBeTruthy();
  }, 180_000);
});
