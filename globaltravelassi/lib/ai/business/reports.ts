import type { LeadStage, FollowUpStatus, FollowUpPriority } from "../crm/rules";
import type { Notice } from "../notifications/rules";

/**
 * Daily business reports and alerts. Pure: no I/O, no model calls.
 *
 * Every figure is counted from stored rows, and every recommendation comes from a named rule with a reason code.
 * Recommendations are labelled as rule-based in the text: they are not model judgements.
 * Notices carry counts and record ids only, never names, contact details or free text from customers.
 */

export interface SalesInput {
  now: string;
  leads: { id: string; stage: LeadStage; createdAt: string; score: number; idleDays: number; intent: "high" | "medium" | "none" }[];
  /** Conversion of all leads ever created, from the funnel. Null when there are no leads. */
  conversionRate: number | null;
  followUps: { leadId: string; status: FollowUpStatus; priority: FollowUpPriority; dueAt: string }[];
}

export interface SalesReport {
  leadsTotal: number;
  newLast24h: number;
  newLast7d: number;
  open: number;
  converted: number;
  lost: number;
  conversionRate: number | null;
  followUpsAwaitingApproval: number;
  followUpsScheduled: number;
  followUpsOverdue: number;
}

const DAY = 86_400_000;

export function salesReport(input: SalesInput): SalesReport {
  const now = Date.parse(input.now);
  const within = (iso: string, ms: number) => now - Date.parse(iso) <= ms && Date.parse(iso) <= now;
  const scheduled = input.followUps.filter((f) => f.status === "scheduled");
  return {
    leadsTotal: input.leads.length,
    newLast24h: input.leads.filter((l) => within(l.createdAt, DAY)).length,
    newLast7d: input.leads.filter((l) => within(l.createdAt, 7 * DAY)).length,
    open: input.leads.filter((l) => l.stage !== "converted" && l.stage !== "lost").length,
    converted: input.leads.filter((l) => l.stage === "converted").length,
    lost: input.leads.filter((l) => l.stage === "lost").length,
    conversionRate: input.conversionRate,
    followUpsAwaitingApproval: input.followUps.filter((f) => f.status === "suggested").length,
    followUpsScheduled: scheduled.length,
    followUpsOverdue: scheduled.filter((f) => Date.parse(f.dueAt) < now).length,
  };
}

export type AlertCode = "hot_lead_idle" | "high_intent_without_follow_up" | "scheduled_follow_up_overdue";

export interface CustomerAlert {
  code: AlertCode;
  leadId: string;
}

/**
 * Customers who need the owner's attention now. Each alert names a lead id and a rule, never the customer.
 * A hot lead is a high-score lead idle for two days. A high-intent lead with no open follow-up needs a decision.
 */
export function customerAlerts(input: SalesInput): CustomerAlert[] {
  const now = Date.parse(input.now);
  const openFollowUpLeads = new Set(input.followUps.filter((f) => f.status === "suggested" || f.status === "scheduled").map((f) => f.leadId));
  const out: CustomerAlert[] = [];
  for (const l of input.leads) {
    if (l.stage === "converted" || l.stage === "lost") continue;
    if (l.score >= 70 && l.idleDays >= 2) out.push({ code: "hot_lead_idle", leadId: l.id });
    if (l.intent === "high" && !openFollowUpLeads.has(l.id)) out.push({ code: "high_intent_without_follow_up", leadId: l.id });
  }
  for (const f of input.followUps) {
    if (f.status === "scheduled" && Date.parse(f.dueAt) < now) out.push({ code: "scheduled_follow_up_overdue", leadId: f.leadId });
  }
  return out;
}

export interface CampaignInput {
  id: string;
  status: "draft" | "active" | "paused" | "finished";
  /** Percent of budget spent. Null when there is no budget. */
  budgetPercent: number | null;
  /** Percent of each KPI target reached. Null for a KPI with no reading. */
  kpiPercents: (number | null)[];
}

export interface MarketingReport {
  activeCampaigns: number;
  pausedCampaigns: number;
  kpisWithReading: number;
  kpisWithoutReading: number;
  campaignsOverBudgetWithLowKpi: string[];
}

/** Counts campaigns and KPIs from readings. A KPI with no reading is counted as missing, never as zero progress. */
export function marketingReport(campaigns: CampaignInput[]): MarketingReport {
  const kpis = campaigns.flatMap((c) => c.kpiPercents);
  return {
    activeCampaigns: campaigns.filter((c) => c.status === "active").length,
    pausedCampaigns: campaigns.filter((c) => c.status === "paused").length,
    kpisWithReading: kpis.filter((k) => k !== null).length,
    kpisWithoutReading: kpis.filter((k) => k === null).length,
    campaignsOverBudgetWithLowKpi: campaigns
      .filter((c) => c.status === "active" && c.budgetPercent !== null && c.budgetPercent >= 80)
      .filter((c) => {
        const readings = c.kpiPercents.filter((k): k is number => k !== null);
        return readings.length > 0 && Math.max(...readings) < 50;
      })
      .map((c) => c.id),
  };
}

export type RecommendationCode =
  | "review_qualification"
  | "review_lost_reasons"
  | "clear_overdue_follow_ups"
  | "review_campaign_spend"
  | "consider_price_review"
  | "monitor_competitor_price";

export interface Recommendation {
  code: RecommendationCode;
  /** Why the rule fired, in counts. */
  evidence: Record<string, number>;
}

export interface StrategyInput {
  sales: SalesReport;
  marketing: MarketingReport;
  competitorOpportunities: { code: string }[];
}

/**
 * Recommendations from fixed rules. Each one names its evidence. Thresholds are set here, in code, so they are reviewable.
 * A rule does not fire on too little data: a conversion rule needs ten leads, a loss rule needs five closed leads.
 */
export function strategyRecommendations(input: StrategyInput): Recommendation[] {
  const out: Recommendation[] = [];
  const s = input.sales;
  if (s.leadsTotal >= 10 && s.conversionRate !== null && s.conversionRate < 10) {
    out.push({ code: "review_qualification", evidence: { leads: s.leadsTotal, conversionRatePercent: Math.round(s.conversionRate) } });
  }
  const closed = s.converted + s.lost;
  if (closed >= 5 && s.lost / closed > 0.5) out.push({ code: "review_lost_reasons", evidence: { lost: s.lost, closed } });
  if (s.followUpsOverdue > 0) out.push({ code: "clear_overdue_follow_ups", evidence: { overdue: s.followUpsOverdue } });
  if (input.marketing.campaignsOverBudgetWithLowKpi.length > 0) {
    out.push({ code: "review_campaign_spend", evidence: { campaigns: input.marketing.campaignsOverBudgetWithLowKpi.length } });
  }
  const priceUp = input.competitorOpportunities.filter((o) => o.code === "competitor_price_increase").length;
  const priceDown = input.competitorOpportunities.filter((o) => o.code === "competitor_price_decrease").length;
  if (priceUp > 0) out.push({ code: "consider_price_review", evidence: { competitorsRaisedPrice: priceUp } });
  if (priceDown > 0) out.push({ code: "monitor_competitor_price", evidence: { competitorsLoweredPrice: priceDown } });
  return out;
}

export function dailyNotices(dayKey: string, sales: SalesReport, alerts: CustomerAlert[], marketing: MarketingReport, recs: Recommendation[]): Notice[] {
  const salesNotice: Notice = {
    dedupeKey: `sales_report:${dayKey}`,
    kind: "sales_report",
    severity: sales.followUpsOverdue > 0 ? "warning" : "info",
    title: `Sales report for ${dayKey}`,
    body: `Leads: ${sales.leadsTotal} (${sales.newLast24h} new in 24 hours, ${sales.newLast7d} in 7 days). Open: ${sales.open}. Converted: ${sales.converted}. Lost: ${sales.lost}. Follow-ups awaiting approval: ${sales.followUpsAwaitingApproval}, scheduled: ${sales.followUpsScheduled}, overdue: ${sales.followUpsOverdue}.`,
    subjectRef: null,
  };
  const marketingNotice: Notice = {
    dedupeKey: `marketing_report:${dayKey}`,
    kind: "marketing_report",
    severity: marketing.campaignsOverBudgetWithLowKpi.length > 0 ? "warning" : "info",
    title: `Marketing report for ${dayKey}`,
    body: `Active campaigns: ${marketing.activeCampaigns}. Paused: ${marketing.pausedCampaigns}. KPIs with a reading: ${marketing.kpisWithReading}; without a reading: ${marketing.kpisWithoutReading}.`,
    subjectRef: null,
  };
  const alertNotice: Notice = {
    dedupeKey: `customer_alerts:${dayKey}`,
    kind: "customer_alerts",
    severity: alerts.length > 0 ? "warning" : "info",
    title: `Customer alerts for ${dayKey}`,
    body: alerts.length === 0 ? "No customer needs attention today." : `${alerts.length} alert(s): ${countBy(alerts.map((a) => a.code))}. Open the CRM to see the leads.`,
    subjectRef: null,
  };
  const recNotice: Notice = {
    dedupeKey: `strategy_recommendations:${dayKey}`,
    kind: "strategy_recommendations",
    severity: recs.length > 0 ? "warning" : "info",
    title: `Rule-based recommendations for ${dayKey}`,
    body: recs.length === 0 ? "No rule fired today. These recommendations are rule-based, not model output." : `Rule-based (not model output): ${recs.map((r) => `${r.code} ${JSON.stringify(r.evidence)}`).join("; ")}.`,
    subjectRef: null,
  };
  return [salesNotice, marketingNotice, alertNotice, recNotice];
}

function countBy(codes: string[]): string {
  const counts = new Map<string, number>();
  for (const c of codes) counts.set(c, (counts.get(c) ?? 0) + 1);
  return [...counts].map(([code, n]) => `${code} ${n}`).join(", ");
}
