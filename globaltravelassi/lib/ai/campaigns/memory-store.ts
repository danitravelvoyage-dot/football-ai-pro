import type { CampaignEvent, CampaignRecord, CampaignStore, KpiRow, SpendRow } from "./service";
import type { CampaignStatus } from "./rules";

/** In-memory campaign store with the same contract as the Supabase store. Used by tests and local development. */
export class MemoryCampaignStore implements CampaignStore {
  private campaigns = new Map<string, CampaignRecord>();
  private spend: SpendRow[] = [];
  private kpis: KpiRow[] = [];
  private events: CampaignEvent[] = [];

  async insert(c: CampaignRecord): Promise<void> {
    this.campaigns.set(c.id, { ...c, agents: [...c.agents], contentIds: [...c.contentIds] });
  }

  async get(id: string): Promise<CampaignRecord | null> {
    const c = this.campaigns.get(id);
    return c ? { ...c, agents: [...c.agents], contentIds: [...c.contentIds] } : null;
  }

  async list(filter: { status?: CampaignStatus; includeArchived: boolean; limit: number }): Promise<CampaignRecord[]> {
    return [...this.campaigns.values()]
      .filter((c) => (filter.status ? c.status === filter.status : true))
      .filter((c) => (filter.includeArchived ? true : c.archivedAt === null))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id))
      .slice(0, filter.limit);
  }

  async update(c: CampaignRecord): Promise<void> {
    this.campaigns.set(c.id, { ...c, agents: [...c.agents], contentIds: [...c.contentIds] });
  }

  async addSpend(row: SpendRow): Promise<void> {
    this.spend.push(row);
  }

  async listSpend(campaignId: string): Promise<SpendRow[]> {
    return this.spend.filter((s) => s.campaignId === campaignId).sort((a, b) => a.at.localeCompare(b.at));
  }

  async addKpi(row: KpiRow): Promise<void> {
    this.kpis.push(row);
  }

  async listKpi(campaignId: string): Promise<KpiRow[]> {
    return this.kpis.filter((k) => k.campaignId === campaignId).map((k) => ({ ...k }));
  }

  async addEvent(row: CampaignEvent): Promise<void> {
    this.events.push(row);
  }

  async listEvents(campaignId: string): Promise<CampaignEvent[]> {
    // Insertion order is the true sequence, so newest first is the reverse of it, even when timestamps tie.
    return this.events.filter((e) => e.campaignId === campaignId).reverse();
  }
}
