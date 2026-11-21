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

/** A retired host changes only through an approved reactivation. */
export class SourceRetiredError extends Error {
  constructor() {
    super("This host is retired. It can come back only through an approved reactivation.");
    this.name = "SourceRetiredError";
  }
}

/** Reactivation needs an approved review item for this host and this exact version. */
export class SourceNotApprovedError extends Error {
  constructor() {
    super("No approved reactivation matches this host and version.");
    this.name = "SourceNotApprovedError";
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
  /** The reason given for the latest change. The database refuses a change without one. */
  lastChangeReason: string | null;
}

export interface SourceStore {
  list(): Promise<SourceRecord[]>;
  get(host: string): Promise<SourceRecord | null>;
  insert(row: SourceRecord): Promise<void>;
  /** Replaces the row only if its version is still `expectedVersion`. Returns false when another change got there first. */
  update(host: string, expectedVersion: number, next: SourceRecord): Promise<boolean>;
  /**
   * Retired to active, through the approved reactivation. The database checks the approval again; the memory store
   * relies on the service's check.
   */
  reactivate(host: string, expectedVersion: number, reason: string, reviewId: string): Promise<boolean>;
}

/** The approval center, as the registry sees it. Reactivation is requested there and decided there. */
export interface SourceApprovals {
  requestReactivation(request: { host: string; version: number; reason: string; requestedBy: string }): Promise<string>;
  isApproved(reviewId: string, host: string, version: number): Promise<boolean>;
}

export interface SourceServiceDeps {
  store: SourceStore;
  audit: AuditSink;
  now: () => Date;
  newId: () => string;
  approvals?: SourceApprovals;
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
 * The owner's source registry. Every change is owner-only, needs its own reason, is checked against the version the owner
 * saw, and is audited with the previous and new values. Hosts are never deleted: retirement is a status. `activeHosts` is
 * the only read agents use: usable hosts only, official sources first.
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

  /** The status and version of one host, for the approval center's checks. */
  async status(host: string): Promise<{ status: SourceStatus; version: number } | null> {
    const row = await this.deps.store.get(normalizeHost(host));
    return row ? { status: row.status, version: row.version } : null;
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
      lastChangeReason: reasonOf(reason),
    };
    await this.deps.store.insert(row);
    await this.audit(by, "source.added", host, null, row, row.lastChangeReason!);
    return row;
  }

  async edit(actor: Actor, host: string, expectedVersion: number, input: Omit<SourceInput, "host">, reason: string): Promise<SourceRecord> {
    const by = owner(actor);
    const now = this.nowIso();
    const before = await this.current(host, expectedVersion);
    const next: SourceRecord = {
      ...before,
      lastChangeReason: reasonOf(reason),
      category: checkCategory(input.category),
      jurisdiction: checkJurisdiction(input.jurisdiction),
      purpose: checkPurpose(input.purpose),
      expiresAt: checkExpiry(input.expiresAt, now),
      version: before.version + 1,
      updatedAt: now,
    };
    await this.write(before, next, expectedVersion);
    await this.audit(by, "source.updated", before.host, before, next, next.lastChangeReason!);
    return next;
  }

  /** Pauses or resumes an active or disabled host. A retired host is not changed here. */
  async setStatus(actor: Actor, host: string, expectedVersion: number, status: "active" | "disabled", reason: string): Promise<SourceRecord> {
    const by = owner(actor);
    const before = await this.current(host, expectedVersion);
    const next: SourceRecord = { ...before, status, version: before.version + 1, updatedAt: this.nowIso(), lastChangeReason: reasonOf(reason) };
    await this.write(before, next, expectedVersion);
    await this.audit(by, status === "disabled" ? "source.disabled" : "source.enabled", before.host, before, next, next.lastChangeReason!);
    return next;
  }

  /** Records that the host was checked again today. Does not verify content. */
  async revalidate(actor: Actor, host: string, expectedVersion: number, reason: string): Promise<SourceRecord> {
    const by = owner(actor);
    const now = this.nowIso();
    const before = await this.current(host, expectedVersion);
    const next: SourceRecord = { ...before, validatedAt: now, version: before.version + 1, updatedAt: now, lastChangeReason: reasonOf(reason) };
    await this.write(before, next, expectedVersion);
    await this.audit(by, "source.revalidated", before.host, before, next, next.lastChangeReason!);
    return next;
  }

  /** Retires a host. Terminal: the row, its history and its approver stay, and agents stop reading it. */
  async retire(actor: Actor, host: string, expectedVersion: number, reason: string): Promise<SourceRecord> {
    const by = owner(actor);
    const before = await this.current(host, expectedVersion);
    const next: SourceRecord = { ...before, status: "retired", version: before.version + 1, updatedAt: this.nowIso(), lastChangeReason: reasonOf(reason) };
    await this.write(before, next, expectedVersion);
    await this.audit(by, "source.retired", before.host, before, next, next.lastChangeReason!);
    return next;
  }

  /** Asks for a retired host to come back. The request is a review item; nothing changes until it is approved. */
  async requestReactivation(actor: Actor, host: string, expectedVersion: number, reason: string): Promise<string> {
    const by = owner(actor);
    const before = await this.require(host);
    if (before.version !== expectedVersion) throw new SourceConflictError();
    if (before.status !== "retired") throw new SourceRuleError("Only a retired host needs a reactivation.", "invalid_host");
    if (!this.deps.approvals) throw new SourceNotApprovedError();
    const reviewId = await this.deps.approvals.requestReactivation({ host: before.host, version: before.version, reason: reasonOf(reason), requestedBy: by });
    await this.audit(by, "source.reactivation_requested", before.host, before, null, reasonOf(reason), { reviewId });
    return reviewId;
  }

  /**
   * Brings a retired host back. Refused unless the approved review item for this host and this exact version exists.
   * Called by the approval center when the owner approves the request. The database checks the same approval again.
   */
  async reactivate(actor: Actor, host: string, expectedVersion: number, reviewId: string, reason: string): Promise<SourceRecord> {
    const by = owner(actor);
    const before = await this.require(host);
    if (before.version !== expectedVersion) throw new SourceConflictError();
    if (before.status !== "retired") throw new SourceRuleError("Only a retired host can be reactivated.", "invalid_host");
    if (!this.deps.approvals || !(await this.deps.approvals.isApproved(reviewId, before.host, before.version))) throw new SourceNotApprovedError();
    const why = reasonOf(reason);
    const ok = await this.deps.store.reactivate(before.host, before.version, why, reviewId);
    if (!ok) throw new SourceConflictError();
    const next: SourceRecord = { ...before, status: "active", version: before.version + 1, updatedAt: this.nowIso(), lastChangeReason: why };
    await this.audit(by, "source.reactivated", before.host, before, next, why, { reviewId });
    return next;
  }

  private async current(host: string, expectedVersion: number): Promise<SourceRecord> {
    const row = await this.require(host);
    if (row.version !== expectedVersion) throw new SourceConflictError();
    if (row.status === "retired") throw new SourceRetiredError();
    return row;
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

  private async audit(
    by: string,
    type: string,
    host: string,
    before: SourceRecord | null,
    after: SourceRecord | null,
    reason: string,
    extra: Record<string, unknown> = {},
  ): Promise<void> {
    await this.deps.audit.write({
      id: this.deps.newId(),
      ts: this.nowIso(),
      actor: `owner:${by}`,
      type,
      entityType: "ai_source",
      entityId: host,
      meta: { previous: before ? summary(before) : null, next: after ? summary(after) : null, reason, ...extra },
    });
  }
}

/** The fields a change is audited with. Approver identity stays in the row, not in the audit trail. */
function summary(s: SourceRecord) {
  return { category: s.category, jurisdiction: s.jurisdiction, purpose: s.purpose, status: s.status, expiresAt: s.expiresAt, validatedAt: s.validatedAt, version: s.version };
}
