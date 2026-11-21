import { describe, it, expect } from "vitest";
import { REVIEW_KINDS, DECISIONS, ALLOWED_DECISIONS, DECISION_TO_STATUS, type Decision, type ReviewKind } from "@/lib/ai/review/rules";
import { ReviewForbiddenError, ReviewRuleError, type ReviewOpenInput } from "@/lib/ai/review/service";
import { buildApprovalServices, heldPayload, TEST_OWNER } from "./approval-fixtures";

const AGENT = { kind: "agent" as const, agent: "CRMAgent" as const };
const SYSTEM = { kind: "system" as const };
const REASON = "Checked against the record";

/** A fresh, open item of each kind, with the payload its effect needs. */
async function openItem(kind: ReviewKind, svc: ReturnType<typeof buildApprovalServices>) {
  const base = { agent: null, runId: null, taskId: null, leadId: null, subjectRef: `subject-${kind}`, summary: `Item ${kind}`, evidence: { codes: ["x"] } };
  const lead = kind === "crm_transition" ? await svc.crm.createLead(TEST_OWNER, { label: "Enquiry", source: "manual", applicationId: null, destinationCountry: "FR", nationality: "DZ", travelDate: null, interest: "visa" }) : null;
  const payloads: Record<ReviewKind, Record<string, unknown>> = {
    held_answer: heldPayload,
    escalated_claim: { claim: "x" },
    crm_stage_disagreement: { leadId: "l", recordStage: "new" },
    rejected_proposal: { taskId: "task-1", runId: "run-1", agent: "ResearchAgent", stepKey: "research" },
    crm_transition: { leadId: lead?.id, from: "new", to: "contacted", expectedVersion: 1, reason: null, requestedBy: TEST_OWNER.id },
  };
  const input: ReviewOpenInput = {
    kind,
    ...base,
    taskId: kind === "rejected_proposal" ? "task-1" : null,
    leadId: lead?.id ?? null,
    subjectRef: lead?.id ?? base.subjectRef,
    payload: payloads[kind],
  } as ReviewOpenInput;
  return svc.review.open(input);
}

describe("every review item type: who may decide, and what each allowed decision does", () => {
  for (const kind of REVIEW_KINDS) {
    for (const decision of DECISIONS as readonly Decision[]) {
      const allowed = ALLOWED_DECISIONS[kind].includes(decision);

      it(`${kind} / ${decision}: owner ${allowed ? "may" : "may not"} decide; agents and the system never can`, async () => {
        const svc = buildApprovalServices();
        const item = await openItem(kind, svc);

        for (const actor of [AGENT, SYSTEM]) {
          await expect(svc.review.decide(actor, item.id, decision, REASON, 1)).rejects.toBeInstanceOf(ReviewForbiddenError);
        }
        expect((await svc.reviewStore.get(item.id))?.status).toBe("open");
        expect(svc.deliveries).toHaveLength(0);
        expect(svc.retries).toHaveLength(0);

        if (!allowed) {
          await expect(svc.review.decide(TEST_OWNER, item.id, decision, REASON, 1)).rejects.toMatchObject({ code: "not_allowed_for_kind" });
          expect((await svc.reviewStore.get(item.id))?.status).toBe("open");
          return;
        }

        const { item: decided } = await svc.review.decide(TEST_OWNER, item.id, decision, REASON, 1);
        expect(decided.status).toBe(DECISION_TO_STATUS[decision]);
        expect(decided.decidedBy).toBe(TEST_OWNER.id);

        // The effect: only the kinds that have one act, and only on the decisions that should.
        if (kind === "held_answer" && decision === "approve") expect(svc.deliveries).toEqual([{ questionId: "q-1", toAgent: "SalesAgent" }]);
        else if (kind === "rejected_proposal" && decision === "request_revision") expect(svc.retries).toEqual(["task-1"]);
        else if (kind === "crm_transition" && decision === "approve") {
          const lead = (await svc.crmStore.listLeads({ includeArchived: false, limit: 10 }))[0];
          expect(lead?.stage).toBe("contacted");
        } else {
          expect(svc.deliveries).toHaveLength(0);
          expect(svc.retries).toHaveLength(0);
        }
      });
    }
  }

  it("a rejected proposal can never be approved, which would mean a task runs without its output being reviewed", async () => {
    const svc = buildApprovalServices();
    const item = await openItem("rejected_proposal", svc);
    await expect(svc.review.decide(TEST_OWNER, item.id, "approve", REASON, 1)).rejects.toBeInstanceOf(ReviewRuleError);
    expect(svc.retries).toHaveLength(0);
  });
});
