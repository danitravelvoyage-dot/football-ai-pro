/**
 * Owner review items: pure rules. No I/O.
 *
 * Every item held for the owner has a kind, and each kind allows only some decisions. An item is decided once. A
 * refused fact (a fabricated source, a nonexistent stage) can never be approved: the owner may reject it or ask for a
 * revision, but cannot override the factual check.
 */

export const REVIEW_KINDS = ["held_answer", "escalated_claim", "crm_stage_disagreement", "rejected_proposal", "crm_transition"] as const;
export type ReviewKind = (typeof REVIEW_KINDS)[number];

export const REVIEW_STATUSES = ["open", "approved", "rejected", "revision_requested", "expired"] as const;
export type ReviewStatus = (typeof REVIEW_STATUSES)[number];

export const DECISIONS = ["approve", "reject", "request_revision"] as const;
export type Decision = (typeof DECISIONS)[number];

/** Which decisions each kind allows. A refused proposal cannot be approved: that would override factual validation. */
export const ALLOWED_DECISIONS: Record<ReviewKind, readonly Decision[]> = {
  held_answer: ["approve", "reject", "request_revision"],
  escalated_claim: ["approve", "reject", "request_revision"],
  crm_stage_disagreement: ["approve", "reject", "request_revision"],
  rejected_proposal: ["reject", "request_revision"],
  crm_transition: ["approve", "reject"],
};

export const DECISION_TO_STATUS: Record<Decision, ReviewStatus> = {
  approve: "approved",
  reject: "rejected",
  request_revision: "revision_requested",
};

export const REVIEW_TTL_HOURS = 7 * 24;

export function expiresAt(createdAtIso: string, ttlHours = REVIEW_TTL_HOURS): string {
  return new Date(Date.parse(createdAtIso) + ttlHours * 3_600_000).toISOString();
}

export function isExpired(item: { status: ReviewStatus; expiresAt: string }, nowIso: string): boolean {
  return item.status === "open" && Date.parse(nowIso) >= Date.parse(item.expiresAt);
}

export type DecisionCheck = { ok: true } | { ok: false; code: "not_allowed_for_kind" | "already_decided" | "expired" };

/** The rule for one decision on one item. Order matters: a decided item is reported as decided before anything else. */
export function checkDecision(item: { kind: ReviewKind; status: ReviewStatus; expiresAt: string }, decision: Decision, nowIso: string): DecisionCheck {
  if (item.status !== "open") return { ok: false, code: "already_decided" };
  if (isExpired(item, nowIso)) return { ok: false, code: "expired" };
  if (!ALLOWED_DECISIONS[item.kind].includes(decision)) return { ok: false, code: "not_allowed_for_kind" };
  return { ok: true };
}

/** Allowed moves for a stored status. Only 'open' moves, and only to a decision or to expiry. */
export function canChangeStatus(from: ReviewStatus, to: ReviewStatus): boolean {
  return from === "open" && to !== "open";
}
