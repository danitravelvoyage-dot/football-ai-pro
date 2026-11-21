import { describe, it, expect } from "vitest";
import { makeHarness, makeClock, makeIds, startInput, OWNER, ScriptedProvider } from "./helpers";
import { taskFailedNotice, schedulerNotice, agentSummaryNotice } from "@/lib/ai/notifications/rules";
import { NotificationService, MemoryNotificationStore, NotificationInputError } from "@/lib/ai/notifications/service";
import { postAgentSummary } from "@/lib/ai/notifications/summary";
import { MemoryAuditSink } from "@/lib/ai/audit";
import { ForbiddenActorError } from "@/lib/ai/approvals";
import { MemorySchedulerStore } from "@/lib/ai/scheduler/store";
import { SchedulerService } from "@/lib/ai/scheduler/service";
import { DEFAULT_SCHEDULER_SETTINGS } from "@/lib/ai/scheduler/schedule";
import { silentLogger } from "@/lib/ai/logging";
import type { AgentRunRecord } from "@/lib/ai/orchestration/records";
import type { AgentDayPoint } from "@/lib/ai/observability/metrics";
import type { ProviderConfig } from "@/lib/ai/llm/config";
import type { Notice } from "@/lib/ai/notifications/rules";

const AGENT = { kind: "agent" as const, agent: "SalesAgent" as const };
const T = "2026-11-20T09:00:00.000Z";
const CONFIG: ProviderConfig = { id: "mock", kind: "mock", costTier: "free", enabled: true, ownerApproved: true, dailyRequestLimit: 1_000_000 };

function inbox() {
  const clock = makeClock(T);
  const store = new MemoryNotificationStore();
  const audit = new MemoryAuditSink();
  return { clock, store, audit, svc: new NotificationService({ store, audit, now: clock.now, newId: makeIds("n") }) };
}

const notice = (over: Partial<Notice> = {}): Notice => ({
  dedupeKey: "task_failed:t-1",
  kind: "task_failed",
  severity: "critical",
  title: "Task failed: Draft",
  body: "SalesAgent stopped.",
  subjectRef: "t-1",
  ...over,
});

describe("notice rules (pure)", () => {
  it("a failed task is critical, and its dedupe key is the task", () => {
    const n = taskFailedNotice({ id: "t-9", agent: "SEOAgent", title: "Keywords" }, "Quality rejected the output.");
    expect(n.severity).toBe("critical");
    expect(n.dedupeKey).toBe("task_failed:t-9");
    expect(n.body).toContain("SEOAgent");
  });

  it("overdue scheduled work is a warning, once per day; a healthy scheduler produces no notice", () => {
    expect(schedulerNotice({ status: "overdue", overdue: 2, queued: 3 }, "2026-11-20")?.dedupeKey).toBe("scheduler_unhealthy:overdue:2026-11-20");
    expect(schedulerNotice({ status: "healthy", overdue: 0, queued: 0 }, "2026-11-20")).toBeNull();
    expect(schedulerNotice({ status: "disabled", overdue: 0, queued: 0 }, "2026-11-20")).toBeNull();
  });

  it("the agent summary names agents and counts, flags high failure rates, and is silent with no runs", () => {
    const points: AgentDayPoint[] = [
      { agent: "SalesAgent", day: "2026-11-20", runs: 4, succeeded: 1, failed: 3, failureRate: 0.75 },
      { agent: "SEOAgent", day: "2026-11-20", runs: 2, succeeded: 2, failed: 0, failureRate: 0 },
    ];
    const n = agentSummaryNotice(points, "2026-11-20");
    expect(n?.severity).toBe("warning");
    expect(n?.body).toContain("SalesAgent: 4 run(s), 3 failed");
    expect(agentSummaryNotice([{ agent: "SEOAgent", day: "2026-11-20", runs: 2, succeeded: 2, failed: 0, failureRate: 0 }], "2026-11-20")?.severity).toBe("info");
    expect(agentSummaryNotice([], "2026-11-20")).toBeNull();
  });
});

describe("the owner's inbox", () => {
  it("a repeated notice keeps one row, and the second write reports it was not created", async () => {
    const { svc, store } = inbox();
    expect((await svc.notify(notice())).created).toBe(true);
    expect((await svc.notify(notice())).created).toBe(false);
    expect((await store.list({ limit: 10 })).length).toBe(1);
  });

  it("personal data in a notice is refused and nothing is stored", async () => {
    const { svc, store } = inbox();
    await expect(svc.notify(notice({ body: "Contact the client at client@example.com." }))).rejects.toBeInstanceOf(NotificationInputError);
    expect((await store.list({ limit: 10 })).length).toBe(0);
  });

  it("only the owner reads the inbox or marks a notice read; an agent is refused", async () => {
    const { svc } = inbox();
    await svc.notify(notice());
    await expect(svc.list(AGENT)).rejects.toBeInstanceOf(ForbiddenActorError);
    await expect(svc.markRead(AGENT, "x")).rejects.toBeInstanceOf(ForbiddenActorError);
    const [row] = await svc.list(OWNER);
    expect(row?.readAt).toBeNull();
    expect(await svc.markRead(OWNER, row!.id)).toBe(true);
    expect(await svc.markRead(OWNER, row!.id)).toBe(false);
  });

  it("a daily agent summary is written once per day", async () => {
    const { svc, store } = inbox();
    const run = (agent: string, status: "succeeded" | "failed"): AgentRunRecord => ({
      id: `r-${agent}-${status}-${Math.random()}`, taskId: "t", agent: agent as AgentRunRecord["agent"], attempt: 1, promptVersion: "1", providerId: "mock",
      status, tokensIn: 1, tokensOut: 1, durationMs: 5, error: null, startedAt: T, finishedAt: T,
    });
    const runs = [run("SalesAgent", "failed"), run("SalesAgent", "succeeded")];
    expect(await postAgentSummary(runs, svc, new Date(T))).toBe(true);
    expect(await postAgentSummary(runs, svc, new Date(T))).toBe(false);
    expect((await store.list({ limit: 10 })).filter((n) => n.kind === "agent_summary").length).toBe(1);
  });
});

describe("notices raised by the platform", () => {
  it("a task that fails terminally notifies the owner once, and the task is still failed", async () => {
    const notices: Notice[] = [];
    const h = makeHarness({
      start: T,
      providers: [{ config: CONFIG, provider: new ScriptedProvider("mock", async () => "this is not a JSON object") }],
      notify: async (n) => (notices.push(n), { created: true }),
    });
    const { runId } = await h.orch.startWorkflow(startInput({ idempotencyKey: "notify-run-0001" }));
    for (let i = 0; i < 20; i++) {
      const r = await h.orch.tick({ limit: 10 });
      if (r.claimed === 0) break;
    }
    const tasks = await h.store.listTasksByRunIds([runId]);
    expect(tasks.some((t) => t.status === "failed")).toBe(true);
    const failures = notices.filter((n) => n.kind === "task_failed");
    expect(failures.length).toBeGreaterThan(0);
    expect(failures[0]?.severity).toBe("critical");
  });

  it("an overdue scheduler notifies the owner, and the run itself still completes", async () => {
    const clock = makeClock(T);
    const store = new MemorySchedulerStore();
    await store.saveSettings({ ...DEFAULT_SCHEDULER_SETTINGS, enabled: true, intervalMinutes: 60, leaseSeconds: 300, maxAttempts: 3 }, "owner-1", T);
    for (let i = 0; i < 6; i++) {
      await store.enqueue({ id: `old-${i}`, jobKey: `cycle:old-${i}`, runAt: T, maxAttempts: 3, nowIso: T });
    }
    clock.advance(65 * 60_000);
    const notices: Notice[] = [];
    const svc = new SchedulerService({
      store,
      runCycle: async () => ({}),
      audit: new MemoryAuditSink(),
      now: clock.now,
      newId: makeIds("s"),
      logger: silentLogger,
      workerName: "scheduler",
      notify: async (n) => (notices.push(n), { created: true }),
    });
    const report = await svc.runOnce();
    expect(report.succeeded).toBeGreaterThan(0);
    expect(notices.map((n) => n.kind)).toContain("scheduler_unhealthy");
  });
});
