import "server-only";
import { createServerSupabase } from "@/lib/supabase/server";
import { classifyLoadError, type LoadErrorKind } from "../command-center/view";
import { consoleLogger } from "../logging";
import { SupabaseSchedulerStore } from "./supabase-store";
import { readOnlyScheduler, type SchedulerHealth } from "./service";
import type { SchedulerJob } from "./store";

export const SCHEDULER_JOB_LIMIT = 20;

export type SchedulerView =
  | { status: "ok"; health: SchedulerHealth; jobs: SchedulerJob[]; generatedAt: string }
  | { status: LoadErrorKind };

/**
 * Reads the scheduler's status with the signed-in administrator's session. Nothing is run. Never throws:
 * failures become a state without raw database text.
 */
export async function loadScheduler(now: Date = new Date()): Promise<SchedulerView> {
  try {
    const db = await createServerSupabase();
    const store = new SupabaseSchedulerStore(db);
    const health = await readOnlyScheduler(store, now, consoleLogger).health();
    const jobs = await store.listJobs(SCHEDULER_JOB_LIMIT);
    return { status: "ok", health, jobs, generatedAt: now.toISOString() };
  } catch (error) {
    const kind = classifyLoadError(error instanceof Error ? error.message : String(error));
    consoleLogger.error("scheduler.load_failed", { kind });
    return { status: kind };
  }
}
