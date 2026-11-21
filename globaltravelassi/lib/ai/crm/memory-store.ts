import { CrmStaleError, type CrmStore, type FollowUpRecord, type InteractionRow, type LeadRecord, type StageHistoryRow } from "./service";
import { canMoveStage, type LeadStage } from "./rules";

/**
 * In-memory CRM store with the same contract as the Supabase store. Used by tests and local development.
 * It mirrors the database rules: stage moves are checked, history is written with every stage change, and only one
 * open follow-up can exist per lead.
 */
export class MemoryCrmStore implements CrmStore {
  private leads = new Map<string, LeadRecord>();
  private history: StageHistoryRow[] = [];
  private interactions: InteractionRow[] = [];
  private followUps = new Map<string, FollowUpRecord>();

  async insertLead(l: LeadRecord): Promise<void> {
    this.leads.set(l.id, { ...l });
  }

  async getLead(id: string): Promise<LeadRecord | null> {
    const l = this.leads.get(id);
    return l ? { ...l } : null;
  }

  async listLeads(filter: { stage?: LeadStage; includeArchived: boolean; limit: number }): Promise<LeadRecord[]> {
    return [...this.leads.values()]
      .filter((l) => (filter.stage ? l.stage === filter.stage : true))
      .filter((l) => (filter.includeArchived ? true : l.archivedAt === null))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id))
      .slice(0, filter.limit)
      .map((l) => ({ ...l }));
  }

  async allActiveLeads(limit: number): Promise<LeadRecord[]> {
    return [...this.leads.values()].filter((l) => l.archivedAt === null).slice(0, limit).map((l) => ({ ...l }));
  }

  async saveLead(l: LeadRecord, changedBy: string, expectedVersion: number): Promise<void> {
    const prev = this.leads.get(l.id);
    if (!prev) throw new Error("Lead not found.");
    // Compare-and-set: a write that read an older version of the lead loses, as it does in the database.
    if (prev.version !== expectedVersion) throw new CrmStaleError();
    if (prev.stage !== l.stage) {
      if (!canMoveStage(prev.stage, l.stage)) throw new Error("Lead stage move is not allowed.");
      if (l.stage === "lost" && (l.stageReason ?? "").length < 3) throw new Error("A lost lead needs a reason.");
      this.history.push({
        id: `hist-${this.history.length + 1}`,
        leadId: l.id,
        fromStage: prev.stage,
        toStage: l.stage,
        reason: l.stageReason,
        changedBy,
        changedAt: l.updatedAt,
      });
    }
    this.leads.set(l.id, { ...l, version: prev.version + 1 });
  }

  async listHistory(leadIds: string[]): Promise<StageHistoryRow[]> {
    return this.history.filter((h) => leadIds.includes(h.leadId)).map((h) => ({ ...h }));
  }

  async addInteraction(row: InteractionRow): Promise<void> {
    this.interactions.push({ ...row });
  }

  async listInteractions(leadIds: string[]): Promise<InteractionRow[]> {
    return this.interactions.filter((i) => leadIds.includes(i.leadId)).map((i) => ({ ...i }));
  }

  async insertFollowUp(row: FollowUpRecord): Promise<void> {
    const open = [...this.followUps.values()].some((f) => f.leadId === row.leadId && (f.status === "suggested" || f.status === "scheduled"));
    if (open && (row.status === "suggested" || row.status === "scheduled")) throw new Error("A lead can have only one open follow-up.");
    this.followUps.set(row.id, { ...row });
  }

  async getFollowUp(id: string): Promise<FollowUpRecord | null> {
    const f = this.followUps.get(id);
    return f ? { ...f } : null;
  }

  async saveFollowUp(row: FollowUpRecord): Promise<void> {
    if (!this.followUps.has(row.id)) throw new Error("Follow-up not found.");
    this.followUps.set(row.id, { ...row });
  }

  async listFollowUps(filter: { statuses: import("./rules").FollowUpStatus[]; limit: number }): Promise<FollowUpRecord[]> {
    return [...this.followUps.values()]
      .filter((f) => filter.statuses.includes(f.status))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id))
      .slice(0, filter.limit)
      .map((f) => ({ ...f }));
  }
}
