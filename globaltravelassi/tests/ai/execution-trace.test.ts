import { describe, it, expect } from "vitest";
import { buildRunTrace, type ReviewFact } from "@/lib/ai/orchestration/trace";
import type { TaskRecord } from "@/lib/ai/orchestration/records";

const T = "2026-11-20T09:00:00.000Z";
const task = (over: Partial<TaskRecord>): TaskRecord => ({
  id: "t", runId: "run-1", workflowKey: "marketing", stepKey: "s", agent: "SalesAgent", title: "T", status: "succeeded", priority: 1,
  dueAt: null, dependsOn: [], input: { objective: "o", language: "fr", country: "dz", brief: "", data: {}, aggregates: [], upstream: [], context: [], knowledge: [] } as never,
  output: null, actionClass: null, requiresApproval: false, attempts: 1, maxAttempts: 3, nextRunAt: T, lastError: null, createdAt: T, updatedAt: T, ...over,
});

describe("execution trace", () => {
  const tasks = [
    task({ id: "a", stepKey: "research", agent: "MarketResearchAgent" }),
    task({ id: "b", stepKey: "strategy", agent: "MarketingStrategistAgent", dependsOn: ["a"], status: "pending", createdAt: "2026-11-20T09:01:00.000Z" }),
    task({ id: "c", stepKey: "other-run", runId: "run-2" }),
  ];

  it("lists the run's steps in order, with dependencies, attempts and the latest quality status", () => {
    const reviews: ReviewFact[] = [
      { taskId: "a", attempt: 1, status: "NEEDS_REVISION", codes: ["unsupported_claim"], createdAt: T },
      { taskId: "a", attempt: 2, status: "PASSED", codes: [], createdAt: T },
    ];
    const trace = buildRunTrace("run-1", tasks, reviews);
    expect(trace.steps.map((s) => s.stepKey)).toEqual(["research", "strategy"]);
    expect(trace.steps[0]?.quality).toEqual({ latestStatus: "PASSED", reviews: 2 });
    expect(trace.steps[1]?.dependsOn).toEqual(["a"]);
    expect(trace.totals).toEqual({ steps: 2, succeeded: 1, failed: 0, attempts: 2 });
  });

  it("a step waiting on a dependency that has not succeeded is listed with what it is missing", () => {
    const trace = buildRunTrace("run-1", tasks, []);
    // Step "a" succeeded, so step "b" is not waiting on anything.
    expect(trace.waitingOn).toEqual([]);
    const waiting = buildRunTrace("run-1", [task({ id: "a", status: "running" }), task({ id: "b", status: "pending", dependsOn: ["a"] })], []);
    expect(waiting.waitingOn).toEqual([{ taskId: "b", missing: ["a"] }]);
  });

  it("cross-agent contradictions are listed as conflicts with the agent and attempt", () => {
    const reviews: ReviewFact[] = [{ taskId: "b", attempt: 1, status: "NEEDS_REVISION", codes: ["conflicting_claims"], createdAt: T }];
    const trace = buildRunTrace("run-1", tasks, reviews);
    expect(trace.conflicts).toEqual([{ taskId: "b", agent: "MarketingStrategistAgent", attempt: 1, codes: ["conflicting_claims"] }]);
  });

  it("the trace contains identifiers and codes only, never outputs or inputs", () => {
    const withOutput = [task({ id: "a", output: { secret: "private client text" } as never })];
    expect(JSON.stringify(buildRunTrace("run-1", withOutput, []))).not.toContain("private client text");
  });
});

describe("handoffs in the run trace", () => {

  it("lists handoffs whose source task belongs to the run, oldest first", () => {
    const tasks = [task({ id: "a", runId: "run-1", agent: "CRMAgent", status: "succeeded" }), task({ id: "b", runId: "run-1", agent: "SalesAgent", dependsOn: ["a"] })];
    const trace = buildRunTrace("run-1", tasks, [], [
      { fromAgent: "CRMAgent", toAgent: "SalesAgent", taskId: "a", at: "2026-11-21T10:05:00.000Z" },
      { fromAgent: "CRMAgent", toAgent: "SalesAgent", taskId: "other-run-task", at: "2026-11-21T09:00:00.000Z" },
    ]);
    expect(trace.handoffs).toEqual([{ fromAgent: "CRMAgent", toAgent: "SalesAgent", taskId: "a", at: "2026-11-21T10:05:00.000Z" }]);
  });

  it("has no handoffs when none are supplied", () => {
    expect(buildRunTrace("run-1", [task({ id: "a", runId: "run-1" })], []).handoffs).toEqual([]);
  });
});
