import { describe, it, expect } from "vitest";
import { makeHarness, startInput, OWNER } from "./helpers";
import { ForbiddenActorError } from "@/lib/ai/approvals";

const AGENT = { kind: "agent" as const, agent: "CRMAgent" as const };

describe("owner cancellation of a run", () => {
  it("cancels every task that has not started, so nothing in the run runs afterwards", async () => {
    const h = makeHarness();
    const { runId } = await h.orch.startWorkflow(startInput({ workflowKey: "sales", idempotencyKey: "cancel-01" }));
    const result = await h.orch.cancelRun(OWNER, runId);
    expect(result.cancelled.length).toBeGreaterThan(0);
    const tasks = await h.store.listTasksByRunIds([runId]);
    expect(tasks.every((t) => t.status === "cancelled")).toBe(true);
    const claimed = await h.orch.tick({ limit: 10 });
    expect(claimed.claimed).toBe(0);
    expect(tasks.find((t) => t.stepKey === "lead")?.lastError).toBe("Cancelled by the owner.");
  });

  it("refuses an agent or the system", async () => {
    const h = makeHarness();
    const { runId } = await h.orch.startWorkflow(startInput({ workflowKey: "sales", idempotencyKey: "cancel-02" }));
    await expect(h.orch.cancelRun(AGENT, runId)).rejects.toBeInstanceOf(ForbiddenActorError);
    await expect(h.orch.cancelRun({ kind: "system" }, runId)).rejects.toBeInstanceOf(ForbiddenActorError);
    expect((await h.store.listTasksByRunIds([runId])).some((t) => t.status === "cancelled")).toBe(false);
  });

  it("is audited with counts only", async () => {
    const h = makeHarness();
    const { runId } = await h.orch.startWorkflow(startInput({ workflowKey: "sales", idempotencyKey: "cancel-03" }));
    await h.orch.cancelRun(OWNER, runId);
    const entry = h.audit.events.find((e) => e.type === "run.cancelled");
    expect(entry?.actor).toBe(`owner:${OWNER.id}`);
    expect(Object.keys(entry?.meta ?? {}).sort()).toEqual(["cancelled", "left"]);
  });

  it("leaves a task waiting for the owner's approval for that decision, and reports it", async () => {
    const h = makeHarness();
    const { runId } = await h.orch.startWorkflow(startInput({ workflowKey: "sales", idempotencyKey: "cancel-04" }));
    for (let i = 0; i < 40; i++) {
      const r = await h.orch.tick({ limit: 10 });
      if (r.claimed === 0) break;
    }
    const waiting = (await h.store.listTasksByRunIds([runId])).find((t) => t.status === "waiting_approval");
    expect(waiting).toBeDefined();
    const result = await h.orch.cancelRun(OWNER, runId);
    expect(result.left).toEqual(expect.arrayContaining([{ taskId: waiting!.id, reason: "awaiting_owner_decision" }]));
    expect((await h.store.getTask(waiting!.id))?.status).toBe("waiting_approval");
  });
});
