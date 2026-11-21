import { z } from "zod";
import { METRICS } from "../memory/types";

export type Metric = (typeof METRICS)[number];
import { AGENT_KEYS, COUNTRIES, LANGUAGES, type AgentKey, type Country, type Language } from "../types";

/** Pure campaign rules: lifecycle, budget arithmetic, KPI progress and input validation. No I/O. */

export const CAMPAIGN_STATUSES = ["draft", "active", "paused", "finished"] as const;
export type CampaignStatus = (typeof CAMPAIGN_STATUSES)[number];

/** Allowed status moves. Archiving is separate from status and is allowed from draft, paused or finished. */
const MOVES: Record<CampaignStatus, CampaignStatus[]> = {
  draft: ["active"],
  active: ["paused", "finished"],
  paused: ["active", "finished"],
  finished: [],
};

export function canMove(from: CampaignStatus, to: CampaignStatus): boolean {
  return MOVES[from].includes(to);
}

export const OBJECTIVES = ["awareness", "leads", "applications", "conversions"] as const;
export type Objective = (typeof OBJECTIVES)[number];

/** Each objective is measured by these metrics. Only a measured metric can be a KPI for that objective. */
export const OBJECTIVE_METRICS: Record<Objective, Metric[]> = {
  awareness: ["impressions", "clicks"],
  leads: ["leads", "reply_rate"],
  applications: ["applications"],
  conversions: ["conversions", "revenue"],
};

export const CURRENCIES = ["DZD", "EUR", "USD"] as const;
export type Currency = (typeof CURRENCIES)[number];

export const MAX_BUDGET_MINOR = 10_000_000_000; // 100 million, in minor units (cents or centimes)
export const MAX_KPIS = 5;
export const MAX_ASSIGNED_AGENTS = 16;

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use a date in the form YYYY-MM-DD.");

export const campaignInputSchema = z
  .object({
    name: z.string().trim().min(2).max(120),
    goal: z.string().trim().min(3).max(500),
    objective: z.enum(OBJECTIVES),
    kpis: z
      .array(z.object({ metric: z.enum(METRICS), target: z.number().positive().max(1_000_000_000) }))
      .min(1)
      .max(MAX_KPIS),
    budgetMinor: z.number().int().min(0).max(MAX_BUDGET_MINOR),
    currency: z.enum(CURRENCIES),
    channel: z.string().trim().min(2).max(60),
    country: z.enum(COUNTRIES),
    language: z.enum(LANGUAGES),
    startsOn: isoDate.nullable(),
    endsOn: isoDate.nullable(),
  })
  .superRefine((v, ctx) => {
    const allowed = OBJECTIVE_METRICS[v.objective];
    v.kpis.forEach((k, i) => {
      if (!allowed.includes(k.metric)) ctx.addIssue({ code: "custom", path: ["kpis", i, "metric"], message: `This objective is not measured by ${k.metric}.` });
    });
    if (v.startsOn && v.endsOn && v.endsOn < v.startsOn) ctx.addIssue({ code: "custom", path: ["endsOn"], message: "The end date is before the start date." });
  });
export type CampaignInput = z.infer<typeof campaignInputSchema>;

/** Editable only while the campaign is a draft or paused. Objectives, KPIs and budget are fixed once running. */
export const campaignEditSchema = z.object({
  name: z.string().trim().min(2).max(120),
  goal: z.string().trim().min(3).max(500),
  channel: z.string().trim().min(2).max(60),
  startsOn: isoDate.nullable(),
  endsOn: isoDate.nullable(),
});
export type CampaignEdit = z.infer<typeof campaignEditSchema>;

export const spendSchema = z.object({
  amountMinor: z.number().int().positive().max(MAX_BUDGET_MINOR),
  note: z.string().trim().min(1).max(200),
});
export type SpendInput = z.infer<typeof spendSchema>;

export const kpiReadingSchema = z.object({
  metric: z.enum(METRICS),
  value: z.number().min(0).max(1_000_000_000),
  period: z.string().trim().min(3).max(40),
});
export type KpiReadingInput = z.infer<typeof kpiReadingSchema>;

export interface BudgetState {
  budgetMinor: number;
  spentMinor: number;
  remainingMinor: number;
  /** Null when there is no budget. Percentage of the budget spent, 0 to 100 (may exceed 100 only if data were inconsistent). */
  percentSpent: number | null;
}

export function budgetState(budgetMinor: number, spendMinor: number[]): BudgetState {
  const spent = spendMinor.reduce((a, b) => a + b, 0);
  return {
    budgetMinor,
    spentMinor: spent,
    remainingMinor: budgetMinor - spent,
    percentSpent: budgetMinor > 0 ? Math.round((spent / budgetMinor) * 1000) / 10 : null,
  };
}

/** A spend is refused when it would take the total above the budget. */
export function canSpend(current: BudgetState, amountMinor: number): boolean {
  return amountMinor > 0 && amountMinor <= current.remainingMinor;
}

export interface KpiProgress {
  metric: Metric;
  target: number;
  /** Latest reading for the metric, or null when none has been recorded. Never estimated. */
  actual: number | null;
  /** Actual over target, as a percentage. Null without a reading. */
  percent: number | null;
}

export function kpiProgress(kpis: { metric: Metric; target: number }[], readings: { metric: Metric; value: number; recordedAt: string }[]): KpiProgress[] {
  return kpis.map((k) => {
    const latest = readings.filter((r) => r.metric === k.metric).sort((a, b) => b.recordedAt.localeCompare(a.recordedAt))[0];
    const actual = latest ? latest.value : null;
    return { metric: k.metric, target: k.target, actual, percent: actual === null ? null : Math.round((actual / k.target) * 1000) / 10 };
  });
}

export function isAgent(value: string): value is AgentKey {
  return (AGENT_KEYS as readonly string[]).includes(value);
}

export type { Country, Language };
