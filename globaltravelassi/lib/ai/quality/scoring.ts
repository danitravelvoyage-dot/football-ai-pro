import { DIMENSIONS, type Dimension, type QualityConfig, type QualityIssue, type QualityStatus, type ScoringWeights } from "./types";

const PENALTY: Record<QualityIssue["severity"], number> = { info: 0, warning: 10, blocking: 40, critical: 60 };

/** One score per dimension, from 0 to 100. Each issue takes away points from the dimension it belongs to. */
export function dimensionScores(issues: QualityIssue[]): Record<Dimension, number> {
  const scores = Object.fromEntries(DIMENSIONS.map((d) => [d, 100])) as Record<Dimension, number>;
  for (const i of issues) scores[i.dimension] = Math.max(0, scores[i.dimension] - PENALTY[i.severity]);
  return scores;
}

export function overallScore(scores: Record<Dimension, number>, weights: ScoringWeights): number {
  const total = DIMENSIONS.reduce((sum, d) => sum + scores[d] * weights[d], 0);
  return Math.round(total);
}

/**
 * Decides the status before any revision limit is applied.
 *  - Schema failure: rejected. The output does not have the agreed structure.
 *  - Critical issue (unverifiable factual claim, factual conflict): needs a human decision.
 *  - Blocking issue: needs a revision.
 *  - Otherwise the score decides: at or above the pass score the output passes, below it needs a revision.
 */
export function decideStatus(issues: QualityIssue[], overall: number, passScore: number): QualityStatus {
  if (issues.some((i) => i.code === "schema_failure" || i.code === "missing_required_field")) return "REJECTED";
  if (issues.some((i) => i.severity === "critical")) return "REQUIRES_HUMAN_REVIEW";
  if (issues.some((i) => i.severity === "blocking")) return "NEEDS_REVISION";
  return overall >= passScore ? "PASSED" : "NEEDS_REVISION";
}
