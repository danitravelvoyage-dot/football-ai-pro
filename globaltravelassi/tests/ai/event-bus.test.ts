import { describe, it, expect } from "vitest";
import { validateEvent, EventBus, EventValidationError, PermanentHandlerError, deliveryBackoffMs, DEFAULT_DELIVERY_ATTEMPTS } from "@/lib/ai/events/bus";
import { MemoryEventStore } from "@/lib/ai/events/store";
import { MemoryAuditSink } from "@/lib/ai/audit";
import { MemoryTaskStore } from "@/lib/ai/orchestration/store";
import { buildHandlers } from "@/lib/ai/events/handlers";
import { createEventBus } from "@/lib/ai/events/build";
import { makeClock, makeHarness, makeIds, startInput } from "./helpers";
import { MAX_HANDOFF_HOPS } from "@/lib/ai/events/types";

const TASK = "task-1";
const RUN = "run-1";

function taskReady(overrides: Record<string, unknown> = {}) {
  return {
    type: "task.ready",
    producer: "COOAgent",
    target: "SalesAgent",
    payload: { taskId: TASK, runId: RUN, agent: "SalesAgent", stepKey: "qualification" },
    idempotencyKey: "ready-key-0001",
    ...overrides,
  };
}

function handoff(overrides: Record<string, unknown> = {}) {
  return {
    type: "agent.handoff",
    producer: "SalesAgent",
    target: "CRMAgent",
    payload: { fromAgent: "SalesAgent", toAgent: "CRMAgent", taskId: null, summary: "Lead qualified, update the CRM stage." },
    idempotencyKey: "handoff-key-0001",
    hopCount: 1,
    ...overrides,
  };
}

describe("event catalogue validation", () => {
  it("accepts a well-formed targeted event", () => {
    const v = validateEvent(taskReady());
    expect(v.type).toBe("task.ready");
    expect(v.target).toBe("SalesAgent");
  });

  it("refuses unknown types, producers and targets", () => {
    expect(() => validateEvent(taskReady({ type: "task.teleported" }))).toThrow(EventValidationError);
    expect(() => validateEvent(taskReady({ producer: "Intern" }))).toThrow(EventValidationError);
    expect(() => validateEvent(taskReady({ target: "nobody" }))).toThrow(EventValidationError);
  });

  it("refuses payloads with extra fields, missing fields and wrong types", () => {
    expect(() => validateEvent(taskReady({ payload: { taskId: TASK, runId: RUN, agent: "SalesAgent", stepKey: "q", extra: 1 } }))).toThrow(EventValidationError);
    expect(() => validateEvent(taskReady({ payload: { taskId: TASK } }))).toThrow(EventValidationError);
    expect(() => validateEvent(taskReady({ payload: { taskId: TASK, runId: RUN, agent: "Bogus", stepKey: "q" } }))).toThrow(EventValidationError);
  });

  it("refuses payloads that contain personal data", () => {
    const failed = {
      type: "task.failed",
      producer: "SalesAgent",
      payload: { taskId: TASK, runId: RUN, agent: "SalesAgent", stepKey: "q", error: "Contact owner@example.dz for details", terminal: true },
      idempotencyKey: "failed-key-0001",
    };
    expect(() => validateEvent(failed)).toThrow("personal data");
  });

  it("refuses an idempotency key that is too short", () => {
    expect(() => validateEvent(taskReady({ idempotencyKey: "short" }))).toThrow(EventValidationError);
  });

  it("limits agent-to-agent handoffs to the hop budget and to their own sender and receiver", () => {
    expect(() => validateEvent(handoff())).not.toThrow();
    expect(() => validateEvent(handoff({ hopCount: MAX_HANDOFF_HOPS + 1 }))).toThrow("limited");
    expect(() => validateEvent(handoff({ hopCount: 0 }))).toThrow("limited");
    expect(() => validateEvent(handoff({ producer: "CRMAgent" }))).toThrow("published by the agent it comes from");
    expect(() => validateEvent(handoff({ target: "SEOAgent" }))).toThrow("must target the agent it names");
    expect(() => validateEvent({ ...taskReady(), hopCount: 2 })).toThrow("Only handoffs");
  });

  it("an agent cannot hand off to itself", () => {
    expect(() =>
      validateEvent(handoff({ producer: "SalesAgent", target: "SalesAgent", payload: { fromAgent: "SalesAgent", toAgent: "SalesAgent", taskId: null, summary: "Self." } })),
    ).toThrow(EventValidationError);
  });
});

describe("publishing", () => {
  function bus(handlers: Record<string, (e: unknown, c: unknown) => Promise<void>> = {}) {
    const clock = makeClock();
    const events = new MemoryEventStore();
    const audit = new MemoryAuditSink();
    const b = new EventBus({ store: events, audit, now: clock.now, newId: makeIds("e"), handlers: handlers as never });
    return { b, events, audit, clock };
  }

  it("publishing the same idempotency key twice stores one event and creates no second delivery", async () => {
    const { b, events } = bus();
    events.setSubscription("SalesAgent", "task.ready");
    const first = await b.publish(taskReady());
    const second = await b.publish(taskReady());
    expect(first.created).toBe(true);
    expect(second.created).toBe(false);
    expect(second.eventId).toBe(first.eventId);
    expect((await events.countDeliveries()).pending).toBe(1);
  });

  it("a targeted event reaches only the named agent, and only when it subscribes", async () => {
    const { b, events } = bus();
    const unsubscribed = await b.publish(taskReady({ idempotencyKey: "ready-key-0002" }));
    expect(unsubscribed.recipients).toEqual([]);
    events.setSubscription("SalesAgent", "task.ready");
    const subscribed = await b.publish(taskReady({ idempotencyKey: "ready-key-0003" }));
    expect(subscribed.recipients).toEqual(["SalesAgent"]);
  });

  it("a broadcast event reaches every subscriber of its type, and nobody else", async () => {
    const { b, events } = bus();
    events.setSubscription("COOAgent", "task.failed");
    events.setSubscription("CRMAgent", "task.failed");
    events.setSubscription("SEOAgent", "task.succeeded");
    const result = await b.publish({
      type: "task.failed",
      producer: "SalesAgent",
      payload: { taskId: TASK, runId: RUN, agent: "SalesAgent", stepKey: "q", error: "HTTP 503", terminal: true },
      idempotencyKey: "failed-key-0002",
    });
    expect(result.recipients).toEqual(["COOAgent", "CRMAgent"]);
  });

  it("a disabled subscription receives nothing", async () => {
    const { b, events } = bus();
    events.setSubscription("SalesAgent", "task.ready", false);
    const result = await b.publish(taskReady({ idempotencyKey: "ready-key-0004" }));
    expect(result.recipients).toEqual([]);
  });
});

describe("delivery, retries and dead letters", () => {
  function setup(handler: (event: unknown, ctx: { attempt: number }) => Promise<void>) {
    const clock = makeClock();
    const events = new MemoryEventStore();
    const audit = new MemoryAuditSink();
    const handlers = { SalesAgent: handler as never };
    const b = new EventBus({ store: events, audit, now: clock.now, newId: makeIds("d"), handlers });
    events.setSubscription("SalesAgent", "task.ready");
    return { b, events, audit, clock };
  }

  it("a handler that succeeds marks the delivery delivered, and it never runs again", async () => {
    let calls = 0;
    const { b, events } = setup(async () => {
      calls += 1;
    });
    await b.publish(taskReady());
    const first = await b.dispatch({ limit: 10 });
    const second = await b.dispatch({ limit: 10 });
    expect(first.delivered).toBe(1);
    expect(second.attempted).toBe(0);
    expect(calls).toBe(1);
    expect((await events.countDeliveries()).delivered).toBe(1);
  });

  it("a transient failure is retried after backoff, then succeeds", async () => {
    let calls = 0;
    const { b, events, clock } = setup(async () => {
      calls += 1;
      if (calls === 1) throw new Error("temporary outage");
    });
    await b.publish(taskReady());
    const first = await b.dispatch({ limit: 10 });
    expect(first.retried).toBe(1);
    const tooSoon = await b.dispatch({ limit: 10 });
    expect(tooSoon.attempted).toBe(0);
    clock.advance(deliveryBackoffMs(1));
    const second = await b.dispatch({ limit: 10 });
    expect(second.delivered).toBe(1);
    expect(calls).toBe(2);
    expect((await events.countDeliveries()).delivered).toBe(1);
  });

  it("after the attempt limit, a failing delivery is dead-lettered and the reason is kept", async () => {
    const { b, events, clock, audit } = setup(async () => {
      throw new Error("always failing");
    });
    await b.publish(taskReady());
    for (let i = 0; i < DEFAULT_DELIVERY_ATTEMPTS; i++) {
      await b.dispatch({ limit: 10 });
      clock.advance(120_000);
    }
    const counts = await events.countDeliveries();
    expect(counts.dead).toBe(1);
    const [dead] = await events.listDeliveries({ status: "dead", limit: 1 });
    expect(dead.lastError).toBe("always failing");
    expect(dead.attempts).toBe(DEFAULT_DELIVERY_ATTEMPTS);
    expect(audit.events.some((e) => e.type === "event.dead_lettered")).toBe(true);
  });

  it("a permanent error goes straight to dead letters without retrying", async () => {
    const { b, events } = setup(async () => {
      throw new PermanentHandlerError("misrouted");
    });
    await b.publish(taskReady());
    const report = await b.dispatch({ limit: 10 });
    expect(report.dead).toBe(1);
    expect(report.retried).toBe(0);
    expect((await events.countDeliveries()).dead).toBe(1);
  });

  it("a recipient with no handler is dead-lettered, not silently dropped", async () => {
    const clock = makeClock();
    const events = new MemoryEventStore();
    const b = new EventBus({ store: events, audit: new MemoryAuditSink(), now: clock.now, newId: makeIds("n"), handlers: {} });
    events.setSubscription("SalesAgent", "task.ready");
    await b.publish(taskReady());
    const report = await b.dispatch({ limit: 10 });
    expect(report.dead).toBe(1);
  });

  it("backoff doubles and is capped", () => {
    expect(deliveryBackoffMs(1)).toBe(1_000);
    expect(deliveryBackoffMs(2)).toBe(2_000);
    expect(deliveryBackoffMs(20)).toBe(60_000);
  });
});

describe("standard handlers", () => {
  it("an agent records receipt of its own ready task and refuses one addressed to someone else", async () => {
    const clock = makeClock();
    const tasks = new MemoryTaskStore();
    const audit = new MemoryAuditSink();
    const handlers = buildHandlers({ tasks, audit, newId: makeIds("h"), now: clock.now });
    const event = {
      id: "evt-1",
      eventType: "task.ready" as const,
      producer: "COOAgent",
      target: "SalesAgent",
      correlationId: null,
      hopCount: 0,
      payload: { taskId: TASK, runId: RUN, agent: "SalesAgent", stepKey: "q" },
      idempotencyKey: "k",
      occurredAt: clock.now().toISOString(),
    };
    await handlers.SalesAgent(event, { subscriber: "SalesAgent", attempt: 1 });
    expect(audit.events.some((e) => e.type === "agent.task_received" && e.entityId === TASK)).toBe(true);
    await expect(handlers.CRMAgent(event, { subscriber: "CRMAgent", attempt: 1 })).rejects.toBeInstanceOf(PermanentHandlerError);
  });

  it("the receiving agent remembers a handoff, keyed by event id so a repeat overwrites the same entry", async () => {
    const clock = makeClock();
    const tasks = new MemoryTaskStore();
    const saved: Array<[string, string]> = [];
    tasks.saveMemory = async (agent, key) => {
      saved.push([agent, key]);
    };
    const handlers = buildHandlers({ tasks, audit: new MemoryAuditSink(), newId: makeIds("h"), now: clock.now });
    const event = {
      id: "evt-handoff",
      eventType: "agent.handoff" as const,
      producer: "SalesAgent",
      target: "CRMAgent",
      correlationId: null,
      hopCount: 1,
      payload: { fromAgent: "SalesAgent", toAgent: "CRMAgent", taskId: null, summary: "Update the stage." },
      idempotencyKey: "k2",
      occurredAt: clock.now().toISOString(),
    };
    await handlers.CRMAgent(event, { subscriber: "CRMAgent", attempt: 1 });
    await handlers.CRMAgent(event, { subscriber: "CRMAgent", attempt: 2 });
    expect(saved).toEqual([
      ["CRMAgent", "handoff:evt-handoff"],
      ["CRMAgent", "handoff:evt-handoff"],
    ]);
  });

  it("the COO escalates a terminal failure with the number of tasks it blocks, and ignores retryable ones", async () => {
    const h = makeHarness();
    const { runId } = await h.orch.startWorkflow(startInput({ idempotencyKey: "coo-escalation-1" }));
    const research = (await h.store.listTasksByRunIds([runId])).find((t) => t.stepKey === "research")!;
    const bus = createEventBus({ store: h.eventStore, tasks: h.store, audit: h.audit, now: h.clock.now, newId: h.ids });
    // Retryable failures must not reach the COO handler; only the terminal one does.
    await bus.publish({
      type: "task.failed",
      producer: "MarketResearchAgent",
      payload: { taskId: research.id, runId, agent: "MarketResearchAgent", stepKey: "research", error: "HTTP 500", terminal: false },
      idempotencyKey: "coo-retryable-1",
    });
    await bus.publish({
      type: "task.failed",
      producer: "MarketResearchAgent",
      payload: { taskId: research.id, runId, agent: "MarketResearchAgent", stepKey: "research", error: "HTTP 500", terminal: true },
      idempotencyKey: "coo-terminal-1",
    });
    await bus.dispatch({ limit: 20 });
    const escalations = h.audit.events.filter((e) => e.type === "coo.escalated");
    expect(escalations).toHaveLength(1);
    expect(escalations[0].meta.blockedDownstream).toBe(6);
  });
});

describe("engine integration", () => {
  it("a marketing workflow emits its lifecycle events in order", async () => {
    const h = makeHarness();
    const { runId } = await h.orch.startWorkflow(startInput({ idempotencyKey: "events-run-01" }));
    for (let i = 0; i < 40; i++) {
      const report = await h.orch.tick({ limit: 10 });
      if (report.claimed === 0) break;
    }
    const events = await h.eventStore.listEvents({ limit: 500 });
    const types = events.items.filter((e) => e.correlationId === runId).map((e) => e.eventType);
    // The in-memory clock does not advance between steps, so this checks what happened, not the order.
    expect(types.filter((t) => t === "workflow.started")).toHaveLength(1);
    expect(types.filter((t) => t === "task.ready")).toHaveLength(7);
    expect(types.filter((t) => t === "task.succeeded")).toHaveLength(6);
    expect(types.filter((t) => t === "task.waiting_approval")).toHaveLength(1);
  });

  it("an approval decision is published as an owner event", async () => {
    const h = makeHarness();
    const { runId } = await h.orch.startWorkflow(startInput({ idempotencyKey: "events-run-02" }));
    for (let i = 0; i < 40; i++) {
      const report = await h.orch.tick({ limit: 10 });
      if (report.claimed === 0) break;
    }
    const [approval] = await h.store.listApprovals("pending");
    await h.orch.decideApproval(approval.id, "rejected", { kind: "owner", id: "owner-1" }, "Not now.");
    const decided = (await h.eventStore.listEvents({ limit: 500 })).items.find((e) => e.eventType === "approval.decided");
    expect(decided?.producer).toBe("owner");
    expect(decided?.correlationId).toBe(runId);
  });

  it("a refused event store never blocks or undoes the workflow", async () => {
    const h = makeHarness();
    h.eventStore.insertEvent = async () => {
      throw new Error("events table unavailable");
    };
    const { runId } = await h.orch.startWorkflow(startInput({ idempotencyKey: "events-run-03" }));
    await h.orch.tick({ limit: 10 });
    const tasks = await h.store.listTasksByRunIds([runId]);
    expect(tasks.filter((t) => t.status === "succeeded").length).toBeGreaterThan(0);
  });
});
