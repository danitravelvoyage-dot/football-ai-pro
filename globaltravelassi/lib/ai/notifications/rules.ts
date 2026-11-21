import type { AgentDayPoint } from "../observability/metrics";
import type { SchedulerHealth } from "../scheduler/service";

/**
 * Which conditions produce an owner notice, and how each notice is identified. Pure: no I/O.
 *
 * Every notice has a dedupe key. The same condition in the same window (one task, one day) yields the same
 * key, so repeated checks never flood the owner's inbox.
 */
export const NOTICE_KINDS = ["task_failed", "scheduler_unhealthy", "scheduler_missing", "agent_summary", "owner_report", "sales_report", "marketing_report", "customer_alerts", "strategy_recommendations"] as const;
export type NoticeKind = (typeof NOTICE_KINDS)[number];
export type Severity = "info" | "warning" | "critical";

export interface Notice {
  dedupeKey: string;
  kind: NoticeKind;
  severity: Severity;
  title: string;
  body: string;
  subjectRef: string | null;
}

/** A failed task is always critical: its work stopped and something downstream may be waiting for it. */
export function taskFailedNotice(task: { id: string; agent: string; title: string }, reason: string): Notice {
  return {
    dedupeKey: `task_failed:${task.id}`,
    kind: "task_failed",
    severity: "critical",
    title: `Task failed: ${task.title}`.slice(0, 160),
    body: `${task.agent} stopped. ${reason}`.slice(0, 1000),
    subjectRef: task.id,
  };
}

/**
 * Overdue work is a warning, once per day. A scheduler that is healthy or disabled produces no notice.
 * The scheduler reports only what it can see from inside a run. A worker that never runs is detected by
 * an independent check, not by the scheduler itself.
 */
export function schedulerNotice(health: Pick<SchedulerHealth, "status" | "overdue" | "queued">, dayKey: string): Notice | null {
  if (health.status !== "overdue") return null;
  return {
    dedupeKey: `scheduler_unhealthy:overdue:${dayKey}`,
    kind: "scheduler_unhealthy",
    severity: "warning",
    title: "Scheduled work is overdue",
    body: `${health.overdue} scheduled slot(s) are overdue and ${health.queued} are queued. Check the scheduler page.`,
    subjectRef: "scheduler",
  };
}

/** Failure rate at or above this share of runs in one day is reported as a warning. */
export const SUMMARY_FAILURE_WARNING = 0.25;

/**
 * A daily summary of agent runs. Returns null when there were no runs: no runs is not a finding.
 * The body names agents and counts only. No task content, prompts or outputs.
 */
export function agentSummaryNotice(points: AgentDayPoint[], dayKey: string): Notice | null {
  const today = points.filter((p) => p.day === dayKey && p.runs > 0);
  if (today.length === 0) return null;
  const failing = today.filter((p) => (p.failureRate ?? 0) >= SUMMARY_FAILURE_WARNING);
  const lines = today.map((p) => `${p.agent}: ${p.runs} run(s), ${p.failed} failed`);
  return {
    dedupeKey: `agent_summary:${dayKey}`,
    kind: "agent_summary",
    severity: failing.length > 0 ? "warning" : "info",
    title: `Agent summary for ${dayKey}`,
    body: lines.join("; ").slice(0, 1000),
    subjectRef: null,
  };
}

/**
 * No worker has run recently while the scheduler is enabled. Raised by the independent watchdog, which does not
 * depend on the scheduler it checks. Critical, once per day.
 */
export function schedulerMissingNotice(health: Pick<SchedulerHealth, "status" | "lastSeenAt">, dayKey: string): Notice | null {
  if (health.status !== "no_recent_worker") return null;
  return {
    dedupeKey: `scheduler_missing:${dayKey}`,
    kind: "scheduler_missing",
    severity: "critical",
    title: "The scheduler has not run recently",
    body: health.lastSeenAt
      ? `The last scheduler run was at ${health.lastSeenAt}. Scheduled work is not being processed. Check the external trigger.`
      : "The scheduler has never reported a run. Check the external trigger and the scheduler settings.",
    subjectRef: "scheduler",
  };
}

export interface OwnerReportInput {
  runsToday: number;
  failedToday: number;
  unreadNotices: number;
  schedulerStatus: SchedulerHealth["status"];
}

/**
 * The scheduled owner report for one day. Counts only. Warning when something failed or needs attention,
 * otherwise information.
 */
export function ownerReportNotice(input: OwnerReportInput, dayKey: string): Notice {
  const attention = input.failedToday > 0 || input.unreadNotices > 10 || (input.schedulerStatus !== "healthy" && input.schedulerStatus !== "disabled");
  return {
    dedupeKey: `owner_report:${dayKey}`,
    kind: "owner_report",
    severity: attention ? "warning" : "info",
    title: `Owner report for ${dayKey}`,
    body: `Agent runs: ${input.runsToday} (${input.failedToday} failed). Unread notices: ${input.unreadNotices}. Scheduler: ${input.schedulerStatus}.`,
    subjectRef: null,
  };
}
