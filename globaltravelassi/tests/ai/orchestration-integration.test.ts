import { describe, it, expect } from "vitest";
import { makeHarness, startInput, OWNER, ScriptedProvider, agentNameIn, mockFor } from "./helpers";
import { MockProvider } from "@/lib/ai/llm/mock-provider";
import type { ProviderConfig } from "@/lib/ai/llm/config";
import type { LLMProvider } from "@/lib/ai/llm/types";
import { EventValidationError } from "@/lib/ai/events/bus";
import { MAX_HANDOFF_HOPS } from "@/lib/ai/events/types";

const CONFIG: ProviderConfig = { id: "mock", kind: "mock", costTier: "free", enabled: true, ownerApproved: true, dailyRequestLimit: 1_000_000 };

/** Runs the mock model and records exactly what each agent was given. */
function recordingProvider() {
  const captured: { agent: string; input: Record<string, unknown> }[] = [];
  const mock = new MockProvider("mock");
  const provider = new ScriptedProvider("mock", async (req) => {
    captured.push({ agent: agentNameIn(req.system), input: JSON.parse(req.user) as Record<string, unknown> });
    return (await mock.complete(req)).text;
  });
  return { captured, providers: [{ config: CONFIG, provider: provider as LLMProvider }] };
}

async function drive(h: ReturnType<typeof makeHarness>, passes = 40) {
  for (let i = 0; i < passes; i++) {
    const report = await h.orch.tick({ limit: 10 });
    if (report.claimed === 0) break;
  }
}

describe("agents receive only what their access rules allow", () => {
  it("the visa agent gets verified knowledge and team context, and never owner-only context or unverified facts", async () => {
    const spy = recordingProvider();
    const h = makeHarness({ providers: spy.providers });
    await h.context.write(OWNER, { scope: "company", scopeKey: "company", contextKey: "company.positioning", value: { text: "Factual and warm." }, expectedVersion: 0, visibility: "team" });
    await h.context.write(OWNER, { scope: "company", scopeKey: "company", contextKey: "company.private_pricing", value: { text: "Internal margin rules." }, expectedVersion: 0, visibility: "owner" });
    const verified = await h.knowledge.save(OWNER, {
      category: "visa_requirements",
      slug: "fr-visa-dz",
      language: "fr",
      country: "dz",
      title: "Visa France - documents",
      body: "Vérifier la liste auprès de la source officielle.",
      officialSourceUrl: "https://www.example-gov.dz/visas",
      reliabilityStatus: "unverified",
    });
    await h.knowledge.review(OWNER, verified.id, "verify_official", null);
    await h.knowledge.save(OWNER, {
      category: "visa_requirements",
      slug: "fr-visa-ma",
      language: "fr",
      country: "ma",
      title: "Entry not verified",
      body: "Ce texte ne doit jamais être donné comme fait.",
      officialSourceUrl: "https://www.example-gov.ma/visas",
      reliabilityStatus: "unverified",
    });

    await h.orch.startWorkflow(startInput({ workflowKey: "visa", idempotencyKey: "integration-visa-01", country: "dz", language: "fr" }));
    await drive(h);

    const visa = spy.captured.find((c) => c.agent === "Visa Research Agent");
    expect(visa).toBeDefined();
    const knowledge = visa!.input.knowledge as { title: string; reliability: string; officialSourceUrl: string }[];
    expect(knowledge).toHaveLength(1);
    expect(knowledge[0]).toMatchObject({ title: "Visa France - documents", reliability: "verified_official", officialSourceUrl: "https://www.example-gov.dz/visas" });

    const context = visa!.input.context as { key: string }[];
    const keys = context.map((c) => c.key);
    expect(keys).toContain("company.positioning");
    expect(keys).toContain("workflow.brief");
    expect(keys).not.toContain("company.private_pricing");

    const everything = JSON.stringify(spy.captured.map((c) => c.input));
    expect(everything).not.toContain("Internal margin rules");
    expect(everything).not.toContain("Ce texte ne doit jamais");
  });

  it("an agent that is not granted knowledge access receives an empty knowledge list", async () => {
    const spy = recordingProvider();
    const h = makeHarness({ providers: spy.providers });
    await h.knowledge.save(OWNER, { category: "customer_faq", slug: "faq-verified", language: "fr", country: "all", title: "Question", body: "Réponse vérifiée à relire.", reliabilityStatus: "verified_internal", verifiedAt: "2026-11-19T09:00:00.000Z" });
    await h.orch.startWorkflow(startInput({ idempotencyKey: "integration-mkt-01" }));
    await drive(h);
    const research = spy.captured.find((c) => c.agent === "Market Research Agent");
    expect(research?.input.knowledge).toEqual([]);
  });

  it("every agent run records what it was given, in the audit trail", async () => {
    const spy = recordingProvider();
    const h = makeHarness({ providers: spy.providers });
    await h.orch.startWorkflow(startInput({ idempotencyKey: "integration-audit-01" }));
    await drive(h);
    const loaded = h.audit.events.filter((e) => e.type === "agent.inputs_loaded");
    expect(loaded.length).toBeGreaterThanOrEqual(6);
    expect(loaded.every((e) => typeof e.meta.context === "number" && typeof e.meta.knowledge === "number")).toBe(true);
  });

  it("the run brief is saved once as workflow context, shared by every agent in the run", async () => {
    const h = makeHarness();
    const { runId } = await h.orch.startWorkflow(startInput({ idempotencyKey: "integration-brief-01", brief: "Keep it factual and warm." }));
    const entries = await h.context.read(OWNER, { scope: "workflow", scopeKey: runId, limit: 10 });
    expect(entries.map((e) => e.contextKey)).toEqual(["workflow.brief"]);
    expect((entries[0].value as { text: string }).text).toBe("Keep it factual and warm.");
  });
});

describe("failures are recoverable and visible", () => {
  it("a terminal failure is escalated by the COO, and an owner retry puts the task back on the ready event path", async () => {
    const failing = new ScriptedProvider("mock", async () => {
      throw Object.assign(new Error("HTTP 400 bad request"), { retryable: false });
    });
    const h = makeHarness({ providers: [{ config: CONFIG, provider: failing as LLMProvider }] });
    const { runId } = await h.orch.startWorkflow(startInput({ idempotencyKey: "integration-fail-01" }));
    await h.orch.tick({ limit: 10 });
    const research = (await h.store.listTasksByRunIds([runId])).find((t) => t.stepKey === "research")!;
    expect(research.status).toBe("failed");
    await h.events.dispatch({ limit: 50 });
    const escalated = h.audit.events.find((e) => e.type === "coo.escalated" && e.entityId === research.id);
    expect(escalated?.meta.blockedDownstream).toBeGreaterThan(0);

    await h.orch.retryTask(research.id, OWNER);
    const retried = await h.store.getTask(research.id);
    expect(retried?.status).toBe("ready");
    const readyEvents = (await h.eventStore.listEvents({ limit: 500 })).items.filter((e) => e.eventType === "task.ready" && e.payload && (e.payload as { taskId: string }).taskId === research.id);
    expect(readyEvents.length).toBeGreaterThanOrEqual(2);
  });
});

describe("agent-to-agent handoffs", () => {
  it("a handoff is delivered to the named agent, which remembers it", async () => {
    const h = makeHarness();
    const saved: string[] = [];
    const original = h.store.saveMemory.bind(h.store);
    h.store.saveMemory = async (agent, key, summary, at) => {
      saved.push(`${agent}|${key}`);
      return original(agent, key, summary, at);
    };
    const result = await h.events.publish({
      type: "agent.handoff",
      producer: "SalesAgent",
      target: "CRMAgent",
      payload: { fromAgent: "SalesAgent", toAgent: "CRMAgent", taskId: null, summary: "Lead qualified; move to the proposal stage." },
      idempotencyKey: "handoff-integration-1",
      hopCount: 1,
    });
    expect(result.recipients).toEqual(["CRMAgent"]);
    await h.events.dispatch({ limit: 10 });
    expect(saved).toEqual([`CRMAgent|handoff:${result.eventId}`]);
    expect(h.audit.events.some((e) => e.type === "agent.handoff_received" && e.actor === "agent:CRMAgent")).toBe(true);
  });

  it("a handoff chain stops at the hop budget, so agents cannot loop forever", async () => {
    const h = makeHarness();
    const hop = (n: number) =>
      h.events.publish({
        type: "agent.handoff",
        producer: n % 2 ? "SalesAgent" : "CRMAgent",
        target: n % 2 ? "CRMAgent" : "SalesAgent",
        payload: { fromAgent: n % 2 ? "SalesAgent" : "CRMAgent", toAgent: n % 2 ? "CRMAgent" : "SalesAgent", taskId: null, summary: `Hop ${n}.` },
        idempotencyKey: `loop-hop-${n}`,
        hopCount: n,
      });
    for (let n = 1; n <= MAX_HANDOFF_HOPS; n++) await hop(n);
    await expect(hop(MAX_HANDOFF_HOPS + 1)).rejects.toBeInstanceOf(EventValidationError);
  });

  it("a handoff from one agent cannot be published as another agent", async () => {
    const h = makeHarness();
    await expect(
      h.events.publish({
        type: "agent.handoff",
        producer: "SEOAgent",
        target: "CRMAgent",
        payload: { fromAgent: "SalesAgent", toAgent: "CRMAgent", taskId: null, summary: "Spoofed." },
        idempotencyKey: "spoofed-handoff-1",
        hopCount: 1,
      }),
    ).rejects.toThrow("published by the agent it comes from");
  });
});

describe("mock provider remains the default", () => {
  it("the integration harness runs entirely on the mock provider", () => {
    expect(mockFor().kind).toBe("mock");
  });
});
