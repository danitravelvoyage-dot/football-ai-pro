import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { CollaborationStore, ConflictRecord, PanelRecord, RoutingRecord } from "./store";

type Row = Record<string, unknown>;

function fail(error: { message: string }): never {
  throw new Error(`Collaboration store error: ${error.message.slice(0, 160)}`);
}

const panelFromRow = (r: Row): PanelRecord => ({
  id: r.id as string,
  taskId: r.task_id as string,
  runId: r.run_id as string,
  producer: r.producer as string,
  attempt: Number(r.attempt),
  status: r.status as PanelRecord["status"],
  decision: r.decision as PanelRecord["decision"],
  votes: (r.votes as PanelRecord["votes"]) ?? [],
  counted: (r.counted as string[]) ?? [],
  excluded: (r.excluded as PanelRecord["excluded"]) ?? [],
  reasons: (r.reasons as string[]) ?? [],
  disagreement: Boolean(r.disagreement),
  createdAt: r.created_at as string,
});

const routingFromRow = (r: Row): RoutingRecord => ({
  id: r.id as string,
  runId: r.run_id as string,
  taskId: r.task_id as string,
  stepKey: r.step_key as string,
  capability: r.capability as string,
  templateAgent: r.template_agent as string,
  chosenAgent: r.chosen_agent as string,
  reasons: (r.reasons as string[]) ?? [],
  candidates: Number(r.candidates),
  createdAt: r.created_at as string,
});

const conflictFromRow = (r: Row): ConflictRecord => ({
  id: r.id as string,
  runId: r.run_id as string,
  taskId: (r.task_id as string | null) ?? null,
  subjectKey: r.subject_key as string,
  parties: (r.parties as string[]) ?? [],
  codes: (r.codes as string[]) ?? [],
  status: r.status as "open" | "resolved",
  resolution: (r.resolution as string | null) ?? null,
  resolvedBy: (r.resolved_by as string | null) ?? null,
  resolvedAt: (r.resolved_at as string | null) ?? null,
  detectedAt: r.detected_at as string,
});

/** Review panels, routing decisions and conflicts on Supabase. Runs with the caller's session, so migration 0017 applies. */
export class SupabaseCollaborationStore implements CollaborationStore {
  constructor(private readonly db: SupabaseClient) {}

  async savePanel(p: PanelRecord): Promise<void> {
    const { error } = await this.db.from("ai_review_panels").insert({
      id: p.id,
      task_id: p.taskId,
      run_id: p.runId,
      producer: p.producer,
      attempt: p.attempt,
      status: p.status,
      decision: p.decision,
      votes: p.votes,
      counted: p.counted,
      excluded: p.excluded,
      reasons: p.reasons,
      disagreement: p.disagreement,
      created_at: p.createdAt,
    });
    if (error) fail(error);
  }

  async listPanels(filter: { runId?: string; limit: number }): Promise<PanelRecord[]> {
    let q = this.db.from("ai_review_panels").select("*");
    if (filter.runId) q = q.eq("run_id", filter.runId);
    const { data, error } = await q.order("created_at", { ascending: false }).limit(filter.limit);
    if (error) fail(error);
    return ((data ?? []) as Row[]).map(panelFromRow);
  }

  async saveRouting(r: RoutingRecord): Promise<void> {
    const { error } = await this.db.from("ai_routing_decisions").insert({
      id: r.id,
      run_id: r.runId,
      task_id: r.taskId,
      step_key: r.stepKey,
      capability: r.capability,
      template_agent: r.templateAgent,
      chosen_agent: r.chosenAgent,
      reasons: r.reasons,
      candidates: r.candidates,
      created_at: r.createdAt,
    });
    if (error) fail(error);
  }

  async listRouting(filter: { runId?: string; limit: number }): Promise<RoutingRecord[]> {
    let q = this.db.from("ai_routing_decisions").select("*");
    if (filter.runId) q = q.eq("run_id", filter.runId);
    const { data, error } = await q.order("created_at", { ascending: false }).limit(filter.limit);
    if (error) fail(error);
    return ((data ?? []) as Row[]).map(routingFromRow);
  }

  async recordConflict(c: ConflictRecord): Promise<{ created: boolean }> {
    const { data, error } = await this.db
      .from("ai_conflicts")
      .upsert(
        {
          id: c.id,
          run_id: c.runId,
          task_id: c.taskId,
          subject_key: c.subjectKey,
          parties: c.parties,
          codes: c.codes,
          status: "open",
          detected_at: c.detectedAt,
        },
        { onConflict: "run_id,subject_key", ignoreDuplicates: true },
      )
      .select("id");
    if (error) fail(error);
    return { created: (data ?? []).length > 0 };
  }

  async listConflicts(filter: { status?: "open" | "resolved"; limit: number }): Promise<ConflictRecord[]> {
    let q = this.db.from("ai_conflicts").select("*");
    if (filter.status) q = q.eq("status", filter.status);
    const { data, error } = await q.order("detected_at", { ascending: false }).limit(filter.limit);
    if (error) fail(error);
    return ((data ?? []) as Row[]).map(conflictFromRow);
  }

  async getConflict(id: string): Promise<ConflictRecord | null> {
    const { data, error } = await this.db.from("ai_conflicts").select("*").eq("id", id).maybeSingle();
    if (error) fail(error);
    return data ? conflictFromRow(data as Row) : null;
  }

  async resolveConflict(c: ConflictRecord): Promise<void> {
    const { error } = await this.db
      .from("ai_conflicts")
      .update({ status: c.status, resolution: c.resolution, resolved_by: c.resolvedBy, resolved_at: c.resolvedAt })
      .eq("id", c.id)
      .eq("status", "open");
    if (error) fail(error);
  }
}
