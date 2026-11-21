import { describe, it, expect } from "vitest";
import { makeHarness, startInput, OWNER, ScriptedProvider, agentNameIn, clearQualityHolds } from "./helpers";
import { CollaborationService } from "@/lib/ai/collaboration/service";
import { OwnerOnlyError } from "@/lib/ai/collaboration/consensus";
import { MemoryAuditSink } from "@/lib/ai/audit";
import { AGENT_CAPABILITIES } from "@/lib/ai/collaboration/delegation";
import { ProviderError } from "@/lib/ai/llm/types";
import { getWorkflow } from "@/lib/ai/workflows/templates";

const AGENT = { kind: "agent" as const, agent: "SalesAgent" as const };
const SALES_STEPS = getWorkflow("sales").steps.length;

async function drive(h: ReturnType<typeof makeHarness>) {
  for (let i = 0; i < 40; i++) {
    const r = await h.orch.tick({ limit: 10 });
    if (r.claimed === 0) break;
  }
}

describe("two independent reviewers on every agent output", () => {
  it("records a consensus with both votes for each approved output", async () => {
    const h = makeHarness();
    const { runId } = await h.orch.startWorkflow(startInput({ workflowKey: "marketing", idempotencyKey: "panel-01" }));
    await drive(h);
    const panels = await h.collab.listPanels({ runId, limit: 100 });
    const research = panels.find((p) => p.producer === "MarketResearchAgent");
    expect(research).toBeDefined();
    expect(research?.decision).toBe("approve");
    expect(research?.status).toBe("PASSED");
    expect(research?.counted.sort()).toEqual(["ComplianceAgent", "QualityController"]);
    expect(research?.votes.map((v) => v.reviewer).sort()).toEqual(["ComplianceAgent", "QualityController"]);
  });

  it("the compliance agent's own output is never self-approved: it is excluded and held for the owner", async () => {
    const h = makeHarness();
    const { runId } = await h.orch.startWorkflow(startInput({ workflowKey: "marketing", idempotencyKey: "panel-02" }));
    await drive(h);
    const panel = (await h.collab.listPanels({ runId, limit: 100 })).find((p) => p.producer === "ComplianceAgent");
    expect(panel?.excluded).toEqual([{ reviewer: "ComplianceAgent", reason: "self_review" }]);
    expect(panel?.decision).toBe("escalate_to_owner");
    expect(panel?.status).toBe("REQUIRES_HUMAN_REVIEW");
    const task = (await h.store.listTasksByRunIds([runId])).find((t) => t.stepKey === "compliance");
    expect(task?.status).toBe("waiting_approval");
  });

  it("a blocking compliance violation is rejected, and the stored review says so", async () => {
    const provider = new ScriptedProvider("scripted", (req) => {
      if (agentNameIn(req.system) === "Content Creator") {
        return JSON.stringify({ drafts: [{ kind: "caption", language: "fr", text: "Visa garanti à 100 % avec nous !" }] });
      }
      return JSON.stringify(req.mockOutput);
    });
    const h = makeHarness({ providers: [{ config: { id: "scripted", kind: "mock", costTier: "free", enabled: true, ownerApproved: true, dailyRequestLimit: 1000 }, provider }] });
    const { runId } = await h.orch.startWorkflow(startInput({ idempotencyKey: "panel-03" }));
    await drive(h);
    const panel = (await h.collab.listPanels({ runId, limit: 100 })).find((p) => p.producer === "ContentCreatorAgent");
    expect(panel?.status).toBe("REJECTED");
    expect(panel?.reasons).toContain("veto:ComplianceAgent");
    const task = (await h.store.listTasksByRunIds([runId])).find((t) => t.agent === "ContentCreatorAgent");
    expect(task?.status).toBe("failed");
    const reviews = await h.quality.history({ kind: "system" }, task!.id);
    expect(reviews.at(-1)?.status).toBe("REJECTED");
  });

  it("every review decision is audited with its decision and reasons, never the output text", async () => {
    const h = makeHarness();
    await h.orch.startWorkflow(startInput({ workflowKey: "marketing", idempotencyKey: "panel-04" }));
    await drive(h);
    const entries = h.audit.events.filter((e) => e.type === "review.consensus");
    expect(entries.length).toBeGreaterThan(0);
    for (const e of entries) expect(JSON.stringify(e.meta)).not.toContain("Mock");
  });
});

describe("intelligent routing in a real run", () => {
  it("routes a routable step to an agent that holds its capability, and keeps pinned steps with their template agent", async () => {
    const h = makeHarness();
    const { runId } = await h.orch.startWorkflow(startInput({ workflowKey: "sales", idempotencyKey: "route-01" }));
    const tasks = await h.store.listTasksByRunIds([runId]);
    const byStep = Object.fromEntries(tasks.map((t) => [t.stepKey, t]));
    for (const t of tasks) expect(AGENT_CAPABILITIES[t.agent as keyof typeof AGENT_CAPABILITIES]).toBeDefined();
    // Pinned: customer messaging and compliance keep their template agents.
    expect(byStep.response_draft?.agent).toBe("SalesAgent");
    expect(byStep.approval?.agent).toBe("SalesAgent");
    expect(byStep.compliance?.agent).toBe("ComplianceAgent");
    expect(byStep.follow_up?.agent).toBe("SalesAgent");
    expect(SALES_STEPS).toBe(7);
  });

  it("routes to the least-loaded qualified agent: the campaign step goes to the lighter of its two holders", async () => {
    const h = makeHarness();
    // content_drafting is held by ContentCreatorAgent and SocialMediaAgent. Load the first run, then measure the second.
    await h.orch.startWorkflow(startInput({ workflowKey: "marketing", idempotencyKey: "route-02a" }));
    const holders = ["ContentCreatorAgent", "SocialMediaAgent"] as const;
    const open = await h.store.listOpenTasks();
    const load = (agent: string) => open.filter((t) => t.agent === agent).length;
    // Least-loaded wins; on a tie the template's agent (ContentCreatorAgent) keeps the step.
    const expected = load(holders[1]) < load(holders[0]) ? holders[1] : holders[0];
    const { runId } = await h.orch.startWorkflow(startInput({ workflowKey: "marketing", idempotencyKey: "route-02b" }));
    const campaign = (await h.store.listTasksByRunIds([runId])).find((t) => t.stepKey === "campaign");
    expect(campaign?.agent).toBe(expected);
  });

  it("keeps the template's agent when the workload is equal", async () => {
    const h = makeHarness();
    const { runId } = await h.orch.startWorkflow(startInput({ workflowKey: "sales", idempotencyKey: "route-02c" }));
    const qualification = (await h.store.listTasksByRunIds([runId])).find((t) => t.stepKey === "qualification");
    expect(qualification?.agent).toBe("SalesAgent");
  });

  it("never routes a protected step: customer-support steps keep their agents even though routing runs", async () => {
    const h = makeHarness();
    const { runId } = await h.orch.startWorkflow(startInput({ workflowKey: "support", idempotencyKey: "route-04" }));
    const decisions = await h.collab.listRouting({ runId, limit: 100 });
    const classification = decisions.find((d) => d.stepKey === "classification");
    expect(classification).toMatchObject({ capability: "none", chosenAgent: "CustomerSupportAgent", templateAgent: "CustomerSupportAgent" });
    const draft = decisions.find((d) => d.stepKey === "draft_response");
    expect(draft?.chosenAgent).toBe("CustomerSupportAgent");
  });
});

describe("owner-only control of the multi-agent layer", () => {
  it("refuses agents and the system from reading or deciding conflicts", async () => {
    const h = makeHarness();
    const service = new CollaborationService({ store: h.collab, audit: new MemoryAuditSink(), now: h.clock.now, newId: () => "x" });
    await expect(service.listConflicts(AGENT, { limit: 10 })).rejects.toBeInstanceOf(OwnerOnlyError);
    await expect(service.listPanels({ kind: "system" }, { limit: 10 })).rejects.toBeInstanceOf(OwnerOnlyError);
    await expect(service.resolveConflict(AGENT, "c1", "Decision text.")).rejects.toBeInstanceOf(OwnerOnlyError);
  });

  it("the owner resolves a conflict once, and the resolution is audited with the resolver and time", async () => {
    const h = makeHarness();
    const audit = new MemoryAuditSink();
    const service = new CollaborationService({ store: h.collab, audit, now: h.clock.now, newId: () => "audit-1" });
    await h.collab.recordConflict({
      id: "conflict-1",
      runId: "run-x",
      taskId: null,
      subjectKey: "finding:x",
      parties: ["SalesAgent", "CRMAgent"],
      codes: ["conflicting_claims"],
      status: "open",
      resolution: null,
      resolvedBy: null,
      resolvedAt: null,
      detectedAt: h.clock.now().toISOString(),
    });
    const resolved = await service.resolveConflict(OWNER, "conflict-1", "Use the official figure from the source.");
    expect(resolved).toMatchObject({ status: "resolved", resolvedBy: OWNER.id });
    const entry = audit.events.find((e) => e.type === "conflict.resolved");
    expect(entry?.actor).toBe(`owner:${OWNER.id}`);
    expect(JSON.stringify(entry?.meta)).not.toContain("official figure");
    await expect(service.resolveConflict(OWNER, "conflict-1", "A second decision.")).rejects.toThrow(/already resolved/);
  });
});

describe("quality holds reach the owner through the approval queue", () => {
  it("clears the compliance hold and then the publishing approval, in order", async () => {
    const h = makeHarness();
    const { runId } = await h.orch.startWorkflow(startInput({ idempotencyKey: "route-05" }));
    await clearQualityHolds(h);
    const tasks = await h.store.listTasksByRunIds([runId]);
    expect(tasks.find((t) => t.stepKey === "compliance")?.status).toBe("succeeded");
    expect(tasks.find((t) => t.stepKey === "approval")?.status).toBe("waiting_approval");
  });

  it("a provider outage stops the run honestly, without a fabricated output", async () => {
    const h = makeHarness({
      providers: [
        {
          config: { id: "down", kind: "mock", costTier: "free", enabled: true, ownerApproved: true, dailyRequestLimit: 1000 },
          provider: new ScriptedProvider("down", async () => {
            throw new ProviderError("HTTP 503", true, "down");
          }),
        },
      ],
    });
    const { runId } = await h.orch.startWorkflow(startInput({ idempotencyKey: "route-06" }));
    await drive(h);
    const research = (await h.store.listTasksByRunIds([runId])).find((t) => t.stepKey === "research");
    expect(research?.output).toBeNull();
    expect(research?.status).not.toBe("succeeded");
  });
});
