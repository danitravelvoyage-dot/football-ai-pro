import { describe, it, expect } from "vitest";
import { AGENT_REGISTRY } from "@/lib/ai/registry";
import { claimsOf } from "@/lib/ai/quality/extract";

/**
 * Documented limitation, pinned so a change is noticed. Cross-agent conflicts are detected only between claims from
 * different agents about the same subject. In the current registry:
 *  - only two output kinds produce claims ("research" and "visa");
 *  - each of those kinds is produced by exactly one agent, so two agents can never disagree on one claim;
 *  - research claims carry no comparable value, so even two producers of the same insight cannot contradict.
 * Making conflicts reachable needs a claim taxonomy (a subject and a value in each output), which changes agent output
 * contracts. That is a design decision, recorded in PROJECT_STATUS. When it is made, these tests should be replaced.
 */

const CLAIM_KINDS = ["research", "visa"] as const;

describe("cross-agent conflicts: the current reachability limit", () => {
  it("each claim-producing output kind has exactly one agent, so no two agents can disagree on a claim", () => {
    for (const kind of CLAIM_KINDS) {
      const producers = Object.values(AGENT_REGISTRY).filter((d) => d.outputKind === kind).map((d) => d.key);
      expect(producers, kind).toHaveLength(1);
    }
  });

  it("research claims carry no value, so the contradiction check cannot compare them", () => {
    const claims = claimsOf("MarketResearchAgent", "research", { findings: [{ insight: "Demand rose.", evidence: "Survey." }] });
    expect(claims.every((c) => c.value === undefined)).toBe(true);
  });
});
