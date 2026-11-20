import type { AuditSink } from "./audit";
import { ContextService } from "./context/service";
import type { ContextStore } from "./context/store";
import { createEventBus } from "./events/build";
import type { EventBus } from "./events/bus";
import type { EventStore } from "./events/store";
import { KbService } from "./knowledge/service";
import type { KbStore } from "./knowledge/store";
import type { TaskStore } from "./orchestration/store";
import { QualityController } from "./quality/controller";
import type { QualityStore } from "./quality/store";
import type { Actor } from "./types";

export interface PlatformStores {
  tasks: TaskStore;
  events: EventStore;
  context: ContextStore;
  knowledge: KbStore;
  quality: QualityStore;
  audit: AuditSink;
}

export interface PlatformClock {
  now: () => Date;
  newId: () => string;
}

export interface Platform {
  events: EventBus;
  context: ContextService;
  knowledge: KbService;
  quality: QualityController;
}

function producerFor(actor: Actor): string {
  if (actor.kind === "agent") return actor.agent;
  if (actor.kind === "owner") return "owner";
  return "system";
}

/**
 * Wires the event bus, shared context and knowledge base to their stores.
 * A context change is announced on the bus. A failed announcement is logged, never raised: the change already happened.
 */
export function buildPlatform(stores: PlatformStores, clock: PlatformClock): Platform {
  const events = createEventBus({ store: stores.events, tasks: stores.tasks, audit: stores.audit, now: clock.now, newId: clock.newId });
  const context = new ContextService({
    store: stores.context,
    audit: stores.audit,
    now: clock.now,
    newId: clock.newId,
    onChanged: async ({ scope, scopeKey, contextKey, version, actor }) => {
      try {
        await events.publish({
          type: "context.updated",
          producer: producerFor(actor),
          payload: { scope, scopeKey, contextKey, version },
          idempotencyKey: `context.updated:${scope}:${scopeKey}:${contextKey}:${version}`,
        });
      } catch {
        // The change is already stored. The missing announcement is a gap in the trail, not a reason to fail.
      }
    },
  });
  const knowledge = new KbService({ store: stores.knowledge, audit: stores.audit, now: clock.now, newId: clock.newId });
  const quality = new QualityController({ store: stores.quality, audit: stores.audit, now: clock.now, newId: clock.newId });
  return { events, context, knowledge, quality };
}
