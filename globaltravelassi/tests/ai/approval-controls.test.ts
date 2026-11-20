import { describe, it, expect } from "vitest";
import { makeHarness, startInput, OWNER } from "./helpers";
import { APPROVAL_POLICY, approvalRequiredFor, expiresAtFor } from "@/lib/ai/approvals/policy";
import { payloadFingerprint } from "@/lib/ai/approvals/payload";
import { ApprovalExpiredError, ApprovalNotRequiredError, ApprovalPayloadMismatchError, ApprovalInputError, ForbiddenActorError } from "@/lib/ai/approvals";
import { ConcurrencyError, MemoryTaskStore } from "@/lib/ai/orchestration/store";
import type { ApprovalRecord } from "@/lib/ai/orchestration/records";
import type { ActionClass } from "@/lib/ai/types";

const HOUR = 3_600_000;

async function startMarketingUntilApproval(h: ReturnType<typeof makeHarness>, key: string) {
  const { runId } = await h.orch.startWorkflow(startInput({ idempotencyKey: key }));
  for (let i = 0; i < 40; i++) {
    const report = await h.orch.tick({ limit: 10 });
    if (report.claimed === 0) break;
  }
  const [approval] = (await h.store.listApprovals("pending")).filter((a) => a.actionClass === "external_publish");
  return { runId, approval: approval! };
}

describe("approval rules per action class", () => {
  it("internal actions need no approval and cannot create one", () => {
    expect(approvalRequiredFor("read_internal")).toBe(false);
    expect(approvalRequiredFor("write_draft")).toBe(false);
    expect(expiresAtFor("read_internal", new Date())).toBeNull();
    expect(expiresAtFor("write_draft", new Date())).toBeNull();
  });

  it("each external class gets the window from the brief", () => {
    expect(APPROVAL_POLICY.external_send_message.expirationHours).toBe(24);
    expect(APPROVAL_POLICY.external_publish.expirationHours).toBe(24);
    expect(APPROVAL_POLICY.external_production_change.expirationHours).toBe(4);
    expect(APPROVAL_POLICY.external_payment.expirationHours).toBe(1);
    expect(APPROVAL_POLICY.external_deploy.expirationHours).toBe(1);
  });

  it("a request for an internal action is refused", async () => {
    const h = makeHarness();
    await expect(
      h.approvals.request({ taskId: "t", artifactId: null, actionClass: "write_draft", riskLevel: "low", summary: "Draft", preview: {}, requestedBy: { kind: "system" } }),
    ).rejects.toBeInstanceOf(ApprovalNotRequiredError);
  });

  it("the expiry time follows the class: a production change expires in 4 hours", async () => {
    const h = makeHarness({ start: "2026-11-20T09:00:00.000Z" });
    const approval = await h.approvals.request({ taskId: "t-prod", artifactId: null, actionClass: "external_production_change", riskLevel: "high", summary: "Change", preview: { n: 1 }, requestedBy: { kind: "system" } });
    expect(approval.expiresAt).toBe("2026-11-20T13:00:00.000Z");
  });
});

describe("expiry is enforced on the server", () => {
  it("an approval whose time has passed cannot be approved, and it is expired and the task cancelled", async () => {
    const h = makeHarness();
    const { runId, approval } = await startMarketingUntilApproval(h, "approval-expiry-01");
    h.clock.advance(25 * HOUR);
    await expect(h.orch.decideApproval(approval.id, "approved", OWNER, null)).rejects.toBeInstanceOf(ApprovalExpiredError);

    const after = await h.store.getApproval(approval.id);
    expect(after?.status).toBe("expired");
    const task = (await h.store.listTasksByRunIds([runId])).find((t) => t.id === approval.taskId);
    expect(task?.status).toBe("cancelled");
    expect(h.audit.events.some((e) => e.type === "approval.expired" && e.actor === "system")).toBe(true);
  });

  it("the scheduler sweeps due approvals on every pass, and leaves the rest alone", async () => {
    const h = makeHarness();
    await startMarketingUntilApproval(h, "approval-sweep-01");
    await h.approvals.request({ taskId: "t-later", artifactId: null, actionClass: "external_deploy", riskLevel: "high", summary: "Deploy later", preview: {}, requestedBy: { kind: "system" } });
    // The deploy approval has a 1-hour window, the publication approval 24 hours.
    h.clock.advance(2 * HOUR);
    expect(await h.orch.expireApprovals()).toBe(1);
    expect((await h.store.listApprovals("pending")).map((a) => a.actionClass)).toEqual(["external_publish"]);
    h.clock.advance(23 * HOUR);
    expect(await h.orch.expireApprovals()).toBe(1);
    expect(await h.store.listApprovals("pending")).toHaveLength(0);
  });

  it("an approval inside its window can still be decided", async () => {
    const h = makeHarness();
    const { approval } = await startMarketingUntilApproval(h, "approval-inside-01");
    h.clock.advance(23 * HOUR);
    const result = await h.orch.decideApproval(approval.id, "rejected", OWNER, "Not this week.");
    expect(result.decision).toBe("rejected");
  });
});

describe("duplicate execution and payload binding", () => {
  it("an approved action produces its owner card once; a second decision is refused", async () => {
    const h = makeHarness();
    const { approval } = await startMarketingUntilApproval(h, "approval-dup-01");
    await h.orch.decideApproval(approval.id, "approved", OWNER, null);
    await expect(h.orch.decideApproval(approval.id, "approved", OWNER, null)).rejects.toBeInstanceOf(ConcurrencyError);
    const cards = (await h.store.listArtifacts(500)).filter((a) => a.kind === "owner_action_card");
    expect(cards).toHaveLength(1);
    expect(h.audit.events.filter((e) => e.type === "approval.approved")).toHaveLength(1);
  });

  it("changing the approved payload invalidates the approval", async () => {
    const h = makeHarness();
    const { approval } = await startMarketingUntilApproval(h, "approval-tamper-01");
    const tampered: ApprovalRecord = { ...approval, preview: { changed: "after approval request" } };
    const store = h.store as MemoryTaskStore;
    const original = store.getApproval.bind(store);
    store.getApproval = async (id: string) => (id === approval.id ? tampered : original(id));
    await expect(h.orch.decideApproval(approval.id, "approved", OWNER, null)).rejects.toBeInstanceOf(ApprovalPayloadMismatchError);
    expect(h.audit.events.some((e) => e.type === "approval.payload_mismatch")).toBe(true);
    store.getApproval = original;
    expect((await h.store.getApproval(approval.id))?.status).toBe("pending");
  });

  it("the fingerprint changes when any part of the action changes", () => {
    const base = { actionClass: "external_publish", taskId: "t1", preview: { text: "a" } };
    const same = payloadFingerprint({ ...base, preview: { text: "a" } });
    expect(payloadFingerprint(base)).toBe(same);
    expect(payloadFingerprint({ ...base, preview: { text: "b" } })).not.toBe(same);
    expect(payloadFingerprint({ ...base, taskId: "t2" })).not.toBe(same);
    expect(payloadFingerprint({ ...base, actionClass: "external_send_message" })).not.toBe(same);
    expect(payloadFingerprint({ ...base, preview: { text: "a", extra: 1 } })).not.toBe(same);
  });
});

describe("owner authorization and input validation", () => {
  it("only the owner decides; an agent or the system cannot", async () => {
    const h = makeHarness();
    const { approval } = await startMarketingUntilApproval(h, "approval-auth-01");
    await expect(h.orch.decideApproval(approval.id, "approved", { kind: "agent", agent: "SalesAgent" }, null)).rejects.toBeInstanceOf(ForbiddenActorError);
    await expect(h.orch.decideApproval(approval.id, "approved", { kind: "system" }, null)).rejects.toBeInstanceOf(ForbiddenActorError);
    expect((await h.store.getApproval(approval.id))?.status).toBe("pending");
  });

  it("an owner without an identity cannot decide", async () => {
    const h = makeHarness();
    const { approval } = await startMarketingUntilApproval(h, "approval-auth-02");
    await expect(h.orch.decideApproval(approval.id, "approved", { kind: "owner", id: "   " }, null)).rejects.toBeInstanceOf(ForbiddenActorError);
  });

  it("a decision outside approved or rejected is refused", async () => {
    const h = makeHarness();
    const { approval } = await startMarketingUntilApproval(h, "approval-auth-03");
    await expect(h.orch.decideApproval(approval.id, "expired" as never, OWNER, null)).rejects.toBeInstanceOf(ApprovalInputError);
  });
});

describe("pagination has no fixed cap", () => {
  it("every pending approval is returned, even beyond 200", async () => {
    const h = makeHarness();
    for (let i = 0; i < 450; i++) {
      await h.approvals.request({ taskId: `t-${i}`, artifactId: null, actionClass: "external_send_message", riskLevel: "low", summary: `Message ${i}`, preview: { i }, requestedBy: { kind: "system" } });
    }
    expect(await h.store.listApprovals("pending")).toHaveLength(450);
    const seen: string[] = [];
    let after: { createdAt: string; id: string } | undefined;
    do {
      const page = await h.store.listApprovalsPage({ status: "pending", limit: 100, after });
      seen.push(...page.items.map((a) => a.id));
      after = page.next ?? undefined;
    } while (after);
    expect(new Set(seen).size).toBe(450);
  });
});

describe("the expiry sweep reads past one batch", () => {
  it("expires every due approval in one pass, even beyond a single batch", async () => {
    const h = makeHarness();
    for (let i = 0; i < 1200; i++) {
      await h.approvals.request({ taskId: `t-sweep-${i}`, artifactId: null, actionClass: "external_deploy", riskLevel: "high", summary: `Deploy ${i}`, preview: { i }, requestedBy: { kind: "system" } });
    }
    h.clock.advance(2 * HOUR);
    expect(await h.approvals.expireDue()).toHaveLength(1200);
    expect(await h.store.listApprovals("pending")).toHaveLength(0);
  });
});

describe("the approval policy is consistent", () => {
  it("expiry grows from the decision time, not from the request time", () => {
    const at = new Date("2026-11-20T09:00:00.000Z");
    const classes: ActionClass[] = ["external_publish", "external_payment"];
    expect(classes.map((c) => expiresAtFor(c, at))).toEqual(["2026-11-21T09:00:00.000Z", "2026-11-20T10:00:00.000Z"]);
  });
});
