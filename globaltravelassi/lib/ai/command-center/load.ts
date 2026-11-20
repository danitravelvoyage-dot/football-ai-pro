import "server-only";
import { createServerSupabase } from "@/lib/supabase/server";
import { SupabaseTaskStore, TASK_QUERY_LIMIT } from "../store/supabase-store";
import { buildExecutiveReport, verifyReportHonesty, type ExecutiveReport } from "../coo";
import type { ApprovalRecord, TaskRecord, WorkflowRunRecord } from "../orchestration/records";
import { consoleLogger } from "../logging";
import { classifyLoadError, type LoadErrorKind } from "./view";

export const RUN_LIMIT = 200;

export interface CommandCenterData {
  status: "ok";
  tasks: TaskRecord[];
  approvals: ApprovalRecord[];
  runs: WorkflowRunRecord[];
  report: ExecutiveReport;
  /** Problems found by verifyReportHonesty. An empty list means the summary is clean. */
  honestyProblems: string[];
  /** True when the task query hit its row cap, so some tasks are not shown. */
  taskCapReached: boolean;
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
    const [tasks, approvals, runs] = await Promise.all([
      store.listTasks(),
      store.listApprovals(),
      store.listRuns(RUN_LIMIT),
    ]);
    const report = buildExecutiveReport({ now, tasks, approvals });
    return {
      status: "ok",
      tasks,
      approvals,
      runs,
      report,
      honestyProblems: verifyReportHonesty(report),
      taskCapReached: tasks.length >= TASK_QUERY_LIMIT,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const kind = classifyLoadError(message);
    consoleLogger.error("command_center.load_failed", { kind });
    return { status: kind };
  }
}
