import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { AuditEvent, AuditSink } from "../audit";
import { assertTransition } from "../orchestration/state";
import type { AgentRunRecord, ApprovalRecord, ArtifactRecord, TaskRecord, WorkflowRunRecord } from "../orchestration/records";
import {
  ConcurrencyError,
  OPEN_TASK_STATUSES,
  type ApprovalCursor,
  type ApprovalPage,
  type NewApproval,
  type NewRun,
  type NewTask,
  type TaskCursor,
  type TaskPage,
  type TaskPatch,
  type TaskStore,
} from "../orchestration/store";
import { TASK_STATUSES, type ActionClass, type AgentKey, type TaskStatus } from "../types";
import type { UsageStore } from "../llm/gateway";

/**
 * Persistent store on the ai_* tables. Runs with the signed-in admin or operator session,
 * so row-level security applies to every call. Not exercised against a live project in this phase.
 */
type Row = Record<string, unknown>;

/**
 * Rows fetched per request. Kept below the project's default row ceiling (1000), so a query that
 * pages through every row never loses rows silently.
 */
export const PAGE_SIZE = 500;

/** Run ids per `in (...)` filter, to keep request URLs short. */
const RUN_ID_CHUNK = 50;

const TASK_SELECT = "*, ai_task_dependencies!task_id(depends_on_task_id)";

/** Cursor values are interpolated into a PostgREST filter, so they must be exactly the shape the database returns. */
const TIMESTAMP_PATTERN = /^\d{4}-\d{2}-\d{2}[T ][\d:.]+(Z|[+-]\d{2}(:?\d{2})?)$/;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function assertCursor(cursor: TaskCursor): void {
  if (!TIMESTAMP_PATTERN.test(cursor.createdAt) || !UUID_PATTERN.test(cursor.id)) {
    throw new Error("Invalid task cursor.");
  }
}

/** Maps a row returned with the dependency join. */
function toTaskRow(row: Row): TaskRecord {
  const joined = row as Row & { ai_task_dependencies?: { depends_on_task_id: string }[] };
  return toTask(joined, (joined.ai_task_dependencies ?? []).map((d) => d.depends_on_task_id));
}

function toTask(row: Row, deps: string[]): TaskRecord {
  return {
    id: row.id as string,
    runId: row.run_id as string,
    workflowKey: row.workflow_key as string,
    stepKey: row.step_key as string,
    agent: row.agent as AgentKey,
    title: row.title as string,
    status: row.status as TaskStatus,
    priority: row.priority as number,
    dueAt: (row.due_at as string | null) ?? null,
    dependsOn: deps,
    input: row.input as TaskRecord["input"],
    output: row.output ?? null,
    actionClass: (row.action_class as ActionClass | null) ?? null,
    requiresApproval: row.requires_approval as boolean,
    attempts: row.attempts as number,
    maxAttempts: row.max_attempts as number,
    nextRunAt: row.next_run_at as string,
    lastError: (row.last_error as string | null) ?? null,
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string,
  };
}

function fail(error: { message: string } | null): never {
  throw new Error(error?.message ?? "Database error.");
}

export class SupabaseTaskStore implements TaskStore {
  constructor(private readonly db: SupabaseClient) {}

  async createRun(run: NewRun, tasks: NewTask[]): Promise<{ run: WorkflowRunRecord; created: boolean }> {
    const existing = await this.db.from("ai_workflow_runs").select("*").eq("idempotency_key", run.idempotencyKey).maybeSingle();
    if (existing.data) return { run: mapRun(existing.data as Row), created: false };

    const inserted = await this.db
      .from("ai_workflow_runs")
      .insert({
        id: run.id,
        workflow_key: run.workflowKey,
        objective: run.objective,
        idempotency_key: run.idempotencyKey,
        created_by: run.createdBy,
        created_at: run.createdAt,
      })
      .select("*")
      .single();
    if (inserted.error) fail(inserted.error);

    const taskRows = tasks.map((t) => ({
      id: t.id,
      run_id: t.runId,
      workflow_key: t.workflowKey,
      step_key: t.stepKey,
      agent: t.agent,
      title: t.title,
      status: t.status,
      priority: t.priority,
      due_at: t.dueAt,
      input: t.input,
      output: t.output,
      action_class: t.actionClass,
      requires_approval: t.requiresApproval,
      attempts: t.attempts,
      max_attempts: t.maxAttempts,
      next_run_at: t.nextRunAt,
      last_error: t.lastError,
    }));
    const tasksInsert = await this.db.from("ai_tasks").insert(taskRows);
    if (tasksInsert.error) fail(tasksInsert.error);

    const edges = tasks.flatMap((t) => t.dependsOn.map((d) => ({ task_id: t.id, depends_on_task_id: d })));
    if (edges.length) {
      const edgeInsert = await this.db.from("ai_task_dependencies").insert(edges);
      if (edgeInsert.error) fail(edgeInsert.error);
    }
    return { run: mapRun(inserted.data as Row), created: true };
  }

  async listRuns(limit: number): Promise<WorkflowRunRecord[]> {
    const { data, error } = await this.db.from("ai_workflow_runs").select("*").order("created_at", { ascending: false }).limit(limit);
    if (error) fail(error);
    return (data ?? []).map((r) => mapRun(r as Row));
  }

  async listTasksPage(filter: { runId?: string; status?: TaskStatus; limit: number; after?: TaskCursor }): Promise<TaskPage> {
    const limit = Math.max(1, Math.min(filter.limit, PAGE_SIZE));
    let query = this.db.from("ai_tasks").select(TASK_SELECT).order("created_at", { ascending: false }).order("id", { ascending: false }).limit(limit + 1);
    if (filter.runId) query = query.eq("run_id", filter.runId);
    if (filter.status) query = query.eq("status", filter.status);
    if (filter.after) {
      assertCursor(filter.after);
      const { createdAt, id } = filter.after;
      query = query.or(`created_at.lt.${createdAt},and(created_at.eq.${createdAt},id.lt.${id})`);
    }
    const { data, error } = await query;
    if (error) fail(error);
    const rows = (data ?? []) as Row[];
    const items = rows.slice(0, limit).map(toTaskRow);
    const last = items[items.length - 1];
    const hasMore = rows.length > limit;
    return { items, next: hasMore && last ? { createdAt: last.createdAt, id: last.id } : null };
  }

  async listOpenTasks(): Promise<TaskRecord[]> {
    const out: TaskRecord[] = [];
    let after: TaskCursor | null = null;
    for (;;) {
      let query = this.db
        .from("ai_tasks")
        .select(TASK_SELECT)
        .in("status", [...OPEN_TASK_STATUSES])
        .order("created_at", { ascending: true })
        .order("id", { ascending: true })
        .limit(PAGE_SIZE);
      if (after) {
        assertCursor(after);
        query = query.or(`created_at.gt.${after.createdAt},and(created_at.eq.${after.createdAt},id.gt.${after.id})`);
      }
      const { data, error } = await query;
      if (error) fail(error);
      const rows = (data ?? []) as Row[];
      out.push(...rows.map(toTaskRow));
      if (rows.length < PAGE_SIZE) return out;
      const last = rows[rows.length - 1];
      after = { createdAt: last.created_at as string, id: last.id as string };
    }
  }

  async listTasksByRunIds(runIds: string[]): Promise<TaskRecord[]> {
    const out: TaskRecord[] = [];
    for (let i = 0; i < runIds.length; i += RUN_ID_CHUNK) {
      const chunk = runIds.slice(i, i + RUN_ID_CHUNK);
      for (let offset = 0; ; offset += PAGE_SIZE) {
        const { data, error } = await this.db
          .from("ai_tasks")
          .select(TASK_SELECT)
          .in("run_id", chunk)
          .order("created_at", { ascending: true })
          .order("id", { ascending: true })
          .range(offset, offset + PAGE_SIZE - 1);
        if (error) fail(error);
        const rows = (data ?? []) as Row[];
        out.push(...rows.map(toTaskRow));
        if (rows.length < PAGE_SIZE) break;
      }
    }
    return out;
  }

  async getTasksByIds(ids: string[]): Promise<TaskRecord[]> {
    const out: TaskRecord[] = [];
    for (let i = 0; i < ids.length; i += RUN_ID_CHUNK) {
      const { data, error } = await this.db.from("ai_tasks").select(TASK_SELECT).in("id", ids.slice(i, i + RUN_ID_CHUNK));
      if (error) fail(error);
      out.push(...((data ?? []) as Row[]).map(toTaskRow));
    }
    return out;
  }

  async getTask(id: string): Promise<TaskRecord | null> {
    const { data, error } = await this.db.from("ai_tasks").select(TASK_SELECT).eq("id", id).maybeSingle();
    if (error) fail(error);
    return data ? toTaskRow(data as Row) : null;
  }

  async transitionTask(id: string, from: TaskStatus, to: TaskStatus, patch: TaskPatch = {}, now?: string): Promise<TaskRecord> {
    assertTransition(from, to);
    const update: Row = { status: to, updated_at: now ?? new Date().toISOString() };
    if (patch.output !== undefined) update.output = patch.output;
    if (patch.lastError !== undefined) update.last_error = patch.lastError;
    if (patch.attempts !== undefined) update.attempts = patch.attempts;
    if (patch.nextRunAt !== undefined) update.next_run_at = patch.nextRunAt;
    if (patch.requiresApproval !== undefined) update.requires_approval = patch.requiresApproval;
    const { data, error } = await this.db.from("ai_tasks").update(update).eq("id", id).eq("status", from).select("*").maybeSingle();
    if (error) fail(error);
    if (!data) throw new ConcurrencyError(`Task ${id} is no longer ${from}.`);
    const deps = await this.db.from("ai_task_dependencies").select("depends_on_task_id").eq("task_id", id);
    return toTask(data as Row, (deps.data ?? []).map((d) => (d as { depends_on_task_id: string }).depends_on_task_id));
  }

  async claimReady(nowIso: string, limit: number): Promise<TaskRecord[]> {
    void nowIso;
    const { data, error } = await this.db.rpc("ai_claim_ready_tasks", { p_limit: limit });
    if (error) fail(error);
    return ((data ?? []) as Row[]).map((r) => toTask(r, []));
  }

  async saveArtifact(a: Omit<ArtifactRecord, "createdAt">): Promise<ArtifactRecord> {
    const { data, error } = await this.db
      .from("ai_artifacts")
      .insert({
        id: a.id,
        task_id: a.taskId,
        agent: a.agent,
        kind: a.kind,
        language: a.language,
        country: a.country,
        body: a.body,
        status: a.status,
        source: a.source,
        prompt_version: a.promptVersion,
      })
      .select("*")
      .single();
    if (error) fail(error);
    return mapArtifact(data as Row);
  }

  async listArtifacts(limit: number): Promise<ArtifactRecord[]> {
    const { data, error } = await this.db.from("ai_artifacts").select("*").order("created_at", { ascending: false }).limit(limit);
    if (error) fail(error);
    return (data ?? []).map((r) => mapArtifact(r as Row));
  }

  /** The database sets the expiry and the fingerprint on insert (migration 0007). */
  async createApproval(a: NewApproval): Promise<ApprovalRecord> {
    const { data, error } = await this.db
      .from("ai_approvals")
      .insert({
        id: a.id,
        task_id: a.taskId,
        artifact_id: a.artifactId,
        action_class: a.actionClass,
        risk_level: a.riskLevel,
        summary: a.summary,
        preview: a.preview,
        status: "pending",
      })
      .select("*")
      .single();
    if (error) fail(error);
    return mapApproval(data as Row);
  }

  async decideApproval(id: string, decision: "approved" | "rejected", decidedBy: string, note: string | null, decidedAt: string): Promise<ApprovalRecord> {
    const { data, error } = await this.db
      .from("ai_approvals")
      .update({ status: decision, decided_by: decidedBy, decided_at: decidedAt, decision_note: note })
      .eq("id", id)
      .eq("status", "pending")
      .select("*")
      .maybeSingle();
    if (error) fail(error);
    if (!data) throw new ConcurrencyError(`Approval ${id} is not pending.`);
    return mapApproval(data as Row);
  }

  async getApproval(id: string): Promise<ApprovalRecord | null> {
    const { data, error } = await this.db.from("ai_approvals").select("*").eq("id", id).maybeSingle();
    if (error) fail(error);
    return data ? mapApproval(data as Row) : null;
  }

  async listApprovalsPage(filter: { status?: ApprovalRecord["status"]; limit: number; after?: ApprovalCursor }): Promise<ApprovalPage> {
    const limit = Math.max(1, Math.min(filter.limit, PAGE_SIZE));
    let query = this.db.from("ai_approvals").select("*").order("created_at", { ascending: false }).order("id", { ascending: false }).limit(limit + 1);
    if (filter.status) query = query.eq("status", filter.status);
    if (filter.after) {
      assertCursor(filter.after);
      const { createdAt, id } = filter.after;
      query = query.or(`created_at.lt.${createdAt},and(created_at.eq.${createdAt},id.lt.${id})`);
    }
    const { data, error } = await query;
    if (error) fail(error);
    const rows = (data ?? []) as Row[];
    const items = rows.slice(0, limit).map(mapApproval);
    const last = items[items.length - 1];
    return { items, next: rows.length > limit && last ? { createdAt: last.createdAt, id: last.id } : null };
  }

  /** Reads every page. There is no fixed row limit: a long history is read in full, page by page. */
  async listApprovals(status?: ApprovalRecord["status"]): Promise<ApprovalRecord[]> {
    const out: ApprovalRecord[] = [];
    let after: ApprovalCursor | undefined;
    for (;;) {
      const page: ApprovalPage = await this.listApprovalsPage({ status, limit: PAGE_SIZE, after });
      out.push(...page.items);
      if (!page.next) return out;
      after = page.next;
    }
  }

  async listExpiredPending(nowIso: string): Promise<ApprovalRecord[]> {
    const { data, error } = await this.db
      .from("ai_approvals")
      .select("*")
      .eq("status", "pending")
      .lte("expires_at", nowIso)
      .order("expires_at", { ascending: true })
      .limit(PAGE_SIZE);
    if (error) fail(error);
    return ((data ?? []) as Row[]).map(mapApproval);
  }

  async expireApproval(id: string, nowIso: string): Promise<ApprovalRecord> {
    const { data, error } = await this.db
      .from("ai_approvals")
      .update({ status: "expired", decided_at: nowIso })
      .eq("id", id)
      .eq("status", "pending")
      .select("*")
      .maybeSingle();
    if (error) fail(error);
    if (!data) throw new ConcurrencyError(`Approval ${id} is not pending.`);
    return mapApproval(data as Row);
  }

  async markExecuted(id: string, nowIso: string): Promise<boolean> {
    const { data, error } = await this.db
      .from("ai_approvals")
      .update({ executed_at: nowIso })
      .eq("id", id)
      .eq("status", "approved")
      .is("executed_at", null)
      .select("id")
      .maybeSingle();
    if (error) fail(error);
    return data !== null;
  }

  async saveAgentRun(run: AgentRunRecord): Promise<void> {
    const { error } = await this.db.from("ai_agent_runs").insert({
      id: run.id,
      task_id: run.taskId,
      agent: run.agent,
      attempt: run.attempt,
      prompt_version: run.promptVersion,
      provider_id: run.providerId,
      status: run.status,
      tokens_in: run.tokensIn,
      tokens_out: run.tokensOut,
      duration_ms: run.durationMs,
      error: run.error,
      started_at: run.startedAt,
      finished_at: run.finishedAt,
    });
    if (error) fail(error);
  }

  async listAgentRuns(limit: number): Promise<AgentRunRecord[]> {
    const { data, error } = await this.db.from("ai_agent_runs").select("*").order("finished_at", { ascending: false }).limit(limit);
    if (error) fail(error);
    return (data ?? []).map((r) => {
      const row = r as Row;
      return {
        id: row.id as string,
        taskId: row.task_id as string,
        agent: row.agent as AgentKey,
        attempt: row.attempt as number,
        promptVersion: row.prompt_version as string,
        providerId: (row.provider_id as string | null) ?? null,
        status: row.status as "succeeded" | "failed",
        tokensIn: row.tokens_in as number,
        tokensOut: row.tokens_out as number,
        durationMs: row.duration_ms as number,
        error: (row.error as string | null) ?? null,
        startedAt: row.started_at as string,
        finishedAt: row.finished_at as string,
      };
    });
  }

  async saveMemory(agent: AgentKey, key: string, summary: string, updatedAt: string): Promise<void> {
    const { error } = await this.db.from("ai_memory").upsert({ agent, memory_key: key, summary, updated_at: updatedAt });
    if (error) fail(error);
  }

  async countTasksByStatus(): Promise<Record<TaskStatus, number>> {
    const entries = await Promise.all(
      TASK_STATUSES.map(async (status) => {
        const { count, error } = await this.db.from("ai_tasks").select("id", { count: "exact", head: true }).eq("status", status);
        if (error) fail(error);
        return [status, count ?? 0] as const;
      }),
    );
    return Object.fromEntries(entries) as Record<TaskStatus, number>;
  }

  async actionFor(taskId: string): Promise<ActionClass | null> {
    const { data, error } = await this.db.from("ai_tasks").select("action_class").eq("id", taskId).maybeSingle();
    if (error) fail(error);
    return ((data as { action_class: ActionClass | null } | null)?.action_class) ?? null;
  }
}

function mapRun(row: Row): WorkflowRunRecord {
  return {
    id: row.id as string,
    workflowKey: row.workflow_key as string,
    objective: row.objective as string,
    idempotencyKey: row.idempotency_key as string,
    createdBy: row.created_by as string,
    createdAt: row.created_at as string,
  };
}

function mapArtifact(row: Row): ArtifactRecord {
  return {
    id: row.id as string,
    taskId: (row.task_id as string | null) ?? null,
    agent: row.agent as AgentKey,
    kind: row.kind as string,
    language: row.language as string,
    country: row.country as string,
    body: row.body,
    status: row.status as ArtifactRecord["status"],
    source: row.source as ArtifactRecord["source"],
    promptVersion: (row.prompt_version as string | null) ?? null,
    createdAt: row.created_at as string,
  };
}

function mapApproval(row: Row): ApprovalRecord {
  return {
    id: row.id as string,
    taskId: row.task_id as string,
    artifactId: (row.artifact_id as string | null) ?? null,
    actionClass: row.action_class as ActionClass,
    riskLevel: row.risk_level as ApprovalRecord["riskLevel"],
    summary: row.summary as string,
    preview: row.preview,
    status: row.status as ApprovalRecord["status"],
    decidedBy: (row.decided_by as string | null) ?? null,
    decidedAt: (row.decided_at as string | null) ?? null,
    decisionNote: (row.decision_note as string | null) ?? null,
    expiresAt: (row.expires_at as string | null) ?? null,
    payloadHash: row.payload_hash as string,
    executedAt: (row.executed_at as string | null) ?? null,
    createdAt: row.created_at as string,
  };
}

export class SupabaseAuditSink implements AuditSink {
  constructor(private readonly db: SupabaseClient) {}

  async write(event: AuditEvent): Promise<void> {
    const { error } = await this.db.from("ai_events").insert({
      id: event.id,
      ts: event.ts,
      actor: event.actor,
      event_type: event.type,
      entity_type: event.entityType,
      entity_id: event.entityId,
      meta: event.meta,
    });
    if (error) fail(error);
  }
}

/** Durable daily counters for provider quotas. Read-then-write: adequate at this scale, documented as such. */
export class SupabaseUsageStore implements UsageStore {
  constructor(private readonly db: SupabaseClient) {}

  async requestsToday(providerId: string, day: string): Promise<number> {
    const { data, error } = await this.db.from("ai_usage").select("requests").eq("day", day).eq("provider_id", providerId).maybeSingle();
    if (error) fail(error);
    return (data as { requests: number } | null)?.requests ?? 0;
  }

  async record(entry: { providerId: string; day: string; tokensIn: number; tokensOut: number }): Promise<void> {
    const current = await this.db.from("ai_usage").select("requests, tokens").eq("day", entry.day).eq("provider_id", entry.providerId).maybeSingle();
    const requests = ((current.data as { requests: number } | null)?.requests ?? 0) + 1;
    const tokens = ((current.data as { tokens: number } | null)?.tokens ?? 0) + entry.tokensIn + entry.tokensOut;
    const { error } = await this.db.from("ai_usage").upsert({ day: entry.day, provider_id: entry.providerId, requests, tokens });
    if (error) fail(error);
  }
}
