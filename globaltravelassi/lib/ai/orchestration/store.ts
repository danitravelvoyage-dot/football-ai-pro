import type { ActionClass, AgentKey, TaskStatus } from "../types";
import { assertTransition } from "./state";
import type { AgentRunRecord, ApprovalRecord, ArtifactRecord, TaskRecord, WorkflowRunRecord } from "./records";

export class ConcurrencyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConcurrencyError";
  }
}

export interface NewRun {
  id: string;
  workflowKey: string;
  objective: string;
  idempotencyKey: string;
  createdBy: string;
  createdAt: string;
}

export type NewTask = Omit<TaskRecord, "createdAt" | "updatedAt">;

export interface TaskPatch {
  output?: unknown;
  lastError?: string | null;
  attempts?: number;
  nextRunAt?: string;
  requiresApproval?: boolean;
}

/** Keyset cursor: the last row of the previous page. Newest-first pages use (createdAt, id) descending. */
export interface TaskCursor {
  createdAt: string;
  id: string;
}

export interface TaskPage {
  items: TaskRecord[];
  next: TaskCursor | null;
}

/** Statuses that still need the scheduler's attention. Succeeded and cancelled tasks are finished. */
export const OPEN_TASK_STATUSES: readonly TaskStatus[] = ["pending", "ready", "running", "waiting_approval", "blocked", "failed"];

export type NewApproval = Omit<ApprovalRecord, "createdAt" | "status" | "decidedBy" | "decidedAt" | "decisionNote" | "executedAt">;

export interface ApprovalCursor {
  createdAt: string;
  id: string;
}

export interface ApprovalPage {
  items: ApprovalRecord[];
  next: ApprovalCursor | null;
}

export interface TaskStore {
  createRun(run: NewRun, tasks: NewTask[]): Promise<{ run: WorkflowRunRecord; created: boolean }>;
  listRuns(limit: number): Promise<WorkflowRunRecord[]>;
  /** Newest first. Pass the `next` cursor back to read the following page. Never truncates silently. */
  listTasksPage(filter: { runId?: string; status?: TaskStatus; limit: number; after?: TaskCursor }): Promise<TaskPage>;
  /** Every task that is not yet succeeded or cancelled, oldest first. Reads all pages; there is no row cap. */
  listOpenTasks(): Promise<TaskRecord[]>;
  /** Every task of the given runs, oldest first. */
  listTasksByRunIds(runIds: string[]): Promise<TaskRecord[]>;
  /** Looks tasks up by id, so a dependency is found wherever it sits in the queue. */
  getTasksByIds(ids: string[]): Promise<TaskRecord[]>;
  getTask(id: string): Promise<TaskRecord | null>;
  /** Moves a task from `from` to `to`. Fails if the stored status is not `from` (optimistic concurrency). */
  transitionTask(id: string, from: TaskStatus, to: TaskStatus, patch?: TaskPatch, now?: string): Promise<TaskRecord>;
  /** Atomically moves due `ready` tasks to `running` and increments their attempt counter. */
  claimReady(nowIso: string, limit: number): Promise<TaskRecord[]>;

  saveArtifact(artifact: Omit<ArtifactRecord, "createdAt">): Promise<ArtifactRecord>;
  listArtifacts(limit: number): Promise<ArtifactRecord[]>;

  createApproval(approval: NewApproval): Promise<ApprovalRecord>;
  decideApproval(id: string, decision: "approved" | "rejected", decidedBy: string, note: string | null, decidedAt: string): Promise<ApprovalRecord>;
  getApproval(id: string): Promise<ApprovalRecord | null>;
  /** Every approval with the given status (all pages are read; there is no row cap). Newest first. */
  listApprovals(status?: ApprovalRecord["status"]): Promise<ApprovalRecord[]>;
  /** One page, newest first. Pass `next` back to read the following page. */
  listApprovalsPage(filter: { status?: ApprovalRecord["status"]; limit: number; after?: ApprovalCursor }): Promise<ApprovalPage>;
  /** Pending approvals whose expiry time has passed. */
  listExpiredPending(nowIso: string): Promise<ApprovalRecord[]>;
  /** Moves a pending approval to expired. Fails if it is no longer pending. */
  expireApproval(id: string, nowIso: string): Promise<ApprovalRecord>;
  /** Claims the one-time execution of an approved item. Returns false if it was already claimed. */
  markExecuted(id: string, nowIso: string): Promise<boolean>;

  saveAgentRun(run: AgentRunRecord): Promise<void>;
  listAgentRuns(limit: number): Promise<AgentRunRecord[]>;
  saveMemory(agent: AgentKey, key: string, summary: string, updatedAt: string): Promise<void>;
  /** Exact counts per status over every task. Used by the COO and the dashboard. */
  countTasksByStatus(): Promise<Record<TaskStatus, number>>;
  actionFor(taskId: string): Promise<ActionClass | null>;
}

function compareApprovalsNewest(a: ApprovalCursor, b: ApprovalCursor): number {
  return b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id);
}

function compareNewestFirst(a: TaskCursor, b: TaskCursor): number {
  return b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id);
}

function compareOldestFirst(a: TaskCursor, b: TaskCursor): number {
  return a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id);
}

/** In-memory store. Same contract as the Supabase store; used by tests and local development. */
export class MemoryTaskStore implements TaskStore {
  private runs: WorkflowRunRecord[] = [];
  private tasks = new Map<string, TaskRecord>();
  private artifacts: ArtifactRecord[] = [];
  private approvals = new Map<string, ApprovalRecord>();
  private agentRuns: AgentRunRecord[] = [];
  private memory = new Map<string, { summary: string; updatedAt: string }>();

  async createRun(run: NewRun, tasks: NewTask[]): Promise<{ run: WorkflowRunRecord; created: boolean }> {
    const existing = this.runs.find((r) => r.idempotencyKey === run.idempotencyKey);
    if (existing) return { run: existing, created: false };
    const record: WorkflowRunRecord = {
      id: run.id,
      workflowKey: run.workflowKey,
      objective: run.objective,
      idempotencyKey: run.idempotencyKey,
      createdBy: run.createdBy,
      createdAt: run.createdAt,
    };
    this.runs.push(record);
    for (const t of tasks) {
      this.tasks.set(t.id, { ...t, createdAt: run.createdAt, updatedAt: run.createdAt });
    }
    return { run: record, created: true };
  }

  async listRuns(limit: number): Promise<WorkflowRunRecord[]> {
    return [...this.runs].reverse().slice(0, limit);
  }

  async listTasksPage(filter: { runId?: string; status?: TaskStatus; limit: number; after?: TaskCursor }): Promise<TaskPage> {
    const after = filter.after;
    const matching = [...this.tasks.values()]
      .filter((t) => (!filter.runId || t.runId === filter.runId) && (!filter.status || t.status === filter.status))
      .filter((t) => !after || compareNewestFirst(t, after) > 0)
      .sort(compareNewestFirst);
    const items = matching.slice(0, filter.limit);
    const last = items[items.length - 1];
    const hasMore = matching.length > filter.limit;
    return { items, next: hasMore && last ? { createdAt: last.createdAt, id: last.id } : null };
  }

  async listOpenTasks(): Promise<TaskRecord[]> {
    return [...this.tasks.values()]
      .filter((t) => OPEN_TASK_STATUSES.includes(t.status))
      .sort(compareOldestFirst);
  }

  async listTasksByRunIds(runIds: string[]): Promise<TaskRecord[]> {
    const wanted = new Set(runIds);
    return [...this.tasks.values()].filter((t) => wanted.has(t.runId)).sort(compareOldestFirst);
  }

  async getTasksByIds(ids: string[]): Promise<TaskRecord[]> {
    return ids.map((id) => this.tasks.get(id)).filter((t): t is TaskRecord => t !== undefined);
  }

  async getTask(id: string): Promise<TaskRecord | null> {
    return this.tasks.get(id) ?? null;
  }

  async transitionTask(id: string, from: TaskStatus, to: TaskStatus, patch: TaskPatch = {}, now?: string): Promise<TaskRecord> {
    const task = this.tasks.get(id);
    if (!task) throw new ConcurrencyError(`Task ${id} not found.`);
    if (task.status !== from) throw new ConcurrencyError(`Task ${id} is ${task.status}, expected ${from}.`);
    assertTransition(from, to);
    const updated: TaskRecord = {
      ...task,
      status: to,
      output: patch.output !== undefined ? patch.output : task.output,
      lastError: patch.lastError !== undefined ? patch.lastError : task.lastError,
      attempts: patch.attempts ?? task.attempts,
      nextRunAt: patch.nextRunAt ?? task.nextRunAt,
      requiresApproval: patch.requiresApproval ?? task.requiresApproval,
      updatedAt: now ?? task.updatedAt,
    };
    this.tasks.set(id, updated);
    return updated;
  }

  async claimReady(nowIso: string, limit: number): Promise<TaskRecord[]> {
    const due = [...this.tasks.values()]
      .filter((t) => t.status === "ready" && t.nextRunAt <= nowIso)
      .sort((a, b) => b.priority - a.priority || a.createdAt.localeCompare(b.createdAt))
      .slice(0, limit);
    const claimed: TaskRecord[] = [];
    for (const task of due) {
      const next: TaskRecord = { ...task, status: "running", attempts: task.attempts + 1, updatedAt: nowIso };
      this.tasks.set(task.id, next);
      claimed.push(next);
    }
    return claimed;
  }

  async saveArtifact(artifact: Omit<ArtifactRecord, "createdAt">): Promise<ArtifactRecord> {
    const record: ArtifactRecord = { ...artifact, createdAt: new Date().toISOString() };
    this.artifacts.push(record);
    return record;
  }

  async listArtifacts(limit: number): Promise<ArtifactRecord[]> {
    return [...this.artifacts].reverse().slice(0, limit);
  }

  async createApproval(input: NewApproval): Promise<ApprovalRecord> {
    const record: ApprovalRecord = {
      ...input,
      status: "pending",
      decidedBy: null,
      decidedAt: null,
      decisionNote: null,
      executedAt: null,
      createdAt: new Date().toISOString(),
    };
    this.approvals.set(record.id, record);
    return record;
  }

  async decideApproval(id: string, decision: "approved" | "rejected", decidedBy: string, note: string | null, decidedAt: string): Promise<ApprovalRecord> {
    const approval = this.approvals.get(id);
    if (!approval) throw new ConcurrencyError(`Approval ${id} not found.`);
    if (approval.status !== "pending") throw new ConcurrencyError(`Approval ${id} is already ${approval.status}.`);
    const updated: ApprovalRecord = { ...approval, status: decision, decidedBy, decidedAt, decisionNote: note };
    this.approvals.set(id, updated);
    return updated;
  }

  async getApproval(id: string): Promise<ApprovalRecord | null> {
    return this.approvals.get(id) ?? null;
  }

  async listApprovals(status?: ApprovalRecord["status"]): Promise<ApprovalRecord[]> {
    return [...this.approvals.values()].filter((a) => !status || a.status === status).sort(compareApprovalsNewest);
  }

  async listApprovalsPage(filter: { status?: ApprovalRecord["status"]; limit: number; after?: ApprovalCursor }): Promise<ApprovalPage> {
    const matching = (await this.listApprovals(filter.status)).filter((a) => !filter.after || compareApprovalsNewest(a, filter.after) > 0);
    const items = matching.slice(0, filter.limit);
    const last = items[items.length - 1];
    return { items, next: matching.length > filter.limit && last ? { createdAt: last.createdAt, id: last.id } : null };
  }

  async listExpiredPending(nowIso: string): Promise<ApprovalRecord[]> {
    return [...this.approvals.values()].filter((a) => a.status === "pending" && a.expiresAt !== null && a.expiresAt <= nowIso);
  }

  async expireApproval(id: string, nowIso: string): Promise<ApprovalRecord> {
    const approval = this.approvals.get(id);
    if (!approval || approval.status !== "pending") throw new ConcurrencyError(`Approval ${id} is not pending.`);
    const updated: ApprovalRecord = { ...approval, status: "expired", decidedBy: null, decidedAt: nowIso };
    this.approvals.set(id, updated);
    return updated;
  }

  /** Records that the owner card for an approved external action was issued. The platform never performs the action itself. */
  async markExecuted(id: string, nowIso: string): Promise<boolean> {
    const approval = this.approvals.get(id);
    if (!approval || approval.status !== "approved" || approval.executedAt !== null) return false;
    this.approvals.set(id, { ...approval, executedAt: nowIso });
    return true;
  }

  async saveAgentRun(run: AgentRunRecord): Promise<void> {
    this.agentRuns.push(run);
  }

  async listAgentRuns(limit: number): Promise<AgentRunRecord[]> {
    return [...this.agentRuns].reverse().slice(0, limit);
  }

  async saveMemory(agent: AgentKey, key: string, summary: string, updatedAt: string): Promise<void> {
    this.memory.set(`${agent}|${key}`, { summary, updatedAt });
  }

  async countTasksByStatus(): Promise<Record<TaskStatus, number>> {
    const counts: Record<TaskStatus, number> = {
      pending: 0,
      ready: 0,
      running: 0,
      waiting_approval: 0,
      succeeded: 0,
      failed: 0,
      blocked: 0,
      cancelled: 0,
    };
    for (const t of this.tasks.values()) counts[t.status] += 1;
    return counts;
  }

  async actionFor(taskId: string): Promise<ActionClass | null> {
    return this.tasks.get(taskId)?.actionClass ?? null;
  }
}
