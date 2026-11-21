import type { SupabaseClient } from "@supabase/supabase-js";
import { MAX_NOTIFICATION_LIST, type NotificationFilter, type NotificationRecord, type NotificationStore } from "./service";

type Row = Record<string, unknown>;

function fail(error: { message: string; code?: string }): never {
  throw new Error(`Notification store error: ${(error.code ?? "").slice(0, 10)} ${error.message.slice(0, 160)}`);
}

function toRecord(r: Row): NotificationRecord {
  return {
    id: r.id as string,
    dedupeKey: r.dedupe_key as string,
    kind: r.kind as NotificationRecord["kind"],
    severity: r.severity as NotificationRecord["severity"],
    title: r.title as string,
    body: r.body as string,
    subjectRef: (r.subject_ref as string | null) ?? null,
    createdAt: r.created_at as string,
    readAt: (r.read_at as string | null) ?? null,
  };
}

/** Owner inbox on Supabase. Runs with the caller's session, so row-level security applies. */
export class SupabaseNotificationStore implements NotificationStore {
  constructor(private readonly db: SupabaseClient) {}

  async insertIfAbsent(row: Omit<NotificationRecord, "readAt"> & { id: string }): Promise<{ created: boolean }> {
    const { error } = await this.db.from("ai_owner_notifications").insert({
      id: row.id,
      dedupe_key: row.dedupeKey,
      kind: row.kind,
      severity: row.severity,
      title: row.title,
      body: row.body,
      subject_ref: row.subjectRef,
      created_at: row.createdAt,
    });
    if (error) {
      // 23505 is a unique violation: the notice already exists. That is the expected, idempotent outcome.
      if (error.code === "23505") return { created: false };
      fail(error);
    }
    return { created: true };
  }

  async list(filter: NotificationFilter): Promise<NotificationRecord[]> {
    const limit = Math.min(Math.max(filter.limit ?? 50, 1), MAX_NOTIFICATION_LIST);
    let q = this.db.from("ai_owner_notifications").select("*");
    if (filter.severity) q = q.eq("severity", filter.severity);
    if (filter.kind) q = q.eq("kind", filter.kind);
    if (filter.unreadOnly) q = q.is("read_at", null);
    const { data, error } = await q.order("created_at", { ascending: false }).limit(limit);
    if (error) fail(error);
    return ((data ?? []) as Row[]).map(toRecord);
  }

  async countUnread(): Promise<number> {
    const { count, error } = await this.db.from("ai_owner_notifications").select("id", { count: "exact", head: true }).is("read_at", null);
    if (error) fail(error);
    return count ?? 0;
  }

  async markRead(id: string, readAtIso: string): Promise<boolean> {
    // The database stamps read_at and read_by from the session. The value passed here is not trusted.
    void readAtIso;
    const { data, error } = await this.db.from("ai_owner_notifications").update({ read_at: new Date().toISOString() }).eq("id", id).is("read_at", null).select("id");
    if (error) fail(error);
    return (data ?? []).length > 0;
  }
}
