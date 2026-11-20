import type { ContextScope, ContextVisibility } from "./policy";

export interface ContextEntry {
  id: string;
  scope: ContextScope;
  scopeKey: string;
  contextKey: string;
  value: unknown;
  visibility: ContextVisibility;
  version: number;
  updatedBy: string;
  updatedAt: string;
}

export interface ContextVersion {
  entryId: string;
  version: number;
  value: unknown;
  changedBy: string;
  reason: string | null;
  changedAt: string;
}

export interface ContextWrite {
  scope: ContextScope;
  scopeKey: string;
  contextKey: string;
  value: unknown;
  /** 0 creates the entry. Any other value must match the stored version, or the write is refused. */
  expectedVersion: number;
  visibility: ContextVisibility;
  changedBy: string;
  reason: string | null;
  changedAt: string;
}

export class ContextVersionConflictError extends Error {
  constructor(message = "The context was changed by someone else. Read it again and retry.") {
    super(message);
    this.name = "ContextVersionConflictError";
  }
}

export interface ContextStore {
  list(filter: { scope?: ContextScope; scopeKey?: string; limit: number }): Promise<ContextEntry[]>;
  get(scope: ContextScope, scopeKey: string, contextKey: string): Promise<ContextEntry | null>;
  /** Atomic: the entry and its history row are written together, or not at all. */
  write(write: ContextWrite): Promise<{ entryId: string; version: number }>;
  history(entryId: string, limit: number): Promise<ContextVersion[]>;
}

/** In-memory context store with the same versioning rules. Used by tests and local development. */
export class MemoryContextStore implements ContextStore {
  private entries = new Map<string, ContextEntry>();
  private versions: ContextVersion[] = [];
  private nextId = 0;

  private keyOf(scope: string, scopeKey: string, key: string) {
    return `${scope}|${scopeKey}|${key}`;
  }

  async list(filter: { scope?: ContextScope; scopeKey?: string; limit: number }) {
    return [...this.entries.values()]
      .filter((e) => (!filter.scope || e.scope === filter.scope) && (!filter.scopeKey || e.scopeKey === filter.scopeKey))
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt) || b.id.localeCompare(a.id))
      .slice(0, filter.limit);
  }

  async get(scope: ContextScope, scopeKey: string, contextKey: string) {
    return this.entries.get(this.keyOf(scope, scopeKey, contextKey)) ?? null;
  }

  async write(w: ContextWrite) {
    const k = this.keyOf(w.scope, w.scopeKey, w.contextKey);
    const existing = this.entries.get(k);
    const currentVersion = existing?.version ?? 0;
    if (currentVersion !== w.expectedVersion) throw new ContextVersionConflictError();
    const version = currentVersion + 1;
    const id = existing?.id ?? `ctx-${++this.nextId}`;
    this.entries.set(k, {
      id,
      scope: w.scope,
      scopeKey: w.scopeKey,
      contextKey: w.contextKey,
      value: w.value,
      visibility: w.visibility,
      version,
      updatedBy: w.changedBy,
      updatedAt: w.changedAt,
    });
    this.versions.push({ entryId: id, version, value: w.value, changedBy: w.changedBy, reason: w.reason, changedAt: w.changedAt });
    return { entryId: id, version };
  }

  async history(entryId: string, limit: number) {
    return this.versions
      .filter((v) => v.entryId === entryId)
      .sort((a, b) => b.version - a.version)
      .slice(0, limit);
  }
}
