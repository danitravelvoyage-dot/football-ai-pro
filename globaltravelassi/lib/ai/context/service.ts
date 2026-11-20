import type { AuditSink } from "../audit";
import { assertNoPersonalData, PersonalDataError } from "../security/personal-data";
import { AGENT_KEYS, type Actor, type AgentKey } from "../types";
import { canRead, canWrite, readableScopesFor, CONTEXT_SCOPES, type ContextScope, type ContextVisibility } from "./policy";
import type { ContextEntry, ContextStore } from "./store";

export class ContextForbiddenError extends Error {
  constructor(message = "This actor may not change that context.") {
    super(message);
    this.name = "ContextForbiddenError";
  }
}

export class ContextValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ContextValidationError";
  }
}

const MAX_VALUE_BYTES = 16_384;
const KEY_PATTERN = /^[a-z][a-z0-9_.]{1,79}$/;

export interface ContextWriteInput {
  scope: ContextScope;
  scopeKey: string;
  contextKey: string;
  value: Record<string, unknown>;
  expectedVersion: number;
  visibility: ContextVisibility;
  reason?: string | null;
}

export interface ContextServiceDeps {
  store: ContextStore;
  audit: AuditSink;
  now: () => Date;
  newId: () => string;
  /** Optional hook so a change can be announced on the event bus without a direct dependency. */
  onChanged?: (change: { scope: ContextScope; scopeKey: string; contextKey: string; version: number; actor: Actor }) => Promise<void>;
}

/** Shared context: company, agent and workflow knowledge, with access rules and versioned history. */
export class ContextService {
  constructor(private readonly deps: ContextServiceDeps) {}

  private actorLabel(actor: Actor): string {
    if (actor.kind === "owner") return `owner:${actor.id}`;
    if (actor.kind === "agent") return `agent:${actor.agent}`;
    return "system";
  }

  validate(input: ContextWriteInput): void {
    if (!(CONTEXT_SCOPES as readonly string[]).includes(input.scope)) throw new ContextValidationError("Unknown context scope.");
    if (input.scope === "company" && input.scopeKey !== "company") throw new ContextValidationError("Company context uses the company scope key.");
    if (input.scope === "agent" && !(AGENT_KEYS as readonly string[]).includes(input.scopeKey)) {
      throw new ContextValidationError("Agent context must name an agent.");
    }
    if (input.scope === "workflow" && !/^[A-Za-z0-9-]{1,120}$/.test(input.scopeKey)) {
      throw new ContextValidationError("Workflow context must name a run.");
    }
    if (!KEY_PATTERN.test(input.contextKey)) throw new ContextValidationError("Context key format is invalid.");
    if (!Number.isInteger(input.expectedVersion) || input.expectedVersion < 0) throw new ContextValidationError("Expected version is invalid.");
    if (typeof input.value !== "object" || input.value === null || Array.isArray(input.value)) {
      throw new ContextValidationError("Context value must be an object.");
    }
    if (new TextEncoder().encode(JSON.stringify(input.value)).length > MAX_VALUE_BYTES) {
      throw new ContextValidationError("Context value is too large.");
    }
    if (input.reason && input.reason.length > 300) throw new ContextValidationError("Reason is too long.");
    try {
      assertNoPersonalData(input.value);
    } catch (error) {
      if (error instanceof PersonalDataError) throw new ContextValidationError("Context contains personal data and was refused.");
      throw error;
    }
  }

  async write(actor: Actor, input: ContextWriteInput): Promise<{ entryId: string; version: number }> {
    this.validate(input);
    if (!canWrite(actor, input)) throw new ContextForbiddenError();
    const changedAt = this.deps.now().toISOString();
    const result = await this.deps.store.write({
      scope: input.scope,
      scopeKey: input.scopeKey,
      contextKey: input.contextKey,
      value: input.value,
      expectedVersion: input.expectedVersion,
      visibility: input.visibility,
      changedBy: this.actorLabel(actor),
      reason: input.reason ?? null,
      changedAt,
    });
    await this.deps.audit.write({
      id: this.deps.newId(),
      ts: changedAt,
      actor: this.actorLabel(actor),
      type: "context.written",
      entityType: "context",
      entityId: result.entryId,
      meta: { scope: input.scope, scopeKey: input.scopeKey, contextKey: input.contextKey, version: result.version, visibility: input.visibility },
    });
    if (this.deps.onChanged) {
      await this.deps.onChanged({ scope: input.scope, scopeKey: input.scopeKey, contextKey: input.contextKey, version: result.version, actor });
    }
    return result;
  }

  /** Entries the actor may read. Anything else is removed before it leaves this function. */
  async read(actor: Actor, filter: { scope?: ContextScope; scopeKey?: string; limit: number }): Promise<ContextEntry[]> {
    const rows = await this.deps.store.list(filter);
    return rows.filter((e) => canRead(actor, { scope: e.scope, scopeKey: e.scopeKey, visibility: e.visibility }));
  }

  /** Context an agent may place in its prompt for one run. Company and run context shared with the team, plus its own scope. */
  async forAgent(agent: AgentKey, runId: string | null, limit = 20): Promise<{ scope: ContextScope; key: string; value: unknown }[]> {
    const out: { scope: ContextScope; key: string; value: unknown }[] = [];
    for (const scope of readableScopesFor(agent)) {
      if (scope.scope === "workflow" && !runId) continue;
      const scopeKey = scope.scope === "workflow" ? runId! : scope.scope === "agent" ? agent : "company";
      const rows = await this.deps.store.list({ scope: scope.scope, scopeKey, limit });
      for (const row of rows) {
        if (canRead({ kind: "agent", agent }, { scope: row.scope, scopeKey: row.scopeKey, visibility: row.visibility })) {
          out.push({ scope: row.scope, key: row.contextKey, value: row.value });
        }
      }
    }
    return out.slice(0, limit);
  }
}
