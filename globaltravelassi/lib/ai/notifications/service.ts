import type { AuditSink } from "../audit";
import { assertNoPersonalData, PersonalDataError } from "../security/personal-data";
import { ForbiddenActorError } from "../approvals";
import type { Actor } from "../types";
import type { Notice, Severity, NoticeKind } from "./rules";

export class NotificationInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NotificationInputError";
  }
}

export interface NotificationRecord {
  id: string;
  dedupeKey: string;
  kind: NoticeKind;
  severity: Severity;
  title: string;
  body: string;
  subjectRef: string | null;
  createdAt: string;
  readAt: string | null;
}

/** Storage contract. `insertIfAbsent` keeps one row per dedupe key and reports whether it created it. */
export interface NotificationStore {
  insertIfAbsent(row: Omit<NotificationRecord, "readAt"> & { id: string }): Promise<{ created: boolean }>;
  list(limit: number): Promise<NotificationRecord[]>;
  markRead(id: string, readAtIso: string): Promise<boolean>;
}

export class MemoryNotificationStore implements NotificationStore {
  private rows = new Map<string, NotificationRecord>();

  async insertIfAbsent(row: Omit<NotificationRecord, "readAt"> & { id: string }): Promise<{ created: boolean }> {
    if ([...this.rows.values()].some((r) => r.dedupeKey === row.dedupeKey)) return { created: false };
    this.rows.set(row.id, { ...row, readAt: null });
    return { created: true };
  }

  async list(limit: number): Promise<NotificationRecord[]> {
    return [...this.rows.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id)).slice(0, limit);
  }

  async markRead(id: string, readAtIso: string): Promise<boolean> {
    const row = this.rows.get(id);
    if (!row || row.readAt !== null) return false;
    this.rows.set(id, { ...row, readAt: readAtIso });
    return true;
  }
}

export interface NotificationServiceDeps {
  store: NotificationStore;
  audit: AuditSink;
  now: () => Date;
  newId: () => string;
}

/**
 * The owner's inbox. The platform writes notices; only the owner reads them and marks them read.
 * Notice text is checked for personal data before it is stored.
 */
export class NotificationService {
  constructor(private readonly deps: NotificationServiceDeps) {}

  /** Stores a notice once. A repeated dedupe key returns created = false and changes nothing. */
  async notify(notice: Notice): Promise<{ created: boolean }> {
    try {
      assertNoPersonalData({ title: notice.title, body: notice.body });
    } catch (error) {
      if (error instanceof PersonalDataError) throw new NotificationInputError("Notice text contains personal data and was refused.");
      throw error;
    }
    const nowIso = this.deps.now().toISOString();
    const id = this.deps.newId();
    const { created } = await this.deps.store.insertIfAbsent({
      id,
      dedupeKey: notice.dedupeKey,
      kind: notice.kind,
      severity: notice.severity,
      title: notice.title,
      body: notice.body,
      subjectRef: notice.subjectRef,
      createdAt: nowIso,
    });
    if (created) {
      await this.deps.audit.write({ id: this.deps.newId(), ts: nowIso, actor: "system", type: "notification.created", entityType: "notification", entityId: id, meta: { kind: notice.kind, severity: notice.severity } });
    }
    return { created };
  }

  /** Owner only. Newest first. */
  async list(actor: Actor, limit = 50): Promise<NotificationRecord[]> {
    if (actor.kind !== "owner") throw new ForbiddenActorError("Only the owner reads notifications.");
    return this.deps.store.list(Math.min(Math.max(limit, 1), 200));
  }

  /** Owner only. Marking a read notice again changes nothing. */
  async markRead(actor: Actor, id: string): Promise<boolean> {
    if (actor.kind !== "owner") throw new ForbiddenActorError("Only the owner marks notifications read.");
    const nowIso = this.deps.now().toISOString();
    const changed = await this.deps.store.markRead(id, nowIso);
    if (changed) {
      await this.deps.audit.write({ id: this.deps.newId(), ts: nowIso, actor: `owner:${actor.id}`, type: "notification.read", entityType: "notification", entityId: id, meta: {} });
    }
    return changed;
  }
}
