import { describe, it, expect } from "vitest";
import { makeHarness, startInput, clearQualityHolds, OWNER } from "./helpers";

/**
 * End-to-end runs of every business workflow through the real engine, on the mock provider (no model call).
 * Each run is driven to the point where the owner must act, then the owner's decision is applied and the result checked.
 * External actions (publishing, customer messages) are never executed: approval only issues an owner card.
 */

async function run(workflowKey: "marketing" | "sales" | "support" | "visa" | "analytics", key: string) {
  const h = makeHarness({ visaAllowlist: ["official.example.dz"] });
  const { runId } = await h.orch.startWorkflow(startInput({ workflowKey, idempotencyKey: key }));
  await clearQualityHolds(h);
  const tasks = await h.store.listTasksByRunIds([runId]);
  const status = (step: string) => tasks.find((t) => t.stepKey === step)?.status;
  return { h, runId, tasks, status };
}

const cards = async (h: Awaited<ReturnType<typeof run>>["h"]) => (await h.store.listArtifacts(500)).filter((a) => a.kind === "owner_action_card");

describe("marketing: research to publishing pack, stopping at owner approval", () => {
  it("completes every content step and waits for the owner before publishing", async () => {
    const { h, status } = await run("marketing", "e2e-marketing-1");
    for (const step of ["research", "strategy", "campaign", "scripts", "creative_brief", "compliance"]) expect(status(step), step).toBe("succeeded");
    expect(status("approval")).toBe("waiting_approval");
    expect((await h.store.listApprovals("pending")).map((a) => a.actionClass)).toEqual(["external_publish"]);
  });

  it("approval issues an owner card and does not publish", async () => {
    const { h } = await run("marketing", "e2e-marketing-2");
    const [approval] = await h.store.listApprovals("pending");
    await h.orch.decideApproval(approval!.id, "approved", OWNER, "I will post it myself.");
    const issued = await cards(h);
    expect(issued).toHaveLength(1);
    expect(issued[0]?.body).toMatchObject({ action: "external_publish" });
    expect(JSON.stringify(issued[0]?.body)).toContain("Not executed by the platform");
  });
});

describe("sales: lead, qualification and a customer message that needs approval", () => {
  it("unblocks the follow-up only after the owner approves the customer message", async () => {
    const { h, status, runId } = await run("sales", "e2e-sales-1");
    expect(status("approval")).toBe("waiting_approval");
    expect(status("follow_up")).toBe("pending");
    const [approval] = await h.store.listApprovals("pending");
    await h.orch.decideApproval(approval!.id, "approved", OWNER, null);
    await clearQualityHolds(h);
    const after = (await h.store.listTasksByRunIds([runId])).find((t) => t.stepKey === "follow_up");
    expect(after?.status).toBe("succeeded");
    expect((await cards(h))[0]?.body).toMatchObject({ action: "external_send_message" });
  });

  it("a rejected customer message keeps the follow-up from ever running", async () => {
    const { h, status, runId } = await run("sales", "e2e-sales-2");
    const [approval] = await h.store.listApprovals("pending");
    await h.orch.decideApproval(approval!.id, "rejected", OWNER, "Not now.");
    await h.orch.tick({ limit: 10 });
    expect(status("approval")).toBe("waiting_approval");
    const follow = (await h.store.listTasksByRunIds([runId])).find((t) => t.stepKey === "follow_up");
    expect(follow?.status).not.toBe("succeeded");
    expect(await cards(h)).toHaveLength(0);
  });
});

describe("CRM: the CRM agent's lead step runs inside the sales workflow", () => {
  it("the lead hygiene proposal is produced and held only as a proposal, never applied to customer data", async () => {
    const { h, status } = await run("sales", "e2e-crm-1");
    expect(status("lead")).toBe("succeeded");
    const artifacts = await h.store.listArtifacts(500);
    expect(artifacts.some((a) => a.agent === "CRMAgent" && a.status === "draft")).toBe(true);
    expect(artifacts.every((a) => a.kind !== "crm_write")).toBe(true);
  });
});

describe("customer support: inquiry to an owner-approved reply", () => {
  it("drafts a reply, passes compliance, and waits for the owner before any message is sent", async () => {
    const { h, status } = await run("support", "e2e-support-1");
    for (const step of ["inquiry", "classification", "knowledge_retrieval", "draft_response", "compliance"]) expect(status(step), step).toBe("succeeded");
    expect(status("approval")).toBe("waiting_approval");
    expect((await h.store.listApprovals("pending")).map((a) => a.actionClass)).toEqual(["external_send_message"]);
  });

  it("a rejected reply is cancelled and nothing is sent", async () => {
    const { h, status } = await run("support", "e2e-support-2");
    const [approval] = await h.store.listApprovals("pending");
    await h.orch.decideApproval(approval!.id, "rejected", OWNER, null);
    expect(status("approval")).toBe("waiting_approval");
    const after = (await h.store.listTasksByRunIds([(await h.store.listRuns(5))[0]!.id])).find((t) => t.stepKey === "approval");
    expect(after?.status).toBe("cancelled");
    expect(await cards(h)).toHaveLength(0);
  });
});

describe("visa: requirement sheets from official sources, with no external action", () => {
  it("completes every step and creates no approval or external action", async () => {
    const { h, status } = await run("visa", "e2e-visa-1");
    for (const step of ["source_discovery", "extraction", "source_validation", "structured_report"]) expect(status(step), step).toBe("succeeded");
    expect(await h.store.listApprovals("pending")).toHaveLength(0);
  });
});

describe("analytics: deterministic aggregation and an executive report, with no external action", () => {
  it("completes, and the executive report is an internal draft", async () => {
    const { h, status } = await run("analytics", "e2e-analytics-1");
    for (const step of ["aggregation", "analysis", "insights", "recommendations", "executive_report"]) expect(status(step), step).toBe("succeeded");
    expect(await h.store.listApprovals("pending")).toHaveLength(0);
  });
});

describe("no unauthorized external action is reachable from any workflow", () => {
  it("every workflow that can publish or message stops at an approval of an external action class", async () => {
    for (const wf of ["marketing", "sales", "support"] as const) {
      const { h } = await run(wf, `e2e-guard-${wf}`);
      const pending = await h.store.listApprovals("pending");
      const external = pending.filter((a) => a.actionClass.startsWith("external_"));
      expect(external.length, wf).toBeGreaterThanOrEqual(1);
      expect(external.every((a) => a.status === "pending"), wf).toBe(true);
    }
  });
});
