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
  /** The engine's task state and owner retry. A revision request requeues the original task through `retryTask`. */
  tasks: { getTask(id: string): Promise<{ status: string } | null> };
  orchestrator: { retryTask(taskId: string, actor: Actor): Promise<void> };
  /** The source registry. A reactivation is applied here, after the owner approves it. */
  registry: {
    status(host: string): Promise<{ status: string; version: number } | null>;
    reactivate(actor: Actor, host: string, version: number, reviewId: string, reason: string): Promise<unknown>;
  };
}

interface ReactivationPayload {
  host: string;
  version: number;
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

interface RejectedPayload {
  taskId: string;
  runId: string;
  agent: AgentKey;
  stepKey: string;
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
 * A rejected proposal's `request_revision` requeues the original task through the orchestrator, and only when that task is
 * still failed. Escalated claims and stage disagreements are recorded decisions with no automatic follow-up.
 */
export function createReviewCenter(deps: ReviewCenterDeps): ReviewService {
  const ownerOf = (actor: string): Actor => ({ kind: "owner", id: actor });
  return new ReviewService({
    store: deps.store,
    audit: deps.audit,
    now: deps.now,
    newId: deps.newId,
    prechecks: {
      crm_transition: async (item, decision) => {
        if (decision !== "approve") return;
        const p = item.payload as unknown as CrmTransitionPayload;
        await deps.crm.checkApprovedTransition({ leadId: p.leadId, from: p.from, expectedVersion: p.expectedVersion });
      },
      // A revision is refused, and not recorded, unless its task is still failed. This stops a second request from
      // queuing the same task twice.
      source_reactivation: async (item, decision) => {
        if (decision !== "approve") return;
        const p = item.payload as unknown as ReactivationPayload;
        const now = await deps.registry.status(p.host);
        // The host must still be retired at the version the request named. Otherwise the approval is stale.
        if (!now || now.status !== "retired" || now.version !== p.version) throw new Error("The source changed since the request.");
      },
      rejected_proposal: async (item, decision) => {
        if (decision !== "request_revision") return;
        const p = item.payload as unknown as RejectedPayload;
        const task = await deps.tasks.getTask(p.taskId);
        if (!task || task.status !== "failed") throw new Error("The task is no longer failed.");
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
      rejected_proposal: async (item, decision, actor) => {
        if (decision !== "request_revision") return { requeued: false };
        const p = item.payload as unknown as RejectedPayload;
        await deps.orchestrator.retryTask(p.taskId, ownerOf(actor));
        return { requeued: true, taskId: p.taskId };
      },
      source_reactivation: async (item, decision, actor) => {
        if (decision !== "approve") return { reactivated: false };
        const p = item.payload as unknown as ReactivationPayload;
        await deps.registry.reactivate(ownerOf(actor), p.host, p.version, item.id, item.decisionReason ?? "Reactivation approved");
        return { reactivated: true, host: p.host };
      },
      escalated_claim: async () => ({ recorded: true }),
      crm_stage_disagreement: async () => ({ recorded: true }),
    },
  });
}
