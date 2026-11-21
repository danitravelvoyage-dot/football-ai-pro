import type { SupabaseClient } from "@supabase/supabase-js";
import type { ArtifactRecord } from "../orchestration/records";
import type { ContentStore, ReviewRow } from "./review";

type Row = Record<string, unknown>;

function fail(error: { message: string }): never {
  throw new Error(`Content store error: ${error.message.slice(0, 160)}`);
}

function toArtifact(r: Row): ArtifactRecord {
  return {
    id: r.id as string,
    taskId: (r.task_id as string | null) ?? null,
    agent: r.agent as ArtifactRecord["agent"],
    kind: r.kind as string,
    language: r.language as string,
    country: r.country as string,
    body: r.body,
    status: r.status as ArtifactRecord["status"],
    source: r.source as ArtifactRecord["source"],
    promptVersion: (r.prompt_version as string | null) ?? null,
    createdAt: r.created_at as string,
  };
}

/** Content pipeline on Supabase. Decisions are written by the owner's session, under migration 0013's policies. */
export class SupabaseContentStore implements ContentStore {
  constructor(private readonly db: SupabaseClient) {}

  async list(statuses: ArtifactRecord["status"][], limit: number): Promise<ArtifactRecord[]> {
    const { data, error } = await this.db.from("ai_artifacts").select("*").in("status", statuses).order("created_at", { ascending: false }).limit(limit);
    if (error) fail(error);
    return ((data ?? []) as Row[]).map(toArtifact);
  }

  async get(id: string): Promise<ArtifactRecord | null> {
    const { data, error } = await this.db.from("ai_artifacts").select("*").eq("id", id).maybeSingle();
    if (error) fail(error);
    return data ? toArtifact(data as Row) : null;
  }

  async setStatus(id: string, status: ArtifactRecord["status"]): Promise<void> {
    const { error } = await this.db.from("ai_artifacts").update({ status }).eq("id", id);
    if (error) fail(error);
  }

  async addReview(row: ReviewRow): Promise<void> {
    const { error } = await this.db.from("ai_content_reviews").insert({
      id: row.id,
      artifact_id: row.artifactId,
      decision: row.decision,
      note: row.note,
      reviewer: row.reviewer,
      reviewed_at: row.reviewedAt,
    });
    if (error) fail(error);
  }

  async reviews(artifactId: string): Promise<ReviewRow[]> {
    const { data, error } = await this.db.from("ai_content_reviews").select("*").eq("artifact_id", artifactId).order("reviewed_at", { ascending: false }).order("seq", { ascending: false }).limit(200);
    if (error) fail(error);
    return ((data ?? []) as Row[]).map((r) => ({
      id: r.id as string,
      artifactId,
      decision: r.decision as ReviewRow["decision"],
      note: (r.note as string | null) ?? null,
      reviewer: r.reviewer as string,
      reviewedAt: r.reviewed_at as string,
    }));
  }
}
