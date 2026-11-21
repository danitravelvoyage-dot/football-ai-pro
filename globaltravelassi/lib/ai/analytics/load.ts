import "server-only";
import { createServerSupabase } from "@/lib/supabase/server";
import { createAiServices } from "../services";
import { ownerId } from "@/lib/actions/ai";
import { loadProviderConfig } from "../llm/config";
import { classifyLoadError, type LoadErrorKind } from "../command-center/view";
import { consoleLogger } from "../logging";
import * as E from "./engine";

export const ANALYTICS_SAMPLE_LIMIT = 5000;

export type AnalyticsState =
  | {
      status: "ok";
      period: E.Period;
      approvals: ReturnType<typeof E.approvalConversion>;
      content: ReturnType<typeof E.contentPerformance>;
      agents: ReturnType<typeof E.agentPerformance>;
      leads: ReturnType<typeof E.leadConversion>;
      cost: ReturnType<typeof E.executionCost> & { complete: boolean };
      sample: { approvals: number; artifacts: number; runs: number; applications: number; usageRows: number };
      generatedAt: string;
    }
  | { status: LoadErrorKind | "unauthorized" };

/**
 * Analytics for the owner, computed from stored rows with the owner's session. Each figure has its own source.
 * Cost is complete only when every usage day carries the input and output token split (migration 0014).
 */
export async function loadAnalytics(period: E.Period, now: Date = new Date()): Promise<AnalyticsState> {
  try {
    const owner = await ownerId();
    if (!owner) return { status: "unauthorized" };
    const services = await createAiServices();
    const db = await createServerSupabase();

    const [approvalRows, artifacts, runs, appRes, usageRes] = await Promise.all([
      services.store.listApprovals(),
      services.store.listArtifacts(ANALYTICS_SAMPLE_LIMIT),
      services.store.listAgentRuns(ANALYTICS_SAMPLE_LIMIT),
      db.from("applications").select("status, created_at").order("created_at", { ascending: false }).limit(ANALYTICS_SAMPLE_LIMIT),
      db.from("ai_usage").select("provider_id, day, requests, tokens, tokens_in, tokens_out").order("day", { ascending: false }).limit(2000),
    ]);
    if (appRes.error) throw new Error(appRes.error.message);
    if (usageRes.error) throw new Error(usageRes.error.message);

    const apps = (appRes.data ?? []) as { status: E.ApplicationRow["status"]; created_at: string }[];
    const usage = (usageRes.data ?? []) as { provider_id: string; day: string; requests: number; tokens: number; tokens_in: number; tokens_out: number }[];

    // A day recorded before the split exists has tokens but no split. Its cost cannot be priced without guessing.
    const complete = usage.every((u) => u.tokens_in + u.tokens_out === u.tokens);
    const prices = Object.fromEntries(loadProviderConfig(process.env).map((p) => [p.id, p.price]));

    return {
      status: "ok",
      period,
      approvals: E.approvalConversion(approvalRows.map((a) => ({ actionClass: a.actionClass, status: a.status, createdAt: a.createdAt }))),
      content: E.contentPerformance(artifacts.map((a) => ({ kind: a.kind, status: a.status }))),
      agents: E.agentPerformance(runs.map((r) => ({ agent: r.agent, status: r.status, durationMs: r.durationMs, finishedAt: r.finishedAt })), now, period),
      leads: E.leadConversion(apps.map((a) => ({ status: a.status, createdAt: a.created_at })), now, period),
      cost: { ...E.executionCost(usage.map((u) => ({ providerId: u.provider_id, day: u.day, tokensIn: u.tokens_in, tokensOut: u.tokens_out, requests: u.requests })), prices), complete },
      sample: { approvals: approvalRows.length, artifacts: artifacts.length, runs: runs.length, applications: apps.length, usageRows: usage.length },
      generatedAt: now.toISOString(),
    };
  } catch (error) {
    const kind = classifyLoadError(error instanceof Error ? error.message : String(error));
    consoleLogger.error("analytics.load_failed", { kind });
    return { status: kind };
  }
}
