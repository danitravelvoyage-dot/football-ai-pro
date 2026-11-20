import "server-only";
import { createClient } from "@supabase/supabase-js";
import { siteConfig } from "@/lib/config";
import { consoleLogger } from "../logging";
import { buildAiServices, type AiDatabase } from "../services";
import type { RunReport } from "./service";

export type WorkerOutcome =
  | { ok: true; report: RunReport }
  | { ok: false; code: "not_configured" | "sign_in_failed" | "run_failed" };

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
