import { isExternalAction, type Actor, type ActionClass } from "./types";
import type { AuditSink } from "./audit";
import type { ApprovalRecord, ArtifactRecord } from "./orchestration/records";
import type { TaskStore } from "./orchestration/store";

export class ForbiddenActorError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ForbiddenActorError";
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

/**
 * Owner approval workflow. Only the owner can decide. An approved external action becomes an
 * "owner action card" for the owner to carry out manually. It is never executed by the platform.
 */
export class ApprovalService {
  constructor(private readonly deps: ApprovalServiceDeps) {}

  private actorLabel(actor: Actor): string {
    if (actor.kind === "owner") return `owner:${actor.id}`;
    if (actor.kind === "agent") return `agent:${actor.agent}`;
    return "system";
  }

  async request(input: ApprovalRequest): Promise<ApprovalRecord> {
    const approval = await this.deps.store.createApproval({
      id: this.deps.newId(),
      taskId: input.taskId,
      artifactId: input.artifactId,
      actionClass: input.actionClass,
      riskLevel: input.riskLevel,
      summary: input.summary.slice(0, 500),
      preview: input.preview,
    });
    await this.deps.audit.write({
      id: this.deps.newId(),
      ts: this.deps.now().toISOString(),
      actor: this.actorLabel(input.requestedBy),
      type: "approval.requested",
      entityType: "approval",
      entityId: approval.id,
      meta: { actionClass: input.actionClass, riskLevel: input.riskLevel, taskId: input.taskId },
    });
    return approval;
  }

  async decide(
    approvalId: string,
    decision: "approved" | "rejected",
    actor: Actor,
    note: string | null,
  ): Promise<{ approval: ApprovalRecord; card: ArtifactRecord | null }> {
    if (actor.kind !== "owner") {
      throw new ForbiddenActorError("Only the owner can decide an approval.");
    }
    const approval = await this.deps.store.decideApproval(
      approvalId,
      decision,
      actor.id,
      note,
      this.deps.now().toISOString(),
    );

    let card: ArtifactRecord | null = null;
    if (decision === "approved" && isExternalAction(approval.actionClass)) {
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

    await this.deps.audit.write({
      id: this.deps.newId(),
      ts: this.deps.now().toISOString(),
      actor: this.actorLabel(actor),
      type: `approval.${decision}`,
      entityType: "approval",
      entityId: approval.id,
      meta: { actionClass: approval.actionClass, cardId: card?.id ?? null },
    });
    return { approval, card };
  }
}
