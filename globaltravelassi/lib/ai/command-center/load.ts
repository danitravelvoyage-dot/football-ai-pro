import "server-only";
import { createServerSupabase } from "@/lib/supabase/server";
import { SupabaseTaskStore } from "../store/supabase-store";
import { buildExecutiveReport, verifyReportHonesty, type ExecutiveReport } from "../coo";
import type { ApprovalRecord, TaskRecord, WorkflowRunRecord } from "../orchestration/records";
import type { TaskStatus } from "../types";
import { consoleLogger } from "../logging";
import { classifyLoadError, type LoadErrorKind } from "./view";
import { SupabaseEventStore } from "../store/supabase-event-store";
import { SupabaseQualityStore } from "../store/supabase-quality-store";
import { buildRunTrace, type HandoffFact, type ReviewFact, type RunTrace } from "../orchestration/trace";

/** Workflow runs shown in detail. Totals in `counts` always cover every task, whatever this limit. */
export const RUN_LIMIT = 200;
/** Decided approvals shown in the dashboard history. Older decisions stay in the audit log. */
const HISTORY_LIMIT = 50;
/** Failed tasks listed by name. The exact number of failed tasks is in `counts`. */
const FAILED_LIMIT = 50;
/** Runs whose execution trace is shown. Each trace reads its tasks' reviews, so this stays small. */
export const TRACE_RUN_LIMIT = 3;
/** Handoff events read for the traces. The newest ones are the ones shown. */
const HANDOFF_EVENT_LIMIT = 500;

export interface CommandCenterData {
  status: "ok";
  /** Exact counts per status over every task. */
  counts: Record<TaskStatus, number>;
  /** Every task of the latest runs, plus the newest failed tasks. */
  tasks: TaskRecord[];
  approvals: ApprovalRecord[];
  runs: WorkflowRunRecord[];
  report: ExecutiveReport;
  /** Problems found by verifyReportHonesty. An empty list means the summary is clean. */
  honestyProblems: string[];
  /** True when there are more runs than RUN_LIMIT, so detail views cover only the latest ones. */
  runsTruncated: boolean;
  /** Execution traces of the newest runs: steps, dependencies, reviews, conflicts and handoffs. */
  traces: RunTrace[];
}

export type CommandCenterState = CommandCenterData | { status: LoadErrorKind };

/**
 * Reads the command-center data with the signed-in admin's session. Row-level security applies.
 * Never throws: a failure becomes a state the pages render without showing raw database messages.
 */
export async function loadCommandCenter(now: Date = new Date()): Promise<CommandCenterState> {
  try {
    const db = await createServerSupabase();
    const store = new SupabaseTaskStore(db);
    const [counts, approvals, runs, failed] = await Promise.all([
      store.countTasksByStatus(),
      loadApprovals(store),
      store.listRuns(RUN_LIMIT),
      store.listTasksPage({ status: "failed", limit: FAILED_LIMIT }),
    ]);
    const runTasks = await store.listTasksByRunIds(runs.map((r) => r.id));
    const tasks = mergeTasks(runTasks, failed.items);
    const report = buildExecutiveReport({ now, tasks, approvals, counts });
    const traces = await loadTraces(db, runs.slice(0, TRACE_RUN_LIMIT), tasks);
    return {
      status: "ok",
      counts,
      tasks,
      approvals,
      runs,
      report,
      honestyProblems: verifyReportHonesty(report),
      runsTruncated: runs.length >= RUN_LIMIT,
      traces,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const kind = classifyLoadError(message);
    consoleLogger.error("command_center.load_failed", { kind });
    return { status: kind };
  }
}

/** Every pending approval, plus a bounded page of decided history. Pending items are never cut off. */
async function loadApprovals(store: SupabaseTaskStore): Promise<ApprovalRecord[]> {
  const [pending, history] = await Promise.all([
    store.listApprovals("pending"),
    store.listApprovalsPage({ limit: HISTORY_LIMIT }),
  ]);
  return [...pending, ...history.items.filter((a) => a.status !== "pending")];
}

/** Union by id, keeping the first occurrence. Both inputs are already exact for their scope. */
export function mergeTasks(...lists: TaskRecord[][]): TaskRecord[] {
  const byId = new Map<string, TaskRecord>();
  for (const list of lists) for (const task of list) if (!byId.has(task.id)) byId.set(task.id, task);
  return [...byId.values()];
}

/**
 * Builds the execution trace of each run. Reviews are read per task, and handoffs from the event log, which is kept
 * by correlation id (the run id). Only the newest handoff events are read.
 */
async function loadTraces(db: Awaited<ReturnType<typeof createServerSupabase>>, runs: WorkflowRunRecord[], tasks: TaskRecord[]): Promise<RunTrace[]> {
  if (runs.length === 0) return [];
  const runIds = new Set(runs.map((r) => r.id));
  const inRuns = tasks.filter((t) => runIds.has(t.runId));
  const quality = new SupabaseQualityStore(db);
  const reviewLists = await Promise.all(inRuns.map((t) => quality.reviewsForTask(t.id)));
  const reviews: ReviewFact[] = reviewLists.flat().map((r) => ({
    taskId: r.taskId,
    attempt: r.attempt,
    status: r.status,
    codes: r.issues.map((i) => i.code),
    createdAt: r.createdAt,
  }));
  const events = await new SupabaseEventStore(db).listEvents({ eventType: "agent.handoff", limit: HANDOFF_EVENT_LIMIT });
  const handoffs: HandoffFact[] = events.items
    .filter((e) => e.correlationId !== null && runIds.has(e.correlationId))
    .map((e) => {
      const p = e.payload as { fromAgent: string; toAgent: string; taskId: string };
      return { fromAgent: p.fromAgent, toAgent: p.toAgent, taskId: p.taskId, at: e.occurredAt };
    });
  return runs.map((r) => buildRunTrace(r.id, inRuns, reviews, handoffs));
}
