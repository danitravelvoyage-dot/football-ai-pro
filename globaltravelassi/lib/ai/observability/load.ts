import "server-only";
import { createServerSupabase } from "@/lib/supabase/server";
import { SupabaseTaskStore } from "../store/supabase-store";
import { SupabaseEventStore } from "../store/supabase-event-store";
import { consoleLogger } from "../logging";
import { classifyLoadError, type LoadErrorKind } from "../command-center/view";
import { agentBoard, alertsFor, health, performance, usageSummary, type ReviewSample, type RunSample, type TaskSample, type UsageSample } from "./metrics";

/** Agent runs read for the metrics. Recent history, not the whole table, so each read stays bounded. */
export const RUN_SAMPLE_LIMIT = 1000;
export const USAGE_DAYS = 90;
export const REVIEW_SAMPLE_LIMIT = 1000;

export type MonitorData = {
  status: "ok";
  board: ReturnType<typeof agentBoard>;
  performance: ReturnType<typeof performance>;
  usage: ReturnType<typeof usageSummary>;
  health: ReturnType<typeof health>;
  alerts: ReturnType<typeof alertsFor>;
  sampleSizes: { tasks: number; runs: number; reviews: number };
  generatedAt: string;
};

export type MonitorState = MonitorData | { status: LoadErrorKind };

/**
 * Reads the monitoring data with the signed-in administrator's session. Never throws: failures become a
 * state without raw database text. Each figure's source is listed in the monitoring page.
 */
export async function loadMonitor(now: Date = new Date()): Promise<MonitorState> {
  try {
    const db = await createServerSupabase();
    const tasks = new SupabaseTaskStore(db);
    const events = new SupabaseEventStore(db);

    const started = Date.now();
    const dbPing = await db.from("ai_workflow_runs").select("id", { count: "exact", head: true });
    if (dbPing.error) throw new Error(dbPing.error.message);
    const databaseLatency = Date.now() - started;

    const [runRows, deliveries, usageRows, reviewRows, runList] = await Promise.all([
      tasks.listAgentRuns(RUN_SAMPLE_LIMIT),
      events.countDeliveries(),
      db.from("ai_usage").select("provider_id, requests, tokens, day").gte("day", isoDay(daysAgo(USAGE_DAYS, now))).limit(1000),
      db.from("ai_quality_reviews").select("agent, status, overall").order("created_at", { ascending: false }).limit(REVIEW_SAMPLE_LIMIT),
      tasks.listRuns(1000),
    ]);
    if (usageRows.error) throw new Error(usageRows.error.message);
    if (reviewRows.error) throw new Error(reviewRows.error.message);

    const taskRows = await tasks.listTasksPage({ limit: 500 });
    const failedRows = await tasks.listTasksPage({ status: "failed", limit: 500 });
    const allTasks = [...taskRows.items, ...failedRows.items].filter((t, i, a) => a.findIndex((x) => x.id === t.id) === i);
    const taskSamples: TaskSample[] = allTasks.map((t) => ({ id: t.id, agent: t.agent, status: t.status, attempts: t.attempts, updatedAt: t.updatedAt, runId: t.runId }));
    const runSamples: RunSample[] = runRows.map((r) => ({
      agent: r.agent,
      status: r.status,
      durationMs: r.durationMs,
      finishedAt: r.finishedAt,
      tokensIn: r.tokensIn,
      tokensOut: r.tokensOut,
      providerId: r.providerId,
    }));
    const reviewSamples: ReviewSample[] = (reviewRows.data ?? []).map((r) => r as ReviewSample);
    const usage: UsageSample[] = aggregateUsage((usageRows.data ?? []) as { provider_id: string; requests: number; tokens: number }[]);

    const workflowsWithFailures = new Set(allTasks.filter((t) => t.status === "failed").map((t) => t.runId)).size;
    const board = agentBoard(taskSamples, runSamples, now);
    const healthData = health({
      deliveries,
      database: { ok: true, latencyMs: databaseLatency },
      runs: runSamples,
      workflowsWithFailures,
      workflowsTotal: runList.length,
    });
    return {
      status: "ok",
      board,
      performance: performance(taskSamples, runSamples, reviewSamples),
      usage: usageSummary(usage, runSamples),
      health: healthData,
      alerts: alertsFor(board, taskSamples, runSamples, now),
      sampleSizes: { tasks: taskSamples.length, runs: runSamples.length, reviews: reviewSamples.length },
      generatedAt: now.toISOString(),
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const kind = classifyLoadError(message);
    consoleLogger.error("command_center.monitor_load_failed", { kind });
    return { status: kind };
  }
}

function daysAgo(days: number, now: Date): Date {
  return new Date(now.getTime() - days * 86_400_000);
}

function isoDay(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function aggregateUsage(rows: { provider_id: string; requests: number; tokens: number }[]): UsageSample[] {
  const byProvider = new Map<string, UsageSample>();
  for (const r of rows) {
    const current = byProvider.get(r.provider_id) ?? { providerId: r.provider_id, requests: 0, tokens: 0 };
    current.requests += r.requests;
    current.tokens += r.tokens;
    byProvider.set(r.provider_id, current);
  }
  return [...byProvider.values()].sort((a, b) => a.providerId.localeCompare(b.providerId));
}
