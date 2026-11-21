import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { AuditEventRow, AuditReader } from "./corrections";

/** Reads the append-only audit table through the owner's session. RLS limits the rows to the owner's role. */
export class SupabaseAuditReader implements AuditReader {
  constructor(private readonly db: SupabaseClient) {}

  async listEvents(filter: { eventType: string; limit: number }): Promise<AuditEventRow[]> {
    const { data, error } = await this.db
      .from("ai_events")
      .select("id, ts, actor, entity_id, meta")
      .eq("event_type", filter.eventType)
      .order("ts", { ascending: false })
      .limit(filter.limit);
    if (error) throw new Error(`Audit read error: ${error.message.slice(0, 160)}`);
    return ((data ?? []) as Record<string, unknown>[]).map((r) => ({
      id: r.id as string,
      ts: r.ts as string,
      actor: r.actor as string,
      entityId: r.entity_id as string,
      meta: (r.meta as Record<string, unknown>) ?? {},
    }));
  }
}
