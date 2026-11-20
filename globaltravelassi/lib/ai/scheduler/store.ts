import { DEFAULT_SCHEDULER_SETTINGS, type SchedulerSettings } from "./schedule";

export type JobStatus = "queued" | "running" | "succeeded" | "failed" | "dead";
export const JOB_STATUSES: readonly JobStatus[] = ["queued", "running", "succeeded", "failed", "dead"];

export interface SchedulerJob {
  id: string;
  jobKey: string;
  kind: "orchestrator_cycle";
  status: JobStatus;
  runAt: string;
  attempts: number;
  maxAttempts: number;
  leaseOwner: string | null;
  leaseExpiresAt: string | null;
  lastError: string | null;
  result: unknown | null;
  createdAt: string;
  updatedAt: string;
  finishedAt: string | null;
}

export interface WorkerHeartbeat {
  workerId: string;
  startedAt: string;
  lastSeenAt: string;
  lastJobId: string | null;
  lastOutcome: string | null;
}

export interface LeaseResult {
  /** Jobs this invocation now owns. Their attempt counter has been incremented. */
  leased: SchedulerJob[];
  /** Jobs whose lease lapsed after their last allowed attempt. They are now dead. */
  deadLettered: SchedulerJob[];
}

export type FailOutcome = "queued" | "dead" | "lost";

/**
 * Persistence for the scheduler. Every write that depends on ownership is fenced: a job can only be completed
 * or failed by the owner that currently holds its lease. The Supabase store implements the same rules in
 * SQL functions (migration 0011), and tests check both implementations against the same scenarios.
 */
export interface SchedulerStore {
  getSettings(): Promise<SchedulerSettings>;
  saveSettings(settings: SchedulerSettings, updatedBy: string, nowIso: string): Promise<void>;
  /** Creates a queued job unless its key already exists. Returns false when the key is taken or the scheduler is disabled. */
  enqueue(job: { id: string; jobKey: string; runAt: string; maxAttempts: number; nowIso: string }): Promise<boolean>;
  /** Atomically leases up to `limit` due jobs and reclaims lapsed leases. Two callers never receive the same job. */
  lease(input: { owner: string; nowIso: string; leaseSeconds: number; limit: number }): Promise<LeaseResult>;
  /** Marks a leased job succeeded. Returns false when the caller no longer holds the lease. */
  complete(input: { jobId: string; owner: string; nowIso: string; result: unknown }): Promise<boolean>;
  /** Re-queues a leased job after `retryAtIso`, or marks it dead when no attempts are left. */
  fail(input: { jobId: string; owner: string; nowIso: string; error: string; retryAtIso: string }): Promise<FailOutcome>;
  heartbeat(input: { workerId: string; nowIso: string; jobId: string | null; outcome: string }): Promise<void>;
  /** Newest first. */
  listJobs(limit: number): Promise<SchedulerJob[]>;
  listQueued(): Promise<SchedulerJob[]>;
  listHeartbeats(): Promise<WorkerHeartbeat[]>;
  countJobs(): Promise<Record<JobStatus, number>>;
}

function emptyCounts(): Record<JobStatus, number> {
  return { queued: 0, running: 0, succeeded: 0, failed: 0, dead: 0 };
}

/** In-memory store with the same rules as the SQL functions. Used by tests and local development. */
export class MemorySchedulerStore implements SchedulerStore {
  private settings: SchedulerSettings = { ...DEFAULT_SCHEDULER_SETTINGS };
  private jobs = new Map<string, SchedulerJob>();
  private beats = new Map<string, WorkerHeartbeat>();
  private settingsUpdates: { updatedBy: string; nowIso: string }[] = [];

  /** Tests read the audit trail of settings changes. */
  get settingsHistory() {
    return [...this.settingsUpdates];
  }

  async getSettings(): Promise<SchedulerSettings> {
    return { ...this.settings };
  }

  async saveSettings(settings: SchedulerSettings, updatedBy: string, nowIso: string): Promise<void> {
    this.settings = { ...settings };
    this.settingsUpdates.push({ updatedBy, nowIso });
  }

  async enqueue(input: { id: string; jobKey: string; runAt: string; maxAttempts: number; nowIso: string }): Promise<boolean> {
    if (!this.settings.enabled) return false;
    if ([...this.jobs.values()].some((j) => j.jobKey === input.jobKey)) return false;
    this.jobs.set(input.id, {
      id: input.id,
      jobKey: input.jobKey,
      kind: "orchestrator_cycle",
      status: "queued",
      runAt: input.runAt,
      attempts: 0,
      maxAttempts: input.maxAttempts,
      leaseOwner: null,
      leaseExpiresAt: null,
      lastError: null,
      result: null,
      createdAt: input.nowIso,
      updatedAt: input.nowIso,
      finishedAt: null,
    });
    return true;
  }

  async lease(input: { owner: string; nowIso: string; leaseSeconds: number; limit: number }): Promise<LeaseResult> {
    const nowMs = Date.parse(input.nowIso);
    const cap = Math.max(1, Math.min(input.limit, 10));
    const candidates = [...this.jobs.values()]
      .filter(
        (j) =>
          (j.status === "queued" && Date.parse(j.runAt) <= nowMs) ||
          (j.status === "running" && (j.leaseExpiresAt === null || Date.parse(j.leaseExpiresAt) <= nowMs)),
      )
      .sort((a, b) => a.runAt.localeCompare(b.runAt) || a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));

    const result: LeaseResult = { leased: [], deadLettered: [] };
    for (const job of candidates) {
      if (result.leased.length >= cap) break;
      if (job.status === "running" && job.attempts >= job.maxAttempts) {
        const dead: SchedulerJob = {
          ...job,
          status: "dead",
          leaseOwner: null,
          leaseExpiresAt: null,
          lastError: "Lease expired after the last allowed attempt.",
          finishedAt: input.nowIso,
          updatedAt: input.nowIso,
        };
        this.jobs.set(job.id, dead);
        result.deadLettered.push(dead);
        continue;
      }
      const leasedJob: SchedulerJob = {
        ...job,
        status: "running",
        leaseOwner: input.owner,
        leaseExpiresAt: new Date(nowMs + input.leaseSeconds * 1000).toISOString(),
        attempts: job.attempts + 1,
        updatedAt: input.nowIso,
      };
      this.jobs.set(job.id, leasedJob);
      result.leased.push(leasedJob);
    }
    return result;
  }

  async complete(input: { jobId: string; owner: string; nowIso: string; result: unknown }): Promise<boolean> {
    const job = this.jobs.get(input.jobId);
    if (!job || job.status !== "running" || job.leaseOwner !== input.owner) return false;
    this.jobs.set(job.id, {
      ...job,
      status: "succeeded",
      result: input.result,
      lastError: null,
      leaseOwner: null,
      leaseExpiresAt: null,
      finishedAt: input.nowIso,
      updatedAt: input.nowIso,
    });
    return true;
  }

  async fail(input: { jobId: string; owner: string; nowIso: string; error: string; retryAtIso: string }): Promise<FailOutcome> {
    const job = this.jobs.get(input.jobId);
    if (!job || job.status !== "running" || job.leaseOwner !== input.owner) return "lost";
    const error = input.error.slice(0, 500);
    if (job.attempts >= job.maxAttempts) {
      this.jobs.set(job.id, {
        ...job,
        status: "dead",
        lastError: error,
        leaseOwner: null,
        leaseExpiresAt: null,
        finishedAt: input.nowIso,
        updatedAt: input.nowIso,
      });
      return "dead";
    }
    this.jobs.set(job.id, {
      ...job,
      status: "queued",
      runAt: input.retryAtIso,
      lastError: error,
      leaseOwner: null,
      leaseExpiresAt: null,
      updatedAt: input.nowIso,
    });
    return "queued";
  }

  async heartbeat(input: { workerId: string; nowIso: string; jobId: string | null; outcome: string }): Promise<void> {
    const current = this.beats.get(input.workerId);
    this.beats.set(input.workerId, {
      workerId: input.workerId,
      startedAt: current?.startedAt ?? input.nowIso,
      lastSeenAt: input.nowIso,
      lastJobId: input.jobId ?? current?.lastJobId ?? null,
      lastOutcome: input.outcome,
    });
  }

  async listJobs(limit: number): Promise<SchedulerJob[]> {
    return [...this.jobs.values()]
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id))
      .slice(0, limit);
  }

  async listQueued(): Promise<SchedulerJob[]> {
    return [...this.jobs.values()].filter((j) => j.status === "queued");
  }

  async listHeartbeats(): Promise<WorkerHeartbeat[]> {
    return [...this.beats.values()].sort((a, b) => b.lastSeenAt.localeCompare(a.lastSeenAt));
  }

  async countJobs(): Promise<Record<JobStatus, number>> {
    const counts = emptyCounts();
    for (const job of this.jobs.values()) counts[job.status] += 1;
    return counts;
  }
}
