import type { AuditSink } from "../audit";
import type { Actor } from "../types";
import { textsOf, claimsOf } from "./extract";
import { brandChecks, completenessChecks, contradictionChecks, duplicateChecks, factualChecks, languageChecks, policyChecks } from "./checks";
import { schemaChecks } from "./schema";
import { dimensionScores, overallScore, decideStatus } from "./scoring";
import { applyRevisionLimit, feedbackFor } from "./revision";
import type { QualityStore, QualityReviewRecord } from "./store";
import { DEFAULT_QUALITY_CONFIG, type Claim, type QualityIssue, type QualityReview, type QualityConfig } from "./types";
import type { z } from "zod";

export class QualityForbiddenError extends Error {
  constructor() {
    super("Only the owner or the platform can read quality reviews.");
    this.name = "QualityForbiddenError";
  }
}

export interface ReviewInput {
  taskId: string;
  runId: string;
  agent: string;
  outputKind: string;
  output: unknown;
  schema: z.ZodTypeAny;
  language: "ar" | "fr" | "en";
  /** Hosts the owner approved as official sources for factual claims. */
  allowlist: string[];
  /** Claims from other agents in the same run, for contradiction checks. */
  peerClaims?: Claim[];
  attempt: number;
}

export interface QualityControllerDeps {
  store: QualityStore;
  audit: AuditSink;
  now: () => Date;
  newId: () => string;
  config?: QualityConfig;
}

/**
 * Quality controller. Every check is deterministic and runs on the stored output. The controller decides
 * the status, returns structured feedback for a revision, and writes one append-only review per attempt.
 * It never executes an external action and never changes the output it reviews.
 */
export class QualityController {
  private readonly config: QualityConfig;

  constructor(private readonly deps: QualityControllerDeps) {
    this.config = deps.config ?? DEFAULT_QUALITY_CONFIG;
  }

  review(input: ReviewInput): QualityReview {
    const now = this.deps.now();
    const texts = textsOf(input.outputKind, input.output);
    const claims = claimsOf(input.agent, input.outputKind, input.output);
    const issues: QualityIssue[] = [
      ...schemaChecks(input.schema, input.output),
      ...(issuesEmptyOutput(input.outputKind, input.output)),
      ...completenessChecks(texts),
      ...duplicateChecks(texts),
      ...languageChecks(texts, input.language),
      ...brandChecks(texts),
      ...policyChecks(texts),
      ...factualChecks(claims, { allowlist: input.allowlist, now, maxSourceAgeDays: this.config.maxSourceAgeDays }),
      ...contradictionChecks([...claims, ...(input.peerClaims ?? [])]),
    ];

    const scores = dimensionScores(issues);
    const overall = overallScore(scores, this.config.weights);
    const decided = decideStatus(issues, overall, this.config.passScore);
    const status = applyRevisionLimit(decided, input.attempt, this.config.maxAttempts);
    return { status, attempt: input.attempt, overall, scores, issues, feedback: status === "NEEDS_REVISION" ? feedbackFor(issues) : [] };
  }

  /** Runs the review and stores it. The stored record holds codes and locations only, never the output text. */
  async reviewAndRecord(input: ReviewInput): Promise<QualityReview> {
    const review = this.review(input);
    const createdAt = this.deps.now().toISOString();
    await this.deps.store.saveReview({
      id: this.deps.newId(),
      taskId: input.taskId,
      runId: input.runId,
      agent: input.agent,
      attempt: input.attempt,
      status: review.status,
      overall: review.overall,
      scores: review.scores,
      issues: review.issues,
      feedback: review.feedback,
      createdAt,
    });
    await this.deps.audit.write({
      id: this.deps.newId(),
      ts: createdAt,
      actor: `agent:${input.agent}`,
      type: "quality.reviewed",
      entityType: "task",
      entityId: input.taskId,
      meta: { attempt: input.attempt, status: review.status, overall: review.overall, issues: review.issues.length },
    });
    return review;
  }

  /** Revision history for a task. Owner and platform only. */
  async history(actor: Actor, taskId: string): Promise<QualityReviewRecord[]> {
    if (actor.kind === "agent") throw new QualityForbiddenError();
    return this.deps.store.reviewsForTask(taskId);
  }
}

/** A structured output with no content at all is worth flagging, though it is not a schema failure. */
function issuesEmptyOutput(outputKind: string, output: unknown): QualityIssue[] {
  const o = (output ?? {}) as Record<string, unknown>;
  const lists: Record<string, string> = { research: "findings", content: "drafts", visa: "requirements", analytics: "metrics" };
  const field = lists[outputKind];
  if (!field) return [];
  const list = o[field];
  return Array.isArray(list) && list.length === 0 ? [{ code: "empty_output", dimension: "completeness", severity: "warning", path: field }] : [];
}
