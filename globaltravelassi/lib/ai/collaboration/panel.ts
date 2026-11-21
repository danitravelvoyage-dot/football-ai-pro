import type { QualityController, ReviewInput } from "../quality/controller";
import { textsOf } from "../quality/extract";
import { brandChecks, policyChecks } from "../quality/checks";
import type { QualityIssue, QualityStatus } from "../quality/types";
import type { Vote } from "./consensus";

/**
 * Independent votes on one output. Pure apart from the controller's deterministic review.
 *  - QualityController: the full deterministic review (schema, completeness, language, facts, policy, brand).
 *  - ComplianceAgent lens: policy and brand checks only, run as its own pass. It is deterministic code, not a model.
 * The consensus module decides what the votes mean; this module only produces them.
 */

const STATUS_TO_VERDICT: Record<QualityStatus, Vote["verdict"]> = {
  PASSED: "approve",
  NEEDS_REVISION: "revise",
  REJECTED: "reject",
  REQUIRES_HUMAN_REVIEW: "escalate",
};

export function qualityVote(status: QualityStatus, issues: QualityIssue[]): Vote {
  return { reviewer: "QualityController", verdict: STATUS_TO_VERDICT[status], codes: [...new Set(issues.map((i) => i.code))] };
}

/** A blocking policy breach (for example a guaranteed visa outcome) is a compliance rejection, not a revision request. */
export function complianceVote(outputKind: string, output: unknown): Vote {
  const texts = textsOf(outputKind, output);
  const issues = [...policyChecks(texts), ...brandChecks(texts)];
  const verdict: Vote["verdict"] = issues.some((i) => i.severity === "critical" || i.severity === "blocking")
    ? "reject"
    : issues.length > 0
      ? "revise"
      : "approve";
  return { reviewer: "ComplianceAgent", verdict, codes: [...new Set(issues.map((i) => i.code))] };
}

export function runReviewPanel(input: ReviewInput, controller: QualityController): Vote[] {
  const review = controller.review(input);
  return [qualityVote(review.status, review.issues), complianceVote(input.outputKind, input.output)];
}
