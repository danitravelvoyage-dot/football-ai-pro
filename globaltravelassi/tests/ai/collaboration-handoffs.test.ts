import { describe, it, expect } from "vitest";
import { makeHarness, startInput, OWNER } from "./helpers";

async function drive(h: ReturnType<typeof makeHarness>, passes = 40) {
  for (let i = 0; i < passes; i++) {
    const report = await h.orch.tick({ limit: 10 });
    if (report.claimed === 0) break;
  }
  await h.events.dispatch({ limit: 200 });
}

describe("automatic handoffs between agents", () => {
  it("publishes one handoff when a step finishes and a dependent step belongs to another agent", async () => {
    const h = makeHarness();
    const { runId } = await h.orch.startWorkflow(startInput({ workflowKey: "sales", idempotencyKey: "handoff-auto-01" }));
    await drive(h);
    const tasks = await h.store.listTasksByRunIds([runId]);
    const lead = tasks.find((t) => t.stepKey === "lead")!;
    expect(lead.status).toBe("succeeded");

    const handoffs = (await h.eventStore.listEvents({ limit: 500 })).items.filter((e) => e.eventType === "agent.handoff");
    const fromLead = handoffs.filter((e) => (e.payload as { taskId: string }).taskId === lead.id);
    expect(fromLead).toHaveLength(1);
    const payload = fromLead[0]!.payload as { fromAgent: string; toAgent: string; taskId: string; summary: string };
    expect(payload).toMatchObject({ fromAgent: "CRMAgent", toAgent: "SalesAgent", taskId: lead.id });
    expect(payload.summary.length).toBeLessThanOrEqual(500);
  });

  it("the receiving agent stores the handoff and the audit trail records its receipt", async () => {
    const h = makeHarness();
    await h.orch.startWorkflow(startInput({ workflowKey: "sales", idempotencyKey: "handoff-auto-02" }));
    await drive(h);
    expect(h.audit.events.some((e) => e.type === "agent.handoff_received" && e.actor === "agent:SalesAgent")).toBe(true);
  });

  it("does not hand off to the same agent: a step's dependent in the same agent gets no handoff", async () => {
    const h = makeHarness();
    const { runId } = await h.orch.startWorkflow(startInput({ workflowKey: "sales", idempotencyKey: "handoff-auto-03" }));
    await drive(h);
    const tasks = await h.store.listTasksByRunIds([runId]);
    const qualification = tasks.find((t) => t.stepKey === "qualification")!;
    const handoffs = (await h.eventStore.listEvents({ limit: 500 })).items.filter((e) => e.eventType === "agent.handoff");
    // qualification (SalesAgent) feeds service_recommendation (SalesAgent): the same agent, so no handoff.
    expect(handoffs.some((e) => (e.payload as { taskId: string }).taskId === qualification.id)).toBe(false);
  });

  it("is idempotent: driving the run again does not repeat a handoff", async () => {
    const h = makeHarness();
    await h.orch.startWorkflow(startInput({ workflowKey: "sales", idempotencyKey: "handoff-auto-04" }));
    await drive(h);
    const before = (await h.eventStore.listEvents({ limit: 500 })).items.filter((e) => e.eventType === "agent.handoff").length;
    await drive(h, 5);
    const after = (await h.eventStore.listEvents({ limit: 500 })).items.filter((e) => e.eventType === "agent.handoff").length;
    expect(after).toBe(before);
  });

  it("a handoff carries identifiers and a fixed summary, never the step's output", async () => {
    const h = makeHarness();
    const { runId } = await h.orch.startWorkflow(startInput({ workflowKey: "sales", idempotencyKey: "handoff-auto-05" }));
    await drive(h);
    const lead = (await h.store.listTasksByRunIds([runId])).find((t) => t.stepKey === "lead")!;
    const handoff = (await h.eventStore.listEvents({ limit: 500 })).items.find((e) => e.eventType === "agent.handoff" && (e.payload as { taskId: string }).taskId === lead.id);
    expect(handoff).toBeDefined();
    expect(Object.keys(handoff!.payload as object).sort()).toEqual(["fromAgent", "summary", "taskId", "toAgent"]);
    expect(lead.output).not.toBeNull();
    // The stored output carries its own wording ("Mock."). A handoff that leaked the output would carry it too.
    expect(JSON.stringify(lead.output)).toContain("Mock.");
    expect(JSON.stringify(handoff!.payload)).not.toContain("Mock.");
  });
});

export { OWNER };
