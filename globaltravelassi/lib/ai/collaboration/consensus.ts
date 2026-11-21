import type { Actor } from "../types";

/**
 * Quality consensus across independent reviewers. Pure: no I/O.
 *
 * Rules, in order:
 *  1. A reviewer cannot review its own output. Its vote is excluded and the exclusion is reported.
 *  2. One vote per reviewer. A second vote from the same reviewer is excluded.
 *  3. At least `minIndependentReviewers` counted votes are needed. Fewer than that escalates to the owner.
 *  4. A veto reviewer's rejection rejects the output, whatever the others say.
 *  5. When reviewers disagree (one approves and another rejects), the result escalates to the owner. Nothing is
 *     decided by majority in that case: a disagreement is a finding, not a vote to count.
 *  6. Any request for revision, with no rejection, sends the output back for revision. Approval needs every counted
 *     vote to approve.
 */

export const VERDICTS = ["approve", "revise", "reject", "escalate"] as const;
export type Verdict = (typeof VERDICTS)[number];

export interface Vote {
  reviewer: string;
  verdict: Verdict;
  /** Weight of this reviewer in the consensus. Defaults to 1 when the policy names no weight. */
  weight?: number;
  /** Issue codes behind the verdict. Codes only, never output text. */
  codes: string[];
}

export interface ConsensusPolicy {
  minIndependentReviewers: number;
  /** Reviewers whose rejection is final. */
  vetoReviewers: string[];
  /** Weights per reviewer. Reviewers not listed count as 1. */
  weights: Record<string, number>;
}

export const DEFAULT_CONSENSUS_POLICY: ConsensusPolicy = { minIndependentReviewers: 2, vetoReviewers: [], weights: {} };

export type ConsensusDecision = "approve" | "revise" | "reject" | "escalate_to_owner";

export interface ConsensusResult {
  decision: ConsensusDecision;
  /** Why, in fixed reason codes. */
  reasons: string[];
  counted: string[];
  excluded: { reviewer: string; reason: "self_review" | "duplicate_reviewer" | "no_weight" }[];
  disagreement: boolean;
}

export function reachConsensus(producer: string, votes: Vote[], policy: ConsensusPolicy = DEFAULT_CONSENSUS_POLICY): ConsensusResult {
  const excluded: ConsensusResult["excluded"] = [];
  const seen = new Set<string>();
  const counted: (Vote & { weight: number })[] = [];
  for (const v of votes) {
    if (v.reviewer === producer) {
      excluded.push({ reviewer: v.reviewer, reason: "self_review" });
      continue;
    }
    if (seen.has(v.reviewer)) {
      excluded.push({ reviewer: v.reviewer, reason: "duplicate_reviewer" });
      continue;
    }
    seen.add(v.reviewer);
    const weight = v.weight ?? policy.weights[v.reviewer] ?? 1;
    if (!(weight > 0)) {
      excluded.push({ reviewer: v.reviewer, reason: "no_weight" });
      continue;
    }
    counted.push({ ...v, weight });
  }

  const verdicts = new Set(counted.map((v) => v.verdict));
  const disagreement = verdicts.size > 1;
  const names = counted.map((v) => v.reviewer);
  const finish = (decision: ConsensusDecision, reasons: string[]): ConsensusResult => ({ decision, reasons, counted: names, excluded, disagreement });

  if (counted.length < policy.minIndependentReviewers) return finish("escalate_to_owner", ["insufficient_independent_reviewers"]);

  const veto = counted.find((v) => policy.vetoReviewers.includes(v.reviewer) && v.verdict === "reject");
  if (veto) return finish("reject", ["veto", `veto:${veto.reviewer}`]);

  if (counted.some((v) => v.verdict === "escalate")) return finish("escalate_to_owner", ["reviewer_requested_owner"]);

  // Approval against rejection is a disagreement and goes to the owner. A revision request is work to do, not a
  // disagreement, so an approval met by a revision request sends the output back (see rule 6).
  const approves = counted.some((v) => v.verdict === "approve");
  const rejects = counted.some((v) => v.verdict === "reject");
  if (approves && rejects) return finish("escalate_to_owner", ["reviewers_disagree"]);

  if (rejects) {
    const total = counted.reduce((s, v) => s + v.weight, 0);
    const rejectWeight = counted.filter((v) => v.verdict === "reject").reduce((s, v) => s + v.weight, 0);
    return rejectWeight / total >= 0.5 ? finish("reject", ["majority_reject"]) : finish("revise", ["minority_reject_revise"]);
  }
  if (counted.some((v) => v.verdict === "revise")) return finish("revise", ["revision_requested"]);
  return finish("approve", ["all_approve"]);
}

/** A conflict between agents' claims, awaiting the owner. Created only by the platform; agents cannot decide it. */
export interface Conflict {
  id: string;
  subjectKey: string;
  /** Agents whose claims disagree. */
  parties: string[];
  status: "open" | "resolved";
  resolvedBy: string | null;
  resolution: string | null;
}

export class OwnerOnlyError extends Error {
  constructor() {
    super("Only the owner can resolve a conflict or decide an escalation.");
    this.name = "OwnerOnlyError";
  }
}

/** Records the owner's decision on an open conflict. Only the owner can decide; the decision is final. */
export function resolveConflict(actor: Actor, conflict: Conflict, resolution: string): Conflict {
  if (actor.kind !== "owner" || actor.id.trim().length === 0) throw new OwnerOnlyError();
  if (conflict.status !== "open") throw new Error("This conflict is already resolved.");
  if (resolution.trim().length < 3 || resolution.length > 500) throw new Error("Write the decision in 3 to 500 characters.");
  return { ...conflict, status: "resolved", resolvedBy: actor.id, resolution: resolution.trim() };
}
