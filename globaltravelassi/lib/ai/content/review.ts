import type { AuditSink } from "../audit";
import type { ArtifactRecord } from "../orchestration/records";
import type { ContextService } from "../context/service";
import { assertNoPersonalData, PersonalDataError } from "../security/personal-data";
import type { Actor, AgentKey } from "../types";

export class ContentForbiddenError extends Error {
  constructor(message = "Only the owner reviews content.") {
    super(message);
    this.name = "ContentForbiddenError";
  }
}
export class ContentRuleError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ContentRuleError";
  }
}
export class ContentInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ContentInputError";
  }
}

export const REVIEW_DECISIONS = ["approved", "rejected", "revision_requested"] as const;
export type ReviewDecision = (typeof REVIEW_DECISIONS)[number];

export interface ReviewRow {
  id: string;
  artifactId: string;
  decision: ReviewDecision;
  note: string | null;
  reviewer: string;
  reviewedAt: string;
}

/** Storage contract for the content pipeline. */
export interface ContentStore {
  list(statuses: ArtifactRecord["status"][], limit: number): Promise<ArtifactRecord[]>;
  get(id: string): Promise<ArtifactRecord | null>;
  setStatus(id: string, status: ArtifactRecord["status"]): Promise<void>;
  addReview(row: ReviewRow): Promise<void>;
  reviews(artifactId: string): Promise<ReviewRow[]>;
}

/** The status a decision moves an item to. */
export const DECISION_STATUS: Record<ReviewDecision, ArtifactRecord["status"]> = {
  approved: "approved",
  rejected: "rejected",
  revision_requested: "draft",
};

export interface ContentReviewDeps {
  store: ContentStore;
  context: ContextService;
  audit: AuditSink;
  now: () => Date;
  newId: () => string;
  /** The latest quality review of a task, or null when none exists. Read-only. */
  latestQuality: (taskId: string) => Promise<{ status: string; overall: number } | null>;
}

export const FEEDBACK_CONTEXT_KEY = "owner.content_feedback";

const owner = (actor: Actor): string => {
  if (actor.kind !== "owner" || actor.id.trim().length === 0) throw new ContentForbiddenError();
  return actor.id;
};

/**
 * The content inbox: the owner reviews what agents produced. A decision is recorded in an append-only history.
 * A revision request sends the owner's note to the agent that wrote the content, as team-visible context.
 * Approval here means the owner accepts the content. Publishing it still goes through the approval engine.
 */
export class ContentReviewService {
  constructor(private readonly deps: ContentReviewDeps) {}

  async inbox(actor: Actor, statuses: ArtifactRecord["status"][] = ["draft", "awaiting_owner"], limit = 50) {
    owner(actor);
    const items = await this.deps.store.list(statuses, Math.min(Math.max(limit, 1), 200));
    return Promise.all(
      items.map(async (artifact) => {
        const reviews = await this.deps.store.reviews(artifact.id);
        return {
          artifact,
          quality: artifact.taskId ? await this.deps.latestQuality(artifact.taskId) : null,
          reviewCount: reviews.length,
          recentReviews: reviews.slice(0, 5),
        };
      }),
    );
  }

  async history(actor: Actor, artifactId: string): Promise<ReviewRow[]> {
    owner(actor);
    return this.deps.store.reviews(artifactId);
  }

  async decide(actor: Actor, artifactId: string, decision: ReviewDecision, note: string | null): Promise<ArtifactRecord> {
    const by = owner(actor);
    if (!(REVIEW_DECISIONS as readonly string[]).includes(decision)) throw new ContentInputError("Unknown decision.");
    const artifact = await this.deps.store.get(artifactId);
    if (!artifact) throw new ContentInputError("Content item not found.");

    const trimmed = note?.trim() ?? null;
    if (decision !== "approved" && (!trimmed || trimmed.length < 3)) throw new ContentInputError("Say why: a short note is required for a rejection or a revision.");
    if (trimmed && trimmed.length > 1000) throw new ContentInputError("The note is too long.");
    if (trimmed) {
      try {
        assertNoPersonalData({ note: trimmed });
      } catch (error) {
        if (error instanceof PersonalDataError) throw new ContentInputError("The note contains personal data and was refused.");
        throw error;
      }
    }

    const target = DECISION_STATUS[decision];
    if (artifact.status === target && decision !== "revision_requested") throw new ContentRuleError(`This item is already ${target}.`);

    const nowIso = this.deps.now().toISOString();
    await this.deps.store.setStatus(artifactId, target);
    await this.deps.store.addReview({ id: this.deps.newId(), artifactId, decision, note: trimmed, reviewer: by, reviewedAt: nowIso });
    if (decision === "revision_requested" && trimmed) {
      await this.deps.context.write({ kind: "owner", id: by }, {
        scope: "agent",
        scopeKey: artifact.agent,
        contextKey: FEEDBACK_CONTEXT_KEY,
        value: { artifactId, kind: artifact.kind, note: trimmed, at: nowIso },
        expectedVersion: await this.currentVersion(actor, artifact.agent),
        visibility: "team",
        reason: "Owner revision request",
      });
    }
    await this.deps.audit.write({ id: this.deps.newId(), ts: nowIso, actor: `owner:${by}`, type: `content.${decision}`, entityType: "artifact", entityId: artifactId, meta: { agent: artifact.agent, kind: artifact.kind } });
    return { ...artifact, status: target };
  }

  /** The version of the feedback entry for this agent, so a new write does not conflict with the last one. */
  private async currentVersion(actor: Actor, agent: AgentKey): Promise<number> {
    const rows = await this.deps.context.read(actor, { scope: "agent", scopeKey: agent, limit: 50 });
    return rows.find((r) => r.contextKey === FEEDBACK_CONTEXT_KEY)?.version ?? 0;
  }
}

/** In-memory content store. Used by tests and local development. */
export class MemoryContentStore implements ContentStore {
  private artifacts = new Map<string, ArtifactRecord>();
  private rows: ReviewRow[] = [];

  add(a: ArtifactRecord) {
    this.artifacts.set(a.id, { ...a });
  }

  async list(statuses: ArtifactRecord["status"][], limit: number): Promise<ArtifactRecord[]> {
    return [...this.artifacts.values()].filter((a) => statuses.includes(a.status)).sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, limit);
  }

  async get(id: string): Promise<ArtifactRecord | null> {
    const a = this.artifacts.get(id);
    return a ? { ...a } : null;
  }

  async setStatus(id: string, status: ArtifactRecord["status"]): Promise<void> {
    const a = this.artifacts.get(id);
    if (a) this.artifacts.set(id, { ...a, status });
  }

  async addReview(row: ReviewRow): Promise<void> {
    this.rows.push({ ...row });
  }

  async reviews(artifactId: string): Promise<ReviewRow[]> {
    return this.rows.filter((r) => r.artifactId === artifactId).reverse();
  }
}
