import { describe, it, expect } from "vitest";
import { makeHarness, startInput, ScriptedProvider, agentNameIn, makeClock, OWNER } from "./helpers";
import { MockProvider } from "@/lib/ai/llm/mock-provider";
import { createReviewCenter } from "@/lib/ai/review/center";
import { MemoryReviewStore } from "@/lib/ai/review/store";
import { MemoryAuditSink } from "@/lib/ai/audit";
import { ReviewRuleError, type ReviewOpenInput, type ReviewService } from "@/lib/ai/review/service";
import { StageAnswerService } from "@/lib/ai/factual/stage-answer";
import { CrmService } from "@/lib/ai/crm/service";
import { MemoryCrmStore } from "@/lib/ai/crm/memory-store";
import type { AgentRuntime } from "@/lib/ai/runtime";

const cfg = { id: "scripted", kind: "mock" as const, costTier: "free" as const, enabled: true, ownerApproved: true, dailyRequestLimit: 1000 };
const REASON = "Checked the output against the brief";

/**
 * A workflow whose research output is always unsupported, so the quality gate revises it twice and then rejects it.
 * The review center is built on the same engine and task store, so an owner decision reaches the real tasks.
 */
async function rejectedWorkflow() {
  let open: ((i: ReviewOpenInput) => Promise<unknown>) | null = null;
  const mock = new MockProvider("scripted");
  const provider = new ScriptedProvider("scripted", (req) => {
    if (agentNameIn(req.system) === "Market Research Agent") {
      return JSON.stringify({ findings: [{ insight: "Demand doubles every month.", evidence: "Trust us.", confidence: "high", sources: [] }] });
    }
    return mock.complete(req).then((r) => r.text);
  });
  const h = makeHarness({
    providers: [{ config: cfg, provider }],
    review: { open: (i) => (open ? open(i) : Promise.reject(new Error("review center not ready"))) },
  });
  const reviewStore = new MemoryReviewStore();
  const center: ReviewService = createReviewCenter({
    store: reviewStore,
    audit: h.audit,
    now: () => new Date(),
    newId: (() => { let n = 0; return () => `rv-${++n}`; })(),
    crm: {} as never,
    communication: {} as never,
    tasks: h.store,
    orchestrator: h.orch,
  });
  open = (i) => center.open(i);
  const { runId } = await h.orch.startWorkflow(startInput({ idempotencyKey: "review-hook-0001" }));
  for (let i = 0; i < 40; i++) {
    const report = await h.orch.tick({ limit: 10 });
    if (report.claimed === 0) break;
  }
  const research = (await h.store.listTasksByRunIds([runId])).find((t) => t.stepKey === "research")!;
  return { ...h, center, reviewStore, research };
}

describe("rejected proposals reach the owner", () => {
  it("opens a rejected_proposal item with the reason codes and no reviewed text", async () => {
    const w = await rejectedWorkflow();
    expect(w.research.status).toBe("failed");
    const [item] = await w.reviewStore.list({ kind: "rejected_proposal", limit: 10 });
    expect(item).toBeDefined();
    expect(item!.taskId).toBe(w.research.id);
    expect(item!.agent).toBe(w.research.agent);
    expect(JSON.stringify(item!.evidence)).not.toContain("Demand doubles");
    expect(item!.evidence).toMatchObject({ attempt: expect.any(Number) });
  });

  it("request_revision requeues the same task once, with its inputs kept", async () => {
    const w = await rejectedWorkflow();
    const before = await w.store.getTask(w.research.id);
    const [item] = await w.reviewStore.list({ kind: "rejected_proposal", limit: 10 });
    const out = await w.center.decide(OWNER, item!.id, "request_revision", REASON, item!.version);
    expect(out.effect).toMatchObject({ requeued: true, taskId: w.research.id });
    const after = await w.store.getTask(w.research.id);
    expect(after!.status).toBe("ready");
    expect(after!.attempts).toBe(0);
    expect(after!.input).toEqual(before!.input);
    expect(after!.stepKey).toBe(before!.stepKey);
    expect(w.audit.events.filter((e) => e.type === "task.retry_requested")).toHaveLength(1);
  });

  it("a second open item for a task that was already requeued is refused, and stays open", async () => {
    const w = await rejectedWorkflow();
    const [first] = await w.reviewStore.list({ kind: "rejected_proposal", limit: 10 });
    await w.center.decide(OWNER, first!.id, "request_revision", REASON, first!.version);
    const dup = await w.center.open({
      kind: "rejected_proposal",
      agent: w.research.agent,
      runId: w.research.runId,
      taskId: w.research.id,
      leadId: null,
      subjectRef: w.research.id,
      summary: "Duplicate",
      evidence: {},
      payload: { taskId: w.research.id, runId: w.research.runId, agent: w.research.agent, stepKey: w.research.stepKey },
    });
    await expect(w.center.decide(OWNER, dup.id, "request_revision", REASON, dup.version)).rejects.toBeInstanceOf(ReviewRuleError);
    expect((await w.reviewStore.get(dup.id))?.status).toBe("open");
    expect((await w.store.getTask(w.research.id))!.status).toBe("ready");
    expect(w.audit.events.filter((e) => e.type === "task.retry_requested")).toHaveLength(1);
  });

  it("reject leaves the task failed and nothing is requeued", async () => {
    const w = await rejectedWorkflow();
    const [item] = await w.reviewStore.list({ kind: "rejected_proposal", limit: 10 });
    await w.center.decide(OWNER, item!.id, "reject", REASON, item!.version);
    expect((await w.store.getTask(w.research.id))!.status).toBe("failed");
  });

  it("approve is not allowed for a rejected proposal", async () => {
    const w = await rejectedWorkflow();
    const [item] = await w.reviewStore.list({ kind: "rejected_proposal", limit: 10 });
    await expect(w.center.decide(OWNER, item!.id, "approve", REASON, item!.version)).rejects.toMatchObject({ code: "not_allowed_for_kind" });
  });
});

describe("CRM stage disagreements reach the owner", () => {
  function stageSetup(modelStage: string | "throw") {
    const clock = makeClock("2026-11-21T09:00:00.000Z");
    const audit = new MemoryAuditSink();
    const reviewStore = new MemoryReviewStore();
    let n = 0;
    const crm = new CrmService({ store: new MemoryCrmStore(), audit, now: clock.now, newId: () => `lead-${++n}`, requestApproval: async () => "unused" });
    const runtime = {
      run: async () => {
        if (modelStage === "throw") throw new Error("model down");
        return { output: { stage: modelStage, reason: "ok" } };
      },
    } as unknown as AgentRuntime;
    const review = createReviewCenter({
      store: reviewStore,
      audit,
      now: clock.now,
      newId: () => `rv-${++n}`,
      crm: crm as never,
      communication: { deliverApproved: async () => ({ eventId: "x" }) } as never,
      tasks: { getTask: async () => null },
      orchestrator: { retryTask: async () => {} },
    });
    const answers = new StageAnswerService({ runtime, crm, audit, now: clock.now, newId: () => `sa-${++n}`, review: { open: (i) => review.open(i) } });
    return { crm, answers, reviewStore, audit, review };
  }

  const newLead = (crm: CrmService) =>
    crm.createLead(OWNER, { label: "Enquiry", source: "manual", applicationId: null, destinationCountry: "FR", nationality: "DZ", travelDate: null, interest: "visa" });

  it("a disagreement opens an item and the stored stage stays the answer", async () => {
    const s = stageSetup("qualified");
    const lead = await newLead(s.crm);
    const out = await s.answers.answer(OWNER, lead.id, "What stage is this lead in?");
    expect(out).toMatchObject({ status: "escalated", modelCheck: "disagreed", stage: "new" });
    const [item] = await s.reviewStore.list({ kind: "crm_stage_disagreement", limit: 10 });
    expect(item).toMatchObject({ leadId: lead.id, status: "open" });
    expect(item!.evidence).toMatchObject({ recordStage: "new" });
  });

  it("agreement opens nothing", async () => {
    const s = stageSetup("new");
    const lead = await newLead(s.crm);
    const out = await s.answers.answer(OWNER, lead.id, "What stage is this lead in?");
    expect(out.modelCheck).toBe("agreed");
    expect(await s.reviewStore.list({ kind: "crm_stage_disagreement", limit: 10 })).toHaveLength(0);
  });

  it("a model failure is recorded as refused and does not open an item", async () => {
    const s = stageSetup("throw");
    const lead = await newLead(s.crm);
    const out = await s.answers.answer(OWNER, lead.id, "What stage is this lead in?");
    expect(out).toMatchObject({ modelCheck: "refused", status: "answered", stage: "new" });
    expect(await s.reviewStore.list({ kind: "crm_stage_disagreement", limit: 10 })).toHaveLength(0);
  });

  it("only the owner can ask for a stage answer", async () => {
    const s = stageSetup("qualified");
    const lead = await newLead(s.crm);
    await expect(s.answers.answer({ kind: "agent", agent: "CRMAgent" }, lead.id, "stage?")).rejects.toThrow(/Only the owner/);
    await expect(s.answers.answer({ kind: "system" }, lead.id, "stage?")).rejects.toThrow(/Only the owner/);
  });

  it("the owner's decision on a disagreement is recorded, with no automatic change to the lead", async () => {
    const s = stageSetup("qualified");
    const lead = await newLead(s.crm);
    await s.answers.answer(OWNER, lead.id, "stage?");
    const [item] = await s.reviewStore.list({ kind: "crm_stage_disagreement", limit: 10 });
    await s.review.decide(OWNER, item!.id, "approve", REASON, item!.version);
    expect((await s.crm.view(OWNER, lead.id)).lead.stage).toBe("new");
  });
});

describe("held answers are delivered exactly once", () => {
  it("two approvals at the same time deliver one answer", async () => {
    const reviewStore = new MemoryReviewStore();
    const delivered: string[] = [];
    const audit = new MemoryAuditSink();
    const review = createReviewCenter({
      store: reviewStore,
      audit,
      now: () => new Date("2026-11-21T10:00:00.000Z"),
      newId: (() => { let n = 0; return () => `held-${++n}`; })(),
      crm: {} as never,
      communication: {
        deliverApproved: async (_a: unknown, p: { questionId: string }) => {
          delivered.push(p.questionId);
          return { eventId: "evt" };
        },
      } as never,
      tasks: { getTask: async () => null },
      orchestrator: { retryTask: async () => {} },
    });
    const item = await review.open({
      kind: "held_answer",
      agent: "ResearchAgent",
      runId: null,
      taskId: null,
      leadId: null,
      subjectRef: "q-9",
      summary: "Held",
      evidence: {},
      payload: { runId: "run-9", questionId: "q-9", fromAgent: "ResearchAgent", toAgent: "SalesAgent", answer: "a", question: "q" },
    });
    const results = await Promise.allSettled([
      review.decide(OWNER, item.id, "approve", REASON, 1),
      review.decide(OWNER, item.id, "approve", REASON, 1),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const failed = results.find((r) => r.status === "rejected") as PromiseRejectedResult;
    expect(failed.reason).toBeInstanceOf(ReviewRuleError);
    expect(delivered).toEqual(["q-9"]);
  });
});
