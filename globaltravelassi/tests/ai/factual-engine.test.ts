import { describe, it, expect } from "vitest";
import { makeHarness, startInput, ScriptedProvider, agentNameIn, OWNER } from "./helpers";
import { MockProvider } from "@/lib/ai/llm/mock-provider";

/**
 * Factual validation inside the real engine: the research and visa outputs of a scripted model are checked against the
 * owner's approved sources and memory, and each outcome is what the brief requires. Two independent reviewers still
 * vote, but a factual verdict cannot be outvoted.
 */

const CONFIG = { id: "scripted", kind: "mock" as const, costTier: "free" as const, enabled: true, ownerApproved: true, dailyRequestLimit: 1000 };
const APPROVED = ["official.example.dz"];

function scripted(reply: (agent: string) => string) {
  const mock = new MockProvider("scripted");
  return new ScriptedProvider("scripted", async (req) => {
    const agent = agentNameIn(req.system);
    const custom = reply(agent);
    return custom || (await mock.complete(req)).text;
  });
}

async function drive(h: ReturnType<typeof makeHarness>) {
  for (let i = 0; i < 40; i++) {
    const r = await h.orch.tick({ limit: 10 });
    if (r.claimed === 0) break;
  }
}

async function researchTask(h: ReturnType<typeof makeHarness>, runId: string) {
  return (await h.store.listTasksByRunIds([runId])).find((t) => t.stepKey === "research")!;
}

const research = (findings: unknown[]) => JSON.stringify({ findings });

describe("research: fabricated, unsupported and unverified sources", () => {
  it("a fabricated source (a well-formed address with a port the owner never approved) is refused", async () => {
    const provider = scripted((agent) => (agent === "Market Research Agent" ? research([{ insight: "Demand rose in spring.", evidence: "Survey.", confidence: "medium", sources: ["https://official.example.dz:9/survey"] }]) : ""));
    const h = makeHarness({ providers: [{ config: CONFIG, provider }], visaAllowlist: APPROVED });
    const { runId } = await h.orch.startWorkflow(startInput({ idempotencyKey: "fact-fab-01" }));
    await drive(h);
    const task = await researchTask(h, runId);
    expect(task.status).toBe("failed");
    expect(task.output).toBeNull();
    expect((await h.store.listArtifacts(100)).some((a) => a.agent === "MarketResearchAgent")).toBe(false);
    expect(h.audit.events.some((e) => e.type === "review.factual" && JSON.stringify(e.meta).includes("non_default_port"))).toBe(true);
  });

  it("a well-formed source the owner has not approved is escalated to the owner, not stored", async () => {
    const provider = scripted((agent) => (agent === "Market Research Agent" ? research([{ insight: "Demand rose in spring.", evidence: "Survey.", confidence: "medium", sources: ["https://made-up-agency.example.com/rules"] }]) : ""));
    const h = makeHarness({ providers: [{ config: CONFIG, provider }], visaAllowlist: APPROVED });
    const { runId } = await h.orch.startWorkflow(startInput({ idempotencyKey: "fact-unapproved-01" }));
    await drive(h);
    const task = await researchTask(h, runId);
    expect(task.status).toBe("waiting_approval");
    expect((await h.store.listApprovals("pending")).some((a) => a.taskId === task.id && a.actionClass === "propose_change")).toBe(true);
    expect(task.output).not.toBeNull();
  });

  it("a finding with no evidence gets a revision request, then is refused: nothing unsupported is stored", async () => {
    const provider = scripted((agent) => (agent === "Market Research Agent" ? research([{ insight: "Demand doubles every month.", evidence: "Trust us.", confidence: "low", sources: [] }]) : ""));
    const h = makeHarness({ providers: [{ config: CONFIG, provider }], visaAllowlist: APPROVED });
    const { runId } = await h.orch.startWorkflow(startInput({ idempotencyKey: "fact-missing-01" }));
    await drive(h);
    const task = await researchTask(h, runId);
    expect(task.status).toBe("failed");
    const reviews = await h.quality.history({ kind: "system" }, task.id);
    expect(reviews.map((r) => r.status)).toEqual(["NEEDS_REVISION", "NEEDS_REVISION", "REJECTED"]);
    expect((await h.store.listArtifacts(100)).some((a) => a.agent === "MarketResearchAgent")).toBe(false);
  });

  it("a finding with a source on the owner's approved list is verified and stored", async () => {
    const provider = scripted((agent) => (agent === "Market Research Agent" ? research([{ insight: "Demand rose in spring.", evidence: "Official checklist.", confidence: "medium", sources: ["https://official.example.dz/checklist"] }]) : ""));
    const h = makeHarness({ providers: [{ config: CONFIG, provider }], visaAllowlist: APPROVED });
    const { runId } = await h.orch.startWorkflow(startInput({ idempotencyKey: "fact-valid-01" }));
    await drive(h);
    const task = await researchTask(h, runId);
    expect(task.status).toBe("succeeded");
    const artifacts = await h.store.listArtifacts(100);
    expect(artifacts.some((a) => a.agent === "MarketResearchAgent")).toBe(true);
    const review = (await h.quality.history({ kind: "system" }, task.id)).at(-1);
    expect(review?.status).toBe("PASSED");
  });
});

describe("contradictory business memory", () => {
  it("a visa claim that contradicts the owner's memory is escalated, not accepted", async () => {
    const requirement = {
      destination: "FR",
      item: "Passport valid 6 months",
      source_url: "https://official.example.dz/visa/passport",
      last_checked: "2026-11-20",
      verified_by_official_source: true,
    };
    const provider = scripted((agent) => (agent === "Visa Research Agent" ? JSON.stringify({ requirements: [requirement] }) : ""));
    const h = makeHarness({
      providers: [{ config: CONFIG, provider }],
      visaAllowlist: APPROVED,
      briefing: async () => [{ scope: "company", key: "visa:FR|passport valid 6 months", value: "Passport valid 3 months" }],
    });
    const { runId } = await h.orch.startWorkflow(startInput({ workflowKey: "visa", idempotencyKey: "fact-memory-01" }));
    await drive(h);
    const tasks = await h.store.listTasksByRunIds([runId]);
    expect(tasks.some((t) => t.status === "waiting_approval")).toBe(true);
    expect(h.audit.events.some((e) => e.type === "review.factual" && JSON.stringify(e.meta).includes("contradicts_memory"))).toBe(true);
  });

  it("a visa claim that agrees with the owner's memory is not escalated for memory", async () => {
    const requirement = {
      destination: "FR",
      item: "Passport valid 6 months",
      source_url: "https://official.example.dz/visa/passport",
      last_checked: "2026-11-20",
      verified_by_official_source: true,
    };
    const provider = scripted((agent) => (agent === "Visa Research Agent" ? JSON.stringify({ requirements: [requirement] }) : ""));
    const h = makeHarness({
      providers: [{ config: CONFIG, provider }],
      visaAllowlist: APPROVED,
      briefing: async () => [{ scope: "company", key: "visa:FR|passport valid 6 months", value: "Passport valid 6 months" }],
    });
    await h.orch.startWorkflow(startInput({ workflowKey: "visa", idempotencyKey: "fact-memory-02" }));
    await drive(h);
    expect(h.audit.events.some((e) => e.type === "review.factual" && JSON.stringify(e.meta).includes("contradicts_memory"))).toBe(false);
  });
});

export { OWNER };
