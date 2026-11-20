import type { AuditSink } from "../audit";
import type { TaskStore } from "../orchestration/store";
import { EventBus } from "./bus";
import { buildHandlers } from "./handlers";
import type { EventStore } from "./store";

/** Wires the bus to a store, the task store and the audit sink, with the standard handlers. */
export function createEventBus(deps: {
  store: EventStore;
  tasks: TaskStore;
  audit: AuditSink;
  now: () => Date;
  newId: () => string;
}): EventBus {
  const handlers = buildHandlers({ tasks: deps.tasks, audit: deps.audit, newId: deps.newId, now: deps.now });
  return new EventBus({ store: deps.store, audit: deps.audit, now: deps.now, newId: deps.newId, handlers });
}
