import type { AuditSink } from "../audit";
import { assertNoPersonalData, PersonalDataError } from "../security/personal-data";
import { isAgent, budgetState, campaignEditSchema, campaignInputSchema, canMove, canSpend, kpiProgress, kpiReadingSchema, spendSchema, type CampaignInput, type CampaignStatus, type KpiReadingInput, type SpendInput, type BudgetState, type KpiProgress, type Currency, type Objective, type CampaignEdit, type Metric } from "./rules";
import type { AgentKey, Actor } from "../types";

export class CampaignForbiddenError extends Error {
  constructor(message = "Only the owner manages campaigns.") {
    super(message);
    this.name = "CampaignForbiddenError";
  }
}
export class CampaignValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CampaignValidationError";
  }
}
export class CampaignRuleError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CampaignRuleError";
  }
}

export interface CampaignRecord {
  id: string;
  name: string;
  goal: string;
  objective: Objective;
  kpis: { metric: Metric; target: number }[];
  budgetMinor: number;
  currency: Currency;
  channel: string;
  country: string;
  language: string;
  startsOn: string | null;
  endsOn: string | null;
  status: CampaignStatus;
  archivedAt: string | null;
  agents: AgentKey[];
  contentIds: string[];
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

export interface CampaignEvent {
  id: string;
  campaignId: string;
  type: string;
  detail: Record<string, unknown>;
  by: string;
  at: string;
}

export interface SpendRow {
  id: string;
  campaignId: string;
  amountMinor: number;
  note: string;
  at: string;
}

export interface KpiRow {
  id: string;
  campaignId: string;
  metric: Metric;
  value: number;
  period: string;
  recordedAt: string;
}

/** Storage contract. Agent and content assignments are kept with the campaign so one read returns the whole picture. */
export interface CampaignStore {
  insert(c: CampaignRecord): Promise<void>;
  get(id: string): Promise<CampaignRecord | null>;
  /** Newest first. Archived campaigns are included only when asked. */
  list(filter: { status?: CampaignStatus; includeArchived: boolean; limit: number }): Promise<CampaignRecord[]>;
  update(c: CampaignRecord): Promise<void>;
  addSpend(row: SpendRow): Promise<void>;
  listSpend(campaignId: string): Promise<SpendRow[]>;
  addKpi(row: KpiRow): Promise<void>;
  listKpi(campaignId: string): Promise<KpiRow[]>;
  addEvent(row: CampaignEvent): Promise<void>;
  listEvents(campaignId: string): Promise<CampaignEvent[]>;
}

export interface CampaignServiceDeps {
  store: CampaignStore;
  audit: AuditSink;
  now: () => Date;
  newId: () => string;
  /** Status of each content item in the content pipeline, or undefined when the item does not exist. */
  contentStatus: (artifactIds: string[]) => Promise<Map<string, string>>;
}

export interface CampaignView {
  campaign: CampaignRecord;
  budget: BudgetState;
  kpis: KpiProgress[];
  spend: SpendRow[];
  events: CampaignEvent[];
}

const owner = (actor: Actor): string => {
  if (actor.kind !== "owner") throw new CampaignForbiddenError();
  if (actor.id.trim().length === 0) throw new CampaignForbiddenError("The owner identity is missing.");
  return actor.id;
};

function noPersonalData(texts: Record<string, string>): void {
  try {
    assertNoPersonalData(texts);
  } catch (error) {
    if (error instanceof PersonalDataError) throw new CampaignValidationError("Campaign text contains personal data and was refused.");
    throw error;
  }
}

function parse<T>(schema: { safeParse: (v: unknown) => { success: true; data: T } | { success: false; error: { issues: { message: string }[] } } }, raw: unknown): T {
  const r = schema.safeParse(raw);
  if (!r.success) throw new CampaignValidationError(r.error.issues[0]?.message ?? "Campaign input is invalid.");
  return r.data;
}

/**
 * Campaign management. The owner creates and edits campaigns, assigns agents and content, records spend and KPI
 * readings, and moves the lifecycle. Every change writes a history row. Launch needs approved content.
 */
export class CampaignService {
  constructor(private readonly deps: CampaignServiceDeps) {}

  private nowIso(): string {
    return this.deps.now().toISOString();
  }

  private async load(id: string): Promise<CampaignRecord> {
    const c = await this.deps.store.get(id);
    if (!c) throw new CampaignValidationError("Campaign not found.");
    return c;
  }

  private async record(c: CampaignRecord, type: string, by: string, detail: Record<string, unknown> = {}): Promise<void> {
    await this.deps.store.addEvent({ id: this.deps.newId(), campaignId: c.id, type, detail, by, at: this.nowIso() });
    await this.deps.audit.write({ id: this.deps.newId(), ts: this.nowIso(), actor: `owner:${by}`, type: `campaign.${type}`, entityType: "campaign", entityId: c.id, meta: detail });
  }

  private assertOpen(c: CampaignRecord): void {
    if (c.archivedAt) throw new CampaignRuleError("An archived campaign cannot be changed.");
  }

  async create(actor: Actor, raw: unknown): Promise<CampaignRecord> {
    const by = owner(actor);
    const input: CampaignInput = parse(campaignInputSchema, raw);
    noPersonalData({ name: input.name, goal: input.goal, channel: input.channel });
    const nowIso = this.nowIso();
    const record: CampaignRecord = {
      id: this.deps.newId(),
      name: input.name,
      goal: input.goal,
      objective: input.objective,
      kpis: input.kpis,
      budgetMinor: input.budgetMinor,
      currency: input.currency,
      channel: input.channel,
      country: input.country,
      language: input.language,
      startsOn: input.startsOn,
      endsOn: input.endsOn,
      status: "draft",
      archivedAt: null,
      agents: [],
      contentIds: [],
      createdBy: by,
      createdAt: nowIso,
      updatedAt: nowIso,
    };
    await this.deps.store.insert(record);
    await this.record(record, "created", by, { objective: input.objective, budgetMinor: input.budgetMinor, currency: input.currency });
    return record;
  }

  /** Name, goal, channel and dates only. Objective, KPIs and budget are fixed at creation. */
  async edit(actor: Actor, id: string, raw: unknown): Promise<CampaignRecord> {
    const by = owner(actor);
    const c = await this.load(id);
    this.assertOpen(c);
    if (c.status === "active" || c.status === "finished") throw new CampaignRuleError("Only a draft or paused campaign can be edited.");
    const input: CampaignEdit = parse(campaignEditSchema, raw);
    noPersonalData({ name: input.name, goal: input.goal, channel: input.channel });
    const updated: CampaignRecord = { ...c, ...input, updatedAt: this.nowIso() };
    await this.deps.store.update(updated);
    await this.record(updated, "edited", by, { fields: Object.keys(input) });
    return updated;
  }

  /**
   * Moves the lifecycle. Launching (draft or paused to active) needs at least one agent, and every assigned
   * content item must be approved in the content review.
   */
  async transition(actor: Actor, id: string, to: CampaignStatus): Promise<CampaignRecord> {
    const by = owner(actor);
    const c = await this.load(id);
    this.assertOpen(c);
    if (!canMove(c.status, to)) throw new CampaignRuleError(`A campaign cannot move from ${c.status} to ${to}.`);
    if (to === "active") {
      if (c.agents.length === 0) throw new CampaignRuleError("Assign at least one agent before launching.");
      const statuses = await this.deps.contentStatus(c.contentIds);
      const unapproved = c.contentIds.filter((cid) => statuses.get(cid) !== "approved");
      if (unapproved.length > 0) throw new CampaignRuleError(`${unapproved.length} content item(s) are not approved yet.`);
    }
    const updated: CampaignRecord = { ...c, status: to, updatedAt: this.nowIso() };
    await this.deps.store.update(updated);
    await this.record(updated, `status_${to}`, by, { from: c.status });
    return updated;
  }

  /** Archives a campaign that is not running. Archived campaigns keep their history and are hidden by default. */
  async archive(actor: Actor, id: string): Promise<CampaignRecord> {
    const by = owner(actor);
    const c = await this.load(id);
    if (c.archivedAt) return c;
    if (c.status === "active") throw new CampaignRuleError("Pause or finish the campaign before archiving it.");
    const updated: CampaignRecord = { ...c, archivedAt: this.nowIso(), updatedAt: this.nowIso() };
    await this.deps.store.update(updated);
    await this.record(updated, "archived", by, {});
    return updated;
  }

  async assignAgent(actor: Actor, id: string, agent: string): Promise<CampaignRecord> {
    const by = owner(actor);
    const c = await this.load(id);
    this.assertOpen(c);
    if (c.status === "finished") throw new CampaignRuleError("A finished campaign cannot change its team.");
    if (!isAgent(agent)) throw new CampaignValidationError("Unknown agent.");
    if (c.agents.includes(agent)) return c;
    const updated: CampaignRecord = { ...c, agents: [...c.agents, agent], updatedAt: this.nowIso() };
    await this.deps.store.update(updated);
    await this.record(updated, "agent_assigned", by, { agent });
    return updated;
  }

  async unassignAgent(actor: Actor, id: string, agent: string): Promise<CampaignRecord> {
    const by = owner(actor);
    const c = await this.load(id);
    this.assertOpen(c);
    if (c.status === "active") throw new CampaignRuleError("Pause the campaign before changing its team.");
    const updated: CampaignRecord = { ...c, agents: c.agents.filter((a) => a !== agent), updatedAt: this.nowIso() };
    await this.deps.store.update(updated);
    await this.record(updated, "agent_removed", by, { agent });
    return updated;
  }

  /** Assigns a content item from the pipeline. The item must exist. Approval is checked at launch, not here. */
  async assignContent(actor: Actor, id: string, artifactId: string): Promise<CampaignRecord> {
    const by = owner(actor);
    const c = await this.load(id);
    this.assertOpen(c);
    if (c.status === "finished") throw new CampaignRuleError("A finished campaign cannot take new content.");
    const found = await this.deps.contentStatus([artifactId]);
    if (!found.has(artifactId)) throw new CampaignValidationError("That content item does not exist.");
    if (c.contentIds.includes(artifactId)) return c;
    const updated: CampaignRecord = { ...c, contentIds: [...c.contentIds, artifactId], updatedAt: this.nowIso() };
    await this.deps.store.update(updated);
    await this.record(updated, "content_assigned", by, { artifactId });
    return updated;
  }

  async unassignContent(actor: Actor, id: string, artifactId: string): Promise<CampaignRecord> {
    const by = owner(actor);
    const c = await this.load(id);
    this.assertOpen(c);
    const updated: CampaignRecord = { ...c, contentIds: c.contentIds.filter((x) => x !== artifactId), updatedAt: this.nowIso() };
    await this.deps.store.update(updated);
    await this.record(updated, "content_removed", by, { artifactId });
    return updated;
  }

  /** Records spend against the budget. A spend that would take the total above the budget is refused. */
  async addSpend(actor: Actor, id: string, raw: unknown): Promise<BudgetState> {
    const by = owner(actor);
    const c = await this.load(id);
    this.assertOpen(c);
    if (c.status === "draft") throw new CampaignRuleError("Launch the campaign before recording spend.");
    const input: SpendInput = parse(spendSchema, raw);
    noPersonalData({ note: input.note });
    const current = budgetState(c.budgetMinor, (await this.deps.store.listSpend(id)).map((s) => s.amountMinor));
    if (!canSpend(current, input.amountMinor)) throw new CampaignRuleError("This spend would take the campaign over its budget.");
    await this.deps.store.addSpend({ id: this.deps.newId(), campaignId: id, amountMinor: input.amountMinor, note: input.note, at: this.nowIso() });
    await this.record(c, "spend_recorded", by, { amountMinor: input.amountMinor });
    return budgetState(c.budgetMinor, [...(await this.deps.store.listSpend(id)).map((s) => s.amountMinor)]);
  }

  /** Records a KPI reading. The metric must be one of the campaign's KPIs. Readings are never estimated. */
  async recordKpi(actor: Actor, id: string, raw: unknown): Promise<KpiProgress[]> {
    const by = owner(actor);
    const c = await this.load(id);
    this.assertOpen(c);
    if (c.status === "draft") throw new CampaignRuleError("Launch the campaign before recording results.");
    const input: KpiReadingInput = parse(kpiReadingSchema, raw);
    if (!c.kpis.some((k) => k.metric === input.metric)) throw new CampaignRuleError("That metric is not a KPI of this campaign.");
    await this.deps.store.addKpi({ id: this.deps.newId(), campaignId: id, metric: input.metric, value: input.value, period: input.period, recordedAt: this.nowIso() });
    await this.record(c, "kpi_recorded", by, { metric: input.metric, period: input.period });
    return kpiProgress(c.kpis, await this.deps.store.listKpi(id));
  }

  async list(actor: Actor, filter: { status?: CampaignStatus; includeArchived?: boolean; limit?: number } = {}): Promise<CampaignRecord[]> {
    owner(actor);
    return this.deps.store.list({ status: filter.status, includeArchived: filter.includeArchived ?? false, limit: Math.min(Math.max(filter.limit ?? 50, 1), 200) });
  }

  async view(actor: Actor, id: string): Promise<CampaignView> {
    owner(actor);
    const campaign = await this.load(id);
    const spend = await this.deps.store.listSpend(id);
    return {
      campaign,
      budget: budgetState(campaign.budgetMinor, spend.map((s) => s.amountMinor)),
      kpis: kpiProgress(campaign.kpis, await this.deps.store.listKpi(id)),
      spend,
      events: await this.deps.store.listEvents(id),
    };
  }
}

