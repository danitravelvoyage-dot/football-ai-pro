import type { AuditSink } from "../audit";
import type { Actor } from "../types";
import { OwnerOnlyError, resolveConflict } from "./consensus";
import type { CollaborationStore, ConflictRecord, PanelRecord, RoutingRecord } from "./store";

export class ConflictNotFoundError extends Error {
  constructor() {
    super("Conflict not found.");
    this.name = "ConflictNotFoundError";
  }
}

export interface CollaborationServiceDeps {
  store: CollaborationStore;
  audit: AuditSink;
  now: () => Date;
  newId: () => string;
}

/**
 * Owner-facing reads and decisions for the multi-agent layer. Every read and every decision is owner-only.
 * Resolving a conflict is final and audited with the resolver and the time, not the resolution text.
 */
export class CollaborationService {
  constructor(private readonly deps: CollaborationServiceDeps) {}

  private owner(actor: Actor): string {
    if (actor.kind !== "owner" || actor.id.trim().length === 0) throw new OwnerOnlyError();
    return actor.id;
  }

  async listConflicts(actor: Actor, filter: { status?: "open" | "resolved"; limit: number }): Promise<ConflictRecord[]> {
    this.owner(actor);
    return this.deps.store.listConflicts(filter);
  }

  async listPanels(actor: Actor, filter: { runId?: string; limit: number }): Promise<PanelRecord[]> {
    this.owner(actor);
    return this.deps.store.listPanels(filter);
  }

  async listRouting(actor: Actor, filter: { runId?: string; limit: number }): Promise<RoutingRecord[]> {
    this.owner(actor);
    return this.deps.store.listRouting(filter);
  }

  async resolveConflict(actor: Actor, conflictId: string, resolution: string): Promise<ConflictRecord> {
    const by = this.owner(actor);
    const current = await this.deps.store.getConflict(conflictId);
    if (!current) throw new ConflictNotFoundError();
    // The pure rule checks the owner, the state and the text; the stored record keeps every other field as it was.
    const decided = resolveConflict(
      actor,
      { id: current.id, subjectKey: current.subjectKey, parties: current.parties, status: current.status, resolvedBy: current.resolvedBy, resolution: current.resolution },
      resolution,
    );
    const at = this.deps.now().toISOString();
    const final: ConflictRecord = { ...current, status: "resolved", resolution: decided.resolution, resolvedBy: decided.resolvedBy, resolvedAt: at };
    await this.deps.store.resolveConflict(final);
    await this.deps.audit.write({
      id: this.deps.newId(),
      ts: at,
      actor: `owner:${by}`,
      type: "conflict.resolved",
      entityType: "conflict",
      entityId: conflictId,
      meta: { runId: current.runId, parties: current.parties.length },
    });
    return final;
  }
}
