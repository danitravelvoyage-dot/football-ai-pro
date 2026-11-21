import type { TaskRecord } from "./records";

/**
 * Execution trace of one workflow run. Pure: built from stored tasks and quality reviews. It answers what each agent
 * did, in what order, what it depended on, how many attempts it took, and where agents' claims contradicted each
 * other. It contains no task inputs or outputs, only identifiers, statuses and codes.
 */
export interface ReviewFact {
  taskId: string;
  attempt: number;
  status: string;
  codes: string[];
  createdAt: string;
}

export interface TraceStep {
  taskId: string;
  stepKey: string;
  agent: string;
  status: TaskRecord["status"];
  dependsOn: string[];
  attempts: number;
  maxAttempts: number;
  lastError: string | null;
  quality: { latestStatus: string | null; reviews: number };
  /** Start of the step: the time it became ready (its creation when it had no dependencies). */
  createdAt: string;
  updatedAt: string;
}

export interface TraceConflict {
  taskId: string;
  agent: string;
  attempt: number;
  codes: string[];
}

/** A handoff between two agents in a run. Identifiers and times only: the summary text is not carried into the trace. */
export interface HandoffFact {
  fromAgent: string;
  toAgent: string;
  taskId: string;
  at: string;
}

export interface RunTrace {
  runId: string;
  steps: TraceStep[];
  /** Handoffs whose source task belongs to this run, oldest first. */
  handoffs: HandoffFact[];
  /** Steps whose dependencies are not all succeeded yet, so they are waiting on them. */
  waitingOn: { taskId: string; missing: string[] }[];
  conflicts: TraceConflict[];
  totals: { steps: number; succeeded: number; failed: number; attempts: number };
}

const CONFLICT_CODE = "conflicting_claims";

export function buildRunTrace(runId: string, tasks: TaskRecord[], reviews: ReviewFact[], handoffs: HandoffFact[] = []): RunTrace {
  const run = tasks.filter((t) => t.runId === runId).sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.stepKey.localeCompare(b.stepKey));
  const byId = new Map(run.map((t) => [t.id, t]));
  const reviewsOf = (taskId: string) => reviews.filter((r) => r.taskId === taskId).sort((a, b) => a.attempt - b.attempt);

  const steps: TraceStep[] = run.map((t) => {
    const mine = reviewsOf(t.id);
    return {
      taskId: t.id,
      stepKey: t.stepKey,
      agent: t.agent,
      status: t.status,
      dependsOn: [...t.dependsOn],
      attempts: t.attempts,
      maxAttempts: t.maxAttempts,
      lastError: t.lastError,
      quality: { latestStatus: mine.at(-1)?.status ?? null, reviews: mine.length },
      createdAt: t.createdAt,
      updatedAt: t.updatedAt,
    };
  });

  const waitingOn = run
    .filter((t) => t.status === "pending" || t.status === "blocked" || t.status === "ready")
    .map((t) => ({ taskId: t.id, missing: t.dependsOn.filter((d) => byId.get(d)?.status !== "succeeded") }))
    .filter((w) => w.missing.length > 0);

  const conflicts: TraceConflict[] = reviews
    .filter((r) => byId.has(r.taskId) && r.codes.includes(CONFLICT_CODE))
    .map((r) => ({ taskId: r.taskId, agent: byId.get(r.taskId)!.agent, attempt: r.attempt, codes: r.codes }));

  const runHandoffs = handoffs
    .filter((h) => byId.has(h.taskId))
    .map((h) => ({ fromAgent: h.fromAgent, toAgent: h.toAgent, taskId: h.taskId, at: h.at }))
    .sort((a, b) => a.at.localeCompare(b.at) || a.taskId.localeCompare(b.taskId));

  return {
    runId,
    steps,
    handoffs: runHandoffs,
    waitingOn,
    conflicts,
    totals: {
      steps: run.length,
      succeeded: run.filter((t) => t.status === "succeeded").length,
      failed: run.filter((t) => t.status === "failed").length,
      attempts: run.reduce((sum, t) => sum + t.attempts, 0),
    },
  };
}
