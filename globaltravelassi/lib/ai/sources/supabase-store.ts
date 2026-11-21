import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { SourceRecord, SourceStore } from "./service";
import type { Jurisdiction, SourceCategory, SourceStatus } from "./rules";

type Row = Record<string, unknown>;

const fromRow = (r: Row): SourceRecord => ({
  host: r.host as string,
  version: Number(r.version ?? 1),
  category: r.category as SourceCategory,
  jurisdiction: r.jurisdiction as Jurisdiction,
  purpose: r.purpose as string,
  status: r.status as SourceStatus,
  expiresAt: (r.expires_at as string | null) ?? null,
  validatedAt: (r.validated_at as string | null) ?? null,
  approvedBy: (r.approved_by as string | null) ?? null,
  approvedAt: r.approved_at as string,
  updatedAt: r.updated_at as string,
});

const toRow = (s: SourceRecord): Row => ({
  host: s.host,
  category: s.category,
  jurisdiction: s.jurisdiction,
  purpose: s.purpose,
  status: s.status,
  expires_at: s.expiresAt,
  validated_at: s.validatedAt,
  approved_by: s.approvedBy,
  approved_at: s.approvedAt,
  updated_at: s.updatedAt,
  version: s.version,
});

/** Source registry on Supabase, through the owner's session. RLS (admin only) applies to every statement. */
export class SupabaseSourceStore implements SourceStore {
  constructor(private readonly db: SupabaseClient) {}

  async list(): Promise<SourceRecord[]> {
    const { data, error } = await this.db.from("ai_sources_allowlist").select("*").order("host", { ascending: true });
    if (error) throw new Error(`Source registry error: ${error.message.slice(0, 160)}`);
    return ((data ?? []) as Row[]).map(fromRow);
  }

  async get(host: string): Promise<SourceRecord | null> {
    const { data, error } = await this.db.from("ai_sources_allowlist").select("*").eq("host", host).maybeSingle();
    if (error) throw new Error(`Source registry error: ${error.message.slice(0, 160)}`);
    return data ? fromRow(data as Row) : null;
  }

  async insert(row: SourceRecord): Promise<void> {
    const { error } = await this.db.from("ai_sources_allowlist").insert(toRow(row));
    if (error) throw new Error(`Source registry error: ${error.message.slice(0, 160)}`);
  }

  /** The version and updated time are set by the database trigger; the write matches only the version the caller read. */
  async update(host: string, expectedVersion: number, next: SourceRecord): Promise<boolean> {
    const { host: _x, approved_by: _a, approved_at: _p, version: _v, updated_at: _u, ...payload } = toRow(next);
    void _x;
    void _a;
    void _p;
    void _v;
    void _u;
    const { data, error } = await this.db
      .from("ai_sources_allowlist")
      .update(payload)
      .eq("host", host)
      .eq("version", expectedVersion)
      .select("host");
    if (error) throw new Error(`Source registry error: ${error.message.slice(0, 160)}`);
    return (data ?? []).length === 1;
  }

  async delete(host: string): Promise<void> {
    const { error } = await this.db.from("ai_sources_allowlist").delete().eq("host", host);
    if (error) throw new Error(`Source registry error: ${error.message.slice(0, 160)}`);
  }
}
