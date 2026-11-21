import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { ReviewItem, ReviewStore } from "./service";
import type { ReviewKind, ReviewStatus } from "./rules";

type Row = Record<string, unknown>;

function fail(error: { message: string }): never {
  throw new Error(`Review store error: ${error.message.slice(0, 160)}`);
}

const fromRow = (r: Row): ReviewItem => ({
  id: r.id as string,
  kind: r.kind as ReviewKind,
  status: r.status as ReviewStatus,
  agent: (r.agent as string | null) ?? null,
  runId: (r.run_id as string | null) ?? null,
  taskId: (r.task_id as string | null) ?? null,
  leadId: (r.lead_id as string | null) ?? null,
  subjectRef: r.subject_ref as string,
  summary: r.summary as string,
  evidence: (r.evidence as Record<string, unknown>) ?? {},
  payload: (r.payload as Record<string, unknown>) ?? {},
  createdAt: r.created_at as string,
  expiresAt: r.expires_at as string,
  decidedBy: (r.decided_by as string | null) ?? null,
  decidedAt: (r.decided_at as string | null) ?? null,
  decisionReason: (r.decision_reason as string | null) ?? null,
  version: Number(r.version),
});

/** Review items on Supabase. The owner's session decides; the operator may open items. Migration 0018 applies. */
export class SupabaseReviewStore implements ReviewStore {
  constructor(private readonly db: SupabaseClient) {}

  async insert(item: ReviewItem): Promise<void> {
    const { error } = await this.db.from("ai_review_items").insert({
      id: item.id,
      kind: item.kind,
      status: item.status,
      agent: item.agent,
      run_id: item.runId,
      task_id: item.taskId,
      lead_id: item.leadId,
      subject_ref: item.subjectRef,
      summary: item.summary,
      evidence: item.evidence,
      payload: item.payload,
      created_at: item.createdAt,
      expires_at: item.expiresAt,
      version: item.version,
    });
    if (error) fail(error);
  }

  async get(id: string): Promise<ReviewItem | null> {
    const { data, error } = await this.db.from("ai_review_items").select("*").eq("id", id).maybeSingle();
    if (error) fail(error);
    return data ? fromRow(data as Row) : null;
  }

  async list(filter: { status?: ReviewStatus; kind?: ReviewKind; limit: number }): Promise<ReviewItem[]> {
    let q = this.db.from("ai_review_items").select("*");
    if (filter.status) q = q.eq("status", filter.status);
    if (filter.kind) q = q.eq("kind", filter.kind);
    const { data, error } = await q.order("created_at", { ascending: false }).limit(filter.limit);
    if (error) fail(error);
    return ((data ?? []) as Row[]).map(fromRow);
  }

  /** Compare-and-set on the version and the open status: a row changed by someone else matches nothing. */
  async decide(id: string, expectedVersion: number, next: { status: ReviewStatus; decidedBy: string; decidedAt: string; decisionReason: string }): Promise<boolean> {
    const { data, error } = await this.db
      .from("ai_review_items")
      .update({ status: next.status, decided_by: next.decidedBy, decided_at: next.decidedAt, decision_reason: next.decisionReason, version: expectedVersion + 1 })
      .eq("id", id)
      .eq("version", expectedVersion)
      .eq("status", "open")
      .select("id");
    if (error) fail(error);
    return (data ?? []).length === 1;
  }
}
