import { describe, it, expect } from "vitest";
import { CrmRequiresApprovalError } from "@/lib/ai/crm/service";
import { ReviewForbiddenError, ReviewRuleError } from "@/lib/ai/review/service";
import { buildApprovalServices, heldPayload, TEST_OWNER } from "./approval-fixtures";

const AGENT = { kind: "agent" as const, agent: "CRMAgent" as const };
const SYSTEM = { kind: "system" as const };
const REASON = "Checked against the record";

async function decidedHeldAnswer() {
  const svc = buildApprovalServices();
  const item = await svc.review.open({ kind: "held_answer", agent: "ResearchAgent", runId: "run-1", taskId: null, leadId: null, subjectRef: "q-1", summary: "Held", evidence: {}, payload: heldPayload });
  await svc.review.decide(TEST_OWNER, item.id, "approve", REASON, 1);
  return { svc, id: item.id };
}

describe("corrections never rewrite a decision", () => {
  it("refuses to correct an item that has no decision yet", async () => {
    const svc = buildApprovalServices();
    const item = await svc.review.open({ kind: "held_answer", agent: null, runId: null, taskId: null, leadId: null, subjectRef: "q-2", summary: "Held", evidence: {}, payload: heldPayload });
    await expect(svc.review.recordCorrection(TEST_OWNER, item.id, "Wrong item")).rejects.toMatchObject({ code: "not_decided" });
    expect(svc.audit.events.some((e) => e.type === "review.correction_recorded")).toBe(false);
  });

  it("refuses agents and the system", async () => {
    const { svc, id } = await decidedHeldAnswer();
    for (const actor of [AGENT, SYSTEM]) {
      await expect(svc.review.recordCorrection(actor, id, "Not for them")).rejects.toBeInstanceOf(ReviewForbiddenError);
    }
    expect(svc.audit.events.some((e) => e.type === "review.correction_recorded")).toBe(false);
  });

  it("records the correction with the original decision quoted, and leaves the item and its decision unchanged", async () => {
    const { svc, id } = await decidedHeldAnswer();
    const before = await svc.reviewStore.get(id);
    const decidedEvent = svc.audit.events.find((e) => e.type === "review.decided")!;

    await svc.review.recordCorrection(TEST_OWNER, id, "Answer was sent to the wrong agent");

    const after = await svc.reviewStore.get(id);
    expect(after).toEqual(before);
    const correction = svc.audit.events.find((e) => e.type === "review.correction_recorded")!;
    expect(correction).toMatchObject({
      actor: `owner:${TEST_OWNER.id}`,
      entityId: id,
      meta: {
        correctionReason: "Answer was sent to the wrong agent",
        originalStatus: "approved",
        originalDecidedBy: TEST_OWNER.id,
        originalReason: REASON,
      },
    });
    expect(correction.ts).toBeTruthy();
    // The original decision entry is still there, unchanged.
    expect(svc.audit.events.find((e) => e.type === "review.decided")).toBe(decidedEvent);
  });

  it("validates the correction reason", async () => {
    const { svc, id } = await decidedHeldAnswer();
    await expect(svc.review.recordCorrection(TEST_OWNER, id, " x ")).rejects.toBeInstanceOf(ReviewRuleError);
    await expect(svc.review.recordCorrection(TEST_OWNER, id, "x".repeat(501))).rejects.toBeInstanceOf(ReviewRuleError);
  });

  it("a correction does not undo a delivered answer: the delivery count stays at one", async () => {
    const { svc, id } = await decidedHeldAnswer();
    await svc.review.recordCorrection(TEST_OWNER, id, "Delivered by mistake, owner follows up");
    expect(svc.deliveries).toHaveLength(1);
  });
});

describe("no duplicate approvals for the same decision", () => {
  it("the same held answer asked for twice is one open item", async () => {
    const svc = buildApprovalServices();
    const a = await svc.review.openOnce({ kind: "held_answer", agent: "ResearchAgent", runId: "run-1", taskId: null, leadId: null, subjectRef: "q-1", summary: "Held", evidence: {}, payload: heldPayload });
    const b = await svc.review.openOnce({ kind: "held_answer", agent: "ResearchAgent", runId: "run-1", taskId: null, leadId: null, subjectRef: "q-1", summary: "Held again", evidence: {}, payload: heldPayload });
    expect(a.created).toBe(true);
    expect(b).toMatchObject({ created: false, item: { id: a.item.id } });
    expect(await svc.reviewStore.list({ kind: "held_answer", limit: 10 })).toHaveLength(1);
  });

  it("a different payload is a different decision and opens its own item", async () => {
    const svc = buildApprovalServices();
    const a = await svc.review.openOnce({ kind: "held_answer", agent: null, runId: null, taskId: null, leadId: null, subjectRef: "q-1", summary: "Held", evidence: {}, payload: heldPayload });
    const b = await svc.review.openOnce({ kind: "held_answer", agent: null, runId: null, taskId: null, leadId: null, subjectRef: "q-1", summary: "Held", evidence: {}, payload: { ...heldPayload, answer: "Three weeks." } });
    expect(b.created).toBe(true);
    expect(b.item.id).not.toBe(a.item.id);
  });

  it("asking twice for the same CRM reopen gives the owner one approval, not two", async () => {
    const svc = buildApprovalServices();
    const lead = await svc.crm.createLead(TEST_OWNER, { label: "Enquiry", source: "manual", applicationId: null, destinationCountry: "FR", nationality: "DZ", travelDate: null, interest: "visa" });
    const lost = await svc.crm.changeStage(TEST_OWNER, lead.id, { to: "lost", reason: "No reply", expectedVersion: lead.version });
    const ids: string[] = [];
    for (let i = 0; i < 2; i++) {
      try {
        await svc.crm.changeStage(TEST_OWNER, lead.id, { to: "new", reason: null, expectedVersion: lost.version });
      } catch (error) {
        expect(error).toBeInstanceOf(CrmRequiresApprovalError);
        ids.push((error as CrmRequiresApprovalError).reviewId);
      }
    }
    expect(ids).toHaveLength(2);
    expect(ids[0]).toBe(ids[1]);
    expect(await svc.reviewStore.list({ kind: "crm_transition", limit: 10 })).toHaveLength(1);
  });
});
