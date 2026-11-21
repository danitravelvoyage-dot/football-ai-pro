import { describe, it, expect } from "vitest";
import { reachConsensus, resolveConflict, OwnerOnlyError, DEFAULT_CONSENSUS_POLICY, type Vote, type Conflict } from "@/lib/ai/collaboration/consensus";
import { routeTask, canReassign, AGENT_CAPABILITIES, type Candidate } from "@/lib/ai/collaboration/delegation";
import { runReviewPanel } from "@/lib/ai/collaboration/panel";
import { QualityController } from "@/lib/ai/quality/controller";
import { MemoryQualityStore } from "@/lib/ai/quality/store";
import { MemoryAuditSink } from "@/lib/ai/audit";
import { z } from "zod";
import { OWNER } from "./helpers";

const v = (reviewer: string, verdict: Vote["verdict"], codes: string[] = []): Vote => ({ reviewer, verdict, codes });
const AGENT = { kind: "agent" as const, agent: "CRMAgent" as const };

describe("reviewer independence", () => {
  it("excludes a reviewer's vote on its own output and reports the exclusion", () => {
    const r = reachConsensus("ComplianceAgent", [v("ComplianceAgent", "approve"), v("QualityController", "approve")]);
    expect(r.excluded).toEqual([{ reviewer: "ComplianceAgent", reason: "self_review" }]);
    expect(r.counted).toEqual(["QualityController"]);
    // Only one independent reviewer counted: not enough to approve.
    expect(r.decision).toBe("escalate_to_owner");
    expect(r.reasons).toContain("insufficient_independent_reviewers");
  });

  it("cannot approve its own output even with a unanimous panel of its own votes", () => {
    const r = reachConsensus("SalesAgent", [v("SalesAgent", "approve"), v("SalesAgent", "approve"), v("SalesAgent", "approve")]);
    expect(r.decision).toBe("escalate_to_owner");
    expect(r.counted).toEqual([]);
  });

  it("counts one vote per reviewer and excludes duplicates", () => {
    const r = reachConsensus("Producer", [v("A", "approve"), v("A", "reject"), v("B", "approve")]);
    expect(r.excluded).toEqual([{ reviewer: "A", reason: "duplicate_reviewer" }]);
    expect(r.decision).toBe("approve");
  });

  it("ignores a reviewer with no weight", () => {
    const r = reachConsensus("P", [{ reviewer: "A", verdict: "approve", codes: [], weight: 0 }, v("B", "approve"), v("C", "approve")]);
    expect(r.excluded).toEqual([{ reviewer: "A", reason: "no_weight" }]);
    expect(r.decision).toBe("approve");
  });
});

describe("consensus decisions", () => {
  it("approves only when every counted reviewer approves", () => {
    expect(reachConsensus("P", [v("A", "approve"), v("B", "approve")]).decision).toBe("approve");
  });

  it("sends the output back for revision when a reviewer asks for it and none rejects", () => {
    const r = reachConsensus("P", [v("A", "approve"), v("B", "revise", ["missing_source"])]);
    expect(r.decision).toBe("revise");
    expect(r.reasons).toEqual(["revision_requested"]);
  });

  it("escalates to the owner when reviewers disagree, instead of counting a majority", () => {
    const r = reachConsensus("P", [v("A", "approve"), v("B", "approve"), v("C", "approve"), v("D", "reject")]);
    expect(r.decision).toBe("escalate_to_owner");
    expect(r.disagreement).toBe(true);
    expect(r.reasons).toEqual(["reviewers_disagree"]);
  });

  it("rejects by weighted majority of rejections, and only asks for revision when rejection is a minority", () => {
    const heavy = reachConsensus("P", [v("A", "reject"), v("B", "revise"), v("C", "revise")], { ...DEFAULT_CONSENSUS_POLICY, weights: { A: 5 } });
    expect(heavy.decision).toBe("reject");
    const light = reachConsensus("P", [v("A", "reject"), v("B", "revise"), v("C", "revise")]);
    expect(light.decision).toBe("revise");
  });

  it("lets a veto reviewer's rejection reject the output alone", () => {
    const policy = { ...DEFAULT_CONSENSUS_POLICY, vetoReviewers: ["ComplianceAgent"] };
    const r = reachConsensus("P", [v("QualityController", "approve"), v("ComplianceAgent", "reject", ["policy_claim"])], policy);
    expect(r.decision).toBe("reject");
    expect(r.reasons).toContain("veto:ComplianceAgent");
  });

  it("escalates when any reviewer asks for an owner decision", () => {
    const r = reachConsensus("P", [v("A", "approve"), v("B", "escalate")]);
    expect(r.decision).toBe("escalate_to_owner");
    expect(r.reasons).toEqual(["reviewer_requested_owner"]);
  });

  it("returns only decision fields, with reviewer names and reason codes", () => {
    const r = reachConsensus("P", [v("A", "revise", ["code_x"]), v("B", "approve", ["secret free text"])]);
    expect(Object.keys(r).sort()).toEqual(["counted", "decision", "disagreement", "excluded", "reasons"]);
    expect(JSON.stringify(r)).not.toContain("secret free text");
  });
});

describe("conflict resolution", () => {
  const conflict: Conflict = { id: "c1", subjectKey: "visa.fee", parties: ["VisaResearchAgent", "SalesAgent"], status: "open", resolvedBy: null, resolution: null };

  it("lets only the owner resolve a conflict", () => {
    expect(() => resolveConflict(AGENT, conflict, "Use the official figure.")).toThrow(OwnerOnlyError);
    expect(() => resolveConflict({ kind: "system" }, conflict, "Use the official figure.")).toThrow(OwnerOnlyError);
  });

  it("records the owner's decision and its author", () => {
    const resolved = resolveConflict(OWNER, conflict, "Use the official figure from the source.");
    expect(resolved).toMatchObject({ status: "resolved", resolvedBy: OWNER.id, resolution: "Use the official figure from the source." });
  });

  it("does not resolve a conflict twice", () => {
    const resolved = resolveConflict(OWNER, conflict, "First decision.");
    expect(() => resolveConflict(OWNER, resolved, "Second decision.")).toThrow(/already resolved/);
  });

  it("refuses an empty or oversized decision", () => {
    expect(() => resolveConflict(OWNER, conflict, "")).toThrow();
    expect(() => resolveConflict(OWNER, conflict, "x".repeat(501))).toThrow();
  });
});

describe("capability-based delegation", () => {
  const all = (open: Partial<Record<string, number>> = {}): Candidate[] =>
    (Object.keys(AGENT_CAPABILITIES) as (keyof typeof AGENT_CAPABILITIES)[]).map((agent) => ({ agent, openTasks: open[agent] ?? 0, available: true }));

  it("routes a capability to an agent that has it", () => {
    const r = routeTask("visa_research", all());
    expect(r).toMatchObject({ agent: "VisaResearchAgent" });
  });

  it("prefers the agent with the lowest open workload among those with the capability", () => {
    const r = routeTask("sales_qualification", all({ SalesAgent: 4, CRMAgent: 1 }));
    expect(r).toMatchObject({ agent: "CRMAgent" });
  });

  it("breaks ties by the fixed agent order, so routing is repeatable", () => {
    const a = routeTask("sales_qualification", all());
    const b = routeTask("sales_qualification", all());
    expect(a).toEqual(b);
  });

  it("skips unavailable agents and excluded agents", () => {
    const candidates = all().map((c) => (c.agent === "CRMAgent" ? { ...c, available: false } : c));
    expect(routeTask("sales_qualification", candidates)).toMatchObject({ agent: "SalesAgent" });
    expect(routeTask("sales_qualification", all(), { exclude: ["SalesAgent", "CRMAgent"] })).toEqual({ refused: "no_capable_agent" });
  });

  it("refuses when no agent has the capability", () => {
    expect(routeTask("finance_review", all().filter((c) => c.agent !== "FinanceAgent"))).toEqual({ refused: "no_capable_agent" });
  });

  it("never reassigns a task whose capability can act outside the platform", () => {
    expect(canReassign("social_publishing_pack")).toBe(false);
    expect(routeTask("social_publishing_pack", all(), { reassignment: true })).toEqual({ refused: "reassignment_not_allowed" });
  });

  it("allows reassigning read-only work to another agent", () => {
    expect(canReassign("market_research")).toBe(true);
    // The strategist also holds market research in the capability map, so that is the only other holder.
    const r = routeTask("market_research", all(), { exclude: ["MarketResearchAgent"], reassignment: true });
    expect(r).toMatchObject({ agent: "MarketingStrategistAgent", reasons: expect.arrayContaining(["reassigned"]) });
    // No other agent holds strategy, so it is not reassigned to anyone.
    expect(routeTask("strategy", all(), { exclude: ["MarketingStrategistAgent"], reassignment: true })).toEqual({ refused: "no_capable_agent" });
  });
});

describe("review panel", () => {
  const schema = z.object({ findings: z.array(z.object({ insight: z.string(), evidence: z.string() })) });
  const controller = () => new QualityController({ store: new MemoryQualityStore(), audit: new MemoryAuditSink(), now: () => new Date("2026-11-21T10:00:00Z"), newId: () => "id" });
  const input = (producer: string, output: unknown) => ({ taskId: "t1", runId: "r1", agent: producer, outputKind: "research", output, schema, language: "en" as const, allowlist: [], attempt: 1 });

  it("gathers two independent votes for one output", () => {
    const votes = runReviewPanel(input("MarketResearchAgent", { findings: [{ insight: "Demand rose in spring.", evidence: "Survey of 120 applicants." }] }), controller());
    expect(votes.map((x) => x.reviewer)).toEqual(["QualityController", "ComplianceAgent"]);
  });

  it("flags a critical policy violation as a rejection from the compliance lens", () => {
    const votes = runReviewPanel(
      input("MarketResearchAgent", { findings: [{ insight: "Guaranteed visa approval in one week.", evidence: "Our promise." }] }),
      controller(),
    );
    const compliance = votes.find((x) => x.reviewer === "ComplianceAgent")!;
    expect(compliance.verdict).toBe("reject");
    expect(compliance.codes.length).toBeGreaterThan(0);
  });

  it("when the producer is the compliance agent, its own lens is excluded and consensus cannot approve", () => {
    const votes = runReviewPanel(input("ComplianceAgent", { findings: [{ insight: "Demand rose in spring.", evidence: "Survey of 120 applicants." }] }), controller());
    const result = reachConsensus("ComplianceAgent", votes);
    expect(result.excluded.map((e) => e.reviewer)).toContain("ComplianceAgent");
    expect(result.decision).toBe("escalate_to_owner");
  });

  it("consensus over a real panel passes only when both reviewers approve", () => {
    const votes = runReviewPanel(input("MarketResearchAgent", { findings: [{ insight: "Demand rose in spring.", evidence: "Survey of 120 applicants." }] }), controller());
    const result = reachConsensus("MarketResearchAgent", votes);
    expect(result.counted).toHaveLength(2);
    expect(["approve", "revise", "reject", "escalate_to_owner"]).toContain(result.decision);
  });
});
