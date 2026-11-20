import { ApprovalService } from "@/lib/ai/approvals";
import { MemoryAuditSink } from "@/lib/ai/audit";
import { LLMGateway, InMemoryUsageStore } from "@/lib/ai/llm/gateway";
import type { ProviderConfig } from "@/lib/ai/llm/config";
import { MockProvider } from "@/lib/ai/llm/mock-provider";
import { ProviderError, type LLMProvider, type LLMRequest, type LLMResponse } from "@/lib/ai/llm/types";
import { silentLogger } from "@/lib/ai/logging";
import { AgentRuntime } from "@/lib/ai/runtime";
import { Orchestrator } from "@/lib/ai/orchestration/engine";
import { MemoryTaskStore } from "@/lib/ai/orchestration/store";
import { MemoryEventStore, seedDefaultSubscriptions } from "@/lib/ai/events/store";
import { AGENT_KEYS } from "@/lib/ai/types";
import { buildPlatform } from "@/lib/ai/platform";
import { MemoryContextStore } from "@/lib/ai/context/store";
import { MemoryKbStore } from "@/lib/ai/knowledge/store";
import { MemoryQualityStore } from "@/lib/ai/quality/store";

export function makeClock(startIso = "2026-11-20T09:00:00.000Z") {
  let t = new Date(startIso).getTime();
  return {
    now: () => new Date(t),
    advance(ms: number) {
      t += ms;
    },
  };
}

export function makeIds(prefix = "id") {
  let n = 0;
  return () => `${prefix}-${++n}`;
}

const FREE_MOCK: ProviderConfig = {
  id: "mock",
  kind: "mock",
  costTier: "free",
  enabled: true,
  ownerApproved: true,
  dailyRequestLimit: 1_000_000,
};

/** Provider whose replies come from a function. Used to script good, bad or failing model behaviour. */
export class ScriptedProvider implements LLMProvider {
  readonly kind = "mock" as const;
  calls = 0;
  constructor(
    public readonly id: string,
    private readonly responder: (req: LLMRequest, call: number) => string | Promise<string>,
  ) {}

  async complete(req: LLMRequest): Promise<LLMResponse> {
    this.calls += 1;
    const text = await this.responder(req, this.calls);
    return { text, providerId: this.id, model: "scripted", tokensIn: 10, tokensOut: 10, source: "mock" };
  }
}

/** Replies with the mock output of the agent named in the system prompt. */
export function mockFor(id = "mock") {
  return new MockProvider(id);
}

export function agentNameIn(system: string): string {
  const m = /You are (.+?) inside the GLOBALTRAVELASSI/.exec(system);
  return m ? m[1] : "";
}

export function makeHarness(options: {
  providers?: { config: ProviderConfig; provider: LLMProvider }[];
  visaAllowlist?: string[];
  start?: string;
} = {}) {
  const clock = makeClock(options.start);
  const store = new MemoryTaskStore();
  const audit = new MemoryAuditSink();
  const ids = makeIds();
  const usage = new InMemoryUsageStore();
  const gateway = new LLMGateway({
    providers: options.providers ?? [{ config: FREE_MOCK, provider: new MockProvider() }],
    usage,
    now: clock.now,
  });
  const runtime = new AgentRuntime(gateway);
  const approvals = new ApprovalService({ store, audit, now: clock.now, newId: ids });
  const eventStore = new MemoryEventStore();
  seedDefaultSubscriptions(eventStore, AGENT_KEYS);
  const platform = buildPlatform(
    { tasks: store, events: eventStore, context: new MemoryContextStore(), knowledge: new MemoryKbStore(), quality: new MemoryQualityStore(), audit },
    { now: clock.now, newId: ids },
  );
  const orch = new Orchestrator({
    store,
    runtime,
    approvals,
    audit,
    logger: silentLogger,
    now: clock.now,
    newId: ids,
    visaAllowlist: () => options.visaAllowlist ?? [],
    events: platform.events,
    context: platform.context,
    knowledge: platform.knowledge,
    quality: platform.quality,
  });
  return { clock, store, audit, ids, usage, gateway, runtime, approvals, orch, events: platform.events, eventStore, context: platform.context, knowledge: platform.knowledge, quality: platform.quality };
}

export const OWNER = { kind: "owner" as const, id: "owner-1" };
export const AGENT = { kind: "agent" as const, agent: "SalesAgent" as const };

export function startInput(overrides: Partial<Parameters<Orchestrator["startWorkflow"]>[0]> = {}) {
  return {
    workflowKey: "marketing" as const,
    objective: "Prepare a spring campaign for France visa support.",
    language: "fr" as const,
    country: "dz" as const,
    brief: "Keep it factual and warm.",
    data: {},
    aggregates: [],
    idempotencyKey: "run-key-0001",
    createdBy: "owner-1",
    ...overrides,
  };
}

export { ProviderError };
