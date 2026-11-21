import { MemoryCollaborationStore } from "@/lib/ai/collaboration/store";
import { describe, it, expect } from "vitest";
import { ForbiddenActorError } from "@/lib/ai/approvals";
import { Orchestrator } from "@/lib/ai/orchestration/engine";
import { ConcurrencyError } from "@/lib/ai/orchestration/store";
import { AgentRuntime } from "@/lib/ai/runtime";
import { LLMGateway, InMemoryUsageStore } from "@/lib/ai/llm/gateway";
import { MockProvider } from "@/lib/ai/llm/mock-provider";
import { ProviderError } from "@/lib/ai/llm/types";
import { ApprovalService } from "@/lib/ai/approvals";
import { MemoryAuditSink } from "@/lib/ai/audit";
import { silentLogger } from "@/lib/ai/logging";
import { MemoryTaskStore } from "@/lib/ai/orchestration/store";
import { makeClock, makeHarness, makeIds, OWNER, AGENT, ScriptedProvider, agentNameIn, startInput, clearQualityHolds } from "./helpers";
import type { TaskStatus } from "@/lib/ai/types";
import { MemoryEventStore } from "@/lib/ai/events/store";
import { buildPlatform } from "@/lib/ai/platform";
import { MemoryContextStore } from "@/lib/ai/context/store";
import { MemoryKbStore } from "@/lib/ai/knowledge/store";
import { MemoryQualityStore } from "@/lib/ai/quality/store";

/** Runs passes until nothing is ready to run, bounded to avoid infinite loops. */
async function drive(orch: Orchestrator, passes = 40) {
  for (let i = 0; i < passes; i++) {
    const report = await orch.tick({ limit: 10 });
    if (report.claimed === 0) break;
  }
}

async function statusOf(store: MemoryTaskStore, runId: string) {
  const tasks = await store.listTasksByRunIds([runId]);
  return Object.fromEntries(tasks.map((t) => [t.stepKey, t.status])) as Record<string, TaskStatus>;
}

describe("workflow start and idempotency", () => {
  it("creates one run and its tasks with dependencies", async () => {
    const h = makeHarness();
    const first = await h.orch.startWorkflow(startInput());
    expect(first.created).toBe(true);
    const tasks = await h.store.listTasksByRunIds([first.runId]);
    expect(tasks).toHaveLength(7);
    const approvalTask = tasks.find((t) => t.stepKey === "approval");
    expect(approvalTask?.requiresApproval).toBe(true);
    expect(approvalTask?.actionClass).toBe("external_publish");
  });

  it("starting the same idempotency key twice creates nothing new", async () => {
    const h = makeHarness();
    const a = await h.orch.startWorkflow(startInput());
    const b = await h.orch.startWorkflow(startInput());
    expect(b.created).toBe(false);
    expect(b.runId).toBe(a.runId);
    expect(await h.store.listOpenTasks()).toHaveLength(7);
  });

  it("rejects malformed input before anything is saved", async () => {
    const h = makeHarness();
    await expect(h.orch.startWorkflow({ ...startInput(), language: "de" as never })).rejects.toThrow();
    expect(await h.store.listOpenTasks()).toHaveLength(0);
  });
});

describe("marketing workflow end to end (mock provider)", () => {
  it("runs in dependency order and stops first at the owner's review of the compliance output", async () => {
    const h = makeHarness();
    const { runId } = await h.orch.startWorkflow(startInput());
    await drive(h.orch);
    const s = await statusOf(h.store, runId);
    expect(s.research).toBe("succeeded");
    // Compliance outputs always go to the owner: the compliance agent has no independent second reviewer.
    expect(s.compliance).toBe("waiting_approval");
    expect(s.approval).toBe("pending");
    const pending = await h.store.listApprovals("pending");
    expect(pending).toHaveLength(1);
    expect(pending[0]?.actionClass).toBe("propose_change");
    expect(pending[0]?.summary).toContain("Human review needed");
  });

  it("after the owner reviews the compliance output, the run reaches the publishing approval gate", async () => {
    const h = makeHarness();
    const { runId } = await h.orch.startWorkflow(startInput());
    await clearQualityHolds(h);
    const s = await statusOf(h.store, runId);
    expect(s.compliance).toBe("succeeded");
    expect(s.approval).toBe("waiting_approval");
    const pending = await h.store.listApprovals("pending");
    expect(pending.map((a) => a.actionClass)).toEqual(["external_publish"]);
  });

  it("the owner approves: the item becomes an owner action card, never an execution", async () => {
    const h = makeHarness();
    const { runId } = await h.orch.startWorkflow(startInput());
    await clearQualityHolds(h);
    const [approval] = await h.store.listApprovals("pending");
    await h.orch.decideApproval(approval!.id, "approved", OWNER, "Looks good.");

    const s = await statusOf(h.store, runId);
    expect(s.approval).toBe("succeeded");
    const artifacts = await h.store.listArtifacts(100);
    const card = artifacts.find((a) => a.kind === "owner_action_card");
    expect(card?.status).toBe("awaiting_owner");
    expect(JSON.stringify(card?.body)).toContain("Not executed by the platform");
    const events = h.audit.events.map((e) => e.type);
    expect(events).toContain("approval.approved");
  });

  it("the owner rejects: the approval task is cancelled and every decision is logged", async () => {
    const h = makeHarness();
    const { runId } = await h.orch.startWorkflow(startInput());
    await clearQualityHolds(h);
    const [approval] = await h.store.listApprovals("pending");
    await h.orch.decideApproval(approval!.id, "rejected", OWNER, "Not now.");
    expect((await statusOf(h.store, runId)).approval).toBe("cancelled");
    expect(h.audit.events.map((e) => e.type)).toContain("approval.rejected");
  });

  it("an agent can never decide an approval", async () => {
    const h = makeHarness();
    await h.orch.startWorkflow(startInput());
    await drive(h.orch);
    const [approval] = await h.store.listApprovals("pending");
    await expect(h.orch.decideApproval(approval!.id, "approved", AGENT, null)).rejects.toBeInstanceOf(ForbiddenActorError);
    expect((await h.store.getApproval(approval!.id))?.status).toBe("pending");
  });

  it("a decision can only be made once", async () => {
    const h = makeHarness();
    await h.orch.startWorkflow(startInput());
    await drive(h.orch);
    const [approval] = await h.store.listApprovals("pending");
    await h.orch.decideApproval(approval!.id, "approved", OWNER, null);
    await expect(h.orch.decideApproval(approval!.id, "rejected", OWNER, null)).rejects.toBeInstanceOf(ConcurrencyError);
  });
});

describe("failure handling", () => {
  it("a rejected sales approval keeps the follow-up blocked", async () => {
    const h = makeHarness();
    const { runId } = await h.orch.startWorkflow(startInput({ workflowKey: "sales", idempotencyKey: "sales-key-0001" }));
    await clearQualityHolds(h);
    const [approval] = await h.store.listApprovals("pending");
    expect(approval?.actionClass).toBe("external_send_message");
    await h.orch.decideApproval(approval!.id, "rejected", OWNER, null);
    await drive(h.orch);
    const s = await statusOf(h.store, runId);
    expect(s.approval).toBe("cancelled");
    expect(s.follow_up).toBe("blocked");
  });

  it("a retryable provider error schedules a retry with backoff, then succeeds", async () => {
    const researchProvider = new ScriptedProvider("scripted", (_req, call) => {
      if (call === 1) throw new ProviderError("HTTP 503", true, "scripted");
      return JSON.stringify({ findings: [] });
    });
    const h = makeHarness({ providers: [{ config: { id: "scripted", kind: "mock", costTier: "free", enabled: true, ownerApproved: true, dailyRequestLimit: 1000 }, provider: researchProvider }], start: "2026-11-20T09:00:00.000Z" });
    const { runId } = await h.orch.startWorkflow(startInput({ idempotencyKey: "retry-key-0001" }));

    await h.orch.tick({ limit: 1 });
    let research = (await h.store.listTasksByRunIds([runId])).find((t) => t.stepKey === "research")!;
    expect(research.status).toBe("ready");
    expect(research.lastError).toContain("HTTP 503");

    await h.orch.tick({ limit: 1 });
    research = (await h.store.listTasksByRunIds([runId])).find((t) => t.stepKey === "research")!;
    expect(research.status).toBe("ready");

    h.clock.advance(60_000);
    await h.orch.tick({ limit: 1 });
    research = (await h.store.listTasksByRunIds([runId])).find((t) => t.stepKey === "research")!;
    expect(research.status).toBe("succeeded");
  });

  it("invalid model output fails the task and blocks everything that depends on it", async () => {
    const provider = new ScriptedProvider("scripted", () => "this is not json at all");
    const h = makeHarness({ providers: [{ config: { id: "scripted", kind: "mock", costTier: "free", enabled: true, ownerApproved: true, dailyRequestLimit: 1000 }, provider }] });
    const { runId } = await h.orch.startWorkflow(startInput({ idempotencyKey: "bad-output-key-1" }));
    await drive(h.orch);
    const s = await statusOf(h.store, runId);
    expect(s.research).toBe("failed");
    expect(s.strategy).toBe("blocked");
    const failed = (await h.store.listTasksByRunIds([runId])).find((t) => t.stepKey === "research")!;
    expect(failed.lastError).toMatch(/not valid JSON|no JSON/);
  });

  it("the compliance gate blocks a draft that promises a guaranteed visa", async () => {
    const provider = new ScriptedProvider("scripted", (req) => {
      const name = agentNameIn(req.system);
      if (name === "Content Creator") {
        return JSON.stringify({ drafts: [{ kind: "caption", language: "fr", text: "Visa garanti à 100 % avec nous !" }] });
      }
      return JSON.stringify(req.mockOutput);
    });
    const h = makeHarness({ providers: [{ config: { id: "scripted", kind: "mock", costTier: "free", enabled: true, ownerApproved: true, dailyRequestLimit: 1000 }, provider }] });
    const { runId } = await h.orch.startWorkflow(startInput({ idempotencyKey: "compliance-key-1" }));
    await drive(h.orch);
    const s = await statusOf(h.store, runId);
    // The quality gate catches the promise at the content step, before compliance or approval run.
    expect(s.campaign).toBe("failed");
    expect(s.compliance).toBe("blocked");
    expect(s.approval).toBe("blocked");
    expect(await h.store.listApprovals()).toHaveLength(0);
    const contentTask = (await h.store.listTasksByRunIds([runId])).find((t) => t.stepKey === "campaign")!;
    const reviews = await h.quality.history({ kind: "system" }, contentTask.id);
    expect(reviews.at(-1)?.status).toBe("REJECTED");
    expect(reviews.some((r) => r.issues.some((i) => i.code === "brand_violation" || i.code === "policy_guaranteed-outcome"))).toBe(true);
  });

  it("personal data in the brief is blocked before any model call", async () => {
    const h = makeHarness();
    const { runId } = await h.orch.startWorkflow(
      startInput({ idempotencyKey: "pii-key-000001", data: { contact: "amina@example.dz" } }),
    );
    await drive(h.orch);
    const s = await statusOf(h.store, runId);
    expect(s.research).toBe("failed");
    const task = (await h.store.listTasksByRunIds([runId])).find((t) => t.stepKey === "research")!;
    expect(task.lastError).toContain("Personal data");
    expect((await h.store.listAgentRuns(50)).filter((r) => r.status === "succeeded")).toHaveLength(0);
  });
});

describe("state survives across sessions", () => {
  it("a new orchestrator instance continues a run started by another instance", async () => {
    const store = new MemoryTaskStore();
    const audit = new MemoryAuditSink();
    const clock = makeClock();
    const ids = makeIds("s");
    const platform = buildPlatform(
      { tasks: store, events: new MemoryEventStore(), context: new MemoryContextStore(), knowledge: new MemoryKbStore(), quality: new MemoryQualityStore(), audit },
      { now: clock.now, newId: ids },
    );
    const build = () => {
      const gateway = new LLMGateway({
        providers: [{ config: { id: "mock", kind: "mock", costTier: "free", enabled: true, ownerApproved: true, dailyRequestLimit: 1000 }, provider: new MockProvider() }],
        usage: new InMemoryUsageStore(),
        now: clock.now,
      });
      return new Orchestrator({
        store,
        runtime: new AgentRuntime(gateway),
        approvals: new ApprovalService({ store, audit, now: clock.now, newId: ids }),
        audit,
        logger: silentLogger,
        now: clock.now,
        newId: ids,
        visaAllowlist: () => [],
        events: platform.events,
        context: platform.context,
        knowledge: platform.knowledge,
        quality: platform.quality,
        collaboration: new MemoryCollaborationStore(),
      });
    };
    const first = build();
    const { runId } = await first.startWorkflow(startInput({ idempotencyKey: "session-key-01" }));
    await first.tick({ limit: 2 });

    const second = build();
    await drive(second);
    const s = await statusOf(store, runId);
    // The second instance carried the run to the first human decision: the owner's review of the compliance output.
    expect(s.research).toBe("succeeded");
    expect(s.compliance).toBe("waiting_approval");
  });
});

describe("other workflows", () => {
  it("visa intelligence passes only when every source is on the owner's allowlist", async () => {
    const extraction = {
      requirements: [
        {
          destination: "France",
          item: "Passport validity",
          source_url: "https://www.diplomatie.gouv.fr/fr/services-aux-etrangers",
          last_checked: "2026-11-15",
          verified_by_official_source: true,
        },
      ],
    };
    const provider = () =>
      new ScriptedProvider("scripted", (req) => (agentNameIn(req.system) === "Visa Research Agent" ? JSON.stringify(extraction) : JSON.stringify(req.mockOutput)));
    const cfg = { id: "scripted", kind: "mock" as const, costTier: "free" as const, enabled: true, ownerApproved: true, dailyRequestLimit: 1000 };

    const allowed = makeHarness({ providers: [{ config: cfg, provider: provider() }], visaAllowlist: ["www.diplomatie.gouv.fr"] });
    const ok = await allowed.orch.startWorkflow(startInput({ workflowKey: "visa", idempotencyKey: "visa-key-allowed" }));
    await drive(allowed.orch);
    expect((await statusOf(allowed.store, ok.runId)).source_validation).toBe("succeeded");

    const blocked = makeHarness({ providers: [{ config: cfg, provider: provider() }], visaAllowlist: [] });
    const bad = await blocked.orch.startWorkflow(startInput({ workflowKey: "visa", idempotencyKey: "visa-key-blocked" }));
    await drive(blocked.orch);
    const sb = await statusOf(blocked.store, bad.runId);
    // An official-looking source outside the allowlist needs the owner's review before validation runs.
    expect(sb.source_discovery).toBe("waiting_approval");
    expect(sb.source_validation).toBe("pending");
    // Each visa step that reports such a claim needs its own review. The owner approves each one in turn.
    for (let i = 0; i < 5; i++) {
      const [review] = await blocked.store.listApprovals("pending");
      if (!review) break;
      expect(review.actionClass).toBe("propose_change");
      await blocked.orch.decideApproval(review.id, "approved", OWNER, null);
      await drive(blocked.orch);
    }
    const after = await statusOf(blocked.store, bad.runId);
    expect(after.source_validation).toBe("failed");
    expect(after.structured_report).toBe("blocked");
  });

  it("analytics aggregates counts deterministically and reports on them", async () => {
    const h = makeHarness();
    const { runId } = await h.orch.startWorkflow(
      startInput({
        workflowKey: "analytics",
        idempotencyKey: "analytics-key-1",
        aggregates: [
          { status: "new", count: 4 },
          { status: "approved", count: 1 },
        ],
      }),
    );
    await drive(h.orch);
    const s = await statusOf(h.store, runId);
    expect(s.aggregation).toBe("succeeded");
    expect(s.executive_report).toBe("succeeded");
    const agg = (await h.store.listArtifacts(50)).find((a) => a.kind === "analytics.aggregate");
    expect(agg?.body).toMatchObject({ total: 5, conversionToApproved: 20 });
  });
});
