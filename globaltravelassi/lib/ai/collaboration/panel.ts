import type { QualityController, ReviewInput } from "../quality/controller";
import { textsOf } from "../quality/extract";
import { brandChecks, policyChecks } from "../quality/checks";
import type { QualityIssue, QualityStatus } from "../quality/types";
import type { Vote } from "./consensus";

/**
 * Two independent reviewers for one output:
 *  - QualityController: the full deterministic review (schema, completeness, language, facts, policy, brand).
 *  - ComplianceAgent lens: policy and brand checks only, run as its own pass. It is deterministic code, not a model.
 * Each returns a vote. The consensus module decides what the votes mean; this module only gathers them.
 */

const STATUS_TO_VERDICT: Record<QualityStatus, Vote["verdict"]> = {
  PASSED: "approve",
  NEEDS_REVISION: "revise",
  REJECTED: "reject",
  REQUIRES_HUMAN_REVIEW: "escalate",
};

function complianceVerdict(issues: QualityIssue[]): Vote["verdict"] {
  // A blocking policy breach (for example a guaranteed visa outcome) is a compliance rejection, not a revision request.
  if (issues.some((i) => i.severity === "critical" || i.severity === "blocking")) return "reject";
  if (issues.length > 0) return "revise";
  return "approve";
}

export function runReviewPanel(input: ReviewInput, controller: QualityController): Vote[] {
  const review = controller.review(input);
  const texts = textsOf(input.outputKind, input.output);
  const compliance = [...policyChecks(texts), ...brandChecks(texts)];
  return [
    {
      reviewer: "QualityController",
      verdict: STATUS_TO_VERDICT[review.status],
      codes: review.issues.map((i) => i.code),
    },
    {
      reviewer: "ComplianceAgent",
      verdict: complianceVerdict(compliance),
      codes: compliance.map((i) => i.code),
    },
  ];
}
