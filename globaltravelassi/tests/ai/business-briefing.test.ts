import { describe, it, expect } from "vitest";
import { makeHarness, makeClock, makeIds, startInput, OWNER, ScriptedProvider, mockFor } from "./helpers";
import { MemoryService, MemoryForbiddenError } from "@/lib/ai/memory/service";
import { MemoryMemoryStore } from "@/lib/ai/memory/store";
import { MemoryAuditSink } from "@/lib/ai/audit";
import { buildBriefing, decisionsBrief, BRIEFING_DECISIONS_KEY, BRIEFING_LEARNING_KEY } from "@/lib/ai/memory/briefing";
import type { ProviderConfig } from "@/lib/ai/llm/config";

const AGENT = { kind: "agent" as const, agent: "SalesAgent" as const };
const SYSTEM = { kind: "system" as const };
const T = "2026-11-20T09:00:00.000Z";
const CONFIG: ProviderConfig = { id: "mock", kind: "mock", costTier: "free", enabled: true, ownerApproved: true, dailyRequestLimit: 1_000_000 };
const DAY = 86_400_000;

function memory() {
  const clock = makeClock(T);
  const store = new MemoryMemoryStore();
  const audit = new MemoryAuditSink();
  return { clock, store, svc: new MemoryService({ store, audit, now: clock.now, newId: makeIds("m") }) };
}

async function runToIdle(h: ReturnType<typeof makeHarness>) {
  for (let i = 0; i < 60; i++) {
    const r = await h.orch.tick({ limit: 10 });
    if (r.claimed === 0) break;
  }
}

describe("briefing rules (pure)", () => {
  const dec = (over: Partial<Parameters<typeof decisionsBrief>[0][number]>) => ({
    id: "d",
    subjectType: "strategy",
    subjectRef: "plan",
    decision: "approved",
    reasoning: "Reason.",
    version: 1,
    supersedesId: null,
    decidedBy: "owner-1",
    decidedAt: T,
    ...over,
  }) as Parameters<typeof decisionsBrief>[0][number];

  it("lists rejected and retired strategies, and ignores other subject types", () => {
    const b = decisionsBrief(
      [dec({ subjectRef: "a", decision: "rejected" }), dec({ subjectRef: "b", decision: "retired" }), dec({ subjectRef: "c", decision: "approved" }), dec({ subjectType: "campaign", subjectRef: "x", decision: "rejected" })],
      new Date(T),
    );
    expect(b.rejected.map((d) => d.subject)).toEqual(["a", "b"]);
    expect(b.needsReview.map((d) => d.subject)).toEqual([]);
  });

  it("flags an approved strategy untouched for 90 days as needing review", () => {
    const old = dec({ subjectRef: "old", decidedAt: new Date(Date.parse(T) - 100 * DAY).toISOString() });
    expect(decisionsBrief([old], new Date(T)).needsReview.map((d) => d.subject)).toEqual(["old"]);
  });

  it("with nothing to say, the briefing is empty rather than a list of empty sections", () => {
    expect(buildBriefing({ decisions: [], experiments: [], results: [], settings: { minSample: 30, minLift: 0.2 }, now: new Date(T) })).toEqual([]);
  });

  it("the briefing carries the decision list under its own key", () => {
    const items = buildBriefing({ decisions: [dec({ decision: "rejected" })], experiments: [], results: [], settings: { minSample: 30, minLift: 0.2 }, now: new Date(T) });
    expect(items.map((i) => i.key)).toEqual([BRIEFING_DECISIONS_KEY]);
  });
});

describe("owner memory access", () => {
  it("agents cannot read the briefing: it is built only for the owner or the platform", async () => {
    const { svc } = memory();
    await expect(svc.briefing(AGENT)).rejects.toBeInstanceOf(MemoryForbiddenError);
    await expect(svc.briefing(SYSTEM)).resolves.toEqual([]);
    await expect(svc.briefing(OWNER)).resolves.toEqual([]);
  });

  it("the briefing holds the rejected strategy and no decision identity", async () => {
    const { svc } = memory();
    await svc.recordDecision(OWNER, { subjectType: "strategy", subjectRef: "discount-led", decision: "rejected", reasoning: "Discounts cut margin on visa fees." });
    const items = await svc.briefing(SYSTEM);
    const text = JSON.stringify(items);
    expect(text).toContain("Discounts cut margin");
    expect(text).not.toContain("decidedBy");
    expect(text).not.toContain("version");
  });

  it("learning reaches the briefing only with enough evidence", async () => {
    const { svc, clock } = memory();
    await svc.setLearningSettings(OWNER, { minSample: 5, minLift: 0.2 });
    for (const n of [1, 2]) {
      const exp = await svc.createExperiment(OWNER, { kind: "content", name: `Hooks ${n}`, hypothesis: "A question hook works better." });
      await svc.setExperimentStatus(OWNER, exp.id, "running");
      await svc.recordResult(OWNER, exp.id, { variant: "question", metric: "conversions", value: 20, sampleSize: 40, source: "manual", period: "2026-10" });
      await svc.recordResult(OWNER, exp.id, { variant: "statement", metric: "conversions", value: 5, sampleSize: 40, source: "manual", period: "2026-10" });
    }
    clock.advance(0);
    const items = await svc.briefing(SYSTEM);
    expect(items.some((i) => i.key === BRIEFING_LEARNING_KEY)).toBe(true);

    const weak = memory();
    await weak.svc.setLearningSettings(OWNER, { minSample: 5, minLift: 0.2 });
    const exp = await weak.svc.createExperiment(OWNER, { kind: "content", name: "Thin", hypothesis: "Not enough data yet." });
    await weak.svc.setExperimentStatus(OWNER, exp.id, "running");
    await weak.svc.recordResult(OWNER, exp.id, { variant: "question", metric: "conversions", value: 2, sampleSize: 2, source: "manual", period: "2026-10" });
    expect((await weak.svc.briefing(SYSTEM)).some((i) => i.key === BRIEFING_LEARNING_KEY)).toBe(false);
  });
});

describe("the briefing reaches agent execution", () => {
  it("a rejected strategy appears in the input the model receives, and the agent's input has no decision identity", async () => {
    const { svc } = memory();
    await svc.recordDecision(OWNER, { subjectType: "strategy", subjectRef: "discount-led", decision: "rejected", reasoning: "Discounts cut margin on visa fees." });
    const payloads: string[] = [];
    const mock = mockFor();
    const h = makeHarness({
      start: T,
      briefing: () => svc.briefing(SYSTEM),
      providers: [{ config: CONFIG, provider: new ScriptedProvider("mock", async (req) => (payloads.push(req.user), (await mock.complete(req)).text)) }],
    });
    await h.orch.startWorkflow(startInput({ idempotencyKey: "brief-run-0001" }));
    await runToIdle(h);

    expect(payloads.length).toBeGreaterThan(0);
    expect(payloads.every((p) => p.includes(BRIEFING_DECISIONS_KEY) && p.includes("Discounts cut margin"))).toBe(true);
    expect(payloads.some((p) => p.includes("decidedBy"))).toBe(false);
  });

  it("with no owner memory, no briefing is sent and the run still completes", async () => {
    const payloads: string[] = [];
    const mock = mockFor();
    const h = makeHarness({
      start: T,
      briefing: async () => [],
      providers: [{ config: CONFIG, provider: new ScriptedProvider("mock", async (req) => (payloads.push(req.user), (await mock.complete(req)).text)) }],
    });
    const { runId } = await h.orch.startWorkflow(startInput({ idempotencyKey: "brief-run-0002" }));
    await runToIdle(h);
    expect(payloads.some((p) => p.includes(BRIEFING_DECISIONS_KEY))).toBe(false);
    const tasks = await h.store.listTasksByRunIds([runId]);
    expect(tasks.some((t) => t.status === "failed")).toBe(false);
    expect(tasks.filter((t) => t.status === "succeeded").length).toBeGreaterThan(0);
  });

  it("after a revision request, the retry receives the quality feedback, with locations and instructions only", async () => {
    const payloads: string[] = [];
    const mock = mockFor();
    let calls = 0;
    // Turns the mock reply into an unsupported, high-confidence claim with no source: the quality gate asks for a revision.
    const unsupported = (text: string) => {
      const replace = (v: unknown, key?: string): unknown => {
        if (key === "confidence") return "high";
        if (typeof v === "string") return v.length >= 8 ? "Guaranteed visa approval in one week, sure thing!" : v;
        if (Array.isArray(v)) return v.map((x) => replace(x));
        if (v && typeof v === "object") return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, replace(x, k)]));
        return v;
      };
      return JSON.stringify(replace(JSON.parse(text)));
    };
    const h = makeHarness({
      start: T,
      providers: [
        {
          config: CONFIG,
          provider: new ScriptedProvider("mock", async (req) => {
            payloads.push(req.user);
            calls += 1;
            const reply = (await mock.complete(req)).text;
            return calls === 1 ? unsupported(reply) : reply;
          }),
        },
      ],
    });
    await h.orch.startWorkflow(startInput({ idempotencyKey: "brief-run-0003" }));
    await runToIdle(h);

    const retried = payloads.filter((p) => p.includes("quality.feedback"));
    expect(retried.length).toBeGreaterThan(0);
    expect(payloads[0]!.includes("quality.feedback")).toBe(false);
    expect(retried[0]).toContain("instruction");
    expect(retried[0]).not.toContain("Guaranteed visa approval");
  });
});
