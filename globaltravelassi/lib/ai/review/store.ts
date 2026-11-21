import type { ReviewItem, ReviewStore } from "./service";
import type { ReviewKind, ReviewStatus } from "./rules";

/** In-memory review store with the same rules as migration 0018. Used by tests and local development. */
export class MemoryReviewStore implements ReviewStore {
  private items = new Map<string, ReviewItem>();

  async insert(item: ReviewItem): Promise<void> {
    if (this.items.has(item.id)) throw new Error("Review item already exists.");
    this.items.set(item.id, clone(item));
  }

  async get(id: string): Promise<ReviewItem | null> {
    const i = this.items.get(id);
    return i ? clone(i) : null;
  }

  async list(filter: { status?: ReviewStatus; kind?: ReviewKind; limit: number }): Promise<ReviewItem[]> {
    return [...this.items.values()]
      .filter((i) => (filter.status ? i.status === filter.status : true))
      .filter((i) => (filter.kind ? i.kind === filter.kind : true))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id))
      .slice(0, filter.limit)
      .map(clone);
  }

  async decide(id: string, expectedVersion: number, next: { status: ReviewStatus; decidedBy: string; decidedAt: string; decisionReason: string }): Promise<boolean> {
    const current = this.items.get(id);
    // A decided item is never changed (the trigger's rule), and a stale version loses the compare-and-set.
    if (!current || current.status !== "open" || current.version !== expectedVersion) return false;
    this.items.set(id, { ...current, ...next, version: current.version + 1 });
    return true;
  }
}

function clone(i: ReviewItem): ReviewItem {
  return { ...i, evidence: structuredClone(i.evidence), payload: structuredClone(i.payload) };
}
