import type { EventType } from "./types";

export type DeliveryStatus = "pending" | "delivered" | "dead";

export interface DomainEventRecord {
  id: string;
  eventType: EventType;
  producer: string;
  target: string;
  correlationId: string | null;
  hopCount: number;
  payload: unknown;
  idempotencyKey: string;
  occurredAt: string;
}

export interface DeliveryRecord {
  id: string;
  eventId: string;
  subscriber: string;
  status: DeliveryStatus;
  attempts: number;
  maxAttempts: number;
  nextAttemptAt: string;
  lastError: string | null;
  deliveredAt: string | null;
  createdAt: string;
}

export interface EventCursor {
  occurredAt: string;
  id: string;
}

export interface EventStore {
  /** Stores an event once. A repeated idempotency key returns the stored event with created = false. */
  insertEvent(event: Omit<DomainEventRecord, "occurredAt"> & { occurredAt: string }): Promise<{ event: DomainEventRecord; created: boolean }>;
  getEvent(id: string): Promise<DomainEventRecord | null>;
  listEvents(filter: { eventType?: string; target?: string; limit: number; after?: EventCursor }): Promise<{ items: DomainEventRecord[]; next: EventCursor | null }>;
  subscribersFor(eventType: EventType): Promise<string[]>;
  isSubscribed(subscriber: string, eventType: EventType): Promise<boolean>;
  /** Creates one delivery per (event, subscriber). Existing pairs are left unchanged. */
  insertDeliveries(rows: DeliveryRecord[]): Promise<void>;
  dueDeliveries(nowIso: string, limit: number): Promise<DeliveryRecord[]>;
  /** Only succeeds while the delivery is still pending. */
  markDelivered(id: string, attempts: number, deliveredAt: string): Promise<void>;
  markRetry(id: string, attempts: number, error: string, nextAttemptAt: string): Promise<void>;
  markDead(id: string, attempts: number, error: string): Promise<void>;
  listDeliveries(filter: { status?: DeliveryStatus; limit: number }): Promise<DeliveryRecord[]>;
  countDeliveries(): Promise<Record<DeliveryStatus, number>>;
}

function compareNewest(a: { occurredAt: string; id: string }, b: { occurredAt: string; id: string }): number {
  return b.occurredAt.localeCompare(a.occurredAt) || b.id.localeCompare(a.id);
}

/** In-memory event store with the same contract. Used by tests and local development. */
export class MemoryEventStore implements EventStore {
  private events = new Map<string, DomainEventRecord>();
  private subscriptions = new Map<string, boolean>();
  private deliveries = new Map<string, DeliveryRecord>();

  /** Subscriptions are keyed as `subscriber|eventType`. Tests set them directly. */
  setSubscription(subscriber: string, eventType: EventType, enabled = true) {
    this.subscriptions.set(`${subscriber}|${eventType}`, enabled);
  }

  async insertEvent(input: Omit<DomainEventRecord, "occurredAt"> & { occurredAt: string }) {
    const existing = [...this.events.values()].find((e) => e.idempotencyKey === input.idempotencyKey);
    if (existing) return { event: existing, created: false };
    const event: DomainEventRecord = { ...input };
    this.events.set(event.id, event);
    return { event, created: true };
  }

  async getEvent(id: string) {
    return this.events.get(id) ?? null;
  }

  async listEvents(filter: { eventType?: string; target?: string; limit: number; after?: EventCursor }) {
    const matching = [...this.events.values()]
      .filter((e) => (!filter.eventType || e.eventType === filter.eventType) && (!filter.target || e.target === filter.target))
      .filter((e) => !filter.after || compareNewest(e, filter.after) > 0)
      .sort(compareNewest);
    const items = matching.slice(0, filter.limit);
    const last = items[items.length - 1];
    return { items, next: matching.length > filter.limit && last ? { occurredAt: last.occurredAt, id: last.id } : null };
  }

  async subscribersFor(eventType: EventType) {
    return [...this.subscriptions.entries()]
      .filter(([key, enabled]) => enabled && key.endsWith(`|${eventType}`))
      .map(([key]) => key.split("|")[0])
      .sort();
  }

  async isSubscribed(subscriber: string, eventType: EventType) {
    return this.subscriptions.get(`${subscriber}|${eventType}`) === true;
  }

  async insertDeliveries(rows: DeliveryRecord[]) {
    for (const row of rows) {
      const key = `${row.eventId}|${row.subscriber}`;
      if (![...this.deliveries.values()].some((d) => `${d.eventId}|${d.subscriber}` === key)) {
        this.deliveries.set(row.id, row);
      }
    }
  }

  async dueDeliveries(nowIso: string, limit: number) {
    return [...this.deliveries.values()]
      .filter((d) => d.status === "pending" && d.nextAttemptAt <= nowIso)
      .sort((a, b) => a.nextAttemptAt.localeCompare(b.nextAttemptAt) || a.id.localeCompare(b.id))
      .slice(0, limit);
  }

  async markDelivered(id: string, attempts: number, deliveredAt: string) {
    const d = this.deliveries.get(id);
    if (!d || d.status !== "pending") throw new Error(`Delivery ${id} is not pending.`);
    this.deliveries.set(id, { ...d, status: "delivered", attempts, deliveredAt, lastError: null });
  }

  async markRetry(id: string, attempts: number, error: string, nextAttemptAt: string) {
    const d = this.deliveries.get(id);
    if (!d || d.status !== "pending") throw new Error(`Delivery ${id} is not pending.`);
    this.deliveries.set(id, { ...d, attempts, lastError: error, nextAttemptAt });
  }

  async markDead(id: string, attempts: number, error: string) {
    const d = this.deliveries.get(id);
    if (!d || d.status !== "pending") throw new Error(`Delivery ${id} is not pending.`);
    this.deliveries.set(id, { ...d, status: "dead", attempts, lastError: error });
  }

  async listDeliveries(filter: { status?: DeliveryStatus; limit: number }) {
    return [...this.deliveries.values()]
      .filter((d) => !filter.status || d.status === filter.status)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id))
      .slice(0, filter.limit);
  }

  async countDeliveries() {
    const counts: Record<DeliveryStatus, number> = { pending: 0, delivered: 0, dead: 0 };
    for (const d of this.deliveries.values()) counts[d.status] += 1;
    return counts;
  }
}

/**
 * Mirrors the default subscriptions seeded by migration 0004: the COO watches outcomes,
 * and every agent receives its ready tasks and handoffs. Keep the two lists in step.
 */
export function seedDefaultSubscriptions(store: MemoryEventStore, agents: readonly string[]): void {
  for (const type of ["workflow.started", "task.succeeded", "task.failed", "task.waiting_approval", "approval.decided"] as const) {
    store.setSubscription("COOAgent", type);
  }
  for (const agent of agents) {
    store.setSubscription(agent, "task.ready");
    store.setSubscription(agent, "agent.handoff");
    store.setSubscription(agent, "agent.question");
    store.setSubscription(agent, "agent.answer");
  }
}
