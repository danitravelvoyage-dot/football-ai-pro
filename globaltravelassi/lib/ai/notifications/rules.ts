import type { AgentDayPoint } from "../observability/metrics";
import type { SchedulerHealth } from "../scheduler/service";

/**
 * Which conditions produce an owner notice, and how each notice is identified. Pure: no I/O.
 *
 * Every notice has a dedupe key. The same condition in the same window (one task, one day) yields the same
 * key, so repeated checks never flood the owner's inbox.
 */
export const NOTICE_KINDS = ["task_failed", "scheduler_unhealthy", "agent_summary"] as const;
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
