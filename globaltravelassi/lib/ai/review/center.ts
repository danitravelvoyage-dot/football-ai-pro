import type { Actor, AgentKey } from "../types";
import type { AuditSink } from "../audit";
import type { CrmService } from "../crm/service";
import type { CommunicationService } from "../collaboration/communication";
import { ReviewService, type ReviewStore } from "./service";

/** The approval center's effects and prechecks. Each decision applies only through the service that owns the thing. */
export interface ReviewCenterDeps {
  store: ReviewStore;
  audit: AuditSink;
  now: () => Date;
  newId: () => string;
  crm: Pick<CrmService, "checkApprovedTransition" | "applyApprovedTransition">;
  communication: Pick<CommunicationService, "deliverApproved">;
}

/** The fields a held answer keeps in its payload. */
interface HeldAnswerPayload {
  runId: string;
  questionId: string;
  fromAgent: AgentKey;
  toAgent: AgentKey;
  answer: string;
  question: string;
}

interface CrmTransitionPayload {
  leadId: string;
  from: "new" | "contacted" | "qualified" | "interested" | "converted" | "lost";
  to: "new" | "contacted" | "qualified" | "interested" | "converted" | "lost";
  expectedVersion: number;
  reason: string | null;
  requestedBy: string;
}

/**
 * Builds the owner's approval center. The effect of an approval runs only after the decision is recorded. The precheck
 * of a CRM transition runs before it, so an approval for a lead that has since changed is refused and not recorded.
 *
 * Rejected proposals have no effect yet: the orchestrator has no retry entry point, so `request_revision` only records the
 * owner's request. Escalated claims and stage disagreements are recorded decisions with no automatic follow-up.
 */
export function createReviewCenter(deps: ReviewCenterDeps): ReviewService {
  const ownerOf = (actor: string): Actor => ({ kind: "owner", id: actor });
  return new ReviewService({
    store: deps.store,
    audit: deps.audit,
    now: deps.now,
    newId: deps.newId,
    prechecks: {
      crm_transition: async (item) => {
        const p = item.payload as unknown as CrmTransitionPayload;
        await deps.crm.checkApprovedTransition({ leadId: p.leadId, from: p.from, expectedVersion: p.expectedVersion });
      },
    },
    effects: {
      crm_transition: async (item, decision, actor) => {
        if (decision !== "approve") return { applied: false };
        const p = item.payload as unknown as CrmTransitionPayload;
        const lead = await deps.crm.applyApprovedTransition(actor, { leadId: p.leadId, from: p.from, to: p.to, expectedVersion: p.expectedVersion, reason: p.reason });
        return { applied: true, stage: lead.stage, version: lead.version };
      },
      held_answer: async (item, decision, actor) => {
        if (decision !== "approve") return { delivered: false };
        const p = item.payload as unknown as HeldAnswerPayload;
        const r = await deps.communication.deliverApproved(ownerOf(actor), { runId: p.runId, questionId: p.questionId, fromAgent: p.fromAgent, toAgent: p.toAgent, answer: p.answer });
        return { delivered: true, eventId: r.eventId };
      },
      rejected_proposal: async (_item, decision) => ({ recorded: true, revisionRequested: decision === "request_revision" }),
      escalated_claim: async () => ({ recorded: true }),
      crm_stage_disagreement: async () => ({ recorded: true }),
    },
  });
}
