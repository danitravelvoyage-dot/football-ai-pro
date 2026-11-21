import "server-only";
import { createClient } from "@supabase/supabase-js";
import { siteConfig } from "@/lib/config";
import { consoleLogger } from "../logging";
import { buildAiServices, type AiDatabase } from "../services";
import type { RunReport } from "./service";
import { readOnlyScheduler, type SchedulerHealth } from "./service";
import { SupabaseSchedulerStore } from "./supabase-store";
import { schedulerMissingNotice } from "../notifications/rules";

export type WorkerOutcome =
  | { ok: true; report: RunReport }
  | { ok: false; code: "not_configured" | "sign_in_failed" | "run_failed" };

export type WatchdogOutcome =
  | { ok: true; schedulerStatus: SchedulerHealth["status"]; notified: boolean }
  | { ok: false; code: "not_configured" | "sign_in_failed" | "run_failed" };

/** Signs in as the operator and returns a client bound to that session, or a failure code. */
async function operatorClient(env: NodeJS.ProcessEnv) {
  const email = env.AI_WORKER_EMAIL ?? "";
  const password = env.AI_WORKER_PASSWORD ?? "";
  if (!siteConfig.supabaseUrl || !siteConfig.supabaseAnonKey || !email || !password) return { code: "not_configured" as const };
  const client = createClient(siteConfig.supabaseUrl, siteConfig.supabaseAnonKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  const { error } = await client.auth.signInWithPassword({ email, password });
  if (error) {
    consoleLogger.error("scheduler.sign_in_failed", {});
    return { code: "sign_in_failed" as const };
  }
  return { client };
}

/**
 * The missing-worker check. It reads the scheduler's heartbeat and writes a critical notice if no run has been seen
 * recently. It never runs scheduled work, so it can run on its own schedule.
 */
export async function runWatchdogOnce(env: NodeJS.ProcessEnv = process.env): Promise<WatchdogOutcome> {
  const op = await operatorClient(env);
  if (!("client" in op)) return { ok: false, code: op.code };
  try {
    const now = new Date();
    const services = await buildAiServices(op.client as unknown as AiDatabase);
    const health = await readOnlyScheduler(new SupabaseSchedulerStore(op.client as unknown as AiDatabase), now, consoleLogger).health();
    const notice = schedulerMissingNotice(health, now.toISOString().slice(0, 10));
    const notified = notice ? (await services.notifications.notify(notice)).created : false;
    return { ok: true, schedulerStatus: health.status, notified };
  } catch (error) {
    consoleLogger.error("scheduler.watchdog_failed", { reason: error instanceof Error ? error.name : "unknown" });
    return { ok: false, code: "run_failed" };
  }
}

/**
 * One scheduler pass, run as the operator account named by AI_WORKER_EMAIL / AI_WORKER_PASSWORD.
 * The operator is a normal Supabase user listed in ai_operators, so every row-level rule applies to the
 * scheduler exactly as it does to the admin. No service-role key is used. Credentials are read from the
 * environment only and never returned, logged or stored.
 */
export async function runSchedulerOnce(env: NodeJS.ProcessEnv = process.env): Promise<WorkerOutcome> {
  const email = env.AI_WORKER_EMAIL ?? "";
  const password = env.AI_WORKER_PASSWORD ?? "";
  if (!siteConfig.supabaseUrl || !siteConfig.supabaseAnonKey || !email || !password) {
    return { ok: false, code: "not_configured" };
  }

  const client = createClient(siteConfig.supabaseUrl, siteConfig.supabaseAnonKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  const { error: signInError } = await client.auth.signInWithPassword({ email, password });
  if (signInError) {
    consoleLogger.error("scheduler.sign_in_failed", {});
    return { ok: false, code: "sign_in_failed" };
  }

  try {
    const services = await buildAiServices(client as unknown as AiDatabase);
    const report = await services.scheduler.runOnce();
    consoleLogger.info("scheduler.run_finished", { leased: report.leased, succeeded: report.succeeded, requeued: report.requeued });
    return { ok: true, report };
  } catch (error) {
    consoleLogger.error("scheduler.run_failed", { reason: error instanceof Error ? error.name : "unknown" });
    return { ok: false, code: "run_failed" };
  }
}
