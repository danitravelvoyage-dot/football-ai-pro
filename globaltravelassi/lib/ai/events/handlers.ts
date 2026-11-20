import type { AuditSink } from "../audit";
import { impactOfTask } from "../orchestration/impact";
import type { TaskStore } from "../orchestration/store";
import { AGENT_KEYS, type AgentKey } from "../types";
import { PermanentHandlerError, type EventHandler } from "./bus";
import type { EventPayload } from "./types";

export interface HandlerDeps {
  tasks: TaskStore;
  audit: AuditSink;
  newId: () => string;
  now: () => Date;
}

/**
 * Handlers for every agent and for the COO. Each one does a small, idempotent piece of work:
 * - An agent records receipt of its ready tasks, and remembers handoffs addressed to it.
 * - The COO escalates terminal failures with the number of downstream tasks they block.
 */
export function buildHandlers(deps: HandlerDeps, subscribers: readonly AgentKey[] = AGENT_KEYS): Record<string, EventHandler> {
  const handlers: Record<string, EventHandler> = {};
  for (const subscriber of subscribers) {
    handlers[subscriber] = subscriber === "COOAgent" ? cooHandler(deps) : agentHandler(subscriber, deps);
  }
  return handlers;
}

async function record(deps: HandlerDeps, actor: string, type: string, entityType: string, entityId: string, meta: Record<string, unknown>) {
  await deps.audit.write({ id: deps.newId(), ts: deps.now().toISOString(), actor, type, entityType, entityId, meta });
}

function agentHandler(agent: AgentKey, deps: HandlerDeps): EventHandler {
  return async (event) => {
    if (event.eventType === "task.ready") {
      const p = event.payload as EventPayload<"task.ready">;
      if (p.agent !== agent) throw new PermanentHandlerError(`A task for ${p.agent} was delivered to ${agent}.`);
      await record(deps, `agent:${agent}`, "agent.task_received", "task", p.taskId, { eventId: event.id, runId: p.runId });
      return;
    }
    if (event.eventType === "agent.handoff") {
      const p = event.payload as EventPayload<"agent.handoff">;
      if (p.toAgent !== agent) throw new PermanentHandlerError(`A handoff for ${p.toAgent} was delivered to ${agent}.`);
      // Keyed by event id, so a repeated delivery overwrites the same memory entry.
      await deps.tasks.saveMemory(agent, `handoff:${event.id}`, p.summary, deps.now().toISOString());
      await record(deps, `agent:${agent}`, "agent.handoff_received", "event", event.id, { fromAgent: p.fromAgent, taskId: p.taskId });
    }
  };
}

function cooHandler(deps: HandlerDeps): EventHandler {
  return async (event) => {
    if (event.eventType !== "task.failed") return;
    const p = event.payload as EventPayload<"task.failed">;
    // Retries are the scheduler's job. The COO only escalates failures that will not retry.
    if (!p.terminal) return;
    const downstream = await impactOfTask(deps.tasks, p.taskId);
    await record(deps, "agent:COOAgent", "coo.escalated", "task", p.taskId, {
      eventId: event.id,
      agent: p.agent,
      blockedDownstream: downstream.length,
    });
  };
}
