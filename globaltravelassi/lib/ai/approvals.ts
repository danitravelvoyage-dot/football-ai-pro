import { z } from "zod";
import { isExternalAction, type Actor, type ActionClass } from "./types";
import type { AuditSink } from "./audit";
import type { ApprovalRecord, ArtifactRecord } from "./orchestration/records";
import type { TaskStore } from "./orchestration/store";
import { approvalRequiredFor, expiresAtFor, isExpired } from "./approvals/policy";
import { payloadFingerprint } from "./approvals/payload";

export class ForbiddenActorError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ForbiddenActorError";
  }
}

export class ApprovalNotRequiredError extends Error {
  constructor(public readonly action: ActionClass) {
    super(`Action "${action}" does not need owner approval.`);
    this.name = "ApprovalNotRequiredError";
  }
}

export class ApprovalExpiredError extends Error {
  constructor(
    public readonly approvalId: string,
    public readonly taskId: string,
  ) {
    super("This approval has expired. The action was not carried out.");
    this.name = "ApprovalExpiredError";
  }
}

export class ApprovalPayloadMismatchError extends Error {
  constructor(public readonly approvalId: string) {
    super("The action no longer matches what was approved. Request a new approval.");
    this.name = "ApprovalPayloadMismatchError";
  }
}

export class ApprovalInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ApprovalInputError";
  }
}

export interface ApprovalRequest {
  taskId: string;
  artifactId: string | null;
  actionClass: ActionClass;
  riskLevel: "low" | "medium" | "high";
  summary: string;
  preview: unknown;
  requestedBy: Actor;
}

export interface ApprovalServiceDeps {
  store: TaskStore;
  audit: AuditSink;
  now: () => Date;
  newId: () => string;
}

const decisionSchema = z.object({
  approvalId: z.string().min(1).max(80),
  decision: z.enum(["approved", "rejected"]),
  note: z.string().max(500).nullable(),
});

/**
 * Owner approval workflow. Only the owner can decide. Expiry, the payload fingerprint and the one-time
 * execution claim are enforced here and, for the Supabase store, again in the database (migration 0007).
 * An approved external action becomes an "owner action card" for the owner to carry out manually.
 * The platform never executes it.
 */
export class ApprovalService {
  constructor(private readonly deps: ApprovalServiceDeps) {}

  private actorLabel(actor: Actor): string {
    if (actor.kind === "owner") return `owner:${actor.id}`;
    if (actor.kind === "agent") return `agent:${actor.agent}`;
    return "system";
  }

  async request(input: ApprovalRequest): Promise<ApprovalRecord> {
    if (!approvalRequiredFor(input.actionClass)) throw new ApprovalNotRequiredError(input.actionClass);
    const now = this.deps.now();
    const approval = await this.deps.store.createApproval({
      id: this.deps.newId(),
      taskId: input.taskId,
      artifactId: input.artifactId,
      actionClass: input.actionClass,
      riskLevel: input.riskLevel,
      summary: input.summary.slice(0, 500),
      preview: input.preview,
      expiresAt: expiresAtFor(input.actionClass, now),
      payloadHash: payloadFingerprint({ actionClass: input.actionClass, taskId: input.taskId, preview: input.preview }),
    });
    await this.deps.audit.write({
      id: this.deps.newId(),
      ts: now.toISOString(),
      actor: this.actorLabel(input.requestedBy),
      type: "approval.requested",
      entityType: "approval",
      entityId: approval.id,
      meta: { actionClass: input.actionClass, riskLevel: input.riskLevel, taskId: input.taskId, expiresAt: approval.expiresAt },
    });
    return approval;
  }

  async decide(
    approvalId: string,
    decision: "approved" | "rejected",
    actor: Actor,
    note: string | null,
  ): Promise<{ approval: ApprovalRecord; card: ArtifactRecord | null }> {
    if (actor.kind !== "owner") throw new ForbiddenActorError("Only the owner can decide an approval.");
    if (actor.id.trim().length === 0) throw new ForbiddenActorError("The owner identity is missing.");

    const parsed = decisionSchema.safeParse({ approvalId, decision, note });
    if (!parsed.success) throw new ApprovalInputError(parsed.error.issues[0]?.message ?? "Decision is invalid.");

    const current = await this.deps.store.getApproval(approvalId);
    if (!current) throw new ApprovalInputError("Approval not found.");

    const now = this.deps.now();
    const nowIso = now.toISOString();
    if (current.status === "pending" && isExpired(current.expiresAt, now)) {
      await this.expireOne(current, nowIso);
      throw new ApprovalExpiredError(current.id, current.taskId);
    }

    if (payloadFingerprint({ actionClass: current.actionClass, taskId: current.taskId, preview: current.preview }) !== current.payloadHash) {
      await this.deps.audit.write({
        id: this.deps.newId(),
        ts: nowIso,
        actor: this.actorLabel(actor),
        type: "approval.payload_mismatch",
        entityType: "approval",
        entityId: current.id,
        meta: { actionClass: current.actionClass },
      });
      throw new ApprovalPayloadMismatchError(current.id);
    }

    const approval = await this.deps.store.decideApproval(approvalId, parsed.data.decision, actor.id, parsed.data.note, nowIso);

    let card: ArtifactRecord | null = null;
    if (parsed.data.decision === "approved" && isExternalAction(approval.actionClass)) {
      // Claimed once. A second claim returns false and no second card is created.
      const claimed = await this.deps.store.markExecuted(approval.id, nowIso);
      if (claimed) {
        const task = await this.deps.store.getTask(approval.taskId);
        card = await this.deps.store.saveArtifact({
          id: this.deps.newId(),
          taskId: approval.taskId,
          agent: task?.agent ?? "COOAgent",
          kind: "owner_action_card",
          language: task?.input.language ?? "fr",
          country: task?.input.country ?? "all",
          body: {
            action: approval.actionClass,
            summary: approval.summary,
            preview: approval.preview,
            notice: "Not executed by the platform. The owner performs this action manually.",
          },
          status: "awaiting_owner",
          source: "deterministic",
          promptVersion: null,
        });
      }
    }

    await this.deps.audit.write({
      id: this.deps.newId(),
      ts: nowIso,
      actor: this.actorLabel(actor),
      type: `approval.${parsed.data.decision}`,
      entityType: "approval",
      entityId: approval.id,
      meta: { actionClass: approval.actionClass, cardId: card?.id ?? null },
    });
    return { approval, card };
  }

  /** Expires every pending approval whose time has passed. Returns the ones it expired. */
  async expireDue(): Promise<ApprovalRecord[]> {
    const nowIso = this.deps.now().toISOString();
    const expired: ApprovalRecord[] = [];
    // Each round reads one batch of due items and expires them. Expired items leave the due set,
    // so the loop ends when nothing is due. A round that expires nothing also ends it, so it cannot spin.
    for (;;) {
      const due = await this.deps.store.listExpiredPending(nowIso);
      if (due.length === 0) return expired;
      let progressed = false;
      for (const approval of due) {
        try {
          expired.push(await this.expireOne(approval, nowIso));
          progressed = true;
        } catch {
          // Already decided by someone else in the meantime. Nothing to expire.
        }
      }
      if (!progressed) return expired;
    }
  }

  private async expireOne(approval: ApprovalRecord, nowIso: string): Promise<ApprovalRecord> {
    const updated = await this.deps.store.expireApproval(approval.id, nowIso);
    await this.deps.audit.write({
      id: this.deps.newId(),
      ts: nowIso,
      actor: "system",
      type: "approval.expired",
      entityType: "approval",
      entityId: approval.id,
      meta: { actionClass: approval.actionClass, expiresAt: approval.expiresAt, taskId: approval.taskId },
    });
    return updated;
  }
}
