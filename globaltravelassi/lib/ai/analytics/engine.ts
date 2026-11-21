import { costOf, type PriceList } from "../llm/cost";

/**
 * Analytics over stored rows. Pure: no I/O. Every rate is null when its denominator is zero, so an empty period is
 * shown as unknown, never as 0%. Money counts only what was actually received.
 */
export type Period = "daily" | "weekly" | "monthly";
export const PERIODS: readonly Period[] = ["daily", "weekly", "monthly"];
const BUCKETS: Record<Period, number> = { daily: 14, weekly: 8, monthly: 6 };

const DAY = 86_400_000;

/** The bucket a date falls in. Weeks start on Monday (ISO). Pure calendar arithmetic on UTC dates. */
export function bucketOf(iso: string, period: Period): string {
  const d = new Date(iso);
  if (period === "monthly") return iso.slice(0, 7);
  if (period === "daily") return d.toISOString().slice(0, 10);
  const day = (d.getUTCDay() + 6) % 7; // Monday = 0
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - day)).toISOString().slice(0, 10);
}

/** The bucket keys for the most recent periods, oldest first, ending with the current one. */
export function bucketsEndingAt(now: Date, period: Period): string[] {
  const keys: string[] = [];
  const count = BUCKETS[period];
  for (let i = count - 1; i >= 0; i--) {
    if (period === "monthly") {
      const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1));
      keys.push(d.toISOString().slice(0, 7));
    } else {
      const step = period === "weekly" ? 7 * DAY : DAY;
      keys.push(bucketOf(new Date(now.getTime() - i * step).toISOString(), period));
    }
  }
  return [...new Set(keys)];
}

export function rate(numerator: number, denominator: number): number | null {
  return denominator === 0 ? null : Math.round((numerator / denominator) * 1000) / 10;
}

export interface ApprovalRow {
  actionClass: string;
  status: "pending" | "approved" | "rejected" | "expired";
  createdAt: string;
}

/**
 * How often the owner approves what the platform asks. Only the owner's own decisions (approved or rejected) enter the
 * rate. Pending items and expired items were not decided by anyone, so they are not in it.
 */
export function approvalConversion(rows: ApprovalRow[]) {
  const count = (s: ApprovalRow["status"], list: ApprovalRow[]) => list.filter((r) => r.status === s).length;
  const isDecision = (r: ApprovalRow) => r.status === "approved" || r.status === "rejected";
  const decided = rows.filter(isDecision);
  const byClass = [...new Set(rows.map((r) => r.actionClass))].sort().map((actionClass) => {
    const list = rows.filter((r) => r.actionClass === actionClass);
    const d = list.filter(isDecision);
    return { actionClass, requested: list.length, decided: d.length, approved: count("approved", list), approvalRate: rate(count("approved", list), d.length) };
  });
  return {
    requested: rows.length,
    decided: decided.length,
    approved: count("approved", rows),
    rejected: count("rejected", rows),
    expired: count("expired", rows),
    approvalRate: rate(count("approved", rows), decided.length),
    byClass,
  };
}

export interface ArtifactRow {
  kind: string;
  status: "draft" | "awaiting_owner" | "approved" | "rejected";
}

/** Content: how many items each kind produces and how many the owner accepts. */
export function contentPerformance(rows: ArtifactRow[]) {
  return [...new Set(rows.map((r) => r.kind))].sort().map((kind) => {
    const list = rows.filter((r) => r.kind === kind);
    const approved = list.filter((r) => r.status === "approved").length;
    const rejected = list.filter((r) => r.status === "rejected").length;
    return { kind, produced: list.length, approved, rejected, waiting: list.length - approved - rejected, approvalRate: rate(approved, approved + rejected) };
  });
}

export interface RunRow {
  agent: string;
  status: "succeeded" | "failed";
  durationMs: number;
  finishedAt: string;
}

/** Agent runs per period: volume, failure rate and average duration. Empty periods are omitted. */
export function agentPerformance(rows: RunRow[], now: Date, period: Period) {
  const keys = new Set(bucketsEndingAt(now, period));
  const map = new Map<string, { agent: string; period: string; runs: number; failed: number; durationTotal: number }>();
  for (const r of rows) {
    const key = bucketOf(r.finishedAt, period);
    if (!keys.has(key)) continue;
    const id = `${r.agent}|${key}`;
    const e = map.get(id) ?? { agent: r.agent, period: key, runs: 0, failed: 0, durationTotal: 0 };
    e.runs += 1;
    if (r.status === "failed") e.failed += 1;
    e.durationTotal += r.durationMs;
    map.set(id, e);
  }
  return [...map.values()]
    .map((e) => ({ agent: e.agent, period: e.period, runs: e.runs, failureRate: rate(e.failed, e.runs), avgDurationMs: Math.round(e.durationTotal / e.runs) }))
    .sort((a, b) => a.period.localeCompare(b.period) || a.agent.localeCompare(b.agent));
}

export interface ApplicationRow {
  status: "new" | "in_review" | "documents_required" | "submitted" | "approved" | "rejected" | "completed" | "cancelled";
  createdAt: string;
}

/**
 * Lead conversion: applications are the leads. A lead converts when it is approved or completed. It is lost when it is
 * rejected or cancelled. The rate uses only the leads that have reached a conclusion.
 */
export function leadConversion(rows: ApplicationRow[], now: Date, period: Period) {
  const concluded = (s: ApplicationRow["status"]) => s === "approved" || s === "completed" || s === "rejected" || s === "cancelled";
  const won = (s: ApplicationRow["status"]) => s === "approved" || s === "completed";
  const keys = bucketsEndingAt(now, period);
  const byPeriod = keys.map((key) => {
    const list = rows.filter((r) => bucketOf(r.createdAt, period) === key);
    const done = list.filter((r) => concluded(r.status));
    return { period: key, leads: list.length, converted: done.filter((r) => won(r.status)).length, conversionRate: rate(done.filter((r) => won(r.status)).length, done.length) };
  });
  const done = rows.filter((r) => concluded(r.status));
  return { leads: rows.length, concluded: done.length, converted: done.filter((r) => won(r.status)).length, conversionRate: rate(done.filter((r) => won(r.status)).length, done.length), byPeriod };
}

export interface UsageRow {
  providerId: string;
  day: string;
  tokensIn: number;
  tokensOut: number;
  requests: number;
}

/**
 * Model execution cost. Priced only by the owner's price list. A provider with no price shows cost null, and the total
 * is null if any provider in use is unpriced. The platform never estimates a price.
 */
export function executionCost(rows: UsageRow[], prices: Record<string, PriceList | undefined>) {
  const byProvider = new Map<string, { providerId: string; requests: number; tokensIn: number; tokensOut: number }>();
  for (const r of rows) {
    const e = byProvider.get(r.providerId) ?? { providerId: r.providerId, requests: 0, tokensIn: 0, tokensOut: 0 };
    e.requests += r.requests;
    e.tokensIn += r.tokensIn;
    e.tokensOut += r.tokensOut;
    byProvider.set(r.providerId, e);
  }
  const providers = [...byProvider.values()].map((e) => ({ ...e, cost: costOf(e.tokensIn, e.tokensOut, prices[e.providerId] ?? {}) }));
  const totalCost = providers.length > 0 && providers.every((p) => p.cost !== null) ? Math.round(providers.reduce((a, p) => a + (p.cost ?? 0), 0) * 10000) / 10000 : null;
  return { providers, totalCost };
}
