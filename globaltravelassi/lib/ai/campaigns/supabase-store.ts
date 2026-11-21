import type { SupabaseClient } from "@supabase/supabase-js";
import type { CampaignEvent, CampaignRecord, CampaignStore, KpiRow, SpendRow } from "./service";
import type { CampaignStatus, Currency, Objective, Metric } from "./rules";
import type { AgentKey } from "../types";

type Row = Record<string, unknown>;

function fail(error: { message: string }): never {
  throw new Error(`Campaign store error: ${error.message.slice(0, 160)}`);
}

/** Campaigns on Supabase. Runs with the owner's session, so migration 0013's policies apply. */
export class SupabaseCampaignStore implements CampaignStore {
  constructor(private readonly db: SupabaseClient) {}

  private async hydrate(rows: Row[]): Promise<CampaignRecord[]> {
    if (rows.length === 0) return [];
    const ids = rows.map((r) => r.id as string);
    const [agents, content] = await Promise.all([
      this.db.from("ai_campaign_agents").select("campaign_id, agent").in("campaign_id", ids),
      this.db.from("ai_campaign_content").select("campaign_id, artifact_id").in("campaign_id", ids),
    ]);
    if (agents.error) fail(agents.error);
    if (content.error) fail(content.error);
    return rows.map((r) => ({
      id: r.id as string,
      name: r.name as string,
      goal: r.goal as string,
      objective: (r.objective as Objective) ?? "leads",
      kpis: (r.kpis as { metric: Metric; target: number }[]) ?? [],
      budgetMinor: Number(r.budget_minor),
      currency: r.currency as Currency,
      channel: r.channel as string,
      country: r.country as string,
      language: r.language as string,
      startsOn: (r.starts_on as string | null) ?? null,
      endsOn: (r.ends_on as string | null) ?? null,
      status: r.status as CampaignStatus,
      archivedAt: (r.archived_at as string | null) ?? null,
      agents: ((agents.data ?? []) as Row[]).filter((a) => a.campaign_id === r.id).map((a) => a.agent as AgentKey),
      contentIds: ((content.data ?? []) as Row[]).filter((c) => c.campaign_id === r.id).map((c) => c.artifact_id as string),
      createdBy: r.created_by as string,
      createdAt: r.created_at as string,
      updatedAt: r.updated_at as string,
    }));
  }

  async insert(c: CampaignRecord): Promise<void> {
    const { error } = await this.db.from("ai_campaigns").insert({
      id: c.id,
      name: c.name,
      goal: c.goal,
      objective: c.objective,
      kpis: c.kpis,
      budget_minor: c.budgetMinor,
      currency: c.currency,
      channel: c.channel,
      country: c.country,
      language: c.language,
      starts_on: c.startsOn,
      ends_on: c.endsOn,
      status: c.status,
      created_by: c.createdBy,
      created_at: c.createdAt,
      updated_at: c.updatedAt,
    });
    if (error) fail(error);
  }

  async get(id: string): Promise<CampaignRecord | null> {
    const { data, error } = await this.db.from("ai_campaigns").select("*").eq("id", id).maybeSingle();
    if (error) fail(error);
    if (!data) return null;
    return (await this.hydrate([data as Row]))[0] ?? null;
  }

  async list(filter: { status?: CampaignStatus; includeArchived: boolean; limit: number }): Promise<CampaignRecord[]> {
    let q = this.db.from("ai_campaigns").select("*");
    if (filter.status) q = q.eq("status", filter.status);
    if (!filter.includeArchived) q = q.is("archived_at", null);
    const { data, error } = await q.order("created_at", { ascending: false }).order("id", { ascending: false }).limit(filter.limit);
    if (error) fail(error);
    return this.hydrate((data ?? []) as Row[]);
  }

  /** Writes the record's fields and reconciles its agent and content assignments with the join tables. */
  async update(c: CampaignRecord): Promise<void> {
    const { error } = await this.db
      .from("ai_campaigns")
      .update({
        name: c.name,
        goal: c.goal,
        channel: c.channel,
        starts_on: c.startsOn,
        ends_on: c.endsOn,
        status: c.status,
        archived_at: c.archivedAt,
        updated_at: c.updatedAt,
      })
      .eq("id", c.id);
    if (error) fail(error);

    const current = await this.get(c.id);
    const before = new Set(current?.agents ?? []);
    const after = new Set(c.agents);
    for (const agent of after) if (!before.has(agent)) await this.insertJoin("ai_campaign_agents", { campaign_id: c.id, agent });
    for (const agent of before) if (!after.has(agent)) await this.removeJoin("ai_campaign_agents", { campaign_id: c.id, agent });

    const beforeContent = new Set(current?.contentIds ?? []);
    const afterContent = new Set(c.contentIds);
    for (const artifactId of afterContent) if (!beforeContent.has(artifactId)) await this.insertJoin("ai_campaign_content", { campaign_id: c.id, artifact_id: artifactId });
    for (const artifactId of beforeContent) if (!afterContent.has(artifactId)) await this.removeJoin("ai_campaign_content", { campaign_id: c.id, artifact_id: artifactId });
  }

  private async insertJoin(table: string, row: Row) {
    const { error } = await this.db.from(table).insert(row);
    if (error) fail(error);
  }

  private async removeJoin(table: string, match: Row) {
    let q = this.db.from(table).delete();
    for (const [k, v] of Object.entries(match)) q = q.eq(k, v as string);
    const { error } = await q;
    if (error) fail(error);
  }

  async addSpend(row: SpendRow): Promise<void> {
    const { error } = await this.db.from("ai_campaign_spend").insert({ id: row.id, campaign_id: row.campaignId, amount_minor: row.amountMinor, note: row.note, spent_at: row.at });
    if (error) fail(error);
  }

  async listSpend(campaignId: string): Promise<SpendRow[]> {
    const { data, error } = await this.db.from("ai_campaign_spend").select("*").eq("campaign_id", campaignId).order("spent_at", { ascending: true }).limit(1000);
    if (error) fail(error);
    return ((data ?? []) as Row[]).map((r) => ({ id: r.id as string, campaignId, amountMinor: Number(r.amount_minor), note: r.note as string, at: r.spent_at as string }));
  }

  async addKpi(row: KpiRow): Promise<void> {
    const { error } = await this.db.from("ai_campaign_kpi_readings").insert({ id: row.id, campaign_id: row.campaignId, metric: row.metric, value: row.value, period: row.period, recorded_at: row.recordedAt });
    if (error) fail(error);
  }

  async listKpi(campaignId: string): Promise<KpiRow[]> {
    const { data, error } = await this.db.from("ai_campaign_kpi_readings").select("*").eq("campaign_id", campaignId).order("recorded_at", { ascending: false }).limit(1000);
    if (error) fail(error);
    return ((data ?? []) as Row[]).map((r) => ({ id: r.id as string, campaignId, metric: r.metric as Metric, value: Number(r.value), period: r.period as string, recordedAt: r.recorded_at as string }));
  }

  async addEvent(row: CampaignEvent): Promise<void> {
    const { error } = await this.db.from("ai_campaign_events").insert({ id: row.id, campaign_id: row.campaignId, event_type: row.type, detail: row.detail, actor: row.by, at: row.at });
    if (error) fail(error);
  }

  async listEvents(campaignId: string): Promise<CampaignEvent[]> {
    const { data, error } = await this.db.from("ai_campaign_events").select("*").eq("campaign_id", campaignId).order("at", { ascending: false }).order("seq", { ascending: false }).limit(200);
    if (error) fail(error);
    return ((data ?? []) as Row[]).map((r) => ({ id: r.id as string, campaignId, type: r.event_type as string, detail: (r.detail ?? {}) as Record<string, unknown>, by: r.actor as string, at: r.at as string }));
  }
}
