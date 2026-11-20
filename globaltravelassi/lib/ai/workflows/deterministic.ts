import { z } from "zod";

/** Aggregates counts by status. Rows must be counts only (no names, emails or documents). */
export const aggregateRowSchema = z.record(z.string().max(60), z.union([z.string().max(60), z.number(), z.null()]));

export interface StatusSummary {
  total: number;
  byStatus: Record<string, number>;
  conversionToApproved: number | null;
}

export function summarizeAggregates(rows: z.infer<typeof aggregateRowSchema>[]): StatusSummary {
  const byStatus: Record<string, number> = {};
  let total = 0;
  for (const row of rows) {
    const status = typeof row.status === "string" ? row.status : "unknown";
    const count = typeof row.count === "number" ? row.count : 0;
    byStatus[status] = (byStatus[status] ?? 0) + count;
    total += count;
  }
  const approved = byStatus.approved ?? 0;
  const completed = byStatus.completed ?? 0;
  const conversionToApproved = total > 0 ? Math.round(((approved + completed) / total) * 1000) / 10 : null;
  return { total, byStatus, conversionToApproved };
}

export interface VisaRequirementInput {
  destination: string;
  item: string;
  source_url: string;
  last_checked: string;
  verified_by_official_source: boolean;
}

export interface VisaValidationIssue {
  index: number;
  problem: "source_not_allowlisted" | "source_not_verified" | "stale_check" | "invalid_date";
}

/**
 * Source and date validation for visa information. A requirement is accepted only if its source
 * host is on the owner's allowlist, the owner-verified flag is set, and it was checked recently.
 */
export function validateVisaRequirements(
  requirements: VisaRequirementInput[],
  allowlistHosts: string[],
  today: Date,
  maxAgeDays = 30,
): { ok: boolean; issues: VisaValidationIssue[] } {
  const issues: VisaValidationIssue[] = [];
  const allowed = new Set(allowlistHosts.map((h) => h.toLowerCase()));
  requirements.forEach((req, index) => {
    let host = "";
    try {
      host = new URL(req.source_url).hostname.toLowerCase();
    } catch {
      host = "";
    }
    if (!allowed.has(host)) issues.push({ index, problem: "source_not_allowlisted" });
    if (!req.verified_by_official_source) issues.push({ index, problem: "source_not_verified" });
    const checked = Date.parse(`${req.last_checked}T00:00:00Z`);
    if (Number.isNaN(checked)) {
      issues.push({ index, problem: "invalid_date" });
    } else if ((today.getTime() - checked) / 86_400_000 > maxAgeDays) {
      issues.push({ index, problem: "stale_check" });
    }
  });
  return { ok: issues.length === 0, issues };
}
