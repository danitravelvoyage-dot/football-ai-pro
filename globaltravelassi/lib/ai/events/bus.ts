import { assertNoPersonalData, PersonalDataError } from "../security/personal-data";
import type { AuditSink } from "../audit";
import { isAgentKey, isEventType, MAX_HANDOFF_HOPS, MAX_PAYLOAD_BYTES, BROADCAST, PRODUCERS, eventPayloadSchemas, type EventType } from "./types";
import type { DeliveryRecord, DomainEventRecord, EventStore } from "./store";

/** Raised when an event does not satisfy the catalogue. Nothing is stored. */
export class EventValidationError extends Error {
  readonly retryable = false;
  constructor(message: string) {
    super(message);
    this.name = "EventValidationError";
  }
}

/** A handler throws this when a retry cannot help, such as a misrouted event. The delivery goes straight to dead letters. */
export class PermanentHandlerError extends Error {
  readonly retryable = false;
  constructor(message: string) {
    super(message);
    this.name = "PermanentHandlerError";
  }
}

export interface PublishInput {
  type: string;
  producer: string;
  /** Defaults to broadcast. A named target receives the event only if it subscribes to the type. */
  target?: string;
  payload: unknown;
  idempotencyKey: string;
  correlationId?: string | null;
  /** Agent-to-agent handoffs only: how many handoffs this chain has made, including this one. */
  hopCount?: number;
}

export interface ValidatedEvent {
  type: EventType;
  producer: string;
  target: string;
  payload: Record<string, unknown>;
  idempotencyKey: string;
  correlationId: string | null;
  hopCount: number;
}

/** Checks an event against the catalogue. Pure: no I/O. */
export function validateEvent(input: PublishInput): ValidatedEvent {
  if (!isEventType(input.type)) throw new EventValidationError(`Unknown event type "${input.type}".`);
  if (!(PRODUCERS as readonly string[]).includes(input.producer)) throw new EventValidationError(`Unknown producer "${input.producer}".`);

  const target = input.target ?? BROADCAST;
  if (target !== BROADCAST && !isAgentKey(target)) throw new EventValidationError(`Unknown target "${target}".`);

  if (typeof input.idempotencyKey !== "string" || input.idempotencyKey.length < 8 || input.idempotencyKey.length > 160) {
    throw new EventValidationError("Idempotency key must be 8 to 160 characters.");
  }

  const parsed = eventPayloadSchemas[input.type].safeParse(input.payload);
  if (!parsed.success) throw new EventValidationError(`Payload does not match "${input.type}".`);

  const size = new TextEncoder().encode(JSON.stringify(parsed.data)).length;
  if (size > MAX_PAYLOAD_BYTES) throw new EventValidationError("Payload is too large.");

  try {
    assertNoPersonalData(parsed.data);
  } catch (error) {
    if (error instanceof PersonalDataError) throw new EventValidationError("Payload contains personal data and was refused.");
    throw error;
  }

  const hopCount = input.hopCount ?? 0;
  if (input.type === "agent.handoff") {
    const p = parsed.data as { fromAgent: string; toAgent: string };
    if (input.producer !== p.fromAgent) throw new EventValidationError("A handoff must be published by the agent it comes from.");
    if (target !== p.toAgent) throw new EventValidationError("A handoff must target the agent it names.");
    if (hopCount < 1 || hopCount > MAX_HANDOFF_HOPS) {
      throw new EventValidationError(`Handoff chains are limited to ${MAX_HANDOFF_HOPS} hops.`);
    }
  } else if (hopCount !== 0) {
    throw new EventValidationError("Only handoffs carry a hop count.");
  }

  return {
    type: input.type,
    producer: input.producer,
    target,
    payload: parsed.data as Record<string, unknown>,
    idempotencyKey: input.idempotencyKey,
    correlationId: input.correlationId ?? null,
    hopCount,
  };
}

export interface HandlerContext {
  subscriber: string;
  attempt: number;
}

export type EventHandler = (event: DomainEventRecord, ctx: HandlerContext) => Promise<void>;

export const DELIVERY_BASE_DELAY_MS = 1_000;
export const DELIVERY_MAX_DELAY_MS = 60_000;
export const DEFAULT_DELIVERY_ATTEMPTS = 5;

/** Exponential backoff between delivery attempts, capped. */
export function deliveryBackoffMs(attempt: number): number {
  return Math.min(DELIVERY_MAX_DELAY_MS, DELIVERY_BASE_DELAY_MS * 2 ** Math.max(0, attempt - 1));
}

export interface DispatchReport {
  attempted: number;
  delivered: number;
  retried: number;
  dead: number;
  /** Deliveries whose result could not be stored. They stay pending and are tried again later. */
  storeErrors: number;
}

export interface EventBusDeps {
  store: EventStore;
  audit: AuditSink;
  now: () => Date;
  newId: () => string;
  handlers: Record<string, EventHandler>;
}

/**
 * Persistent typed event bus.
 * - Publishing is idempotent per idempotency key. A duplicate publish creates nothing.
 * - Each recipient gets one delivery row. A recipient is never queued twice for the same event.
 * - Delivery is at least once: a handler may run again if the process stops after it succeeds and before
 *   the result is stored. Handlers receive the event id so they can make their work idempotent.
 * - Failures back off exponentially. After the attempt limit, or on a permanent error, a delivery is dead-lettered.
 */
export class EventBus {
  constructor(private readonly deps: EventBusDeps) {}

  async publish(input: PublishInput): Promise<{ eventId: string; created: boolean; recipients: string[] }> {
    const v = validateEvent(input);
    const now = this.deps.now().toISOString();
    const { event, created } = await this.deps.store.insertEvent({
      id: this.deps.newId(),
      eventType: v.type,
      producer: v.producer,
      target: v.target,
      correlationId: v.correlationId,
      hopCount: v.hopCount,
      payload: v.payload,
      idempotencyKey: v.idempotencyKey,
      occurredAt: now,
    });
    if (!created) return { eventId: event.id, created: false, recipients: [] };

    const recipients = await this.recipientsFor(event);
    await this.deps.store.insertDeliveries(
      recipients.map(
        (subscriber): DeliveryRecord => ({
          id: this.deps.newId(),
          eventId: event.id,
          subscriber,
          status: "pending",
          attempts: 0,
          maxAttempts: DEFAULT_DELIVERY_ATTEMPTS,
          nextAttemptAt: now,
          lastError: null,
          deliveredAt: null,
          createdAt: now,
        }),
      ),
    );
    return { eventId: event.id, created: true, recipients };
  }

  async recipientsFor(event: Pick<DomainEventRecord, "eventType" | "target">): Promise<string[]> {
    if (event.target !== BROADCAST) {
      return (await this.deps.store.isSubscribed(event.target, event.eventType)) ? [event.target] : [];
    }
    return this.deps.store.subscribersFor(event.eventType);
  }

  /** Runs the due deliveries once. Safe to call repeatedly; each call handles at most `limit` deliveries. */
  async dispatch(options: { limit: number }): Promise<DispatchReport> {
    const report: DispatchReport = { attempted: 0, delivered: 0, retried: 0, dead: 0, storeErrors: 0 };
    const due = await this.deps.store.dueDeliveries(this.deps.now().toISOString(), options.limit);
    for (const delivery of due) {
      report.attempted += 1;
      try {
        await this.attempt(delivery, report);
      } catch {
        report.storeErrors += 1;
      }
    }
    return report;
  }

  private async attempt(delivery: DeliveryRecord, report: DispatchReport): Promise<void> {
    const attempt = delivery.attempts + 1;
    const event = await this.deps.store.getEvent(delivery.eventId);
    const handler = this.deps.handlers[delivery.subscriber];

    if (!event || !handler) {
      const reason = !event ? "event_missing" : "no_handler";
      await this.deps.store.markDead(delivery.id, attempt, reason);
      await this.audit("event.dead_lettered", delivery, { attempt, error: reason, terminal: true });
      report.dead += 1;
      return;
    }

    try {
      await handler(event, { subscriber: delivery.subscriber, attempt });
      await this.deps.store.markDelivered(delivery.id, attempt, this.deps.now().toISOString());
      report.delivered += 1;
    } catch (error) {
      const message = error instanceof Error ? error.message.slice(0, 500) : "Unknown error";
      const permanent = (error as { retryable?: boolean }).retryable === false;
      if (permanent || attempt >= delivery.maxAttempts) {
        await this.deps.store.markDead(delivery.id, attempt, message);
        await this.audit("event.dead_lettered", delivery, { attempt, error: message, terminal: true });
        report.dead += 1;
      } else {
        const nextAttemptAt = new Date(this.deps.now().getTime() + deliveryBackoffMs(attempt)).toISOString();
        await this.deps.store.markRetry(delivery.id, attempt, message, nextAttemptAt);
        await this.audit("event.retry_scheduled", delivery, { attempt, error: message, nextAttemptAt });
        report.retried += 1;
      }
    }
  }

  private async audit(type: string, delivery: DeliveryRecord, meta: Record<string, unknown>) {
    await this.deps.audit.write({
      id: this.deps.newId(),
      ts: this.deps.now().toISOString(),
      actor: "system",
      type,
      entityType: "event_delivery",
      entityId: delivery.id,
      meta: { eventId: delivery.eventId, subscriber: delivery.subscriber, ...meta },
    });
  }
}
