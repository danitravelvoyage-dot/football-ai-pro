import type { SupabaseClient } from "@supabase/supabase-js";
import { DEFAULT_SCHEDULER_SETTINGS, type SchedulerSettings } from "./schedule";
import { JOB_STATUSES, type FailOutcome, type JobStatus, type LeaseResult, type SchedulerJob, type SchedulerStore, type WorkerHeartbeat } from "./store";

type Row = Record<string, unknown>;

function fail(error: { message: string }): never {
  // Database text stays out of the message the caller sees. The scheduler logs only the name.
  throw new Error(`Scheduler store error: ${error.message.slice(0, 200)}`);
}

function toJob(r: Row): SchedulerJob {
  return {
    id: r.id as string,
    jobKey: r.job_key as string,
    kind: r.kind as "orchestrator_cycle",
    status: r.status as JobStatus,
    runAt: r.run_at as string,
    attempts: r.attempts as number,
    maxAttempts: r.max_attempts as number,
    leaseOwner: (r.lease_owner as string | null) ?? null,
    leaseExpiresAt: (r.lease_expires_at as string | null) ?? null,
    lastError: (r.last_error as string | null) ?? null,
    result: r.result ?? null,
    createdAt: r.created_at as string,
    updatedAt: r.updated_at as string,
    finishedAt: (r.finished_at as string | null) ?? null,
  };
}

function toBeat(r: Row): WorkerHeartbeat {
  return {
    workerId: r.worker_id as string,
    startedAt: r.started_at as string,
    lastSeenAt: r.last_seen_at as string,
    lastJobId: (r.last_job_id as string | null) ?? null,
    lastOutcome: (r.last_outcome as string | null) ?? null,
  };
}

/**
 * Scheduler persistence on Supabase. It runs with the signed-in operator's session, so every row-level rule
 * applies. Ownership-sensitive writes go through the SQL functions of migration 0011, which take the lease
 * with `for update skip locked` and fence completions by lease owner.
 */
export class SupabaseSchedulerStore implements SchedulerStore {
  constructor(private readonly db: SupabaseClient) {}

  async getSettings(): Promise<SchedulerSettings> {
    const { data, error } = await this.db.from("ai_scheduler_settings").select("*").eq("id", 1).maybeSingle();
    if (error) fail(error);
    if (!data) return { ...DEFAULT_SCHEDULER_SETTINGS };
    const r = data as Row;
    return {
      enabled: r.enabled as boolean,
      intervalMinutes: r.interval_minutes as number,
      timezone: r.timezone as string,
      leaseSeconds: r.lease_seconds as number,
      maxAttempts: r.max_attempts as number,
    };
  }

  async saveSettings(settings: SchedulerSettings, updatedBy: string, nowIso: string): Promise<void> {
    // The database stamps updated_by from the session and updated_at from the clock. The arguments are kept for the contract.
    void updatedBy;
    void nowIso;
    const { error } = await this.db
      .from("ai_scheduler_settings")
      .update({
        enabled: settings.enabled,
        interval_minutes: settings.intervalMinutes,
        timezone: settings.timezone,
        lease_seconds: settings.leaseSeconds,
        max_attempts: settings.maxAttempts,
      })
      .eq("id", 1);
    if (error) fail(error);
  }

  async enqueue(input: { id: string; jobKey: string; runAt: string; maxAttempts: number; nowIso: string }): Promise<boolean> {
    void input.maxAttempts;
    void input.nowIso;
    const { data, error } = await this.db.rpc("ai_scheduler_enqueue", {
      p_job_key: input.jobKey,
      p_kind: "orchestrator_cycle",
      p_run_at: input.runAt,
      p_id: input.id,
    });
    if (error) fail(error);
    return data === true;
  }

  async lease(input: { owner: string; nowIso: string; leaseSeconds: number; limit: number }): Promise<LeaseResult> {
    const { data, error } = await this.db.rpc("ai_scheduler_lease", {
      p_owner: input.owner,
      p_now: input.nowIso,
      p_lease_seconds: input.leaseSeconds,
      p_limit: input.limit,
    });
    if (error) fail(error);
    const jobs = ((data ?? []) as Row[]).map(toJob);
    return {
      leased: jobs.filter((j) => j.status === "running"),
      deadLettered: jobs.filter((j) => j.status === "dead"),
    };
  }

  async complete(input: { jobId: string; owner: string; nowIso: string; result: unknown }): Promise<boolean> {
    const { data, error } = await this.db.rpc("ai_scheduler_complete", {
      p_job: input.jobId,
      p_owner: input.owner,
      p_now: input.nowIso,
      p_result: input.result,
    });
    if (error) fail(error);
    return data === true;
  }

  async fail(input: { jobId: string; owner: string; nowIso: string; error: string; retryAtIso: string }): Promise<FailOutcome> {
    const { data, error } = await this.db.rpc("ai_scheduler_fail", {
      p_job: input.jobId,
      p_owner: input.owner,
      p_now: input.nowIso,
      p_error: input.error.slice(0, 500),
      p_retry_at: input.retryAtIso,
    });
    if (error) fail(error);
    return data as FailOutcome;
  }

  async heartbeat(input: { workerId: string; nowIso: string; jobId: string | null; outcome: string }): Promise<void> {
    const { error } = await this.db.rpc("ai_worker_heartbeat", {
      p_worker: input.workerId,
      p_now: input.nowIso,
      p_job: input.jobId,
      p_outcome: input.outcome,
    });
    if (error) fail(error);
  }

  async listJobs(limit: number): Promise<SchedulerJob[]> {
    const { data, error } = await this.db.from("ai_scheduler_jobs").select("*").order("created_at", { ascending: false }).limit(limit);
    if (error) fail(error);
    return ((data ?? []) as Row[]).map(toJob);
  }

  async listQueued(): Promise<SchedulerJob[]> {
    const { data, error } = await this.db.from("ai_scheduler_jobs").select("*").eq("status", "queued").order("run_at", { ascending: true }).limit(1000);
    if (error) fail(error);
    return ((data ?? []) as Row[]).map(toJob);
  }

  async listHeartbeats(): Promise<WorkerHeartbeat[]> {
    const { data, error } = await this.db.from("ai_worker_heartbeats").select("*").order("last_seen_at", { ascending: false }).limit(20);
    if (error) fail(error);
    return ((data ?? []) as Row[]).map(toBeat);
  }

  async countJobs(): Promise<Record<JobStatus, number>> {
    const counts = Object.fromEntries(JOB_STATUSES.map((s) => [s, 0])) as Record<JobStatus, number>;
    for (const status of JOB_STATUSES) {
      const { count, error } = await this.db.from("ai_scheduler_jobs").select("id", { count: "exact", head: true }).eq("status", status);
      if (error) fail(error);
      counts[status] = count ?? 0;
    }
    return counts;
  }
}
