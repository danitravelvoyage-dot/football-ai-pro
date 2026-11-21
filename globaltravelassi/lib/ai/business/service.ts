import type { AuditSink } from "../audit";
import type { Actor } from "../types";
import type { CrmService } from "../crm/service";
import type { CampaignService } from "../campaigns/service";
import type { CompetitorService } from "../competitors/service";
import type { Notice } from "../notifications/rules";
import { customerAlerts, dailyNotices, marketingReport, salesReport, strategyRecommendations, type CampaignInput, type Recommendation, type SalesInput } from "./reports";

export class BusinessReportForbiddenError extends Error {
  constructor() {
    super("Only the owner can publish business reports.");
    this.name = "BusinessReportForbiddenError";
  }
}

export interface BusinessReportDeps {
  crm: CrmService;
  campaigns: CampaignService;
  competitors: CompetitorService;
  notify: (notice: Notice) => Promise<{ created: boolean }>;
  audit: AuditSink;
  now: () => Date;
  newId: () => string;
}

export interface PublishSummary {
  dayKey: string;
  created: string[];
  /** Notices already posted today. Reports are published once per day per kind. */
  alreadyPosted: string[];
  recommendations: Recommendation[];
}

const MAX_CAMPAIGNS = 50;

/**
 * Builds the daily sales, marketing, customer-alert and recommendation notices from stored rows, as the owner.
 * It runs in the owner's session, not the scheduler's: the scheduler's operator account has no access to CRM data.
 * Nothing is sent to a customer. Each notice is written once per day.
 */
export class BusinessReportService {
  constructor(private readonly deps: BusinessReportDeps) {}

  async publishDaily(actor: Actor): Promise<PublishSummary> {
    if (actor.kind !== "owner" || actor.id.trim().length === 0) throw new BusinessReportForbiddenError();
    const now = this.deps.now().toISOString();
    const dayKey = now.slice(0, 10);

    const leads = await this.deps.crm.list(actor, { includeArchived: false, limit: 1000 });
    const funnel = await this.deps.crm.funnel(actor);
    const followUps = await this.deps.crm.openFollowUps(actor, 1000);
    const salesInput: SalesInput = {
      now,
      leads: leads.map((item) => ({
        id: item.lead.id,
        stage: item.lead.stage,
        createdAt: item.lead.createdAt,
        score: item.assessment.score,
        idleDays: item.assessment.idleDays,
        intent: item.assessment.intent,
      })),
      conversionRate: funnel.conversionRate,
      followUps: followUps.map((f) => ({ leadId: f.leadId, status: f.status, priority: f.priority, dueAt: f.dueAt })),
    };
    const sales = salesReport(salesInput);
    const alerts = customerAlerts(salesInput);

    const campaignRows = (await this.deps.campaigns.list(actor, { includeArchived: false, limit: MAX_CAMPAIGNS }))
      .filter((c) => c.status === "active" || c.status === "paused");
    const campaignInputs: CampaignInput[] = [];
    for (const c of campaignRows) {
      const view = await this.deps.campaigns.view(actor, c.id);
      campaignInputs.push({ id: c.id, status: c.status, budgetPercent: view.budget.percentSpent, kpiPercents: view.kpis.map((k) => k.percent) });
    }
    const marketing = marketingReport(campaignInputs);

    const competitorReports = await this.deps.competitors.report(actor);
    const recs = strategyRecommendations({
      sales,
      marketing,
      competitorOpportunities: competitorReports.flatMap((r) => r.opportunities),
    });

    const created: string[] = [];
    const alreadyPosted: string[] = [];
    for (const notice of dailyNotices(dayKey, sales, alerts, marketing, recs)) {
      const result = await this.deps.notify(notice);
      (result.created ? created : alreadyPosted).push(notice.kind);
    }
    await this.deps.audit.write({
      id: this.deps.newId(),
      ts: now,
      actor: `owner:${actor.id}`,
      type: "business.reports_published",
      entityType: "business_reports",
      entityId: dayKey,
      meta: { created: created.length, alerts: alerts.length, recommendations: recs.map((r) => r.code) },
    });
    return { dayKey, created, alreadyPosted, recommendations: recs };
  }
}
