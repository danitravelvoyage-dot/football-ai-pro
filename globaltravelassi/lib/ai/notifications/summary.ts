import type { AgentRunRecord } from "../orchestration/records";
import { performanceHistory, type RunSample } from "../observability/metrics";
import { agentSummaryNotice } from "./rules";
import type { NotificationService } from "./service";

/** Maps stored agent runs to the samples the metrics read. No prompts or outputs are carried over. */
export function runSamplesFrom(runs: AgentRunRecord[]): RunSample[] {
  return runs.map((r) => ({
    agent: r.agent,
    status: r.status,
    durationMs: r.durationMs,
    finishedAt: r.finishedAt,
    tokensIn: r.tokensIn,
    tokensOut: r.tokensOut,
    providerId: r.providerId,
  }));
}

/**
 * Writes today's agent summary to the owner's inbox. Runs once per cycle; the dedupe key holds it to one per day.
 * Returns whether a new notice was written.
 */
export async function postAgentSummary(runs: AgentRunRecord[], notifications: NotificationService, now: Date): Promise<boolean> {
  const dayKey = now.toISOString().slice(0, 10);
  const points = performanceHistory(runSamplesFrom(runs), now, 1);
  const notice = agentSummaryNotice(points, dayKey);
  if (!notice) return false;
  const { created } = await notifications.notify(notice);
  return created;
}
