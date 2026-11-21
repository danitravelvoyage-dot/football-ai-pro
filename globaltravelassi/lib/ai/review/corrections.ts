import type { Actor } from "../types";

/** Reads audit events by type. Corrections are read from the same append-only trail that holds the decisions. */
export interface AuditReader {
  listEvents(filter: { eventType: string; limit: number }): Promise<AuditEventRow[]>;
}

export interface AuditEventRow {
  id: string;
  ts: string;
  actor: string;
  entityId: string;
  meta: Record<string, unknown>;
}

/** A correction, as the owner reads it: the original decision quoted, the correction, who made it and when. */
export interface CorrectionRecord {
  id: string;
  reviewId: string;
  kind: string;
  originalStatus: string;
  originalDecidedBy: string | null;
  originalDecidedAt: string | null;
  originalReason: string | null;
  correctionReason: string;
  actor: string;
  timestamp: string;
}

export class CorrectionForbiddenError extends Error {
  constructor() {
    super("Only the owner can read corrections.");
    this.name = "CorrectionForbiddenError";
  }
}

/** The owner's view of corrections. Read only: a correction is written by the review service, never edited here. */
export class CorrectionCenter {
  constructor(private readonly reader: AuditReader) {}

  async list(actor: Actor, limit = 200): Promise<CorrectionRecord[]> {
    if (actor.kind !== "owner" || actor.id.trim().length === 0) throw new CorrectionForbiddenError();
    const rows = await this.reader.listEvents({ eventType: "review.correction_recorded", limit });
    return rows
      .map((r) => ({
        id: r.id,
        reviewId: r.entityId,
        kind: String(r.meta.kind ?? ""),
        originalStatus: String(r.meta.originalStatus ?? ""),
        originalDecidedBy: (r.meta.originalDecidedBy as string | null) ?? null,
        originalDecidedAt: (r.meta.originalDecidedAt as string | null) ?? null,
        originalReason: (r.meta.originalReason as string | null) ?? null,
        correctionReason: String(r.meta.correctionReason ?? ""),
        actor: r.actor,
        timestamp: r.ts,
      }))
      .sort((a, b) => b.timestamp.localeCompare(a.timestamp));
  }
}

/** Reads the audit trail from memory. Used by tests and local runs. */
export class MemoryAuditReader implements AuditReader {
  constructor(private readonly events: { id: string; ts: string; actor: string; type: string; entityId: string; meta: Record<string, unknown> }[]) {}

  async listEvents(filter: { eventType: string; limit: number }): Promise<AuditEventRow[]> {
    return this.events
      .filter((e) => e.type === filter.eventType)
      .slice(0, filter.limit)
      .map((e) => ({ id: e.id, ts: e.ts, actor: e.actor, entityId: e.entityId, meta: e.meta }));
  }
}
