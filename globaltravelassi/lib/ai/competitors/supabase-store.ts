import type { SupabaseClient } from "@supabase/supabase-js";
import type { CompetitorStore, ObservationRecord, SourceRecord } from "./service";
import type { Change, Offer, ObservationStatus, SourceKind } from "./rules";

type Row = Record<string, unknown>;

function fail(error: { message: string }): never {
  throw new Error(`Competitor store error: ${error.message.slice(0, 160)}`);
}

const sourceFromRow = (r: Row): SourceRecord => ({
  id: r.id as string,
  name: r.name as string,
  url: r.url as string,
  host: r.host as string,
  kind: r.kind as SourceKind,
  purpose: r.purpose as string,
  termsReviewedBy: r.terms_reviewed_by as string,
  termsReviewedAt: r.terms_reviewed_at as string,
  minIntervalHours: Number(r.min_interval_hours),
  active: Boolean(r.active),
  lastCheckedAt: (r.last_checked_at as string | null) ?? null,
  lastStatus: (r.last_status as ObservationStatus | null) ?? null,
  createdAt: r.created_at as string,
});

/** Competitor sources on Supabase. Runs with the owner's session, so migration 0016's policies apply. */
export class SupabaseCompetitorStore implements CompetitorStore {
  constructor(private readonly db: SupabaseClient) {}

  async insertSource(s: SourceRecord): Promise<void> {
    const { error } = await this.db.from("ai_competitor_sources").insert({
      id: s.id,
      name: s.name,
      url: s.url,
      host: s.host,
      kind: s.kind,
      purpose: s.purpose,
      terms_reviewed_by: s.termsReviewedBy,
      terms_reviewed_at: s.termsReviewedAt,
      min_interval_hours: s.minIntervalHours,
      active: s.active,
      created_at: s.createdAt,
    });
    if (error) fail(error);
  }

  async getSource(id: string): Promise<SourceRecord | null> {
    const { data, error } = await this.db.from("ai_competitor_sources").select("*").eq("id", id).maybeSingle();
    if (error) fail(error);
    return data ? sourceFromRow(data as Row) : null;
  }

  async listSources(filter: { activeOnly: boolean }): Promise<SourceRecord[]> {
    let q = this.db.from("ai_competitor_sources").select("*");
    if (filter.activeOnly) q = q.eq("active", true);
    const { data, error } = await q.order("created_at", { ascending: true }).limit(200);
    if (error) fail(error);
    return ((data ?? []) as Row[]).map(sourceFromRow);
  }

  async saveSource(s: SourceRecord): Promise<void> {
    const { error } = await this.db
      .from("ai_competitor_sources")
      .update({ active: s.active, last_checked_at: s.lastCheckedAt, last_status: s.lastStatus })
      .eq("id", s.id);
    if (error) fail(error);
  }

  async addObservation(o: ObservationRecord): Promise<void> {
    const { error } = await this.db.from("ai_competitor_observations").insert({
      id: o.id,
      source_id: o.sourceId,
      observed_at: o.observedAt,
      status: o.status,
      content_hash: o.contentHash,
      offers: o.offers,
      changes: o.changes,
    });
    if (error) fail(error);
  }

  async listObservations(sourceId: string, limit: number): Promise<ObservationRecord[]> {
    const { data, error } = await this.db
      .from("ai_competitor_observations")
      .select("*")
      .eq("source_id", sourceId)
      .order("observed_at", { ascending: false })
      .limit(limit);
    if (error) fail(error);
    return ((data ?? []) as Row[]).map((r) => ({
      id: r.id as string,
      sourceId: r.source_id as string,
      observedAt: r.observed_at as string,
      status: r.status as ObservationStatus,
      contentHash: (r.content_hash as string | null) ?? null,
      offers: (r.offers as Offer[]) ?? [],
      changes: (r.changes as Change[]) ?? [],
    }));
  }
}
