/**
 * Observability calculations. Pure functions over records the platform already stores.
 * Anything the platform does not record is returned as null with a reason. No value is estimated.
 */

export interface TaskSample {
  id: string;
  agent: string;
  status: string;
  attempts: number;
  updatedAt: string;
  runId: string;
}

export interface RunSample {
  agent: string;
  status: "succeeded" | "failed";
  durationMs: number;
  finishedAt: string;
  tokensIn: number;
  tokensOut: number;
  providerId: string | null;
}

export interface ReviewSample {
  agent: string;
  status: string;
  overall: number;
}

export interface UsageSample {
  providerId: string;
  requests: number;
  tokens: number;
}

export const STALL_MINUTES = 60;
export const REPEATED_FAILURE_THRESHOLD = 3;
export const FAILING_RATE = 0.5;
const ACTIVE = ["ready", "running", "waiting_approval"];

export type LiveStatus = "idle" | "working" | "stalled" | "failing";

export interface AgentRow {
  agent: string;
  liveStatus: LiveStatus;
  active: number;
  completed: number;
  failed: number;
  retries: number;
  lastActivity: string | null;
  runs: number;
  failureRate: number | null;
  averageDurationMs: number | null;
  workloadShare: number | null;
}

function ms(iso: string): number {
  return Date.parse(iso);
}

/** One row per agent that has any task or run, plus live status derived from recent activity. */
export function agentBoard(tasks: TaskSample[], runs: RunSample[], now: Date): AgentRow[] {
  const agents = new Set([...tasks.map((t) => t.agent), ...runs.map((r) => r.agent)]);
  const totalTasks = tasks.length;
  const rows: AgentRow[] = [];
  for (const agent of [...agents].sort()) {
    const mine = tasks.filter((t) => t.agent === agent);
    const myRuns = runs.filter((r) => r.agent === agent);
    const active = mine.filter((t) => ACTIVE.includes(t.status)).length;
    const completed = mine.filter((t) => t.status === "succeeded").length;
    const failed = mine.filter((t) => t.status === "failed").length;
    const retries = mine.reduce((sum, t) => sum + Math.max(0, t.attempts - 1), 0);
    const failedRuns = myRuns.filter((r) => r.status === "failed").length;
    const failureRate = myRuns.length > 0 ? failedRuns / myRuns.length : null;
    const succeededRuns = myRuns.filter((r) => r.status === "succeeded");
    const lastActivity = [...mine.map((t) => t.updatedAt), ...myRuns.map((r) => r.finishedAt)].sort().at(-1) ?? null;
    const idleFor = lastActivity ? (now.getTime() - ms(lastActivity)) / 60_000 : Infinity;

    let liveStatus: LiveStatus = "idle";
    if (myRuns.length >= REPEATED_FAILURE_THRESHOLD && failureRate !== null && failureRate >= FAILING_RATE) liveStatus = "failing";
    else if (active > 0 && idleFor > STALL_MINUTES) liveStatus = "stalled";
    else if (active > 0) liveStatus = "working";

    rows.push({
      agent,
      liveStatus,
      active,
      completed,
      failed,
      retries,
      lastActivity,
      runs: myRuns.length,
      failureRate,
      averageDurationMs: succeededRuns.length > 0 ? Math.round(succeededRuns.reduce((s, r) => s + r.durationMs, 0) / succeededRuns.length) : null,
      workloadShare: totalTasks > 0 ? mine.length / totalTasks : null,
    });
  }
  return rows;
}

export interface Performance {
  tasksCompleted: number;
  tasksFailed: number;
  successRate: number | null;
  averageExecutionMs: number | null;
  revisionRate: number | null;
  outputQualityScore: number | null;
}

export function performance(tasks: TaskSample[], runs: RunSample[], reviews: ReviewSample[]): Performance {
  const completed = tasks.filter((t) => t.status === "succeeded").length;
  const failed = tasks.filter((t) => t.status === "failed").length;
  const succeededRuns = runs.filter((r) => r.status === "succeeded");
  return {
    tasksCompleted: completed,
    tasksFailed: failed,
    successRate: completed + failed > 0 ? completed / (completed + failed) : null,
    averageExecutionMs: succeededRuns.length > 0 ? Math.round(succeededRuns.reduce((s, r) => s + r.durationMs, 0) / succeededRuns.length) : null,
    revisionRate: reviews.length > 0 ? reviews.filter((r) => r.status === "NEEDS_REVISION").length / reviews.length : null,
    outputQualityScore: reviews.length > 0 ? Math.round(reviews.reduce((s, r) => s + r.overall, 0) / reviews.length) : null,
  };
}

export interface UsageSummary {
  providers: UsageSample[];
  tokensIn: number;
  tokensOut: number;
  /** Null: the platform keeps no price table. The reason is shown instead of a number. */
  estimatedCost: null;
  estimatedCostReason: "no_price_table";
}

export function usageSummary(usage: UsageSample[], runs: RunSample[]): UsageSummary {
  return {
    providers: usage,
    tokensIn: runs.reduce((s, r) => s + r.tokensIn, 0),
    tokensOut: runs.reduce((s, r) => s + r.tokensOut, 0),
    estimatedCost: null,
    estimatedCostReason: "no_price_table",
  };
}

export interface Alert {
  kind: "repeated_agent_failures" | "stalled_work";
  subject: string;
  count: number;
}

/** Alerts from the current state. Thresholds are the constants above. */
export function alertsFor(board: AgentRow[], tasks: TaskSample[], runs: RunSample[], now: Date): Alert[] {
  const alerts: Alert[] = [];
  for (const row of board) {
    const failedRuns = runs.filter((r) => r.agent === row.agent && r.status === "failed").length;
    if (failedRuns >= REPEATED_FAILURE_THRESHOLD) alerts.push({ kind: "repeated_agent_failures", subject: row.agent, count: failedRuns });
  }
  const stalled = tasks.filter((t) => ACTIVE.includes(t.status) && (now.getTime() - ms(t.updatedAt)) / 60_000 > STALL_MINUTES);
  if (stalled.length > 0) alerts.push({ kind: "stalled_work", subject: "tasks", count: stalled.length });
  return alerts;
}

/** Scheduler figures as the scheduler service reports them. Null when they could not be read. */
export interface SchedulerFigures {
  status: "disabled" | "no_recent_worker" | "overdue" | "healthy";
  enabled: boolean;
  queued: number;
  overdue: number;
  deadJobs: number;
  lastSeenAt: string | null;
}

export interface Health {
  eventBus: { pending: number; delivered: number; deadLetters: number };
  deadLetterQueue: number;
  database: { ok: boolean; latencyMs: number | null };
  /** Null means the scheduler figures could not be read. The dashboard says so instead of inventing a value. */
  scheduler: SchedulerFigures | null;
  workflows: { total: number; withFailures: number };
  agentErrorRate: number | null;
}

export function health(input: {
  deliveries: { pending: number; delivered: number; dead: number };
  database: { ok: boolean; latencyMs: number | null };
  runs: RunSample[];
  workflowsWithFailures: number;
  workflowsTotal: number;
  scheduler: SchedulerFigures | null;
}): Health {
  const failed = input.runs.filter((r) => r.status === "failed").length;
  return {
    eventBus: { pending: input.deliveries.pending, delivered: input.deliveries.delivered, deadLetters: input.deliveries.dead },
    deadLetterQueue: input.deliveries.dead,
    database: input.database,
    scheduler: input.scheduler,
    workflows: { total: input.workflowsTotal, withFailures: input.workflowsWithFailures },
    agentErrorRate: input.runs.length > 0 ? failed / input.runs.length : null,
  };
}
