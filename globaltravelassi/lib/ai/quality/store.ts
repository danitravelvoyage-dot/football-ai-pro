import type { Dimension, QualityIssue, QualityStatus, RevisionFeedback } from "./types";

export interface QualityReviewRecord {
  id: string;
  taskId: string;
  runId: string;
  agent: string;
  attempt: number;
  status: QualityStatus;
  overall: number;
  scores: Record<Dimension, number>;
  issues: QualityIssue[];
  feedback: RevisionFeedback[];
  createdAt: string;
}

export interface QualityStore {
  saveReview(record: QualityReviewRecord): Promise<void>;
  reviewsForTask(taskId: string): Promise<QualityReviewRecord[]>;
}

/** Revision history per task, oldest first. Append-only. */
export class MemoryQualityStore implements QualityStore {
  private rows: QualityReviewRecord[] = [];

  async saveReview(record: QualityReviewRecord): Promise<void> {
    if (this.rows.some((r) => r.taskId === record.taskId && r.attempt === record.attempt)) {
      throw new Error(`Review ${record.attempt} for task ${record.taskId} already exists.`);
    }
    this.rows.push(record);
  }

  async reviewsForTask(taskId: string): Promise<QualityReviewRecord[]> {
    return this.rows.filter((r) => r.taskId === taskId).sort((a, b) => a.attempt - b.attempt);
  }
}
