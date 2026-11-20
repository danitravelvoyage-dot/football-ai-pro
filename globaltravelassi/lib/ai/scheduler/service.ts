import type { AuditSink } from "../audit";
import type { Logger } from "../logging";
import { ForbiddenActorError } from "../approvals";
import type { Actor } from "../types";
import {
  isOverdue,
  isWorkerStale,
  overdueGraceMs,
  retryDelayMs,
  schedulerSettingsSchema,
  slotFor,
  type SchedulerSettings,
} from "./schedule";
import type { JobStatus, SchedulerJob, SchedulerStore, WorkerHeartbeat } from "./store";

/** Jobs one invocation may lease at a time. Each cycle is short; a backlog drains over several invocations. */
export const LEASE_BATCH = 3;
/** A worker is stale after three intervals, but never sooner than this. */
export const MIN_STALE_AFTER_MS = 15 * 60_000;

export class SchedulerInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SchedulerInputError";
  }
}

/** Numbers reported by one orchestration cycle (dispatch, recovery, expiry and task counts). */
export type CycleReport = Record<string, number>;

export interface RunReport {
  disabled: boolean;
  enqueued: boolean;
  leased: number;
  succeeded: number;
  requeued: number;
  deadLettered: number;
  leaseLost: number;
  cycles: CycleReport;
}

export interface SchedulerHealth {
  status: "disabled" | "no_recent_worker" | "overdue" | "healthy";
  enabled: boolean;
  intervalMinutes: number;
  timezone: string;
  leaseSeconds: number;
  maxAttempts: number;
  counts: Record<JobStatus, number>;
  queued: number;
  overdue: number;
  workers: WorkerHeartbeat[];
  lastSeenAt: string | null;
  staleAfterMs: number;
  /** Event deliveries that were dead-lettered. Null when the event store cannot be read. */
  deadEventDeliveries: number | null;
}

export interface SchedulerServiceDeps {
  store: SchedulerStore;
  /** One orchestration cycle: expiry sweep, stale-task recovery, readiness, dispatch. Must be idempotent. */
  runCycle: () => Promise<CycleReport>;
  audit: AuditSink;
  now: () => Date;
  newId: () => string;
  logger: Logger;
  /** Stable name of this scheduler. Shown in the heartbeat table. */
  workerName: string;
  deadEventDeliveries?: () => Promise<number>;
}

/**
 * The scheduler. Each invocation:
 *  1. records a heartbeat,
 *  2. enqueues the current time slot once (idempotent through the slot key),
 *  3. leases due jobs (lapsed leases are reclaimed; crash loops end in dead letters),
 *  4. runs one cycle per job and records the outcome (fenced by the lease owner).
 * Several invocations can run at once: the store guarantees a job is leased by one owner at a time.
 */
export class SchedulerService {
  constructor(private readonly deps: SchedulerServiceDeps) {}

  private nowIso(): string {
    return this.deps.now().toISOString();
  }

  private async audit(type: string, entityId: string, meta: Record<string, unknown>): Promise<void> {
    await this.deps.audit.write({
      id: this.deps.newId(),
      ts: this.nowIso(),
      actor: "system",
      type,
      entityType: "scheduler_job",
      entityId,
      meta,
    });
  }

  async runOnce(): Promise<RunReport> {
    const report: RunReport = { disabled: false, enqueued: false, leased: 0, succeeded: 0, requeued: 0, deadLettered: 0, leaseLost: 0, cycles: {} };
    const invocation = `inv-${this.deps.newId()}`;
    await this.heartbeat("started", null);

    const settings = await this.deps.store.getSettings();
    if (!settings.enabled) {
      report.disabled = true;
      await this.heartbeat("disabled", null);
      return report;
    }

    const nowMs = this.deps.now().getTime();
    const slot = slotFor(nowMs, settings.intervalMinutes);
    report.enqueued = await this.deps.store.enqueue({
      id: this.deps.newId(),
      jobKey: slot.key,
      runAt: new Date(slot.startMs).toISOString(),
      maxAttempts: settings.maxAttempts,
      nowIso: this.nowIso(),
    });
    if (report.enqueued) await this.audit("scheduler.job_enqueued", slot.key, { slotStart: new Date(slot.startMs).toISOString() });

    const lease = await this.deps.store.lease({
      owner: invocation,
      nowIso: this.nowIso(),
      leaseSeconds: settings.leaseSeconds,
      limit: LEASE_BATCH,
    });
    for (const job of lease.deadLettered) {
      report.deadLettered += 1;
      await this.audit("scheduler.job_dead_lettered", job.id, { attempts: job.attempts, reason: "lease_expired" });
    }

    for (const job of lease.leased) {
      report.leased += 1;
      await this.runLeased(job, invocation, report);
    }

    await this.heartbeat(`ran:${report.leased}`, lease.leased.at(-1)?.id ?? null);
    return report;
  }

  private async runLeased(job: SchedulerJob, owner: string, report: RunReport): Promise<void> {
    if (job.attempts > 1) await this.audit("scheduler.lease_reclaimed", job.id, { attempt: job.attempts });
    await this.audit("scheduler.job_started", job.id, { attempt: job.attempts, maxAttempts: job.maxAttempts });

    let cycle: CycleReport;
    try {
      cycle = await this.deps.runCycle();
    } catch (error) {
      await this.failLeased(job, owner, error, report);
      return;
    }

    const completed = await this.deps.store.complete({ jobId: job.id, owner, nowIso: this.nowIso(), result: cycle });
    if (!completed) {
      report.leaseLost += 1;
      await this.audit("scheduler.lease_lost", job.id, { reason: "completed_by_another_owner_or_expired" });
      return;
    }
    report.succeeded += 1;
    for (const [key, value] of Object.entries(cycle)) report.cycles[key] = (report.cycles[key] ?? 0) + value;
    await this.audit("scheduler.job_succeeded", job.id, { attempt: job.attempts, ...cycle });
  }

  private async failLeased(job: SchedulerJob, owner: string, error: unknown, report: RunReport): Promise<void> {
    const name = error instanceof Error ? error.name : "UnknownError";
    const message = `${name}: ${error instanceof Error ? error.message.slice(0, 200) : "cycle failed"}`;
    const retryAt = new Date(this.deps.now().getTime() + retryDelayMs(job.attempts)).toISOString();
    const outcome = await this.deps.store.fail({ jobId: job.id, owner, nowIso: this.nowIso(), error: message, retryAtIso: retryAt });
    this.deps.logger.error("scheduler.job_failed", { jobId: job.id, attempt: job.attempts, outcome });
    if (outcome === "lost") {
      report.leaseLost += 1;
      await this.audit("scheduler.lease_lost", job.id, { reason: "failed_after_lease_was_taken" });
    } else if (outcome === "queued") {
      report.requeued += 1;
      await this.audit("scheduler.job_failed", job.id, { attempt: job.attempts, retryAt, error: message });
    } else {
      report.deadLettered += 1;
      await this.audit("scheduler.job_dead_lettered", job.id, { attempts: job.attempts, error: message });
    }
  }

  private async heartbeat(outcome: string, jobId: string | null): Promise<void> {
    try {
      await this.deps.store.heartbeat({ workerId: this.deps.workerName, nowIso: this.nowIso(), jobId, outcome });
    } catch (error) {
      // A heartbeat that cannot be stored must not stop the work itself. It is logged and the health page shows the gap.
      this.deps.logger.error("scheduler.heartbeat_failed", { reason: error instanceof Error ? error.name : "unknown" });
    }
  }

  /** Owner-only. Validates and stores the schedule, and records which fields changed. */
  async updateSettings(actor: Actor, raw: unknown): Promise<SchedulerSettings> {
    if (actor.kind !== "owner") throw new ForbiddenActorError("Only the owner can change scheduler settings.");
    if (actor.id.trim().length === 0) throw new ForbiddenActorError("The owner identity is missing.");
    const parsed = schedulerSettingsSchema.safeParse(raw);
    if (!parsed.success) throw new SchedulerInputError(parsed.error.issues[0]?.message ?? "Scheduler settings are invalid.");

    const before = await this.deps.store.getSettings();
    await this.deps.store.saveSettings(parsed.data, actor.id, this.nowIso());

    const changed: Record<string, { from: unknown; to: unknown }> = {};
    for (const key of Object.keys(parsed.data) as (keyof SchedulerSettings)[]) {
      if (before[key] !== parsed.data[key]) changed[key] = { from: before[key], to: parsed.data[key] };
    }
    await this.deps.audit.write({
      id: this.deps.newId(),
      ts: this.nowIso(),
      actor: `owner:${actor.id}`,
      type: "scheduler.settings_changed",
      entityType: "scheduler_settings",
      entityId: "singleton",
      meta: { changed },
    });
    return parsed.data;
  }

  /** Read-only health figures for the owner dashboard. Nothing here is estimated: each value comes from stored rows. */
  async health(): Promise<SchedulerHealth> {
    const nowMs = this.deps.now().getTime();
    const settings = await this.deps.store.getSettings();
    const counts = await this.deps.store.countJobs();
    const queued = await this.deps.store.listQueued();
    const workers = await this.deps.store.listHeartbeats();
    const graceMs = overdueGraceMs(settings.intervalMinutes);
    const overdue = queued.filter((j) => isOverdue(j.runAt, nowMs, graceMs)).length;
    const staleAfterMs = Math.max(MIN_STALE_AFTER_MS, settings.intervalMinutes * 3 * 60_000);
    const lastSeenAt = workers[0]?.lastSeenAt ?? null;

    let status: SchedulerHealth["status"] = "healthy";
    if (!settings.enabled) status = "disabled";
    else if (!lastSeenAt || isWorkerStale(lastSeenAt, nowMs, staleAfterMs)) status = "no_recent_worker";
    else if (overdue > 0) status = "overdue";

    let deadEventDeliveries: number | null = null;
    if (this.deps.deadEventDeliveries) {
      try {
        deadEventDeliveries = await this.deps.deadEventDeliveries();
      } catch {
        deadEventDeliveries = null;
      }
    }

    return {
      status,
      enabled: settings.enabled,
      intervalMinutes: settings.intervalMinutes,
      timezone: settings.timezone,
      leaseSeconds: settings.leaseSeconds,
      maxAttempts: settings.maxAttempts,
      counts,
      queued: queued.length,
      overdue,
      workers: workers.slice(0, 5),
      lastSeenAt,
      staleAfterMs,
      deadEventDeliveries,
    };
  }
}

/**
 * A service for reading health only. Its cycle throws if it is ever called, so a read path can never run work.
 * Pages and the monitor use this instead of building a full scheduler.
 */
export function readOnlyScheduler(store: SchedulerStore, now: Date, logger: Logger, deadEventDeliveries?: () => Promise<number>): SchedulerService {
  return new SchedulerService({
    store,
    runCycle: async () => {
      throw new Error("read-only scheduler service");
    },
    audit: { write: async () => undefined },
    now: () => now,
    newId: () => "read-only",
    logger,
    workerName: "monitor",
    deadEventDeliveries,
  });
}
