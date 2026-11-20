import { describe, it, expect } from "vitest";
import { agentBoard, performance, usageSummary, alertsFor, health, STALL_MINUTES, REPEATED_FAILURE_THRESHOLD, type TaskSample, type RunSample } from "@/lib/ai/observability/metrics";

const NOW = new Date("2026-11-20T10:00:00.000Z");
const minutesAgo = (m: number) => new Date(NOW.getTime() - m * 60_000).toISOString();

const task = (over: Partial<TaskSample> = {}): TaskSample => ({ id: "t", agent: "SalesAgent", status: "succeeded", attempts: 1, updatedAt: minutesAgo(5), runId: "r", ...over });
const run = (over: Partial<RunSample> = {}): RunSample => ({ agent: "SalesAgent", status: "succeeded", durationMs: 1000, finishedAt: minutesAgo(5), tokensIn: 10, tokensOut: 20, providerId: "mock", ...over });

describe("agent monitoring", () => {
  it("counts active, completed and failed tasks, and the retries beyond the first attempt", () => {
    const tasks = [task({ id: "a", status: "succeeded", attempts: 1 }), task({ id: "b", status: "failed", attempts: 3 }), task({ id: "c", status: "running", attempts: 2 })];
    const [row] = agentBoard(tasks, [], NOW);
    expect(row).toMatchObject({ completed: 1, failed: 1, active: 1, retries: 3 });
  });

  it("an agent with active work and recent activity is working; with no recent activity it is stalled", () => {
    expect(agentBoard([task({ status: "running", updatedAt: minutesAgo(5) })], [], NOW)[0].liveStatus).toBe("working");
    expect(agentBoard([task({ status: "running", updatedAt: minutesAgo(STALL_MINUTES + 30) })], [], NOW)[0].liveStatus).toBe("stalled");
  });

  it("an agent that fails most of its recent runs is failing", () => {
    const runs = [run({ status: "failed" }), run({ status: "failed" }), run({ status: "failed" }), run({ status: "succeeded" })];
    expect(agentBoard([], runs, NOW)[0].liveStatus).toBe("failing");
  });

  it("with too few runs, a single failure does not make an agent failing", () => {
    expect(agentBoard([], [run({ status: "failed" })], NOW)[0].liveStatus).toBe("idle");
  });

  it("last activity is the latest of its task updates and run finishes", () => {
    const row = agentBoard([task({ updatedAt: minutesAgo(30) })], [run({ finishedAt: minutesAgo(2) })], NOW)[0];
    expect(row.lastActivity).toBe(minutesAgo(2));
  });

  it("workload share is the agent's part of all tasks", () => {
    const rows = agentBoard([task({ agent: "SalesAgent" }), task({ id: "x", agent: "SalesAgent" }), task({ id: "y", agent: "SEOAgent" })], [], NOW);
    expect(rows.find((r) => r.agent === "SalesAgent")?.workloadShare).toBeCloseTo(2 / 3);
    expect(rows.find((r) => r.agent === "SEOAgent")?.workloadShare).toBeCloseTo(1 / 3);
  });
});

describe("performance metrics", () => {
  it("success rate is completed over finished, and null when nothing has finished", () => {
    expect(performance([task({ status: "succeeded" }), task({ id: "b", status: "failed" })], [], []).successRate).toBe(0.5);
    expect(performance([task({ status: "running" })], [], []).successRate).toBeNull();
  });

  it("average execution time uses succeeded runs only, and is null with none", () => {
    expect(performance([], [run({ durationMs: 1000 }), run({ durationMs: 3000 }), run({ status: "failed", durationMs: 99999 })], []).averageExecutionMs).toBe(2000);
    expect(performance([], [run({ status: "failed" })], []).averageExecutionMs).toBeNull();
  });

  it("revision rate and quality score are null without reviews, and computed from them otherwise", () => {
    const none = performance([], [], []);
    expect(none.revisionRate).toBeNull();
    expect(none.outputQualityScore).toBeNull();
    const some = performance([], [], [
      { agent: "A", status: "NEEDS_REVISION", overall: 50 },
      { agent: "A", status: "PASSED", overall: 90 },
    ]);
    expect(some.revisionRate).toBe(0.5);
    expect(some.outputQualityScore).toBe(70);
  });
});

describe("cost and usage", () => {
  it("token totals come from recorded runs; cost is never estimated", () => {
    const summary = usageSummary([{ providerId: "mock", requests: 4, tokens: 100 }], [run({ tokensIn: 10, tokensOut: 5 }), run({ tokensIn: 3, tokensOut: 2 })]);
    expect(summary.tokensIn).toBe(13);
    expect(summary.tokensOut).toBe(7);
    expect(summary.estimatedCost).toBeNull();
    expect(summary.estimatedCostReason).toBe("no_price_table");
  });
});

describe("alerts", () => {
  it("raises an alert for an agent with repeated failures", () => {
    const runs = Array.from({ length: REPEATED_FAILURE_THRESHOLD }, () => run({ status: "failed" }));
    const alerts = alertsFor(agentBoard([], runs, NOW), [], runs, NOW);
    expect(alerts).toContainEqual({ kind: "repeated_agent_failures", subject: "SalesAgent", count: REPEATED_FAILURE_THRESHOLD });
  });

  it("raises an alert for stalled work", () => {
    const stuck = [task({ status: "running", updatedAt: minutesAgo(STALL_MINUTES + 1) })];
    expect(alertsFor(agentBoard(stuck, [], NOW), stuck, [], NOW)).toContainEqual({ kind: "stalled_work", subject: "tasks", count: 1 });
  });

  it("no alert when things are healthy", () => {
    const fine = [task({ status: "succeeded" })];
    expect(alertsFor(agentBoard(fine, [], NOW), fine, [], NOW)).toEqual([]);
  });
});

describe("system health", () => {
  it("reports the dead-letter queue, the agent error rate, and that no scheduler exists", () => {
    const h = health({
      deliveries: { pending: 2, delivered: 10, dead: 3 },
      database: { ok: true, latencyMs: 12 },
      runs: [run({ status: "failed" }), run(), run(), run()],
      workflowsWithFailures: 1,
      workflowsTotal: 4,
    });
    expect(h.deadLetterQueue).toBe(3);
    expect(h.agentErrorRate).toBe(0.25);
    expect(h.scheduler.status).toBe("not_built");
    expect(h.workflows).toEqual({ total: 4, withFailures: 1 });
  });

  it("with no runs, the error rate is unknown, not zero", () => {
    const h = health({ deliveries: { pending: 0, delivered: 0, dead: 0 }, database: { ok: true, latencyMs: null }, runs: [], workflowsWithFailures: 0, workflowsTotal: 0 });
    expect(h.agentErrorRate).toBeNull();
  });
});
