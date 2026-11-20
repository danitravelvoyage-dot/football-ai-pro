import type { QualityIssue, QualityStatus, RevisionFeedback } from "./types";

const INSTRUCTIONS: Record<string, string> = {
  missing_data: "Fill in the empty field with content, or remove the item.",
  placeholder_content: "Replace placeholder wording with real content.",
  duplicate_content: "Remove the repeated text and write a distinct item.",
  language_mismatch: "Write this item in the language the request asked for.",
  brand_violation: "Remove the promise. Describe the service without guaranteeing an outcome.",
  unsupported_claim: "Cite a source for this claim, or lower the confidence and say it is uncertain.",
  uncertain_claim: "Mark this as uncertain or verify it.",
  invalid_source_url: "Use an https source address.",
  undated_source: "Add the date the source was checked.",
  stale_source: "Check the source again and update the date.",
  unverifiable_claim: "This factual claim needs an official source reviewed by the owner.",
  conflicting_claims: "Resolve the conflict with another agent's claim, using evidence.",
};

/** Turns issues into instructions the agent can act on. Each entry names the location, not the content. */
export function feedbackFor(issues: QualityIssue[]): RevisionFeedback[] {
  return issues
    .filter((i) => i.severity !== "info")
    .map((i) => ({ code: i.code, path: i.path, instruction: INSTRUCTIONS[i.code] ?? "Review this item." }));
}

/**
 * Applies the revision limit. A revision request beyond the allowed attempts becomes a rejection.
 * `attempt` counts from 1, so with maxAttempts 2 the second review may still ask for a revision and the third may not.
 */
export function applyRevisionLimit(status: QualityStatus, attempt: number, maxAttempts: number): QualityStatus {
  if (status === "NEEDS_REVISION" && attempt > maxAttempts) return "REJECTED";
  return status;
}
