import { describe, it, expect } from "vitest";
import { CorrectionCenter, CorrectionForbiddenError, MemoryAuditReader } from "@/lib/ai/review/corrections";
import { buildApprovalServices, heldPayload, TEST_OWNER } from "./approval-fixtures";

const AGENT = { kind: "agent" as const, agent: "CRMAgent" as const };
const SYSTEM = { kind: "system" as const };
const REASON = "Checked against the record";

async function decidedItem(svc: ReturnType<typeof buildApprovalServices>, subject = "q-1") {
  const item = await svc.review.open({ kind: "held_answer", agent: "ResearchAgent", runId: "run-1", taskId: null, leadId: null, subjectRef: subject, summary: "Held", evidence: {}, payload: { ...heldPayload, questionId: subject } });
  await svc.review.decide(TEST_OWNER, item.id, "approve", REASON, 1);
  return item;
}

function centerFor(svc: ReturnType<typeof buildApprovalServices>) {
  return new CorrectionCenter(new MemoryAuditReader(svc.audit.events.map((e) => ({ id: e.id, ts: e.ts, actor: e.actor, type: e.type, entityId: e.entityId, meta: e.meta }))));
}

describe("correction center: what the owner sees", () => {
  it("shows the original decision, the correction, who made it and when, and the reason", async () => {
    const svc = buildApprovalServices();
    const item = await decidedItem(svc);
    await svc.review.recordCorrection(TEST_OWNER, item.id, "Sent to the wrong agent");
    const rows = await centerFor(svc).list(TEST_OWNER);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      reviewId: item.id,
      kind: "held_answer",
      originalStatus: "approved",
      originalDecidedBy: TEST_OWNER.id,
      originalReason: REASON,
      correctionReason: "Sent to the wrong agent",
      actor: `owner:${TEST_OWNER.id}`,
    });
    expect(rows[0]!.originalDecidedAt).toBeTruthy();
    expect(rows[0]!.timestamp).toBeTruthy();
  });

  it("lists the newest correction first", async () => {
    const svc = buildApprovalServices();
    const a = await decidedItem(svc, "q-a");
    const b = await decidedItem(svc, "q-b");
    await svc.review.recordCorrection(TEST_OWNER, a.id, "First correction");
    svc.clock.advance(60_000);
    await svc.review.recordCorrection(TEST_OWNER, b.id, "Second correction");
    const rows = await centerFor(svc).list(TEST_OWNER);
    expect(rows.map((r) => r.correctionReason)).toEqual(["Second correction", "First correction"]);
  });

  it("is empty until a correction is recorded", async () => {
    const svc = buildApprovalServices();
    await decidedItem(svc);
    expect(await centerFor(svc).list(TEST_OWNER)).toEqual([]);
  });

  it("only the owner can read corrections", async () => {
    const svc = buildApprovalServices();
    const center = centerFor(svc);
    await expect(center.list(AGENT)).rejects.toBeInstanceOf(CorrectionForbiddenError);
    await expect(center.list(SYSTEM)).rejects.toBeInstanceOf(CorrectionForbiddenError);
    await expect(center.list({ kind: "owner", id: " " })).rejects.toBeInstanceOf(CorrectionForbiddenError);
  });
});

describe("correction center: nothing rewritten", () => {
  it("each correction adds exactly one audit event, and the decision and its item are unchanged", async () => {
    const svc = buildApprovalServices();
    const item = await decidedItem(svc);
    const decisionsBefore = svc.audit.events.filter((e) => e.type === "review.decided");
    const itemBefore = await svc.reviewStore.get(item.id);
    const countBefore = svc.audit.events.length;

    await svc.review.recordCorrection(TEST_OWNER, item.id, "First correction");
    await svc.review.recordCorrection(TEST_OWNER, item.id, "Second correction");

    expect(svc.audit.events.length).toBe(countBefore + 2);
    expect(svc.audit.events.filter((e) => e.type === "review.correction_recorded")).toHaveLength(2);
    expect(svc.audit.events.filter((e) => e.type === "review.decided")).toEqual(decisionsBefore);
    expect(await svc.reviewStore.get(item.id)).toEqual(itemBefore);
  });

  it("a refused correction writes nothing", async () => {
    const svc = buildApprovalServices();
    const item = await svc.review.open({ kind: "held_answer", agent: null, runId: null, taskId: null, leadId: null, subjectRef: "q-open", summary: "Held", evidence: {}, payload: heldPayload });
    const countBefore = svc.audit.events.length;
    await expect(svc.review.recordCorrection(TEST_OWNER, item.id, "Too early")).rejects.toMatchObject({ code: "not_decided" });
    await expect(svc.review.recordCorrection(AGENT, item.id, "Not allowed")).rejects.toThrow();
    expect(svc.audit.events.length).toBe(countBefore);
  });
});
