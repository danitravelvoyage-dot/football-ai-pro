import type { SupabaseClient } from "@supabase/supabase-js";
import { CrmStaleError, type CrmStore, type FollowUpRecord, type InteractionRow, type LeadRecord, type StageHistoryRow } from "./service";
import type { FollowUpStatus, LeadSource, LeadStage, Interest, InteractionKind, FollowUpPriority } from "./rules";

type Row = Record<string, unknown>;

function fail(error: { message: string }): never {
  throw new Error(`CRM store error: ${error.message.slice(0, 160)}`);
}

const leadFromRow = (r: Row): LeadRecord => ({
  id: r.id as string,
  version: Number(r.version ?? 1),
  label: r.label as string,
  source: r.source as LeadSource,
  applicationId: (r.application_id as string | null) ?? null,
  destinationCountry: (r.destination_country as string | null) ?? null,
  nationality: (r.nationality as string | null) ?? null,
  travelDate: (r.travel_date as string | null) ?? null,
  interest: r.interest as Interest,
  stage: r.stage as LeadStage,
  stageReason: (r.stage_reason as string | null) ?? null,
  archivedAt: (r.archived_at as string | null) ?? null,
  createdBy: r.created_by as string,
  createdAt: r.created_at as string,
  updatedAt: r.updated_at as string,
});

const leadToRow = (l: LeadRecord): Row => ({
  id: l.id,
  label: l.label,
  source: l.source,
  application_id: l.applicationId,
  destination_country: l.destinationCountry,
  nationality: l.nationality,
  travel_date: l.travelDate,
  interest: l.interest,
  stage: l.stage,
  stage_reason: l.stageReason,
  archived_at: l.archivedAt,
  created_by: l.createdBy,
  created_at: l.createdAt,
  updated_at: l.updatedAt,
});

const followUpFromRow = (r: Row): FollowUpRecord => ({
  id: r.id as string,
  leadId: r.lead_id as string,
  reason: r.reason as string,
  priority: r.priority as FollowUpPriority,
  status: r.status as FollowUpStatus,
  dueAt: r.due_at as string,
  createdBy: r.created_by as string,
  decidedBy: (r.decided_by as string | null) ?? null,
  decidedAt: (r.decided_at as string | null) ?? null,
  createdAt: r.created_at as string,
});

/** CRM on Supabase. Runs with the owner's session, so migration 0015's policies and guards apply to every write. */
export class SupabaseCrmStore implements CrmStore {
  constructor(private readonly db: SupabaseClient) {}

  async insertLead(l: LeadRecord): Promise<void> {
    const { error } = await this.db.from("ai_leads").insert(leadToRow(l));
    if (error) fail(error);
  }

  async getLead(id: string): Promise<LeadRecord | null> {
    const { data, error } = await this.db.from("ai_leads").select("*").eq("id", id).maybeSingle();
    if (error) fail(error);
    return data ? leadFromRow(data as Row) : null;
  }

  async listLeads(filter: { stage?: LeadStage; includeArchived: boolean; limit: number }): Promise<LeadRecord[]> {
    let q = this.db.from("ai_leads").select("*");
    if (filter.stage) q = q.eq("stage", filter.stage);
    if (!filter.includeArchived) q = q.is("archived_at", null);
    const { data, error } = await q.order("created_at", { ascending: false }).limit(filter.limit);
    if (error) fail(error);
    return ((data ?? []) as Row[]).map(leadFromRow);
  }

  async allActiveLeads(limit: number): Promise<LeadRecord[]> {
    const { data, error } = await this.db.from("ai_leads").select("*").is("archived_at", null).limit(limit);
    if (error) fail(error);
    return ((data ?? []) as Row[]).map(leadFromRow);
  }

  /**
   * The stage history row is written by the database guard in the same statement. The version is bumped by the database;
   * the write matches only while the stored version is still the one the caller read.
   */
  async saveLead(l: LeadRecord, _changedBy: string, expectedVersion: number): Promise<void> {
    const { id: _id, version: _v, ...payload } = leadToRow(l) as Record<string, unknown> & { id: string };
    void _id;
    void _v;
    const { data, error } = await this.db.from("ai_leads").update(payload).eq("id", l.id).eq("version", expectedVersion).select("id");
    if (error) fail(error);
    if ((data ?? []).length !== 1) throw new CrmStaleError();
  }

  async listHistory(leadIds: string[]): Promise<StageHistoryRow[]> {
    if (leadIds.length === 0) return [];
    const { data, error } = await this.db.from("ai_lead_stage_history").select("*").in("lead_id", leadIds).order("changed_at", { ascending: true });
    if (error) fail(error);
    return ((data ?? []) as Row[]).map((r) => ({
      id: r.id as string,
      leadId: r.lead_id as string,
      fromStage: r.from_stage as LeadStage,
      toStage: r.to_stage as LeadStage,
      reason: (r.reason as string | null) ?? null,
      changedBy: r.changed_by as string,
      changedAt: r.changed_at as string,
    }));
  }

  async addInteraction(row: InteractionRow): Promise<void> {
    const { error } = await this.db.from("ai_lead_interactions").insert({
      id: row.id,
      lead_id: row.leadId,
      kind: row.kind,
      summary: row.summary,
      recorded_by: row.recordedBy,
      occurred_at: row.occurredAt,
    });
    if (error) fail(error);
  }

  async listInteractions(leadIds: string[]): Promise<InteractionRow[]> {
    if (leadIds.length === 0) return [];
    const { data, error } = await this.db.from("ai_lead_interactions").select("*").in("lead_id", leadIds).order("occurred_at", { ascending: true });
    if (error) fail(error);
    return ((data ?? []) as Row[]).map((r) => ({
      id: r.id as string,
      leadId: r.lead_id as string,
      kind: r.kind as InteractionKind,
      summary: r.summary as string,
      recordedBy: r.recorded_by as string,
      occurredAt: r.occurred_at as string,
    }));
  }

  async insertFollowUp(row: FollowUpRecord): Promise<void> {
    const { error } = await this.db.from("ai_follow_ups").insert({
      id: row.id,
      lead_id: row.leadId,
      reason: row.reason,
      priority: row.priority,
      status: row.status,
      due_at: row.dueAt,
      created_by: row.createdBy,
      decided_by: row.decidedBy,
      decided_at: row.decidedAt,
      created_at: row.createdAt,
    });
    if (error) fail(error);
  }

  async getFollowUp(id: string): Promise<FollowUpRecord | null> {
    const { data, error } = await this.db.from("ai_follow_ups").select("*").eq("id", id).maybeSingle();
    if (error) fail(error);
    return data ? followUpFromRow(data as Row) : null;
  }

  async saveFollowUp(row: FollowUpRecord): Promise<void> {
    const { error } = await this.db
      .from("ai_follow_ups")
      .update({ status: row.status, decided_by: row.decidedBy, decided_at: row.decidedAt })
      .eq("id", row.id);
    if (error) fail(error);
  }

  async listFollowUps(filter: { statuses: FollowUpStatus[]; limit: number }): Promise<FollowUpRecord[]> {
    const { data, error } = await this.db
      .from("ai_follow_ups")
      .select("*")
      .in("status", filter.statuses)
      .order("created_at", { ascending: false })
      .limit(filter.limit);
    if (error) fail(error);
    return ((data ?? []) as Row[]).map(followUpFromRow);
  }
}
