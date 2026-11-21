import type { QualityStatus, QualityIssue } from "../quality/types";
import { applyRevisionLimit } from "../quality/revision";
import { DEFAULT_QUALITY_CONFIG } from "../quality/types";
import { reachConsensus, type ConsensusPolicy, type ConsensusResult, type Vote } from "./consensus";
import { VERIFIED, type FactualVerdict } from "../factual/validate";
import { complianceVote, qualityVote } from "./panel";

/**
 * The quality gate for every agent output. Pure.
 *
 * Two independent reviewers vote on each output: the quality controller and the compliance lens. The producing agent
 * never counts as its own reviewer. Consensus decides the panel result, and the gate reports the more severe of that
 * and the controller's own status. Severity, weakest first: PASSED, NEEDS_REVISION, REQUIRES_HUMAN_REVIEW, REJECTED.
 *
 * Consequences:
 *  - a blocking compliance violation is a rejection (the compliance lens is a veto);
 *  - any disagreement between reviewers goes to the owner, including when the controller rejects and compliance approves;
 *  - a compliance agent's own output cannot be approved by the system, because it has no independent second reviewer:
 *    it goes to the owner.
 */

export const GATE_POLICY: ConsensusPolicy = { minIndependentReviewers: 2, vetoReviewers: ["ComplianceAgent"], weights: {} };

const SEVERITY: Record<QualityStatus, number> = { PASSED: 0, NEEDS_REVISION: 1, REQUIRES_HUMAN_REVIEW: 2, REJECTED: 3 };
const FROM_DECISION: Record<ConsensusResult["decision"], QualityStatus> = {
  approve: "PASSED",
  revise: "NEEDS_REVISION",
  reject: "REJECTED",
  escalate_to_owner: "REQUIRES_HUMAN_REVIEW",
};

export interface GateInput {
  producer: string;
  outputKind: string;
  output: unknown;
  controllerStatus: QualityStatus;
  controllerIssues: QualityIssue[];
  attempt: number;
  /**
   * Factual validation, checked against the owner's approved sources, the CRM and the owner's memory. It is not a
   * vote: the final status is never less severe than this verdict, whatever the reviewers say.
   */
  factual?: FactualVerdict;
}

const FACTUAL_TO_STATUS: Record<FactualVerdict["status"], QualityStatus> = {
  verified: "PASSED",
  needs_evidence: "NEEDS_REVISION",
  uncertain: "REQUIRES_HUMAN_REVIEW",
  fabricated: "REJECTED",
};

export interface GateResult {
  status: QualityStatus;
  votes: Vote[];
  consensus: ConsensusResult;
}

/**
 * A controller REJECTED with no schema failure came from the revision limit, not from a reviewer's judgement: the output
 * still needs revision, and the loop has run out of attempts. Its vote is "revise", so the limit alone does not create a
 * disagreement. A schema failure is a real rejection and keeps its reject vote.
 */
function controllerVoteStatus(status: QualityStatus, issues: QualityIssue[]): QualityStatus {
  const schemaFailure = issues.some((i) => i.code === "schema_failure" || i.code === "missing_required_field");
  return status === "REJECTED" && !schemaFailure ? "NEEDS_REVISION" : status;
}

export function decideGate(input: GateInput): GateResult {
  const votes: Vote[] = [
    qualityVote(controllerVoteStatus(input.controllerStatus, input.controllerIssues), input.controllerIssues),
    complianceVote(input.outputKind, input.output),
  ];
  const consensus = reachConsensus(input.producer, votes, GATE_POLICY);
  const panelStatus = FROM_DECISION[consensus.decision];
  // A disagreement is the owner's to decide. It is not settled by taking the controller's rejection.
  const disagreement = consensus.reasons.includes("reviewers_disagree");
  const votesStatus = disagreement
    ? "REQUIRES_HUMAN_REVIEW"
    : SEVERITY[panelStatus] >= SEVERITY[input.controllerStatus]
      ? panelStatus
      : input.controllerStatus;
  // Factual validation has the last word: the more severe of the votes and the facts.
  const factual = input.factual ?? VERIFIED;
  const factualStatus = FACTUAL_TO_STATUS[factual.status];
  const worst = SEVERITY[factualStatus] > SEVERITY[votesStatus] ? factualStatus : votesStatus;
  const status = applyRevisionLimit(worst, input.attempt, DEFAULT_QUALITY_CONFIG.maxAttempts);
  return { status, votes, consensus };
}
