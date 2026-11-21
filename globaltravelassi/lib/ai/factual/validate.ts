import { LEAD_STAGES, type LeadStage } from "../crm/rules";

/**
 * Factual validation, kept apart from structural review. Pure: no I/O and no network call.
 *
 * It never trusts a model's claim about itself. A source is checked by its form and by the owner's approved list, never
 * by fetching it. A stage is checked against the CRM's own stage list and the stored lead record. Reviewer agreement is
 * not an input: a verdict here can only be made stricter by the gate, never overridden by votes.
 *
 * Statuses, weakest to strongest:
 *  - verified:        every checked fact has evidence the owner can verify;
 *  - needs_evidence:  a fact has no source yet; the agent may add one (revision);
 *  - uncertain:       the fact cannot be confirmed or conflicts with a record; the owner decides;
 *  - fabricated:      the output names something that does not exist or cannot be a real source; refuse.
 */

export const FACTUAL_STATUSES = ["verified", "needs_evidence", "uncertain", "fabricated"] as const;
export type FactualStatus = (typeof FACTUAL_STATUSES)[number];

export interface FactualIssue {
  /** A fixed code. Never the text of the output. */
  code: string;
  /** Where in the output the problem is. */
  path: string;
  status: Exclude<FactualStatus, "verified">;
}

export interface FactualVerdict {
  status: FactualStatus;
  issues: FactualIssue[];
}

const RANK: Record<FactualStatus, number> = { verified: 0, needs_evidence: 1, uncertain: 2, fabricated: 3 };
export const VERIFIED: FactualVerdict = { status: "verified", issues: [] };

/** Combines verdicts. The most severe status wins; every issue is kept. */
export function combineVerdicts(...verdicts: FactualVerdict[]): FactualVerdict {
  const issues = verdicts.flatMap((v) => v.issues);
  const status = verdicts.reduce<FactualStatus>((worst, v) => (RANK[v.status] > RANK[worst] ? v.status : worst), "verified");
  return { status, issues };
}

const IP_LITERAL = /^\d{1,3}(\.\d{1,3}){3}$/;
const INTERNAL_SUFFIXES = [".local", ".internal", ".localhost", ".test", ".example", ".invalid"];

/**
 * Checks one source. Form problems are fabricated: they cannot point to a real page. A well-formed public https
 * address that the owner has not approved is uncertain: the owner must approve it or decide.
 */
export function checkSource(raw: string, approvedHosts: readonly string[], path: string): FactualIssue | null {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return { code: "invalid_url", path, status: "fabricated" };
  }
  if (url.protocol !== "https:") return { code: "insecure_url", path, status: "fabricated" };
  if (url.username || url.password) return { code: "credentials_in_url", path, status: "fabricated" };
  if (url.port && url.port !== "443") return { code: "non_default_port", path, status: "fabricated" };
  const host = url.hostname.toLowerCase();
  if (!host.includes(".") || host.startsWith("[") || host.includes(":") || IP_LITERAL.test(host) || INTERNAL_SUFFIXES.some((s) => host.endsWith(s))) {
    return { code: "not_a_public_host", path, status: "fabricated" };
  }
  if (!approvedHosts.map((h) => h.toLowerCase()).includes(host)) return { code: "unapproved_source", path, status: "uncertain" };
  return null;
}

function verdictFrom(issues: (FactualIssue | null)[]): FactualVerdict {
  const present = issues.filter((i): i is FactualIssue => i !== null);
  return combineVerdicts(...present.map((i): FactualVerdict => ({ status: i.status, issues: [i] })));
}

/** Research findings: every finding needs at least one source, and every source must be a real, approved address. */
export function validateResearch(findings: { sources?: string[] }[], approvedHosts: readonly string[]): FactualVerdict {
  const issues: (FactualIssue | null)[] = [];
  findings.forEach((f, i) => {
    const sources = f.sources ?? [];
    if (sources.length === 0) {
      issues.push({ code: "missing_evidence", path: `findings[${i}]`, status: "needs_evidence" });
      return;
    }
    sources.forEach((s, j) => issues.push(checkSource(s, approvedHosts, `findings[${i}].sources[${j}]`)));
  });
  return verdictFrom(issues);
}

/** A free-text answer is delivered automatically only when it cites an approved source. Otherwise it is for the owner. */
export function validateAnswerSources(sources: string[], approvedHosts: readonly string[]): FactualVerdict {
  if (sources.length === 0) return { status: "uncertain", issues: [{ code: "unsupported_answer", path: "answer", status: "uncertain" }] };
  return verdictFrom(sources.map((s, j) => checkSource(s, approvedHosts, `sources[${j}]`)));
}

/** A stage must be one the CRM defines, and must agree with the stored lead record when there is one. */
export function validateStage(stage: string, record: { stage: LeadStage } | null, path = "stage"): FactualVerdict {
  if (!(LEAD_STAGES as readonly string[]).includes(stage)) return { status: "fabricated", issues: [{ code: "nonexistent_stage", path, status: "fabricated" }] };
  if (record && record.stage !== stage) return { status: "uncertain", issues: [{ code: "contradicts_record", path, status: "uncertain" }] };
  return VERIFIED;
}

/** Claims with a value that differ from an owner memory fact with the same key. Only the owner's memory decides. */
export function validateAgainstMemory(claims: { key: string; value?: unknown; path: string }[], memory: { key: string; value: unknown }[]): FactualVerdict {
  const issues: FactualIssue[] = [];
  for (const claim of claims) {
    if (claim.value === undefined) continue;
    for (const fact of memory) {
      if (fact.key === claim.key && JSON.stringify(fact.value) !== JSON.stringify(claim.value)) {
        issues.push({ code: "contradicts_memory", path: claim.path, status: "uncertain" });
      }
    }
  }
  return issues.length === 0 ? VERIFIED : { status: "uncertain", issues };
}
