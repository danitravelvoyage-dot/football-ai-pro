import type { AgentRunRecord } from "../orchestration/records";
import type { NotificationService } from "./service";
import { ownerReportNotice } from "./rules";
import type { SchedulerHealth } from "../scheduler/service";

/**
 * Writes the owner's report for the given day. Counts come from stored agent runs and the inbox. The dedupe key
 * holds it to one report per day, however many cycles run.
 */
export async function postOwnerReport(
  runs: AgentRunRecord[],
  notifications: NotificationService,
  schedulerStatus: SchedulerHealth["status"],
  now: Date,
): Promise<boolean> {
  const dayKey = now.toISOString().slice(0, 10);
  const today = runs.filter((r) => r.finishedAt.slice(0, 10) === dayKey);
  const unreadNotices = await notifications.unreadTotal();
  const notice = ownerReportNotice(
    { runsToday: today.length, failedToday: today.filter((r) => r.status === "failed").length, unreadNotices, schedulerStatus },
    dayKey,
  );
  const { created } = await notifications.notify(notice);
  return created;
}
