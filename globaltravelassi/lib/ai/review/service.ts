import type { AuditSink } from "../audit";
import type { Actor } from "../types";
import { ALLOWED_DECISIONS, DECISION_TO_STATUS, checkDecision, expiresAt, REVIEW_KINDS, type Decision, type ReviewKind, type ReviewStatus } from "./rules";

export class ReviewForbiddenError extends Error {
  constructor() {
    super("Only the owner can decide a review item.");
    this.name = "ReviewForbiddenError";
  }
}
export class ReviewRuleError extends Error {
  constructor(
    message: string,
    public readonly code: "not_allowed_for_kind" | "already_decided" | "expired" | "not_found" | "stale" | "invalid",
  ) {
    super(message);
    this.name = "ReviewRuleError";
  }
}

export interface ReviewItem {
  id: string;
  kind: ReviewKind;
  status: ReviewStatus;
  agent: string | null;
  runId: string | null;
  taskId: string | null;
  leadId: string | null;
  subjectRef: string;
  summary: string;
  /** Evidence for the owner: source addresses, reason codes and the compared values. */
  evidence: Record<string, unknown>;
  /** What applying an approval needs. Kind-specific. */
  payload: Record<string, unknown>;
  createdAt: string;
  expiresAt: string;
  decidedBy: string | null;
  decidedAt: string | null;
  decisionReason: string | null;
  version: number;
}

export interface ReviewStore {
  insert(item: ReviewItem): Promise<void>;
  get(id: string): Promise<ReviewItem | null>;
  list(filter: { status?: ReviewStatus; kind?: ReviewKind; limit: number }): Promise<ReviewItem[]>;
  /**
   * Compare-and-set: moves an item from open to a decision only if its version is still `expectedVersion`. Returns
   * false when another decision got there first.
   */
  decide(id: string, expectedVersion: number, next: { status: ReviewStatus; decidedBy: string; decidedAt: string; decisionReason: string }): Promise<boolean>;
}

/** Applies a decision to the thing the item is about. Each kind has its own handler, supplied by the caller. */
export type ReviewEffect = (item: ReviewItem, decision: Decision, actor: string) => Promise<Record<string, unknown>>;

/** What the system provides to open an item. The id, status and decision fields are set by the service. */
export type ReviewOpenInput = Omit<ReviewItem, "id" | "status" | "createdAt" | "expiresAt" | "decidedBy" | "decidedAt" | "decisionReason" | "version">;

export interface ReviewServiceDeps {
  store: ReviewStore;
  audit: AuditSink;
  now: () => Date;
  newId: () => string;
  effects: Partial<Record<ReviewKind, ReviewEffect>>;
  /**
   * Re-checks an approval before it is recorded. Throws when the thing it approves has changed since the item was opened,
   * so the approval is refused and not recorded as a decision.
   */
  prechecks?: Partial<Record<ReviewKind, (item: ReviewItem) => Promise<void>>>;
}

const owner = (actor: Actor): string => {
  if (actor.kind !== "owner" || actor.id.trim().length === 0) throw new ReviewForbiddenError();
  return actor.id;
};

/**
 * The owner's approval center. The system opens items (through `open`); only the owner decides them. A decision is
 * checked against the item's kind and state, written with a compare-and-set, audited with the previous and new status,
 * the actor, the time and the reason, and only then applied.
 */
export class ReviewService {
  constructor(private readonly deps: ReviewServiceDeps) {}

  private nowIso(): string {
    return this.deps.now().toISOString();
  }

  /** Opens an item for the owner. Called by the system; the caller is responsible for keeping personal data out. */
  async open(input: ReviewOpenInput): Promise<ReviewItem> {
    if (!(REVIEW_KINDS as readonly string[]).includes(input.kind)) throw new ReviewRuleError("Unknown review kind.", "invalid");
    const createdAt = this.nowIso();
    const item: ReviewItem = {
      ...input,
      id: this.deps.newId(),
      status: "open",
      createdAt,
      expiresAt: expiresAt(createdAt),
      decidedBy: null,
      decidedAt: null,
      decisionReason: null,
      version: 1,
    };
    await this.deps.store.insert(item);
    return item;
  }

  async list(actor: Actor, filter: { status?: ReviewStatus; kind?: ReviewKind; limit: number }): Promise<ReviewItem[]> {
    owner(actor);
    return this.deps.store.list(filter);
  }

  async get(actor: Actor, id: string): Promise<ReviewItem> {
    owner(actor);
    const item = await this.deps.store.get(id);
    if (!item) throw new ReviewRuleError("Review item not found.", "not_found");
    return item;
  }

  /**
   * One decision. `expectedVersion` is the version the owner saw. An item changed since then is refused, so a stale
   * screen cannot decide something newer.
   */
  async decide(actor: Actor, id: string, decision: Decision, reason: string, expectedVersion: number): Promise<{ item: ReviewItem; effect: Record<string, unknown> }> {
    const by = owner(actor);
    const trimmed = reason.trim();
    if (trimmed.length < 3 || trimmed.length > 500) throw new ReviewRuleError("Give a reason of 3 to 500 characters.", "invalid");
    const item = await this.deps.store.get(id);
    if (!item) throw new ReviewRuleError("Review item not found.", "not_found");
    if (item.version !== expectedVersion) throw new ReviewRuleError("This item changed after you opened it. Reload and decide again.", "stale");

    const now = this.nowIso();
    const check = checkDecision(item, decision, now);
    if (!check.ok) {
      if (check.code === "expired") {
        await this.deps.store.decide(id, item.version, { status: "expired", decidedBy: by, decidedAt: now, decisionReason: "Expired before a decision." });
      }
      await this.audit(by, "review.refused", id, item, { decision, reason: check.code });
      throw new ReviewRuleError(messageFor(check.code), check.code);
    }

    if (decision === "approve" && this.deps.prechecks?.[item.kind]) {
      try {
        await this.deps.prechecks[item.kind]!(item);
      } catch {
        await this.audit(by, "refused", id, item, { decision, reason: "stale" });
        throw new ReviewRuleError("The item it approves has changed since it was opened. Review it again.", "stale");
      }
    }

    const next = DECISION_TO_STATUS[decision];
    const claimed = await this.deps.store.decide(id, item.version, { status: next, decidedBy: by, decidedAt: now, decisionReason: trimmed });
    if (!claimed) {
      // Another decision took this item between the read and the write.
      throw new ReviewRuleError("This item was already decided.", "already_decided");
    }
    const decided: ReviewItem = { ...item, status: next, decidedBy: by, decidedAt: now, decisionReason: trimmed, version: item.version + 1 };
    await this.audit(by, "review.decided", id, item, { decision, reason: trimmed, previousStatus: item.status, newStatus: next }, decided);
    const effect = this.deps.effects[item.kind] ? await this.deps.effects[item.kind]!(decided, decision, by) : {};
    return { item: decided, effect };
  }

  private async audit(by: string, type: string, id: string, before: ReviewItem, meta: Record<string, unknown>, after?: ReviewItem): Promise<void> {
    await this.deps.audit.write({
      id: this.deps.newId(),
      ts: this.nowIso(),
      actor: `owner:${by}`,
      type: `review.${type.replace("review.", "")}`,
      entityType: "review_item",
      entityId: id,
      meta: { kind: before.kind, previousStatus: before.status, newStatus: after?.status ?? before.status, ...meta },
    });
  }
}

function messageFor(code: string): string {
  if (code === "already_decided") return "This item was already decided.";
  if (code === "expired") return "This item expired before a decision and can no longer be decided.";
  if (code === "not_allowed_for_kind") return "This decision is not allowed for this kind of item.";
  return "The decision was refused.";
}

export { ALLOWED_DECISIONS };
