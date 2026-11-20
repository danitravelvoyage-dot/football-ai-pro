import { z } from "zod";
import { ACTION_CLASSES, AGENT_KEYS, type AgentKey } from "../types";

/**
 * Typed event catalogue. A payload that does not match its schema is refused before anything is stored.
 * Payloads carry identifiers and short labels only, never customer records or free text from outside.
 */
export const EVENT_TYPES = [
  "workflow.started",
  "task.ready",
  "task.succeeded",
  "task.failed",
  "task.waiting_approval",
  "approval.decided",
  "agent.handoff",
  "context.updated",
  "kb.entry_changed",
] as const;
export type EventType = (typeof EVENT_TYPES)[number];

/** Target value meaning "every subscriber of this event type". */
export const BROADCAST = "broadcast";

/** An agent may hand work to another agent at most this many times in a chain. Loops stop here. */
export const MAX_HANDOFF_HOPS = 3;

/** Maximum serialized payload size, matching the database check. */
export const MAX_PAYLOAD_BYTES = 8192;

const refId = z.string().min(1).max(80);
const agent = z.enum(AGENT_KEYS);
const action = z.enum(ACTION_CLASSES);
const label = z.string().min(1).max(60);

export const eventPayloadSchemas = {
  "workflow.started": z.object({ runId: refId, workflowKey: label, taskCount: z.number().int().min(0).max(100) }).strict(),
  "task.ready": z.object({ taskId: refId, runId: refId, agent, stepKey: label }).strict(),
  "task.succeeded": z.object({ taskId: refId, runId: refId, agent, stepKey: label }).strict(),
  "task.failed": z
    .object({ taskId: refId, runId: refId, agent, stepKey: label, error: z.string().max(500), terminal: z.boolean() })
    .strict(),
  "task.waiting_approval": z.object({ taskId: refId, runId: refId, agent, actionClass: action }).strict(),
  "approval.decided": z.object({ approvalId: refId, taskId: refId, decision: z.enum(["approved", "rejected"]), actionClass: action }).strict(),
  "agent.handoff": z
    .object({ fromAgent: agent, toAgent: agent, taskId: refId.nullable(), summary: z.string().min(1).max(500) })
    .strict()
    .refine((p) => p.fromAgent !== p.toAgent, { message: "An agent cannot hand off to itself." }),
  "context.updated": z
    .object({ scope: z.enum(["company", "agent", "workflow"]), scopeKey: z.string().min(1).max(120), contextKey: z.string().min(2).max(80), version: z.number().int().min(1) })
    .strict(),
  "kb.entry_changed": z.object({ entryId: refId, category: label, reliability: label }).strict(),
} satisfies Record<EventType, z.ZodTypeAny>;

export type EventPayload<T extends EventType> = z.infer<(typeof eventPayloadSchemas)[T]>;

/** Who may publish. Agents publish as themselves; the platform and the owner have their own labels. */
export const PRODUCERS = [...AGENT_KEYS, "system", "owner"] as const;

export function isEventType(value: string): value is EventType {
  return (EVENT_TYPES as readonly string[]).includes(value);
}

export function isAgentKey(value: string): value is AgentKey {
  return (AGENT_KEYS as readonly string[]).includes(value);
}
