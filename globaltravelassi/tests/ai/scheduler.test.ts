import { describe, it, expect } from "vitest";
import { makeHarness, makeIds, OWNER, AGENT, startInput, clearQualityHolds } from "./helpers";
import { silentLogger } from "@/lib/ai/logging";
import { ForbiddenActorError } from "@/lib/ai/approvals";
import { MemorySchedulerStore } from "@/lib/ai/scheduler/store";
import { SchedulerService, SchedulerInputError, type CycleReport } from "@/lib/ai/scheduler/service";
import {
  DEFAULT_SCHEDULER_SETTINGS,
  formatInZone,
  isLeaseExpired,
  isOverdue,
  isValidTimezone,
  isWorkerStale,
  overdueGraceMs,
  retryDelayMs,
  schedulerSettingsSchema,
  slotFor,
  JOB_RETRY_MAX_MS,
  type SchedulerSettings,
} from "@/lib/ai/scheduler/schedule";

const T0 = "2026-11-20T09:00:00.000Z";
const MIN = 60_000;

const ENABLED: SchedulerSettings = { ...DEFAULT_SCHEDULER_SETTINGS, enabled: true, intervalMinutes: 60, leaseSeconds: 300, maxAttempts: 3 };

/** A scheduler on the harness clock. The cycle defaults to one real orchestrator pass. */
function makeScheduler(h: ReturnType<typeof makeHarness>, options: { store?: MemorySchedulerStore; runCycle?: () => Promise<CycleReport>; deadEvents?: () => Promise<number> } = {}) {
  const store = options.store ?? new MemorySchedulerStore();
  const service = new SchedulerService({
    store,
    runCycle: options.runCycle ?? (async () => ({ ...(await h.orch.tick({ limit: 5 })) })),
    audit: h.audit,
    now: h.clock.now,
    newId: makeIds("sched"),
    logger: silentLogger,
    workerName: "scheduler",
    deadEventDeliveries: options.deadEvents,
  });
  return { store, service };
}

async function enable(store: MemorySchedulerStore, settings: SchedulerSettings = ENABLED, at = T0) {
  await store.saveSettings(settings, "owner-1", at);
}

function auditTypes(h: ReturnType<typeof makeHarness>) {
  return h.audit.events.map((e) => e.type);
}

describe("schedule rules (pure)", () => {
  it("a slot is the same for every instant inside it, and changes at the boundary", () => {
    const a = slotFor(Date.parse("2026-11-20T09:00:00.000Z"), 5);
    const b = slotFor(Date.parse("2026-11-20T09:04:59.999Z"), 5);
    const c = slotFor(Date.parse("2026-11-20T09:05:00.000Z"), 5);
    expect(a.key).toBe(b.key);
    expect(a.key).not.toBe(c.key);
  });

  it("slots are aligned to UTC epoch, so the owner's timezone never shifts them", () => {
    const slot = slotFor(Date.parse("2026-11-20T09:07:31.000Z"), 15);
    expect(new Date(slot.startMs).toISOString()).toBe("2026-11-20T09:00:00.000Z");
    expect(slot.endMs - slot.startMs).toBe(15 * MIN);
  });

  it("retry delays double and stop at the cap", () => {
    expect(retryDelayMs(1)).toBe(MIN);
    expect(retryDelayMs(2)).toBe(2 * MIN);
    expect(retryDelayMs(3)).toBe(4 * MIN);
    expect(retryDelayMs(50)).toBe(JOB_RETRY_MAX_MS);
  });

  it("overdue, lapsed-lease and stale-worker checks use the given instant", () => {
    const now = Date.parse(T0);
    // Grace is one interval. Strictly after it is overdue; exactly at the boundary is not yet.
    expect(isOverdue("2026-11-20T07:59:00.000Z", now, overdueGraceMs(60))).toBe(true);
    expect(isOverdue("2026-11-20T08:00:00.000Z", now, overdueGraceMs(60))).toBe(false);
    expect(isOverdue("2026-11-20T08:59:00.000Z", now, overdueGraceMs(60))).toBe(false);
    expect(isLeaseExpired(null, now)).toBe(true);
    expect(isLeaseExpired("2026-11-20T09:00:00.000Z", now)).toBe(true);
    expect(isLeaseExpired("2026-11-20T09:01:00.000Z", now)).toBe(false);
    expect(isWorkerStale("2026-11-20T08:00:00.000Z", now, 30 * MIN)).toBe(true);
    expect(isWorkerStale("2026-11-20T08:45:00.000Z", now, 30 * MIN)).toBe(false);
  });

  it("the owner's timezone changes how a time is shown, and nothing else", () => {
    // Algiers is UTC+1 all year. The same instant reads 10:00 there.
    expect(formatInZone(T0, "Africa/Algiers")).toContain("10:00");
    expect(formatInZone(T0, "UTC")).toContain("09:00");
    expect(isValidTimezone("Africa/Algiers")).toBe(true);
    expect(isValidTimezone("Mars/Olympus")).toBe(false);
  });

  it("settings are validated against the limits", () => {
    expect(schedulerSettingsSchema.safeParse(DEFAULT_SCHEDULER_SETTINGS).success).toBe(true);
    expect(schedulerSettingsSchema.safeParse({ ...DEFAULT_SCHEDULER_SETTINGS, intervalMinutes: 0 }).success).toBe(false);
    expect(schedulerSettingsSchema.safeParse({ ...DEFAULT_SCHEDULER_SETTINGS, intervalMinutes: 1441 }).success).toBe(false);
    expect(schedulerSettingsSchema.safeParse({ ...DEFAULT_SCHEDULER_SETTINGS, leaseSeconds: 30 }).success).toBe(false);
    expect(schedulerSettingsSchema.safeParse({ ...DEFAULT_SCHEDULER_SETTINGS, maxAttempts: 11 }).success).toBe(false);
    expect(schedulerSettingsSchema.safeParse({ ...DEFAULT_SCHEDULER_SETTINGS, timezone: "Mars/Olympus" }).success).toBe(false);
  });

  it("the scheduler is disabled until the owner turns it on", () => {
    expect(DEFAULT_SCHEDULER_SETTINGS.enabled).toBe(false);
  });
});

describe("persistent job queue: leases, duplicates and fencing", () => {
  const runAt = T0;

  it("nothing is queued while the scheduler is disabled", async () => {
    const store = new MemorySchedulerStore();
    expect(await store.enqueue({ id: "j1", jobKey: "k1", runAt, maxAttempts: 3, nowIso: T0 })).toBe(false);
  });

  it("a slot key is queued once: a duplicate enqueue creates nothing", async () => {
    const store = new MemorySchedulerStore();
    await enable(store);
    expect(await store.enqueue({ id: "j1", jobKey: "k1", runAt, maxAttempts: 3, nowIso: T0 })).toBe(true);
    expect(await store.enqueue({ id: "j2", jobKey: "k1", runAt, maxAttempts: 3, nowIso: T0 })).toBe(false);
    expect((await store.countJobs()).queued).toBe(1);
  });

  it("two concurrent workers never lease the same job", async () => {
    const store = new MemorySchedulerStore();
    await enable(store);
    await store.enqueue({ id: "j1", jobKey: "k1", runAt, maxAttempts: 3, nowIso: T0 });
    const [a, b] = await Promise.all([
      store.lease({ owner: "worker-a", nowIso: T0, leaseSeconds: 300, limit: 1 }),
      store.lease({ owner: "worker-b", nowIso: T0, leaseSeconds: 300, limit: 1 }),
    ]);
    expect(a.leased.length + b.leased.length).toBe(1);
  });

  it("a job whose lease lapsed is reclaimed with one more attempt", async () => {
    const store = new MemorySchedulerStore();
    await enable(store);
    await store.enqueue({ id: "j1", jobKey: "k1", runAt, maxAttempts: 3, nowIso: T0 });
    await store.lease({ owner: "crashed", nowIso: T0, leaseSeconds: 300, limit: 1 });
    const later = new Date(Date.parse(T0) + 301_000).toISOString();
    const r = await store.lease({ owner: "new", nowIso: later, leaseSeconds: 300, limit: 1 });
    expect(r.leased[0]?.leaseOwner).toBe("new");
    expect(r.leased[0]?.attempts).toBe(2);
  });

  it("a lapsed lease after the last allowed attempt becomes a dead letter, not a new run", async () => {
    const store = new MemorySchedulerStore();
    await enable(store);
    await store.enqueue({ id: "j1", jobKey: "k1", runAt, maxAttempts: 1, nowIso: T0 });
    await store.lease({ owner: "crashed", nowIso: T0, leaseSeconds: 300, limit: 1 });
    const later = new Date(Date.parse(T0) + 301_000).toISOString();
    const r = await store.lease({ owner: "new", nowIso: later, leaseSeconds: 300, limit: 1 });
    expect(r.leased).toHaveLength(0);
    expect(r.deadLettered[0]?.status).toBe("dead");
    expect((await store.countJobs()).dead).toBe(1);
  });

  it("a worker that lost its lease cannot complete or fail the job", async () => {
    const store = new MemorySchedulerStore();
    await enable(store);
    await store.enqueue({ id: "j1", jobKey: "k1", runAt, maxAttempts: 3, nowIso: T0 });
    await store.lease({ owner: "slow", nowIso: T0, leaseSeconds: 300, limit: 1 });
    const later = new Date(Date.parse(T0) + 301_000).toISOString();
    await store.lease({ owner: "new", nowIso: later, leaseSeconds: 300, limit: 1 });

    expect(await store.complete({ jobId: "j1", owner: "slow", nowIso: later, result: { stale: true } })).toBe(false);
    expect(await store.fail({ jobId: "j1", owner: "slow", nowIso: later, error: "late", retryAtIso: later })).toBe("lost");
    expect(await store.complete({ jobId: "j1", owner: "new", nowIso: later, result: { ok: true } })).toBe(true);
    const [job] = await store.listJobs(1);
    expect(job?.status).toBe("succeeded");
    expect(job?.result).toEqual({ ok: true });
  });

  it("a failed job is re-queued for later, then dead once its attempts are used up", async () => {
    const store = new MemorySchedulerStore();
    await enable(store);
    await store.enqueue({ id: "j1", jobKey: "k1", runAt, maxAttempts: 2, nowIso: T0 });
    await store.lease({ owner: "w", nowIso: T0, leaseSeconds: 300, limit: 1 });
    const retryAt = new Date(Date.parse(T0) + MIN).toISOString();
    expect(await store.fail({ jobId: "j1", owner: "w", nowIso: T0, error: "boom", retryAtIso: retryAt })).toBe("queued");
    expect((await store.listQueued())[0]?.runAt).toBe(retryAt);

    await store.lease({ owner: "w", nowIso: retryAt, leaseSeconds: 300, limit: 1 });
    expect(await store.fail({ jobId: "j1", owner: "w", nowIso: retryAt, error: "boom again", retryAtIso: retryAt })).toBe("dead");
  });
});

describe("autonomous scheduler service", () => {
  it("a disabled scheduler queues nothing, runs nothing and says so in its heartbeat", async () => {
    const h = makeHarness({ start: T0 });
    const { store, service } = makeScheduler(h);
    let cycles = 0;
    const svc = new SchedulerService({ ...svcDeps(h, store), runCycle: async () => (cycles++, {}) });
    const report = await svc.runOnce();
    expect(report.disabled).toBe(true);
    expect(cycles).toBe(0);
    expect((await store.countJobs()).queued + (await store.countJobs()).succeeded).toBe(0);
    expect((await store.listHeartbeats())[0]?.lastOutcome).toBe("disabled");
    expect(service).toBeDefined();
  });

  it("scheduled execution: the slot is queued, leased, run once, and recorded with its result", async () => {
    const h = makeHarness({ start: T0 });
    const { store, service } = makeScheduler(h);
    await enable(store);
    const report = await service.runOnce();
    expect(report.enqueued).toBe(true);
    expect(report.leased).toBe(1);
    expect(report.succeeded).toBe(1);
    const [job] = await store.listJobs(1);
    expect(job?.status).toBe("succeeded");
    expect(job?.result).toBeTruthy();
    expect(auditTypes(h)).toEqual(expect.arrayContaining(["scheduler.job_enqueued", "scheduler.job_started", "scheduler.job_succeeded"]));
  });

  it("duplicate jobs: a second run in the same slot does not run the cycle again", async () => {
    const h = makeHarness({ start: T0 });
    let cycles = 0;
    const { store, service } = makeScheduler(h, { runCycle: async () => (cycles++, {}) });
    await enable(store);
    await service.runOnce();
    h.clock.advance(5 * MIN);
    const second = await service.runOnce();
    expect(second.enqueued).toBe(false);
    expect(second.leased).toBe(0);
    expect(cycles).toBe(1);
  });

  it("concurrent workers in one slot run the cycle exactly once", async () => {
    const h = makeHarness({ start: T0 });
    let cycles = 0;
    const store = new MemorySchedulerStore();
    await enable(store);
    const make = () => new SchedulerService({ ...svcDeps(h, store), runCycle: async () => (cycles++, {}) });
    await Promise.all([make().runOnce(), make().runOnce(), make().runOnce()]);
    expect(cycles).toBe(1);
  });

  it("automatic retries: a failing cycle is re-queued with backoff and succeeds on the retry", async () => {
    const h = makeHarness({ start: T0 });
    let calls = 0;
    const { store, service } = makeScheduler(h, {
      runCycle: async () => {
        calls += 1;
        if (calls === 1) throw new Error("provider timeout");
        return { ok: 1 };
      },
    });
    await enable(store);
    const first = await service.runOnce();
    expect(first.requeued).toBe(1);
    expect(first.succeeded).toBe(0);

    // Before the retry time nothing is leased.
    const early = await service.runOnce();
    expect(early.leased).toBe(0);

    h.clock.advance(MIN);
    const retry = await service.runOnce();
    expect(retry.succeeded).toBe(1);
    expect((await store.listJobs(1))[0]?.status).toBe("succeeded");
    expect(h.audit.events.some((e) => e.type === "scheduler.job_failed")).toBe(true);
  });

  it("a job that keeps failing ends as a dead letter at the attempt limit", async () => {
    const h = makeHarness({ start: T0 });
    const { store, service } = makeScheduler(h, { runCycle: async () => { throw new Error("down"); } });
    await enable(store, { ...ENABLED, maxAttempts: 2 });
    await service.runOnce();
    h.clock.advance(MIN);
    const second = await service.runOnce();
    expect(second.deadLettered).toBe(1);
    expect((await store.countJobs()).dead).toBe(1);
    expect(auditTypes(h)).toContain("scheduler.job_dead_lettered");
  });

  it("crash recovery: a job left by a crashed worker is taken over after its lease lapses", async () => {
    const h = makeHarness({ start: T0 });
    const store = new MemorySchedulerStore();
    await enable(store);
    await store.enqueue({ id: "crashed-job", jobKey: "cycle:manual", runAt: T0, maxAttempts: 3, nowIso: T0 });
    await store.lease({ owner: "dead-process", nowIso: T0, leaseSeconds: 300, limit: 1 });

    h.clock.advance(6 * MIN);
    let cycles = 0;
    const { service } = makeScheduler(h, { store, runCycle: async () => (cycles++, {}) });
    const report = await service.runOnce();
    expect(report.succeeded).toBeGreaterThanOrEqual(1);
    expect(cycles).toBeGreaterThanOrEqual(1);
    expect(auditTypes(h)).toContain("scheduler.lease_reclaimed");
    expect((await store.listJobs(10)).find((j) => j.id === "crashed-job")?.status).toBe("succeeded");
  });

  it("a crash loop ends as a dead letter instead of running forever", async () => {
    const h = makeHarness({ start: T0 });
    const store = new MemorySchedulerStore();
    await enable(store, { ...ENABLED, maxAttempts: 1 });
    await store.enqueue({ id: "loop-job", jobKey: "cycle:loop", runAt: T0, maxAttempts: 1, nowIso: T0 });
    await store.lease({ owner: "dead-process", nowIso: T0, leaseSeconds: 300, limit: 1 });
    h.clock.advance(6 * MIN);
    let cycles = 0;
    const { service } = makeScheduler(h, { store, runCycle: async () => (cycles++, {}) });
    const report = await service.runOnce();
    expect(report.deadLettered).toBeGreaterThanOrEqual(1);
    expect((await store.listJobs(10)).find((j) => j.id === "loop-job")?.status).toBe("dead");
    // The crashed job never runs again. The current slot is a separate job and runs once, as normal.
    expect(cycles).toBe(1);
  });

  it("the cycle runs the real engine: expired approvals are swept and their tasks cancelled", async () => {
    const h = makeHarness({ start: T0 });
    const { runId } = await h.orch.startWorkflow(startInput({ idempotencyKey: "sched-approval-1" }));
    // The compliance output is held for the owner first. Approving it lets the run reach the publishing approval.
    await clearQualityHolds(h);
    const [approval] = (await h.store.listApprovals("pending")).filter((a) => a.actionClass === "external_publish");
    expect(approval).toBeDefined();

    const { store, service } = makeScheduler(h);
    await enable(store);
    h.clock.advance(25 * 3_600_000);
    const report = await service.runOnce();
    expect(report.cycles.expiredApprovals).toBeGreaterThanOrEqual(1);
    expect((await h.store.getApproval(approval!.id))?.status).toBe("expired");
    const tasks = await h.store.listTasksByRunIds([runId]);
    expect(tasks.some((t) => t.status === "cancelled")).toBe(true);
  });

  it("event dispatch runs inside the cycle, and the report matches what was stored", async () => {
    const h = makeHarness({ start: T0 });
    await h.orch.startWorkflow(startInput({ idempotencyKey: "sched-events-1" }));
    const { store, service } = makeScheduler(h);
    await enable(store);
    const report = await service.runOnce();
    const delivered = (await h.eventStore.countDeliveries()).delivered;
    expect(report.cycles.eventsDelivered).toBe(delivered);
  });

  it("stale running tasks left by an interrupted worker are recovered in the cycle", async () => {
    const h = makeHarness({ start: T0 });
    await h.orch.startWorkflow(startInput({ idempotencyKey: "sched-stale-1" }));
    await h.orch.tick({ limit: 0 }); // readiness pass only: marks dependency-free tasks ready, claims nothing
    const claimed = await h.store.claimReady(T0, 1);
    expect(claimed).toHaveLength(1);
    const taskId = claimed[0]!.id;

    h.clock.advance(16 * MIN);
    const { store, service } = makeScheduler(h);
    await enable(store);
    const report = await service.runOnce();
    expect(report.cycles.recoveredTasks).toBeGreaterThanOrEqual(1);
    expect(auditTypes(h)).toContain("task.recovered");
    expect((await h.store.getTask(taskId))?.status).not.toBe("running");
  });

  it("a stale task that used up its attempts is failed, not retried forever", async () => {
    const h = makeHarness({ start: T0 });
    const { runId } = await h.orch.startWorkflow(startInput({ idempotencyKey: "sched-stale-2" }));
    await h.orch.tick({ limit: 0 });
    const [first] = await h.store.claimReady(T0, 1);
    const taskId = first!.id;
    // Put the task back in the queue with its attempt counter at the limit, then claim it again.
    await h.store.transitionTask(taskId, "running", "ready", { attempts: 99 }, T0);
    const [again] = await h.store.claimReady(T0, 1);
    expect(again?.attempts).toBeGreaterThanOrEqual(again!.maxAttempts);
    h.clock.advance(16 * MIN);
    const recovered = await h.orch.recoverStaleTasks();
    expect(recovered).toBe(1);
    expect((await h.store.getTask(taskId))?.status).toBe("failed");
    expect(runId).toBeTruthy();
    expect(auditTypes(h)).toContain("task.recovery_failed");
  });

  it("overdue tasks are counted by the tick, not changed", async () => {
    const h = makeHarness({ start: T0 });
    await h.orch.startWorkflow(startInput({ workflowKey: "sales", idempotencyKey: "sched-overdue-1" }));
    h.clock.advance(365 * 24 * 3_600_000);
    const report = await h.orch.tick({ limit: 1 });
    expect(report.overdueTasks).toBeGreaterThan(0);
  });

  it("health: a queued slot older than its grace period is overdue, and dead letters are counted", async () => {
    const h = makeHarness({ start: T0 });
    const store = new MemorySchedulerStore();
    await enable(store);
    const { service } = makeScheduler(h, { store, deadEvents: async () => 2 });
    await service.runOnce();
    await store.enqueue({ id: "late", jobKey: "cycle:late", runAt: T0, maxAttempts: 3, nowIso: T0 });
    h.clock.advance(65 * MIN);
    const health = await service.health();
    expect(health.overdue).toBe(1);
    expect(health.status).toBe("overdue");
    expect(health.deadEventDeliveries).toBe(2);
  });

  it("health: an enabled scheduler with no recent worker says so", async () => {
    const h = makeHarness({ start: T0 });
    const store = new MemorySchedulerStore();
    await enable(store);
    const { service } = makeScheduler(h, { store });
    expect((await service.health()).status).toBe("no_recent_worker");
    expect((await service.health()).lastSeenAt).toBeNull();
  });

  it("health: after a run the scheduler reports healthy", async () => {
    const h = makeHarness({ start: T0 });
    const store = new MemorySchedulerStore();
    await enable(store);
    const { service } = makeScheduler(h, { store });
    await service.runOnce();
    expect((await service.health()).status).toBe("healthy");
  });

  it("persistent state: a new service instance on the same store continues the queue", async () => {
    const h = makeHarness({ start: T0 });
    const store = new MemorySchedulerStore();
    await enable(store);
    const before = makeScheduler(h, { store, runCycle: async () => { throw new Error("first process failed"); } });
    await before.service.runOnce();

    // The process restarts. The queued retry and the settings survive in the store.
    h.clock.advance(MIN);
    let cycles = 0;
    const after = makeScheduler(h, { store, runCycle: async () => (cycles++, {}) });
    expect((await after.store.getSettings()).enabled).toBe(true);
    const report = await after.service.runOnce();
    expect(report.succeeded).toBe(1);
    expect(cycles).toBe(1);
  });
});

describe("authorization of scheduler settings", () => {
  it("only the owner can change the schedule", async () => {
    const h = makeHarness({ start: T0 });
    const { service } = makeScheduler(h);
    await expect(service.updateSettings(AGENT, { ...DEFAULT_SCHEDULER_SETTINGS, enabled: true })).rejects.toBeInstanceOf(ForbiddenActorError);
    await expect(service.updateSettings({ kind: "system" }, { ...DEFAULT_SCHEDULER_SETTINGS, enabled: true })).rejects.toBeInstanceOf(ForbiddenActorError);
    await expect(service.updateSettings({ kind: "owner", id: "  " }, { ...DEFAULT_SCHEDULER_SETTINGS, enabled: true })).rejects.toBeInstanceOf(ForbiddenActorError);
  });

  it("invalid settings are refused and nothing is stored", async () => {
    const h = makeHarness({ start: T0 });
    const { store, service } = makeScheduler(h);
    await expect(service.updateSettings(OWNER, { ...DEFAULT_SCHEDULER_SETTINGS, intervalMinutes: 0 })).rejects.toBeInstanceOf(SchedulerInputError);
    expect((await store.getSettings()).enabled).toBe(false);
  });

  it("the owner's change is stored and audited with the changed fields only", async () => {
    const h = makeHarness({ start: T0 });
    const { store, service } = makeScheduler(h);
    await service.updateSettings(OWNER, { ...DEFAULT_SCHEDULER_SETTINGS, enabled: true, intervalMinutes: 15 });
    expect((await store.getSettings()).intervalMinutes).toBe(15);
    const event = h.audit.events.find((e) => e.type === "scheduler.settings_changed");
    expect(event?.actor).toBe("owner:owner-1");
    expect(event?.meta.changed).toEqual({
      enabled: { from: false, to: true },
      intervalMinutes: { from: 5, to: 15 },
    });
  });
});

function svcDeps(h: ReturnType<typeof makeHarness>, store: MemorySchedulerStore) {
  return {
    store,
    runCycle: async () => ({ ...(await h.orch.tick({ limit: 5 })) }),
    audit: h.audit,
    now: h.clock.now,
    newId: makeIds(`s${Math.random().toString(36).slice(2, 7)}`),
    logger: silentLogger,
    workerName: "scheduler",
  };
}
