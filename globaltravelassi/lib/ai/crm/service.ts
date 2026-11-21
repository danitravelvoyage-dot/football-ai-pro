import type { AuditSink } from "../audit";
import { assertNoPersonalData, PersonalDataError } from "../security/personal-data";
import type { Actor } from "../types";
import {
  LEAD_STAGES,
  assessLead,
  canMoveStage,
  interactionSchema,
  isTerminal,
  leadInputSchema,
  salesFunnel,
  stageChangeSchema,
  suggestFollowUp,
  type FollowUpPriority,
  type FollowUpStatus,
  type Interest,
  type InteractionInput,
  type InteractionKind,
  type LeadAssessment,
  type LeadFacts,
  type LeadInput,
  type LeadSource,
  type LeadStage,
  type StageChange,
  type FunnelRow,
} from "./rules";

export class CrmForbiddenError extends Error {
  constructor(message = "Only the owner manages the CRM.") {
    super(message);
    this.name = "CrmForbiddenError";
  }
}
export class CrmValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CrmValidationError";
  }
}
export class CrmRuleError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CrmRuleError";
  }
}

export interface LeadRecord {
  id: string;
  label: string;
  source: LeadSource;
  applicationId: string | null;
  destinationCountry: string | null;
  nationality: string | null;
  travelDate: string | null;
  interest: Interest;
  stage: LeadStage;
  stageReason: string | null;
  archivedAt: string | null;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

export interface StageHistoryRow {
  id: string;
  leadId: string;
  fromStage: LeadStage;
  toStage: LeadStage;
  reason: string | null;
  changedBy: string;
  changedAt: string;
}

export interface InteractionRow {
  id: string;
  leadId: string;
  kind: InteractionKind;
  summary: string;
  recordedBy: string;
  occurredAt: string;
}

export interface FollowUpRecord {
  id: string;
  leadId: string;
  reason: string;
  priority: FollowUpPriority;
  status: FollowUpStatus;
  dueAt: string;
  createdBy: string;
  decidedBy: string | null;
  decidedAt: string | null;
  createdAt: string;
}

/**
 * Storage contract. `saveLead` writes the whole lead. When the stage differs, the store records one stage-history row
 * in the same write (the Supabase store does this in a database trigger, so the two cannot disagree).
 */
export interface CrmStore {
  insertLead(l: LeadRecord): Promise<void>;
  getLead(id: string): Promise<LeadRecord | null>;
  listLeads(filter: { stage?: LeadStage; includeArchived: boolean; limit: number }): Promise<LeadRecord[]>;
  /** Every non-archived lead, for the funnel. Bounded by the store's own limit. */
  allActiveLeads(limit: number): Promise<LeadRecord[]>;
  saveLead(l: LeadRecord, changedBy: string): Promise<void>;
  /** Oldest first. */
  listHistory(leadIds: string[]): Promise<StageHistoryRow[]>;
  addInteraction(row: InteractionRow): Promise<void>;
  listInteractions(leadIds: string[]): Promise<InteractionRow[]>;
  insertFollowUp(row: FollowUpRecord): Promise<void>;
  getFollowUp(id: string): Promise<FollowUpRecord | null>;
  saveFollowUp(row: FollowUpRecord): Promise<void>;
  listFollowUps(filter: { statuses: FollowUpStatus[]; limit: number }): Promise<FollowUpRecord[]>;
}

export interface CrmServiceDeps {
  store: CrmStore;
  audit: AuditSink;
  now: () => Date;
  newId: () => string;
}

export interface LeadListItem {
  lead: LeadRecord;
  assessment: LeadAssessment;
}

export interface LeadView extends LeadListItem {
  history: StageHistoryRow[];
  interactions: InteractionRow[];
  followUps: FollowUpRecord[];
  allowedMoves: LeadStage[];
}

const owner = (actor: Actor): string => {
  if (actor.kind !== "owner") throw new CrmForbiddenError();
  if (actor.id.trim().length === 0) throw new CrmForbiddenError("The owner identity is missing.");
  return actor.id;
};

function parse<T>(schema: { safeParse: (v: unknown) => { success: true; data: T } | { success: false; error: { issues: { message: string }[] } } }, raw: unknown): T {
  const r = schema.safeParse(raw);
  if (!r.success) throw new CrmValidationError(r.error.issues[0]?.message ?? "CRM input is invalid.");
  return r.data;
}

function noPersonalData(texts: Record<string, string>): void {
  try {
    assertNoPersonalData(texts);
  } catch (error) {
    if (error instanceof PersonalDataError) throw new CrmValidationError("Text contains personal data and was refused. Keep contact details in the application record.");
    throw error;
  }
}

function factsFor(lead: LeadRecord, interactions: InteractionRow[]): LeadFacts {
  const mine = interactions.filter((i) => i.leadId === lead.id).sort((a, b) => a.occurredAt.localeCompare(b.occurredAt));
  return {
    stage: lead.stage,
    source: lead.source,
    destinationCountry: lead.destinationCountry,
    travelDate: lead.travelDate,
    createdAt: lead.createdAt,
    lastActivityAt: mine.at(-1)?.occurredAt ?? null,
    interactionSummaries: mine.map((i) => i.summary),
  };
}

/**
 * CRM: leads, pipeline stages, interactions, lead scoring and follow-up suggestions. The owner runs it. Agents cannot
 * call it, and no follow-up is ever sent to a customer from here: a suggestion waits for the owner's decision.
 */
export class CrmService {
  constructor(private readonly deps: CrmServiceDeps) {}

  private nowIso(): string {
    return this.deps.now().toISOString();
  }

  private async audit(by: string, type: string, entityType: string, entityId: string, meta: Record<string, unknown>): Promise<void> {
    await this.deps.audit.write({ id: this.deps.newId(), ts: this.nowIso(), actor: `owner:${by}`, type: `crm.${type}`, entityType, entityId, meta });
  }

  private async loadLead(id: string): Promise<LeadRecord> {
    const lead = await this.deps.store.getLead(id);
    if (!lead) throw new CrmValidationError("Lead not found.");
    return lead;
  }

  private assertOpen(lead: LeadRecord): void {
    if (lead.archivedAt) throw new CrmRuleError("An archived lead cannot be changed.");
  }

  async createLead(actor: Actor, raw: unknown): Promise<LeadRecord> {
    const by = owner(actor);
    const input: LeadInput = parse(leadInputSchema, raw);
    noPersonalData({ label: input.label });
    const at = this.nowIso();
    const lead: LeadRecord = {
      id: this.deps.newId(),
      label: input.label,
      source: input.source,
      applicationId: input.applicationId,
      destinationCountry: input.destinationCountry,
      nationality: input.nationality,
      travelDate: input.travelDate,
      interest: input.interest,
      stage: "new",
      stageReason: null,
      archivedAt: null,
      createdBy: by,
      createdAt: at,
      updatedAt: at,
    };
    await this.deps.store.insertLead(lead);
    await this.audit(by, "lead_created", "crm_lead", lead.id, { source: lead.source, interest: lead.interest });
    return lead;
  }

  /** Moves a lead along the pipeline. Refused moves are not written. Closing a lead closes its open follow-ups. */
  async changeStage(actor: Actor, leadId: string, raw: unknown): Promise<LeadRecord> {
    const by = owner(actor);
    const change: StageChange = parse(stageChangeSchema, raw);
    const lead = await this.loadLead(leadId);
    this.assertOpen(lead);
    if (!canMoveStage(lead.stage, change.to)) throw new CrmRuleError(`A lead cannot move from ${lead.stage} to ${change.to}.`);
    if (change.reason) noPersonalData({ reason: change.reason });

    const from = lead.stage;
    const updated: LeadRecord = { ...lead, stage: change.to, stageReason: change.reason, updatedAt: this.nowIso() };
    await this.deps.store.saveLead(updated, by);
    await this.audit(by, "stage_changed", "crm_lead", lead.id, { from, to: change.to });

    if (isTerminal(change.to)) {
      const open = await this.deps.store.listFollowUps({ statuses: ["suggested", "scheduled"], limit: 1000 });
      for (const f of open.filter((x) => x.leadId === lead.id)) {
        await this.deps.store.saveFollowUp({ ...f, status: "dismissed", decidedBy: by, decidedAt: this.nowIso() });
      }
    }
    return updated;
  }

  async addInteraction(actor: Actor, leadId: string, raw: unknown): Promise<InteractionRow> {
    const by = owner(actor);
    const input: InteractionInput = parse(interactionSchema, raw);
    const lead = await this.loadLead(leadId);
    this.assertOpen(lead);
    noPersonalData({ summary: input.summary });
    const row: InteractionRow = { id: this.deps.newId(), leadId, kind: input.kind, summary: input.summary, recordedBy: by, occurredAt: this.nowIso() };
    await this.deps.store.addInteraction(row);
    await this.audit(by, "interaction_recorded", "crm_lead", leadId, { kind: input.kind });
    return row;
  }

  async list(actor: Actor, filter: { stage?: LeadStage; includeArchived: boolean; limit: number }): Promise<LeadListItem[]> {
    owner(actor);
    const leads = await this.deps.store.listLeads(filter);
    const interactions = await this.deps.store.listInteractions(leads.map((l) => l.id));
    const now = this.nowIso();
    return leads.map((lead) => ({ lead, assessment: assessLead(factsFor(lead, interactions), now) }));
  }

  async view(actor: Actor, leadId: string): Promise<LeadView> {
    owner(actor);
    const lead = await this.loadLead(leadId);
    const [interactions, history, followUps] = await Promise.all([
      this.deps.store.listInteractions([leadId]),
      this.deps.store.listHistory([leadId]),
      this.deps.store.listFollowUps({ statuses: ["suggested", "scheduled", "done", "dismissed"], limit: 200 }),
    ]);
    const mine = interactions.filter((i) => i.leadId === leadId);
    const allowedMoves = LEAD_STAGES.filter((s) => canMoveStage(lead.stage, s));
    return {
      lead,
      assessment: assessLead(factsFor(lead, mine), this.nowIso()),
      // Stores return history oldest first. The owner sees the newest move first.
      history: history.filter((h) => h.leadId === leadId).reverse(),
      interactions: mine.sort((a, b) => b.occurredAt.localeCompare(a.occurredAt)),
      followUps: followUps.filter((f) => f.leadId === leadId),
      allowedMoves,
    };
  }

  /**
   * Looks at every open lead and proposes one follow-up for each one that has gone quiet. Idempotent: a lead with an
   * open follow-up is skipped, and the database refuses a second open one. Returns how many were created.
   */
  async proposeFollowUps(actor: Actor): Promise<number> {
    const by = owner(actor);
    const leads = (await this.deps.store.allActiveLeads(500)).filter((l) => !isTerminal(l.stage));
    const interactions = await this.deps.store.listInteractions(leads.map((l) => l.id));
    const open = await this.deps.store.listFollowUps({ statuses: ["suggested", "scheduled"], limit: 1000 });
    const openLeads = new Set(open.map((f) => f.leadId));
    const now = this.nowIso();
    let created = 0;
    for (const lead of leads) {
      if (openLeads.has(lead.id)) continue;
      const facts = factsFor(lead, interactions);
      const suggestion = suggestFollowUp(facts, assessLead(facts, now));
      if (!suggestion) continue;
      await this.deps.store.insertFollowUp({
        id: this.deps.newId(),
        leadId: lead.id,
        reason: suggestion.reason,
        priority: suggestion.priority,
        status: "suggested",
        dueAt: now,
        createdBy: "system",
        decidedBy: null,
        decidedAt: null,
        createdAt: now,
      });
      created += 1;
    }
    if (created > 0) await this.audit(by, "follow_ups_proposed", "crm_follow_up", "batch", { created });
    return created;
  }

  /** Follow-ups waiting for a decision or already scheduled. Nothing here has been sent to anyone. */
  async openFollowUps(actor: Actor, limit = 100): Promise<FollowUpRecord[]> {
    owner(actor);
    return this.deps.store.listFollowUps({ statuses: ["suggested", "scheduled"], limit });
  }

  async decideFollowUp(actor: Actor, followUpId: string, decision: "approve" | "dismiss" | "complete"): Promise<FollowUpRecord> {
    const by = owner(actor);
    const f = await this.deps.store.getFollowUp(followUpId);
    if (!f) throw new CrmValidationError("Follow-up not found.");
    const lead = await this.loadLead(f.leadId);
    this.assertOpen(lead);
    const next: Record<typeof decision, { from: FollowUpStatus[]; to: FollowUpStatus }> = {
      approve: { from: ["suggested"], to: "scheduled" },
      dismiss: { from: ["suggested", "scheduled"], to: "dismissed" },
      complete: { from: ["scheduled"], to: "done" },
    };
    const rule = next[decision];
    if (!rule.from.includes(f.status)) throw new CrmRuleError(`A follow-up that is ${f.status} cannot be ${decision === "approve" ? "approved" : decision === "dismiss" ? "dismissed" : "completed"}.`);
    const updated: FollowUpRecord = { ...f, status: rule.to, decidedBy: by, decidedAt: this.nowIso() };
    await this.deps.store.saveFollowUp(updated);
    await this.audit(by, `follow_up_${decision}`, "crm_follow_up", f.id, { from: f.status, to: rule.to });
    return updated;
  }

  /** Sales funnel for the owner's dashboard, from stored rows only. Null rates mean there is no data yet. */
  async funnel(actor: Actor): Promise<{ rows: FunnelRow[]; conversionRate: number | null; lostCount: number; activeCount: number }> {
    owner(actor);
    const leads = await this.deps.store.allActiveLeads(1000);
    const history = await this.deps.store.listHistory(leads.map((l) => l.id));
    const reachedBy = new Map<string, LeadStage[]>();
    for (const h of history) reachedBy.set(h.leadId, [...(reachedBy.get(h.leadId) ?? []), h.toStage]);
    return salesFunnel(leads.map((l) => ({ stage: l.stage, reached: reachedBy.get(l.id) ?? [] })));
  }
}
