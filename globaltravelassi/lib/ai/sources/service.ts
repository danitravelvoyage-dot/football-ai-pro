import type { Actor } from "../types";
import type { AuditSink } from "../audit";
import {
  checkCategory,
  checkExpiry,
  checkJurisdiction,
  checkPurpose,
  isUsable,
  normalizeHost,
  prioritize,
  revalidationDue,
  SourceRuleError,
  type Jurisdiction,
  type SourceCategory,
  type SourceStatus,
} from "./rules";

export class SourceForbiddenError extends Error {
  constructor() {
    super("Only the owner can change the source registry.");
    this.name = "SourceForbiddenError";
  }
}

export class SourceNotFoundError extends Error {
  constructor() {
    super("Source not found.");
    this.name = "SourceNotFoundError";
  }
}

export class SourceConflictError extends Error {
  constructor() {
    super("This source changed since you opened it. Reload and try again.");
    this.name = "SourceConflictError";
  }
}

export interface SourceRecord {
  host: string;
  /** Bumped on every change. A change that names an older version is refused. */
  version: number;
  category: SourceCategory;
  jurisdiction: Jurisdiction;
  purpose: string;
  status: SourceStatus;
  expiresAt: string | null;
  validatedAt: string | null;
  approvedBy: string | null;
  approvedAt: string;
  updatedAt: string;
}

export interface SourceStore {
  list(): Promise<SourceRecord[]>;
  get(host: string): Promise<SourceRecord | null>;
  insert(row: SourceRecord): Promise<void>;
  /** Replaces the row only if its version is still `expectedVersion`. Returns false when another change got there first. */
  update(host: string, expectedVersion: number, next: SourceRecord): Promise<boolean>;
  delete(host: string): Promise<void>;
}

export interface SourceServiceDeps {
  store: SourceStore;
  audit: AuditSink;
  now: () => Date;
  newId: () => string;
}

export interface SourceInput {
  host: string;
  category: string;
  jurisdiction: string;
  purpose: string;
  expiresAt: string | null;
}

const owner = (actor: Actor): string => {
  if (actor.kind !== "owner" || actor.id.trim().length === 0) throw new SourceForbiddenError();
  return actor.id;
};

const reasonOf = (reason: string): string => {
  const r = reason.trim();
  if (r.length < 3 || r.length > 500) throw new SourceRuleError("Give a reason of 3 to 500 characters.", "invalid_purpose");
  return r;
};

/**
 * The owner's source registry. Every change is owner-only, needs a reason, is audited with the previous and new values,
 * and is checked against the version the owner saw. `activeHosts` is the only read that agents use: usable hosts only,
 * official sources first.
 */
export class SourceService {
  constructor(private readonly deps: SourceServiceDeps) {}

  private nowIso(): string {
    return this.deps.now().toISOString();
  }

  async list(actor: Actor): Promise<(SourceRecord & { usable: boolean; revalidationDue: boolean })[]> {
    owner(actor);
    const now = this.nowIso();
    return prioritize(await this.deps.store.list()).map((s) => ({ ...s, usable: isUsable(s, now), revalidationDue: revalidationDue(s, now) }));
  }

  /** Agents' read. No actor: agents never see who approved what. Usable hosts only, official sources first. */
  async activeHosts(): Promise<string[]> {
    const now = this.nowIso();
    return prioritize((await this.deps.store.list()).filter((s) => isUsable(s, now))).map((s) => s.host);
  }

  async add(actor: Actor, input: SourceInput, reason: string): Promise<SourceRecord> {
    const by = owner(actor);
    const now = this.nowIso();
    const host = normalizeHost(input.host);
    if (await this.deps.store.get(host)) throw new SourceRuleError("This host is already on the registry.", "invalid_host");
    const row: SourceRecord = {
      host,
      version: 1,
      category: checkCategory(input.category),
      jurisdiction: checkJurisdiction(input.jurisdiction),
      purpose: checkPurpose(input.purpose),
      status: "active",
      expiresAt: checkExpiry(input.expiresAt, now),
      validatedAt: now,
      approvedBy: by,
      approvedAt: now,
      updatedAt: now,
    };
    await this.deps.store.insert(row);
    await this.audit(by, "source.added", host, null, row, reasonOf(reason));
    return row;
  }

  async edit(actor: Actor, host: string, expectedVersion: number, input: Omit<SourceInput, "host">, reason: string): Promise<SourceRecord> {
    const by = owner(actor);
    const now = this.nowIso();
    const before = await this.require(host);
    if (before.version !== expectedVersion) throw new SourceConflictError();
    const next: SourceRecord = {
      ...before,
      category: checkCategory(input.category),
      jurisdiction: checkJurisdiction(input.jurisdiction),
      purpose: checkPurpose(input.purpose),
      expiresAt: checkExpiry(input.expiresAt, now),
      version: before.version + 1,
      updatedAt: now,
    };
    await this.write(before, next, expectedVersion);
    await this.audit(by, "source.updated", before.host, before, next, reasonOf(reason));
    return next;
  }

  async setStatus(actor: Actor, host: string, expectedVersion: number, status: SourceStatus, reason: string): Promise<SourceRecord> {
    const by = owner(actor);
    const before = await this.require(host);
    if (before.version !== expectedVersion) throw new SourceConflictError();
    const next: SourceRecord = { ...before, status, version: before.version + 1, updatedAt: this.nowIso() };
    await this.write(before, next, expectedVersion);
    await this.audit(by, status === "disabled" ? "source.disabled" : "source.enabled", before.host, before, next, reasonOf(reason));
    return next;
  }

  /** Records that the host was checked again today. Does not verify content. */
  async revalidate(actor: Actor, host: string, expectedVersion: number, reason: string): Promise<SourceRecord> {
    const by = owner(actor);
    const now = this.nowIso();
    const before = await this.require(host);
    if (before.version !== expectedVersion) throw new SourceConflictError();
    const next: SourceRecord = { ...before, validatedAt: now, version: before.version + 1, updatedAt: now };
    await this.write(before, next, expectedVersion);
    await this.audit(by, "source.revalidated", before.host, before, next, reasonOf(reason));
    return next;
  }

  async remove(actor: Actor, host: string, expectedVersion: number, reason: string): Promise<void> {
    const by = owner(actor);
    const before = await this.require(host);
    if (before.version !== expectedVersion) throw new SourceConflictError();
    await this.deps.store.delete(before.host);
    await this.audit(by, "source.removed", before.host, before, null, reasonOf(reason));
  }

  private async require(host: string): Promise<SourceRecord> {
    const row = await this.deps.store.get(normalizeHost(host));
    if (!row) throw new SourceNotFoundError();
    return row;
  }

  private async write(before: SourceRecord, next: SourceRecord, expectedVersion: number): Promise<void> {
    const ok = await this.deps.store.update(before.host, expectedVersion, next);
    if (!ok) throw new SourceConflictError();
  }

  private async audit(by: string, type: string, host: string, before: SourceRecord | null, after: SourceRecord | null, reason: string): Promise<void> {
    await this.deps.audit.write({
      id: this.deps.newId(),
      ts: this.nowIso(),
      actor: `owner:${by}`,
      type,
      entityType: "ai_source",
      entityId: host,
      meta: { previous: before ? summary(before) : null, next: after ? summary(after) : null, reason },
    });
  }
}

/** The fields a change is audited with. Approver identity stays in the row, not in the audit trail. */
function summary(s: SourceRecord) {
  return { category: s.category, jurisdiction: s.jurisdiction, purpose: s.purpose, status: s.status, expiresAt: s.expiresAt, validatedAt: s.validatedAt };
}
