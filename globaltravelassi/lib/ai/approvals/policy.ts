import type { ActionClass } from "../types";

export interface ApprovalRule {
  approvalRequired: boolean;
  /** Hours until a pending approval expires. Null when no approval is needed. */
  expirationHours: number | null;
}

/**
 * Approval rules per action class. The owner set the windows for the spec classes; the mapping to the
 * platform's action classes is listed in the report. Migration 0007 holds the same table for the database.
 * Decisions not in the owner's brief are marked so they can be changed deliberately.
 */
export const APPROVAL_POLICY: Record<ActionClass, ApprovalRule> = {
  read_internal: { approvalRequired: false, expirationHours: null }, // read_only
  write_draft: { approvalRequired: false, expirationHours: null }, // internal_draft
  propose_change: { approvalRequired: true, expirationHours: 24 }, // not in brief: kept at 24h
  external_send_message: { approvalRequired: true, expirationHours: 24 }, // customer_message
  external_publish: { approvalRequired: true, expirationHours: 24 }, // social_media_publication
  external_production_change: { approvalRequired: true, expirationHours: 4 }, // production_data_change
  external_payment: { approvalRequired: true, expirationHours: 1 }, // financial_transaction
  external_deploy: { approvalRequired: true, expirationHours: 1 }, // deployment
  external_commitment: { approvalRequired: true, expirationHours: 1 }, // not in brief: most restrictive window
};

export function approvalRequiredFor(action: ActionClass): boolean {
  return APPROVAL_POLICY[action].approvalRequired;
}

/** Expiry time for an approval created at `now`, or null when the action needs no approval. */
export function expiresAtFor(action: ActionClass, now: Date): string | null {
  const hours = APPROVAL_POLICY[action].expirationHours;
  if (hours === null) return null;
  return new Date(now.getTime() + hours * 3_600_000).toISOString();
}

export function isExpired(expiresAt: string | null, now: Date): boolean {
  return expiresAt !== null && now.getTime() >= Date.parse(expiresAt);
}
