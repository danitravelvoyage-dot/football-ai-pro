import type { Actor, AgentKey } from "../types";

export const CONTEXT_SCOPES = ["company", "agent", "workflow"] as const;
export type ContextScope = (typeof CONTEXT_SCOPES)[number];
export type ContextVisibility = "owner" | "team";

export interface ContextRef {
  scope: ContextScope;
  scopeKey: string;
  visibility: ContextVisibility;
}

/**
 * Who may read an entry.
 * - The owner reads everything.
 * - An agent's own scope is readable by that agent alone (never by other agents or the owner-only rule).
 * - Company and workflow context is readable by agents and the system only when visibility is 'team'.
 * - Owner-visibility company and workflow context is never shown to an agent.
 */
export function canRead(actor: Actor, ref: ContextRef): boolean {
  if (actor.kind === "owner") return true;
  if (ref.scope === "agent") return actor.kind === "agent" && actor.agent === ref.scopeKey;
  return ref.visibility === "team";
}

/**
 * Who may write an entry.
 * - The owner writes any scope and any visibility.
 * - An agent writes only its own agent scope, and only as team-visible (readable by the agent and the runner).
 *   Agents cannot write to other agents or to the company.
 * - The COO may write workflow context, team-visible only, since it coordinates runs.
 * - Nobody but the owner writes company context.
 */
export function canWrite(actor: Actor, ref: ContextRef): boolean {
  if (actor.kind === "owner") return true;
  if (actor.kind !== "agent") return false;
  if (ref.scope === "agent") return actor.agent === ref.scopeKey && ref.visibility === "team";
  if (ref.scope === "workflow" && actor.agent === "COOAgent") return ref.visibility === "team";
  return false;
}

/** The entries an agent may read for its own prompt: company and workflow team context, and its own scope. */
export function readableScopesFor(agent: AgentKey): { scope: ContextScope; scopeKey?: string; visibility: ContextVisibility }[] {
  return [
    { scope: "company", visibility: "team" },
    { scope: "workflow", visibility: "team" },
    { scope: "agent", scopeKey: agent, visibility: "team" },
  ];
}
