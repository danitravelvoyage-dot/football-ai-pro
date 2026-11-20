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

export interface TaskStore {
  createRun(run: NewRun, tasks: NewTask[]): Promise<{ run: WorkflowRunRecord; created: boolean }>;
  listRuns(limit: number): Promise<WorkflowRunRecord[]>;
  listTasks(filter?: { runId?: string; status?: TaskStatus }): Promise<TaskRecord[]>;
  getTask(id: string): Promise<TaskRecord | null>;
  /** Moves a task from `from` to `to`. Fails if the stored status is not `from` (optimistic concurrency). */
  transitionTask(id: string, from: TaskStatus, to: TaskStatus, patch?: TaskPatch, now?: string): Promise<TaskRecord>;
  /** Atomically moves due `ready` tasks to `running` and increments their attempt counter. */
  claimReady(nowIso: string, limit: number): Promise<TaskRecord[]>;

  saveArtifact(artifact: Omit<ArtifactRecord, "createdAt">): Promise<ArtifactRecord>;
  listArtifacts(limit: number): Promise<ArtifactRecord[]>;

  createApproval(approval: Omit<ApprovalRecord, "createdAt" | "status" | "decidedBy" | "decidedAt" | "decisionNote">): Promise<ApprovalRecord>;
  decideApproval(id: string, decision: "approved" | "rejected", decidedBy: string, note: string | null, decidedAt: string): Promise<ApprovalRecord>;
  getApproval(id: string): Promise<ApprovalRecord | null>;
  listApprovals(status?: ApprovalRecord["status"]): Promise<ApprovalRecord[]>;

  saveAgentRun(run: AgentRunRecord): Promise<void>;
  listAgentRuns(limit: number): Promise<AgentRunRecord[]>;
  saveMemory(agent: AgentKey, key: string, summary: string, updatedAt: string): Promise<void>;
  /** Used by the COO to read counts without loading personal data. */
  countTasksByStatus(): Promise<Record<TaskStatus, number>>;
  actionFor(taskId: string): Promise<ActionClass | null>;
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

  async listTasks(filter: { runId?: string; status?: TaskStatus } = {}): Promise<TaskRecord[]> {
    return [...this.tasks.values()].filter(
      (t) => (!filter.runId || t.runId === filter.runId) && (!filter.status || t.status === filter.status),
    );
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

  async createApproval(input: Omit<ApprovalRecord, "createdAt" | "status" | "decidedBy" | "decidedAt" | "decisionNote">): Promise<ApprovalRecord> {
    const record: ApprovalRecord = {
      ...input,
      status: "pending",
      decidedBy: null,
      decidedAt: null,
      decisionNote: null,
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
    return [...this.approvals.values()].filter((a) => !status || a.status === status);
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
