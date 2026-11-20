import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { DecisionRecord, ExperimentRecord, MemoryStore, ResultRecord } from "../memory/store";

type Row = Record<string, unknown>;

/** Largest set a single analysis reads. At the limit the read fails instead of returning a partial set. */
export const ANALYSIS_LIMIT = 5000;

function atLimit(count: number): void {
  if (count >= ANALYSIS_LIMIT) throw new Error("The business history is too large to analyse in one read.");
}

function fail(error: { message: string } | null): never {
  throw new Error(error?.message ?? "Database error.");
}

function toDecision(r: Row): DecisionRecord {
  return {
    id: r.id as string,
    subjectType: r.subject_type as DecisionRecord["subjectType"],
    subjectRef: r.subject_ref as string,
    decision: r.decision as DecisionRecord["decision"],
    reasoning: r.reasoning as string,
    version: r.version as number,
    supersedesId: (r.supersedes_id as string | null) ?? null,
    decidedBy: r.decided_by as string,
    decidedAt: r.decided_at as string,
  };
}

function toExperiment(r: Row): ExperimentRecord {
  return {
    id: r.id as string,
    kind: r.kind as ExperimentRecord["kind"],
    name: r.name as string,
    hypothesis: r.hypothesis as string,
    status: r.status as ExperimentRecord["status"],
    startedAt: (r.started_at as string | null) ?? null,
    endedAt: (r.ended_at as string | null) ?? null,
    createdBy: r.created_by as string,
    createdAt: r.created_at as string,
  };
}

function toResult(r: Row): ResultRecord {
  return {
    id: r.id as string,
    experimentId: r.experiment_id as string,
    variant: r.variant as string,
    metric: r.metric_key as string,
    value: Number(r.value),
    sampleSize: r.sample_size as number,
    source: r.source as ResultRecord["source"],
    period: r.period as string,
    recordedBy: r.recorded_by as string,
    recordedAt: r.recorded_at as string,
  };
}

/** Business memory on the ai_owner_decisions, ai_experiments and ai_experiment_results tables. */
export class SupabaseMemoryStore implements MemoryStore {
  constructor(private readonly db: SupabaseClient) {}

  async latestDecision(subjectType: string, subjectRef: string) {
    const { data, error } = await this.db
      .from("ai_owner_decisions")
      .select("*")
      .eq("subject_type", subjectType)
      .eq("subject_ref", subjectRef)
      .order("version", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) fail(error);
    return data ? toDecision(data as Row) : null;
  }

  async insertDecision(d: Omit<DecisionRecord, "id">) {
    const { data, error } = await this.db
      .from("ai_owner_decisions")
      .insert({
        subject_type: d.subjectType,
        subject_ref: d.subjectRef,
        decision: d.decision,
        reasoning: d.reasoning,
        version: d.version,
        supersedes_id: d.supersedesId,
        decided_by: d.decidedBy,
        decided_at: d.decidedAt,
      })
      .select("*")
      .single();
    if (error) fail(error);
    return toDecision(data as Row);
  }

  async decisionHistory(subjectType: string, subjectRef: string) {
    const { data, error } = await this.db
      .from("ai_owner_decisions")
      .select("*")
      .eq("subject_type", subjectType)
      .eq("subject_ref", subjectRef)
      .order("version", { ascending: true })
      .limit(500);
    if (error) fail(error);
    return ((data ?? []) as Row[]).map(toDecision);
  }

  async latestDecisionsBySubject(subjectType?: string) {
    let query = this.db.from("ai_owner_decisions").select("*").order("version", { ascending: false }).limit(ANALYSIS_LIMIT);
    if (subjectType) query = query.eq("subject_type", subjectType);
    const { data, error } = await query;
    if (error) fail(error);
    atLimit((data ?? []).length);
    const seen = new Map<string, DecisionRecord>();
    for (const row of (data ?? []) as Row[]) {
      const d = toDecision(row);
      const key = `${d.subjectType}|${d.subjectRef}`;
      if (!seen.has(key)) seen.set(key, d);
    }
    return [...seen.values()];
  }

  async insertExperiment(e: Omit<ExperimentRecord, "id" | "createdAt" | "status" | "startedAt" | "endedAt">) {
    const { data, error } = await this.db
      .from("ai_experiments")
      .insert({ kind: e.kind, name: e.name, hypothesis: e.hypothesis, created_by: e.createdBy })
      .select("*")
      .single();
    if (error) fail(error);
    return toExperiment(data as Row);
  }

  async getExperiment(id: string) {
    const { data, error } = await this.db.from("ai_experiments").select("*").eq("id", id).maybeSingle();
    if (error) fail(error);
    return data ? toExperiment(data as Row) : null;
  }

  async updateExperimentStatus(id: string, status: ExperimentRecord["status"], at: string) {
    const changes: Row = { status };
    if (status === "running") changes.started_at = at;
    if (status === "finished") changes.ended_at = at;
    const { data, error } = await this.db.from("ai_experiments").update(changes).eq("id", id).select("*").maybeSingle();
    if (error) fail(error);
    if (!data) throw new Error("Experiment not found.");
    return toExperiment(data as Row);
  }

  async listExperiments() {
    const { data, error } = await this.db.from("ai_experiments").select("*").order("created_at", { ascending: false }).limit(1000);
    if (error) fail(error);
    return ((data ?? []) as Row[]).map(toExperiment);
  }

  async insertResult(r: Omit<ResultRecord, "id">) {
    const { data, error } = await this.db
      .from("ai_experiment_results")
      .insert({
        experiment_id: r.experimentId,
        variant: r.variant,
        metric_key: r.metric,
        value: r.value,
        sample_size: r.sampleSize,
        source: r.source,
        period: r.period,
        recorded_by: r.recordedBy,
        recorded_at: r.recordedAt,
      })
      .select("*")
      .single();
    if (error) fail(error);
    return toResult(data as Row);
  }

  async resultsFor(experimentId: string) {
    const { data, error } = await this.db.from("ai_experiment_results").select("*").eq("experiment_id", experimentId).limit(ANALYSIS_LIMIT);
    if (error) fail(error);
    atLimit((data ?? []).length);
    return ((data ?? []) as Row[]).map(toResult);
  }

  async listResults() {
    const { data, error } = await this.db.from("ai_experiment_results").select("*").order("recorded_at", { ascending: false }).limit(ANALYSIS_LIMIT);
    if (error) fail(error);
    atLimit((data ?? []).length);
    return ((data ?? []) as Row[]).map(toResult);
  }
}
