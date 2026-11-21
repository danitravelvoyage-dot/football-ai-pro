import { describe, it, expect } from "vitest";
import { decideGate } from "@/lib/ai/collaboration/gate";
import type { QualityIssue } from "@/lib/ai/quality/types";

const clean = { producer: "MarketResearchAgent", outputKind: "research", output: { findings: [{ insight: "Demand rose in spring.", evidence: "Survey of 120 applicants." }] } };
const blocking = { producer: "MarketResearchAgent", outputKind: "research", output: { findings: [{ insight: "Guaranteed visa approval in one week.", evidence: "Our promise." }] } };
const issue = (severity: QualityIssue["severity"]): QualityIssue => ({ code: "x", dimension: "completeness", severity, path: "p" });

describe("quality gate: two independent reviewers, no self-review", () => {
  it("passes an output that both reviewers approve", () => {
    const g = decideGate({ ...clean, controllerStatus: "PASSED", controllerIssues: [], attempt: 1 });
    expect(g.status).toBe("PASSED");
    expect(g.consensus.counted).toEqual(["QualityController", "ComplianceAgent"]);
  });

  it("always has two independent votes for a non-compliance producer", () => {
    const g = decideGate({ ...clean, controllerStatus: "PASSED", controllerIssues: [], attempt: 1 });
    expect(g.votes.map((v) => v.reviewer)).toEqual(["QualityController", "ComplianceAgent"]);
    expect(g.consensus.excluded).toEqual([]);
  });

  it("a compliance agent's output has no independent second reviewer, so it goes to the owner", () => {
    const g = decideGate({ producer: "ComplianceAgent", outputKind: "research", output: clean.output, controllerStatus: "PASSED", controllerIssues: [], attempt: 1 });
    expect(g.consensus.excluded).toEqual([{ reviewer: "ComplianceAgent", reason: "self_review" }]);
    expect(g.status).toBe("REQUIRES_HUMAN_REVIEW");
  });

  it("a compliance agent's output that the controller rejects is still rejected", () => {
    const g = decideGate({ producer: "ComplianceAgent", outputKind: "research", output: clean.output, controllerStatus: "REJECTED", controllerIssues: [issue("critical")], attempt: 1 });
    expect(g.status).toBe("REJECTED");
  });
});

describe("quality gate: blocking violations and disagreement", () => {
  it("a blocking compliance violation rejects, even when the controller passed it", () => {
    const g = decideGate({ ...blocking, controllerStatus: "PASSED", controllerIssues: [], attempt: 1 });
    expect(g.status).toBe("REJECTED");
    expect(g.consensus.reasons).toContain("veto:ComplianceAgent");
  });

  it("an approval from the controller against a revision request from compliance sends the output back", () => {
    // "testimonial" is a warning-level compliance flag: the compliance lens asks for revision.
    const warned = { ...clean, output: { findings: [{ insight: "We have a testimonial from a client.", evidence: "Page." }] } };
    const g = decideGate({ ...warned, controllerStatus: "PASSED", controllerIssues: [], attempt: 1 });
    expect(g.votes.find((v) => v.reviewer === "ComplianceAgent")?.verdict).toBe("revise");
    expect(g.consensus.reasons).toEqual(["revision_requested"]);
    expect(g.status).toBe("NEEDS_REVISION");
  });

  it("a schema rejection that compliance approves is a disagreement, and goes to the owner", () => {
    const schema: QualityIssue = { code: "schema_failure", dimension: "schema_validity", severity: "blocking", path: "findings" };
    const g = decideGate({ ...clean, controllerStatus: "REJECTED", controllerIssues: [schema], attempt: 1 });
    expect(g.consensus.reasons).toEqual(["reviewers_disagree"]);
    expect(g.status).toBe("REQUIRES_HUMAN_REVIEW");
  });

  it("a rejection that only comes from the revision limit is a revision request, not a disagreement, and stays rejected", () => {
    const g = decideGate({ ...clean, controllerStatus: "REJECTED", controllerIssues: [issue("blocking")], attempt: 3 });
    expect(g.votes.find((v) => v.reviewer === "QualityController")?.verdict).toBe("revise");
    expect(g.consensus.reasons).toEqual(["revision_requested"]);
    expect(g.status).toBe("REJECTED");
  });

  it("the more severe of the controller and the panel wins", () => {
    const g = decideGate({ ...clean, controllerStatus: "REQUIRES_HUMAN_REVIEW", controllerIssues: [issue("critical")], attempt: 1 });
    expect(g.status).toBe("REQUIRES_HUMAN_REVIEW");
  });

  it("a controller revision request is kept when compliance is satisfied, and is not silently approved", () => {
    const g = decideGate({ ...clean, controllerStatus: "NEEDS_REVISION", controllerIssues: [issue("blocking")], attempt: 1 });
    expect(["NEEDS_REVISION", "REQUIRES_HUMAN_REVIEW"]).toContain(g.status);
    expect(g.status).not.toBe("PASSED");
  });
});

describe("quality gate: loop prevention", () => {
  it("a revision that exceeds the attempt limit becomes a rejection, so revisions cannot loop", () => {
    const g = decideGate({ ...clean, output: { findings: [{ insight: "Please call our office for details.", evidence: "Page." }] }, controllerStatus: "NEEDS_REVISION", controllerIssues: [issue("blocking")], attempt: 99 });
    expect(g.status).not.toBe("NEEDS_REVISION");
  });
});
