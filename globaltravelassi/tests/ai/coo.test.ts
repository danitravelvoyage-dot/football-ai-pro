import { describe, it, expect } from "vitest";
import { buildExecutiveReport, externalStatusFor, planWorkflow, verifyReportHonesty } from "@/lib/ai/coo";
import type { ApprovalRecord, TaskRecord } from "@/lib/ai/orchestration/records";

const now = new Date("2026-11-20T09:00:00Z");

function task(id: string, status: TaskRecord["status"], extra: Partial<TaskRecord> = {}): TaskRecord {
  return {
    id,
    runId: "run-1",
    workflowKey: "marketing",
    stepKey: id,
    agent: "ContentCreatorAgent",
    title: id,
    status,
    priority: 5,
    dueAt: null,
    dependsOn: [],
    input: { objective: "o", language: "fr", country: "dz", brief: "", data: {}, aggregates: [], upstream: [], context: [], knowledge: [] },
    output: null,
    actionClass: null,
    requiresApproval: false,
    attempts: 1,
    maxAttempts: 3,
    nextRunAt: now.toISOString(),
    lastError: null,
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
    ...extra,
  };
}

function approval(id: string, status: ApprovalRecord["status"], actionClass: ApprovalRecord["actionClass"]): ApprovalRecord {
  return {
    id,
    taskId: "t-approval",
    artifactId: null,
    actionClass,
    riskLevel: "medium",
    summary: "s",
    preview: {},
    expiresAt: null,
    payloadHash: "0".repeat(64),
    executedAt: null,
    status,
    decidedBy: null,
    decidedAt: null,
    decisionNote: null,
    createdAt: now.toISOString(),
  };
}

describe("COO planning", () => {
  it("plans the marketing workflow in order with approval flags and no dates for immediate steps", () => {
    const plan = planWorkflow("marketing", now);
    expect(plan.map((p) => p.stepKey)).toEqual(["research", "strategy", "campaign", "scripts", "creative_brief", "compliance", "approval"]);
    expect(plan.find((p) => p.stepKey === "approval")?.requiresOwnerApproval).toBe(true);
    expect(plan.find((p) => p.stepKey === "research")?.requiresOwnerApproval).toBe(false);
  });

  it("gives the sales follow-up a deadline 48 hours after planning", () => {
    const follow = planWorkflow("sales", now).find((p) => p.stepKey === "follow_up");
    expect(follow?.dueAt).toBe("2026-11-22T09:00:00.000Z");
  });
});

describe("executive report", () => {
  it("counts tasks by status and lists failures with their error", () => {
    const report = buildExecutiveReport({
      now,
      tasks: [task("a", "succeeded"), task("b", "failed", { lastError: "boom" }), task("c", "blocked")],
      approvals: [],
    });
    expect(report.counts.succeeded).toBe(1);
    expect(report.counts.failed).toBe(1);
    expect(report.failed[0]).toMatchObject({ taskId: "b", error: "boom" });
    expect(verifyReportHonesty(report)).toEqual([]);
  });

  it("never reports an external action as completed, whatever its approval state", () => {
    const pending = approval("a1", "pending", "external_publish");
    const approved = approval("a2", "approved", "external_send_message");
    const rejected = approval("a3", "rejected", "external_payment");
    expect(externalStatusFor(pending)).toBe("awaiting_owner_approval");
    expect(externalStatusFor(approved)).toBe("awaiting_owner_execution");
    expect(externalStatusFor(rejected)).toBe("rejected");

    const report = buildExecutiveReport({ now, tasks: [], approvals: [pending, approved, rejected] });
    const statuses = report.externalItems.map((i) => i.status);
    expect(statuses).not.toContain("completed");
    expect(report.statements.join(" ")).toContain("None were executed by the platform");
    expect(verifyReportHonesty(report)).toEqual([]);
  });

  it("internal approvals (propose_change) are not external items", () => {
    expect(externalStatusFor(approval("p", "pending", "propose_change"))).toBeNull();
  });

  it("the honesty check catches a statement that claims a publication happened", () => {
    const report = buildExecutiveReport({ now, tasks: [], approvals: [] });
    report.statements.push("The post was published to TikTok.");
    expect(verifyReportHonesty(report).length).toBeGreaterThan(0);
  });

  it("the honesty check catches a fabricated external status", () => {
    const report = buildExecutiveReport({ now, tasks: [], approvals: [approval("x", "approved", "external_publish")] });
    report.externalItems[0] = { ...report.externalItems[0]!, status: "completed" as never };
    expect(verifyReportHonesty(report).some((p) => p.includes("completed"))).toBe(true);
  });
});
