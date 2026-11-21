import { describe, it, expect } from "vitest";
import { salesReport, customerAlerts, marketingReport, strategyRecommendations, dailyNotices, type SalesInput } from "@/lib/ai/business/reports";
import { BusinessReportService, BusinessReportForbiddenError } from "@/lib/ai/business/service";
import { CrmService } from "@/lib/ai/crm/service";
import { MemoryCrmStore } from "@/lib/ai/crm/memory-store";
import { CampaignService } from "@/lib/ai/campaigns/service";
import { MemoryCampaignStore } from "@/lib/ai/campaigns/memory-store";
import { CompetitorService } from "@/lib/ai/competitors/service";
import { MemoryCompetitorStore } from "@/lib/ai/competitors/memory-store";
import { NotificationService, MemoryNotificationStore } from "@/lib/ai/notifications/service";
import { MemoryAuditSink } from "@/lib/ai/audit";
import { makeClock, makeIds, OWNER } from "./helpers";

const NOW = "2026-11-21T09:00:00.000Z";
const DAY = 86_400_000;
const ago = (days: number) => new Date(Date.parse(NOW) - days * DAY).toISOString();
const AGENT = { kind: "agent" as const, agent: "CRMAgent" as const };

function input(over: Partial<SalesInput> = {}): SalesInput {
  return { now: NOW, leads: [], conversionRate: null, followUps: [], ...over };
}

describe("sales report", () => {
  it("counts stages, recent leads and follow-up states from stored rows", () => {
    const r = salesReport(
      input({
        leads: [
          { id: "a", stage: "new", createdAt: ago(0.5), score: 10, idleDays: 0, intent: "none" },
          { id: "b", stage: "converted", createdAt: ago(3), score: 100, idleDays: 1, intent: "none" },
          { id: "c", stage: "lost", createdAt: ago(20), score: 0, idleDays: 9, intent: "none" },
        ],
        conversionRate: 33.3,
        followUps: [
          { leadId: "a", status: "suggested", priority: "normal", dueAt: NOW },
          { leadId: "b", status: "scheduled", priority: "high", dueAt: ago(1) },
          { leadId: "c", status: "scheduled", priority: "low", dueAt: ago(-1) },
        ],
      }),
    );
    expect(r).toMatchObject({ leadsTotal: 3, newLast24h: 1, newLast7d: 2, open: 1, converted: 1, lost: 1, conversionRate: 33.3 });
    expect(r).toMatchObject({ followUpsAwaitingApproval: 1, followUpsScheduled: 2, followUpsOverdue: 1 });
  });

  it("reports a null conversion rate when there are no leads, never zero", () => {
    expect(salesReport(input()).conversionRate).toBeNull();
  });
});

describe("customer alerts", () => {
  it("flags hot leads idle for two days, high-intent leads without a follow-up, and overdue scheduled follow-ups", () => {
    const alerts = customerAlerts(
      input({
        leads: [
          { id: "hot", stage: "interested", createdAt: ago(10), score: 80, idleDays: 3, intent: "none" },
          { id: "intent", stage: "new", createdAt: ago(1), score: 20, idleDays: 0, intent: "high" },
          { id: "covered", stage: "new", createdAt: ago(1), score: 20, idleDays: 0, intent: "high" },
          { id: "closed", stage: "lost", createdAt: ago(10), score: 0, idleDays: 9, intent: "high" },
        ],
        followUps: [
          { leadId: "covered", status: "suggested", priority: "high", dueAt: NOW },
          { leadId: "hot", status: "scheduled", priority: "low", dueAt: ago(2) },
        ],
      }),
    );
    expect(alerts).toEqual(
      expect.arrayContaining([
        { code: "hot_lead_idle", leadId: "hot" },
        { code: "high_intent_without_follow_up", leadId: "intent" },
        { code: "scheduled_follow_up_overdue", leadId: "hot" },
      ]),
    );
    expect(alerts.find((a) => a.leadId === "covered")).toBeUndefined();
    expect(alerts.find((a) => a.leadId === "closed")).toBeUndefined();
  });

  it("carries only ids and codes, never text", () => {
    const alerts = customerAlerts(input({ leads: [{ id: "x", stage: "new", createdAt: ago(1), score: 90, idleDays: 5, intent: "high" }] }));
    for (const a of alerts) expect(Object.keys(a).sort()).toEqual(["code", "leadId"]);
  });
});

describe("marketing report", () => {
  it("counts a KPI without a reading as missing, not as zero progress", () => {
    const r = marketingReport([{ id: "c1", status: "active", budgetPercent: 10, kpiPercents: [null, 40] }]);
    expect(r).toMatchObject({ activeCampaigns: 1, kpisWithReading: 1, kpisWithoutReading: 1, campaignsOverBudgetWithLowKpi: [] });
  });

  it("flags an active campaign with at least 80% of budget spent and every reading under 50%", () => {
    const r = marketingReport([
      { id: "slow", status: "active", budgetPercent: 85, kpiPercents: [20, 30] },
      { id: "fine", status: "active", budgetPercent: 85, kpiPercents: [60] },
      { id: "nodata", status: "active", budgetPercent: 95, kpiPercents: [null] },
      { id: "paused", status: "paused", budgetPercent: 99, kpiPercents: [5] },
    ]);
    expect(r.campaignsOverBudgetWithLowKpi).toEqual(["slow"]);
  });
});

describe("strategy recommendations", () => {
  const sales = salesReport(input());
  const marketing = marketingReport([]);

  it("fires nothing on too little data", () => {
    const small = salesReport(input({ leads: [{ id: "a", stage: "new", createdAt: ago(1), score: 0, idleDays: 0, intent: "none" }], conversionRate: 0 }));
    expect(strategyRecommendations({ sales: small, marketing, competitorOpportunities: [] })).toEqual([]);
  });

  it("names each rule that fires with its evidence", () => {
    const many = Array.from({ length: 12 }, (_, i) => ({ id: `l${i}`, stage: "lost" as const, createdAt: ago(1), score: 0, idleDays: 0, intent: "none" as const }));
    const s = salesReport(input({ leads: many, conversionRate: 0, followUps: [{ leadId: "l0", status: "scheduled", priority: "low", dueAt: ago(1) }] }));
    const recs = strategyRecommendations({
      sales: s,
      marketing: marketingReport([{ id: "c", status: "active", budgetPercent: 90, kpiPercents: [10] }]),
      competitorOpportunities: [{ code: "competitor_price_increase" }],
    });
    expect(recs.map((r) => r.code)).toEqual(
      expect.arrayContaining(["review_qualification", "review_lost_reasons", "clear_overdue_follow_ups", "review_campaign_spend", "consider_price_review"]),
    );
    expect(recs.find((r) => r.code === "review_qualification")?.evidence).toEqual({ leads: 12, conversionRatePercent: 0 });
  });

  it("labels the recommendations as rule-based in the notice", () => {
    const notices = dailyNotices("2026-11-21", sales, [], marketing, []);
    const rec = notices.find((n) => n.kind === "strategy_recommendations");
    expect(rec?.body).toContain("rule-based");
    expect(new Set(notices.map((n) => n.dedupeKey)).size).toBe(4);
  });
});

describe("publishing the daily reports", () => {
  function setup() {
    const clock = makeClock(NOW);
    const audit = new MemoryAuditSink();
    const newId = makeIds("b");
    const crm = new CrmService({ store: new MemoryCrmStore(), audit, now: clock.now, newId });
    const campaigns = new CampaignService({ store: new MemoryCampaignStore(), audit, now: clock.now, newId, contentStatus: async () => new Map() });
    const competitors = new CompetitorService({ store: new MemoryCompetitorStore(), fetch: (async () => new Response("", { status: 404 })) as unknown as typeof fetch, audit, now: clock.now, newId });
    const notifications = new NotificationService({ store: new MemoryNotificationStore(), audit, now: clock.now, newId });
    const svc = new BusinessReportService({ crm, campaigns, competitors, notify: (n) => notifications.notify(n), audit, now: clock.now, newId });
    return { svc, crm, notifications, audit, clock };
  }

  it("refuses agents and the system", async () => {
    const { svc } = setup();
    await expect(svc.publishDaily(AGENT)).rejects.toBeInstanceOf(BusinessReportForbiddenError);
    await expect(svc.publishDaily({ kind: "system" })).rejects.toBeInstanceOf(BusinessReportForbiddenError);
  });

  it("posts four notices once per day and reports repeats as already posted", async () => {
    const { svc } = setup();
    const first = await svc.publishDaily(OWNER);
    expect(first.created.sort()).toEqual(["customer_alerts", "marketing_report", "sales_report", "strategy_recommendations"]);
    const second = await svc.publishDaily(OWNER);
    expect(second.created).toEqual([]);
    expect(second.alreadyPosted).toHaveLength(4);
  });

  it("builds the reports from stored CRM rows and writes an audit entry with counts only", async () => {
    const { svc, crm, notifications, audit } = setup();
    const lead = await crm.createLead(OWNER, { label: "Enquiry", source: "manual", applicationId: null, destinationCountry: "FR", nationality: "DZ", travelDate: null, interest: "visa" });
    await crm.addInteraction(OWNER, lead.id, { kind: "call", summary: "Asked how much it costs" });
    await svc.publishDaily(OWNER);
    const inbox = await notifications.list({ kind: "owner", id: OWNER.id }, { kind: "sales_report", limit: 5 });
    expect(inbox.map((n) => n.body).join(" ")).toContain("Leads: 1");
    const entry = audit.events.find((e) => e.type === "business.reports_published");
    expect(JSON.stringify(entry?.meta)).not.toContain("Enquiry");
  });
});
