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

export interface NotificationFilter {
  severity?: Severity;
  kind?: NoticeKind;
  unreadOnly?: boolean;
  limit?: number;
}

/** Storage contract. `insertIfAbsent` keeps one row per dedupe key and reports whether it created it. */
export interface NotificationStore {
  insertIfAbsent(row: Omit<NotificationRecord, "readAt"> & { id: string }): Promise<{ created: boolean }>;
  list(filter: NotificationFilter): Promise<NotificationRecord[]>;
  countUnread(): Promise<number>;
  markRead(id: string, readAtIso: string): Promise<boolean>;
}

export const MAX_NOTIFICATION_LIST = 200;

/** Applies a filter to rows. Shared by the in-memory store and the tests. Newest first. */
export function filterNotifications(rows: NotificationRecord[], f: NotificationFilter): NotificationRecord[] {
  const limit = Math.min(Math.max(f.limit ?? 50, 1), MAX_NOTIFICATION_LIST);
  return rows
    .filter((r) => (f.severity ? r.severity === f.severity : true))
    .filter((r) => (f.kind ? r.kind === f.kind : true))
    .filter((r) => (f.unreadOnly ? r.readAt === null : true))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id))
    .slice(0, limit);
}

export class MemoryNotificationStore implements NotificationStore {
  private rows = new Map<string, NotificationRecord>();

  async insertIfAbsent(row: Omit<NotificationRecord, "readAt"> & { id: string }): Promise<{ created: boolean }> {
    if ([...this.rows.values()].some((r) => r.dedupeKey === row.dedupeKey)) return { created: false };
    this.rows.set(row.id, { ...row, readAt: null });
    return { created: true };
  }

  async list(filter: NotificationFilter): Promise<NotificationRecord[]> {
    return filterNotifications([...this.rows.values()], filter);
  }

  async countUnread(): Promise<number> {
    return [...this.rows.values()].filter((r) => r.readAt === null).length;
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

  /** Owner only. Newest first, optionally filtered by severity, kind or unread state. */
  async list(actor: Actor, filter: NotificationFilter = {}): Promise<NotificationRecord[]> {
    if (actor.kind !== "owner") throw new ForbiddenActorError("Only the owner reads notifications.");
    return this.deps.store.list(filter);
  }

  /** Owner only. The number shown on the inbox badge. */
  async unreadCount(actor: Actor): Promise<number> {
    if (actor.kind !== "owner") throw new ForbiddenActorError("Only the owner reads notifications.");
    return this.deps.store.countUnread();
  }

  /**
   * The number of unread notices, for platform reports. It returns a count only and never the content.
   */
  async unreadTotal(): Promise<number> {
    return this.deps.store.countUnread();
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
