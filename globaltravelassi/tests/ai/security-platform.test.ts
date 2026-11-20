import { describe, it, expect } from "vitest";
import { validateEvent, producerRules, EventValidationError } from "@/lib/ai/events/bus";

const decided = (producer: string) => ({
  type: "approval.decided",
  producer,
  payload: { approvalId: "appr-1", taskId: "task-1", decision: "approved", actionClass: "external_publish" },
  idempotencyKey: `decided-${producer}-1`,
});

const taskDone = (producer: string, agent: string) => ({
  type: "task.succeeded",
  producer,
  payload: { taskId: "task-9", runId: "run-9", agent, stepKey: "research" },
  idempotencyKey: `done-${producer}-${agent}`,
});

describe("event producers cannot forge facts", () => {
  it("an agent cannot announce an owner approval decision", () => {
    expect(() => validateEvent(decided("SalesAgent"))).toThrow(EventValidationError);
    expect(() => validateEvent(decided("COOAgent"))).toThrow("may not publish");
  });

  it("the owner publishes decisions, not agent task results", () => {
    expect(() => validateEvent(decided("owner"))).not.toThrow();
    expect(() => validateEvent(taskDone("owner", "SalesAgent"))).toThrow("may not publish");
  });

  it("an agent cannot report a result for another agent's task", () => {
    expect(() => validateEvent(taskDone("SalesAgent", "CRMAgent"))).toThrow("may not publish");
    expect(() => validateEvent(taskDone("SalesAgent", "SalesAgent"))).not.toThrow();
  });

  it("only the COO announces workflow starts and ready tasks", () => {
    expect(() => validateEvent({ type: "workflow.started", producer: "SalesAgent", payload: { runId: "r", workflowKey: "sales", taskCount: 3 }, idempotencyKey: "start-spoof-1" })).toThrow("may not publish");
    expect(() =>
      validateEvent({ type: "task.ready", producer: "SalesAgent", target: "SalesAgent", payload: { taskId: "t", runId: "r", agent: "SalesAgent", stepKey: "q" }, idempotencyKey: "ready-spoof-1" }),
    ).toThrow("may not publish");
  });

  it("the rule table itself refuses unknown producers for owner-only facts", () => {
    expect(producerRules("approval.decided", "system", undefined)).toBe(true);
    expect(producerRules("approval.decided", "CRMAgent", undefined)).toBe(false);
  });
});
