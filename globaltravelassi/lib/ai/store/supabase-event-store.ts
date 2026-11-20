import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { DeliveryRecord, DeliveryStatus, DomainEventRecord, EventCursor, EventStore } from "../events/store";
import type { EventType } from "../events/types";

type Row = Record<string, unknown>;

const UNIQUE_VIOLATION = "23505";
const TIMESTAMP_PATTERN = /^\d{4}-\d{2}-\d{2}[T ][\d:.]+(Z|[+-]\d{2}(:?\d{2})?)$/;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function fail(error: { message: string } | null): never {
  throw new Error(error?.message ?? "Database error.");
}

function toEvent(row: Row): DomainEventRecord {
  return {
    id: row.id as string,
    eventType: row.event_type as EventType,
    producer: row.producer as string,
    target: row.target as string,
    correlationId: (row.correlation_id as string | null) ?? null,
    hopCount: row.hop_count as number,
    payload: row.payload,
    idempotencyKey: row.idempotency_key as string,
    occurredAt: row.occurred_at as string,
  };
}

function toDelivery(row: Row): DeliveryRecord {
  return {
    id: row.id as string,
    eventId: row.event_id as string,
    subscriber: row.subscriber as string,
    status: row.status as DeliveryStatus,
    attempts: row.attempts as number,
    maxAttempts: row.max_attempts as number,
    nextAttemptAt: row.next_attempt_at as string,
    lastError: (row.last_error as string | null) ?? null,
    deliveredAt: (row.delivered_at as string | null) ?? null,
    createdAt: row.created_at as string,
  };
}

/** Event store on the ai_domain_events, ai_event_subscriptions and ai_event_deliveries tables. Uses the caller's session under RLS. */
export class SupabaseEventStore implements EventStore {
  constructor(private readonly db: SupabaseClient) {}

  private async findByKey(key: string): Promise<DomainEventRecord | null> {
    const { data, error } = await this.db.from("ai_domain_events").select("*").eq("idempotency_key", key).maybeSingle();
    if (error) fail(error);
    return data ? toEvent(data as Row) : null;
  }

  async insertEvent(event: Omit<DomainEventRecord, "occurredAt"> & { occurredAt: string }) {
    const existing = await this.findByKey(event.idempotencyKey);
    if (existing) return { event: existing, created: false };

    const { data, error } = await this.db
      .from("ai_domain_events")
      .insert({
        id: event.id,
        event_type: event.eventType,
        producer: event.producer,
        target: event.target,
        correlation_id: event.correlationId,
        hop_count: event.hopCount,
        payload: event.payload,
        idempotency_key: event.idempotencyKey,
        occurred_at: event.occurredAt,
      })
      .select("*")
      .single();
    if (error) {
      // A concurrent publish with the same key won the race. Return the stored event.
      if ((error as { code?: string }).code === UNIQUE_VIOLATION) {
        const won = await this.findByKey(event.idempotencyKey);
        if (won) return { event: won, created: false };
      }
      fail(error);
    }
    return { event: toEvent(data as Row), created: true };
  }

  async getEvent(id: string) {
    if (!UUID_PATTERN.test(id)) return null;
    const { data, error } = await this.db.from("ai_domain_events").select("*").eq("id", id).maybeSingle();
    if (error) fail(error);
    return data ? toEvent(data as Row) : null;
  }

  async listEvents(filter: { eventType?: string; target?: string; limit: number; after?: EventCursor }) {
    const limit = Math.max(1, Math.min(filter.limit, 500));
    let query = this.db.from("ai_domain_events").select("*").order("occurred_at", { ascending: false }).order("id", { ascending: false }).limit(limit + 1);
    if (filter.eventType) query = query.eq("event_type", filter.eventType);
    if (filter.target) query = query.eq("target", filter.target);
    if (filter.after) {
      if (!TIMESTAMP_PATTERN.test(filter.after.occurredAt) || !UUID_PATTERN.test(filter.after.id)) throw new Error("Invalid event cursor.");
      const { occurredAt, id } = filter.after;
      query = query.or(`occurred_at.lt.${occurredAt},and(occurred_at.eq.${occurredAt},id.lt.${id})`);
    }
    const { data, error } = await query;
    if (error) fail(error);
    const rows = (data ?? []) as Row[];
    const items = rows.slice(0, limit).map(toEvent);
    const last = items[items.length - 1];
    return { items, next: rows.length > limit && last ? { occurredAt: last.occurredAt, id: last.id } : null };
  }

  async subscribersFor(eventType: EventType) {
    const { data, error } = await this.db.from("ai_event_subscriptions").select("subscriber").eq("event_type", eventType).eq("enabled", true).order("subscriber");
    if (error) fail(error);
    return ((data ?? []) as Row[]).map((r) => r.subscriber as string);
  }

  async isSubscribed(subscriber: string, eventType: EventType) {
    const { data, error } = await this.db
      .from("ai_event_subscriptions")
      .select("subscriber")
      .eq("subscriber", subscriber)
      .eq("event_type", eventType)
      .eq("enabled", true)
      .maybeSingle();
    if (error) fail(error);
    return data !== null;
  }

  async insertDeliveries(rows: DeliveryRecord[]) {
    if (rows.length === 0) return;
    const { error } = await this.db.from("ai_event_deliveries").upsert(
      rows.map((r) => ({
        id: r.id,
        event_id: r.eventId,
        subscriber: r.subscriber,
        status: r.status,
        attempts: r.attempts,
        max_attempts: r.maxAttempts,
        next_attempt_at: r.nextAttemptAt,
        last_error: r.lastError,
        delivered_at: r.deliveredAt,
        created_at: r.createdAt,
      })),
      { onConflict: "event_id,subscriber", ignoreDuplicates: true },
    );
    if (error) fail(error);
  }

  async dueDeliveries(nowIso: string, limit: number) {
    const { data, error } = await this.db
      .from("ai_event_deliveries")
      .select("*")
      .eq("status", "pending")
      .lte("next_attempt_at", nowIso)
      .order("next_attempt_at", { ascending: true })
      .limit(limit);
    if (error) fail(error);
    return ((data ?? []) as Row[]).map(toDelivery);
  }

  private async settle(id: string, patch: Row): Promise<void> {
    const { data, error } = await this.db.from("ai_event_deliveries").update(patch).eq("id", id).eq("status", "pending").select("id").maybeSingle();
    if (error) fail(error);
    if (!data) throw new Error(`Delivery ${id} is not pending.`);
  }

  async markDelivered(id: string, attempts: number, deliveredAt: string) {
    await this.settle(id, { status: "delivered", attempts, delivered_at: deliveredAt, last_error: null });
  }

  async markRetry(id: string, attempts: number, error: string, nextAttemptAt: string) {
    await this.settle(id, { attempts, last_error: error, next_attempt_at: nextAttemptAt });
  }

  async markDead(id: string, attempts: number, error: string) {
    await this.settle(id, { status: "dead", attempts, last_error: error });
  }

  async listDeliveries(filter: { status?: DeliveryStatus; limit: number }) {
    let query = this.db.from("ai_event_deliveries").select("*").order("created_at", { ascending: false }).order("id", { ascending: false }).limit(filter.limit);
    if (filter.status) query = query.eq("status", filter.status);
    const { data, error } = await query;
    if (error) fail(error);
    return ((data ?? []) as Row[]).map(toDelivery);
  }

  async countDeliveries() {
    const statuses: DeliveryStatus[] = ["pending", "delivered", "dead"];
    const entries = await Promise.all(
      statuses.map(async (status) => {
        const { count, error } = await this.db.from("ai_event_deliveries").select("id", { count: "exact", head: true }).eq("status", status);
        if (error) fail(error);
        return [status, count ?? 0] as const;
      }),
    );
    return Object.fromEntries(entries) as Record<DeliveryStatus, number>;
  }
}
