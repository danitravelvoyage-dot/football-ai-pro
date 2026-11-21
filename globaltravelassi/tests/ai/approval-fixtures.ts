import { CrmService } from "@/lib/ai/crm/service";
import { MemoryCrmStore } from "@/lib/ai/crm/memory-store";
import { MemoryAuditSink } from "@/lib/ai/audit";
import { MemoryReviewStore } from "@/lib/ai/review/store";
import { createReviewCenter } from "@/lib/ai/review/center";
import type { ReviewService } from "@/lib/ai/review/service";
import { MemorySourceStore } from "@/lib/ai/sources/memory-store";
import { SourceService } from "@/lib/ai/sources/service";
import { makeClock, OWNER } from "./helpers";

/**
 * The real approval stack on in-memory stores: review center, CRM, registry. Only the edges are stand-ins: the
 * communication service (counts deliveries) and the orchestrator (counts requeues, and reads a task status).
 */
export function buildApprovalServices(opts: { taskStatus?: string } = {}) {
  const clock = makeClock("2026-11-21T09:00:00.000Z");
  const audit = new MemoryAuditSink();
  const newId = () => crypto.randomUUID();
  const reviewStore = new MemoryReviewStore();
  const crmStore = new MemoryCrmStore();
  const sourceStore = new MemorySourceStore();
  const deliveries: { questionId: string; toAgent: string }[] = [];
  const retries: string[] = [];
  const task = { status: opts.taskStatus ?? "failed" };

  let review: ReviewService | null = null;
  const crm = new CrmService({
    store: crmStore,
    audit,
    now: clock.now,
    newId,
    requestApproval: async (r) => {
      const { item } = await review!.openOnce({
        kind: "crm_transition",
        agent: null,
        runId: null,
        taskId: null,
        leadId: r.leadId,
        subjectRef: r.leadId,
        summary: "Stage move needs approval",
        evidence: { from: r.from, to: r.to },
        payload: { leadId: r.leadId, from: r.from, to: r.to, expectedVersion: r.expectedVersion, reason: r.reason, requestedBy: r.requestedBy },
      });
      return item.id;
    },
  });
  review = createReviewCenter({
    store: reviewStore,
    audit,
    now: clock.now,
    newId,
    crm,
    communication: {
      deliverApproved: async (_actor: unknown, p: { questionId: string; toAgent: string }) => {
        deliveries.push({ questionId: p.questionId, toAgent: p.toAgent });
        return { eventId: `evt-${deliveries.length}` };
      },
    } as never,
    tasks: { getTask: async () => ({ status: task.status }) },
    orchestrator: {
      retryTask: async (taskId: string) => {
        retries.push(taskId);
        task.status = "ready";
      },
    },
  });
  const sources = new SourceService({ store: sourceStore, audit, now: clock.now, newId });
  return { review, crm, sources, audit, reviewStore, crmStore, sourceStore, deliveries, retries, task, clock, newId };
}

export const TEST_OWNER = OWNER;

export const heldPayload = { runId: "run-1", questionId: "q-1", fromAgent: "ResearchAgent", toAgent: "SalesAgent", answer: "Two weeks.", question: "How long?" };
