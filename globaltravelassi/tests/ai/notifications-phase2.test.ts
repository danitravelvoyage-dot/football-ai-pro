import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { makeClock, makeIds, OWNER, makeHarness } from "./helpers";
import { NotificationService, MemoryNotificationStore } from "@/lib/ai/notifications/service";
import { schedulerMissingNotice, ownerReportNotice } from "@/lib/ai/notifications/rules";
import { postOwnerReport } from "@/lib/ai/notifications/report";
import { authorizeTrigger, MIN_TRIGGER_SECRET_LENGTH } from "@/lib/ai/scheduler/auth";
import { MemoryAuditSink } from "@/lib/ai/audit";
import { MemorySchedulerStore } from "@/lib/ai/scheduler/store";
import { SchedulerService } from "@/lib/ai/scheduler/service";
import { DEFAULT_SCHEDULER_SETTINGS } from "@/lib/ai/scheduler/schedule";
import { silentLogger } from "@/lib/ai/logging";
import type { AgentRunRecord } from "@/lib/ai/orchestration/records";

const T = "2026-11-20T09:00:00.000Z";
const AGENT = { kind: "agent" as const, agent: "SalesAgent" as const };

function inbox() {
  const clock = makeClock(T);
  const store = new MemoryNotificationStore();
  const svc = new NotificationService({ store, audit: new MemoryAuditSink(), now: clock.now, newId: makeIds("n") });
  return { clock, store, svc };
}

const n = (key: string, severity: "info" | "warning" | "critical", kind: "task_failed" | "owner_report" = "task_failed") => ({
  dedupeKey: key, kind, severity, title: `Notice ${key}`, body: "Body.", subjectRef: null,
});

describe("inbox filtering and unread counts", () => {
  it("filters by severity and kind, and counts unread notices", async () => {
    const { svc, clock } = inbox();
    await svc.notify(n("a", "critical"));
    clock.advance(1000);
    await svc.notify(n("b", "info", "owner_report"));
    clock.advance(1000);
    await svc.notify(n("c", "warning"));

    expect((await svc.list(OWNER, { severity: "critical" })).map((r) => r.dedupeKey)).toEqual(["a"]);
    expect((await svc.list(OWNER, { kind: "owner_report" })).map((r) => r.dedupeKey)).toEqual(["b"]);
    expect((await svc.list(OWNER)).map((r) => r.dedupeKey)).toEqual(["c", "b", "a"]);
    expect(await svc.unreadCount(OWNER)).toBe(3);
  });

  it("marking a notice read lowers the unread count, and the unread filter drops it", async () => {
    const { svc } = inbox();
    await svc.notify(n("a", "critical"));
    await svc.notify(n("b", "info"));
    const [first] = await svc.list(OWNER, { severity: "critical" });
    expect(await svc.markRead(OWNER, first!.id)).toBe(true);
    expect(await svc.unreadCount(OWNER)).toBe(1);
    expect((await svc.list(OWNER, { unreadOnly: true })).map((r) => r.dedupeKey)).toEqual(["b"]);
  });

  it("an agent cannot read the unread count", async () => {
    const { svc } = inbox();
    await expect(svc.unreadCount(AGENT)).rejects.toThrow();
  });
});

describe("missing-worker and owner-report rules", () => {
  it("a scheduler with no recent worker is critical, once a day", () => {
    const notice = schedulerMissingNotice({ status: "no_recent_worker", lastSeenAt: null }, "2026-11-20");
    expect(notice).toMatchObject({ severity: "critical", dedupeKey: "scheduler_missing:2026-11-20", kind: "scheduler_missing" });
    expect(notice?.body).toContain("never reported");
  });

  it("a healthy, overdue or disabled scheduler does not raise the missing-worker alert", () => {
    for (const status of ["healthy", "overdue", "disabled"] as const) {
      expect(schedulerMissingNotice({ status, lastSeenAt: T }, "2026-11-20")).toBeNull();
    }
  });

  it("the owner report is information on a quiet day and a warning when something failed or needs attention", () => {
    const quiet = ownerReportNotice({ runsToday: 4, failedToday: 0, unreadNotices: 2, schedulerStatus: "healthy" }, "2026-11-20");
    const failing = ownerReportNotice({ runsToday: 4, failedToday: 1, unreadNotices: 2, schedulerStatus: "healthy" }, "2026-11-20");
    const stale = ownerReportNotice({ runsToday: 0, failedToday: 0, unreadNotices: 0, schedulerStatus: "overdue" }, "2026-11-20");
    expect(quiet.severity).toBe("info");
    expect(failing.severity).toBe("warning");
    expect(stale.severity).toBe("warning");
    expect(quiet.body).toContain("Agent runs: 4 (0 failed)");
  });

  it("the owner report is written once per day, counting only today's runs", async () => {
    const { svc } = inbox();
    const run = (status: "succeeded" | "failed", finishedAt: string): AgentRunRecord => ({
      id: `r-${Math.random()}`, taskId: "t", agent: "SalesAgent", attempt: 1, promptVersion: "1", providerId: "mock",
      status, tokensIn: 1, tokensOut: 1, durationMs: 5, error: null, startedAt: finishedAt, finishedAt,
    });
    const runs = [run("failed", T), run("succeeded", T), run("succeeded", "2026-11-19T10:00:00.000Z")];
    expect(await postOwnerReport(runs, svc, "healthy", new Date(T))).toBe(true);
    expect(await postOwnerReport(runs, svc, "healthy", new Date(T))).toBe(false);
    const [report] = await svc.list(OWNER, { kind: "owner_report" });
    expect(report?.body).toContain("Agent runs: 2 (1 failed)");
  });

  it("a scheduler run writes the owner report through its callback", async () => {
    const h = makeHarness({ start: T });
    const store = new MemorySchedulerStore();
    await store.saveSettings({ ...DEFAULT_SCHEDULER_SETTINGS, enabled: true, intervalMinutes: 60 }, "owner-1", T);
    const statuses: string[] = [];
    const svc = new SchedulerService({
      store,
      runCycle: async () => ({}),
      audit: h.audit,
      now: h.clock.now,
      newId: makeIds("s"),
      logger: silentLogger,
      workerName: "scheduler",
      ownerReport: async (status) => (statuses.push(status), true),
    });
    await svc.runOnce();
    expect(statuses).toEqual(["healthy"]);
  });
});

describe("trigger authentication (shared)", () => {
  const SECRET = "s".repeat(MIN_TRIGGER_SECRET_LENGTH);
  it("refuses when the secret is missing or shorter than the minimum", () => {
    expect(authorizeTrigger(`Bearer ${SECRET}`, undefined)).toEqual({ ok: false, status: 503, code: "not_configured" });
    expect(authorizeTrigger(`Bearer short`, "short")).toEqual({ ok: false, status: 503, code: "not_configured" });
  });

  it("refuses a missing, malformed or wrong bearer, and accepts the right one", () => {
    expect(authorizeTrigger(null, SECRET)).toMatchObject({ ok: false, status: 401 });
    expect(authorizeTrigger(`Basic ${SECRET}`, SECRET)).toMatchObject({ ok: false, status: 401 });
    expect(authorizeTrigger(`Bearer ${"x".repeat(MIN_TRIGGER_SECRET_LENGTH)}`, SECRET)).toMatchObject({ ok: false, status: 401 });
    expect(authorizeTrigger(`Bearer ${SECRET}`, SECRET)).toEqual({ ok: true });
  });
});

describe("watchdog route", () => {
  const { runWatchdogOnce } = vi.hoisted(() => ({ runWatchdogOnce: vi.fn() }));
  vi.mock("server-only", () => ({}));
  vi.mock("@/lib/ai/scheduler/worker", () => ({ runWatchdogOnce, runSchedulerOnce: vi.fn() }));

  let saved: string | undefined;
  beforeEach(() => {
    saved = process.env.AI_SCHEDULER_SECRET;
    process.env.AI_SCHEDULER_SECRET = "w".repeat(40);
    runWatchdogOnce.mockReset();
    runWatchdogOnce.mockResolvedValue({ ok: true, schedulerStatus: "no_recent_worker", notified: true });
  });
  afterEach(() => {
    if (saved === undefined) delete process.env.AI_SCHEDULER_SECRET;
    else process.env.AI_SCHEDULER_SECRET = saved;
  });

  it("is refused without the secret and runs only with it", async () => {
    const { POST } = await import("@/app/api/ai/scheduler/watchdog/route");
    const denied = await POST(new Request("http://localhost/api/ai/scheduler/watchdog", { method: "POST" }));
    expect(denied.status).toBe(401);
    expect(runWatchdogOnce).not.toHaveBeenCalled();

    const ok = await POST(new Request("http://localhost/api/ai/scheduler/watchdog", { method: "POST", headers: { authorization: `Bearer ${"w".repeat(40)}` } }));
    expect(ok.status).toBe(200);
    expect(await ok.json()).toEqual({ ok: true, schedulerStatus: "no_recent_worker", notified: true });
  });
});
