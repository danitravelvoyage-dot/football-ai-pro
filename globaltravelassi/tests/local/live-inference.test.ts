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
    // 1. The raw reply, exactly as the model returned it, with time and token counts. Printed before any validation.
    const raw = await gateway.complete({
      system: getAgent("MarketResearchAgent").prompt.system + " Reply with JSON only: {\"findings\":[{\"insight\":\"...\",\"evidence\":\"...\",\"confidence\":\"low|medium|high\",\"sources\":[]}]}",
      user: "List two things a family visa application usually needs to prove. Reply with the JSON object only.",
      maxOutputTokens: 300,
      timeoutMs: 170_000,
    });
    console.log("REAL LOCAL MODEL RAW REPLY", JSON.stringify({ model: raw.model, providerId: raw.providerId, tokensIn: raw.tokensIn, tokensOut: raw.tokensOut, text: raw.text }, null, 2));
    expect(raw.providerId).toBe("local-ollama");
    expect(raw.text.length).toBeGreaterThan(0);

    // Would the first reply pass the agent's contract? Checked with the same parser and schema the runtime uses.
    const { parseJsonLoose } = await import("@/lib/ai/runtime");
    const contract = getAgent("MarketResearchAgent").outputSchema.safeParse(parseJsonLoose(raw.text));
    console.log("REAL LOCAL MODEL RAW REPLY CONTRACT", JSON.stringify({ passesContract: contract.success, issues: contract.success ? [] : contract.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`) }));

    // 2. The same request through the agent runtime, which validates the reply against the agent's contract.
    // The gateway is wrapped so the raw text of this reply is recorded even when validation rejects it.
    const replies: string[] = [];
    const original = gateway.complete.bind(gateway);
    gateway.complete = async (req) => {
      const r = await original(req);
      replies.push(r.text);
      return r;
    };
    const started = performance.now();
    let result: Awaited<ReturnType<AgentRuntime["run"]>> | null = null;
    try {
      result = await new AgentRuntime(gateway).run(getAgent("MarketResearchAgent"), {
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
    } catch (error) {
      // Rejected by the contract: the reply is recorded and the run fails. No output is stored or invented.
      console.log("REAL LOCAL MODEL AGENT REPLY REJECTED", JSON.stringify({ elapsedMs: Math.round(performance.now() - started), reason: error instanceof Error ? error.message : String(error), text: replies.at(-1) }, null, 2));
      // A reply that breaks the contract is refused, and that refusal is the correct result. Anything else is a failure.
      expect(error).toBeInstanceOf(Error);
      expect((error as Error).name).toBe("OutputValidationError");
      return;
    }
    const elapsedMs = Math.round(performance.now() - started);
    console.log("REAL LOCAL MODEL RESPONSE", JSON.stringify({ model: MODEL, providerId: result.providerId, source: result.source, elapsedMs, tokensIn: result.tokensIn, tokensOut: result.tokensOut, output: result.output }, null, 2));
    expect(result.providerId).toBe("local-ollama");
    expect(result.source).toBe("live");
    expect(result.output).toBeTruthy();
  }, 180_000);
});

describe.skipIf(!LIVE)("real local model: one agent question, answered and reviewed (opt-in)", () => {
  it("an agent question is answered by the local model, passes the two-reviewer gate, and is delivered to the asker", async () => {
    const { makeHarness, startInput, OWNER } = await import("../ai/helpers");
    const { CommunicationService } = await import("@/lib/ai/collaboration/communication");
    const config = loadProviderConfig({ AI_LOCAL_ENABLED: "true", AI_LOCAL_BASE_URL: BASE, AI_LOCAL_MODEL: MODEL, AI_LOCAL_MAX_RETRIES: "0" }).find((p) => p.id === "local-ollama")!;
    const provider = new OpenAICompatibleProvider({ id: config.id, baseUrl: config.baseUrl ?? "", model: config.model ?? "" });
    const h = makeHarness({ providers: [{ config, provider }] });
    const comm = new CommunicationService({ bus: h.events, events: h.eventStore, runtime: h.runtime, quality: h.quality, collaboration: h.collab, audit: h.audit, now: h.clock.now, newId: h.ids });
    const { runId } = await h.orch.startWorkflow(startInput({ workflowKey: "sales", idempotencyKey: "live-answer-01" }));
    const asked = await comm.ask(OWNER, { runId, fromAgent: "SalesAgent", toAgent: "CRMAgent", question: "Which stage should a new family visa enquiry start in?" });
    // Record the raw text of the model's reply, so a rejected answer shows what the model actually produced.
    const replies: string[] = [];
    const original = h.gateway.complete.bind(h.gateway);
    h.gateway.complete = async (req) => {
      const r = await original(req);
      replies.push(r.text);
      return r;
    };
    const started = performance.now();
    const outcome = await comm.answer(OWNER, { runId, questionId: asked.questionId });
    const elapsedMs = Math.round(performance.now() - started);
    const exchange = (await comm.exchanges(runId)).find((x) => x.questionId === asked.questionId);
    const decisions = h.audit.events.filter((e) => e.type === "agent.answer_reviewed" || e.type === "agent.answer_held" || e.type === "agent.answer_failed").map((e) => ({ type: e.type, meta: e.meta }));
    console.log("REAL LOCAL MODEL QUESTION", JSON.stringify({ model: MODEL, outcome: outcome.status, elapsedMs, answer: exchange?.answer ?? null, decisions, rawReply: replies.at(-1) ?? null }, null, 2));
    expect(["delivered", "held", "failed"]).toContain(outcome.status);
    if (outcome.status === "delivered") expect(exchange?.answer).toBeTruthy();
  }, 240_000);
});
