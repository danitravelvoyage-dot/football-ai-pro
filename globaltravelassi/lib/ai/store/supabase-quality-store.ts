import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { QualityReviewRecord, QualityStore } from "../quality/store";
import type { Dimension, QualityIssue, QualityStatus, RevisionFeedback } from "../quality/types";

type Row = Record<string, unknown>;

function toRecord(row: Row): QualityReviewRecord {
  return {
    id: row.id as string,
    taskId: row.task_id as string,
    runId: row.run_id as string,
    agent: row.agent as string,
    attempt: row.attempt as number,
    status: row.status as QualityStatus,
    overall: row.overall as number,
    scores: row.scores as Record<Dimension, number>,
    issues: row.issues as QualityIssue[],
    feedback: row.feedback as RevisionFeedback[],
    createdAt: row.created_at as string,
  };
}

export class SupabaseQualityStore implements QualityStore {
  constructor(private readonly db: SupabaseClient) {}

  async saveReview(r: QualityReviewRecord): Promise<void> {
    const { error } = await this.db.from("ai_quality_reviews").insert({
      id: r.id,
      task_id: r.taskId,
      run_id: r.runId,
      agent: r.agent,
      attempt: r.attempt,
      status: r.status,
      overall: r.overall,
      scores: r.scores,
      issues: r.issues,
      feedback: r.feedback,
      created_at: r.createdAt,
    });
    if (error) throw new Error(error.message);
  }

  async reviewsForTask(taskId: string): Promise<QualityReviewRecord[]> {
    const { data, error } = await this.db.from("ai_quality_reviews").select("*").eq("task_id", taskId).order("attempt", { ascending: true }).limit(100);
    if (error) throw new Error(error.message);
    return ((data ?? []) as Row[]).map(toRecord);
  }
}
