import { z } from "zod";

/**
 * Pure scheduling rules. No I/O, no clock reads: every function takes the time it needs.
 *
 * Time handling: all instants are UTC epoch milliseconds or ISO strings. A schedule slot is an epoch-aligned
 * bucket, so two workers that compute a slot for the same instant always agree, whatever the server's
 * timezone or daylight-saving changes. The owner's timezone is used only to display times, never to
 * compute when work runs.
 */

export const SCHEDULE_LIMITS = {
  intervalMinutes: { min: 1, max: 1440 },
  leaseSeconds: { min: 60, max: 3600 },
  maxAttempts: { min: 1, max: 10 },
} as const;

/** Retry backoff for a failed scheduler job: 1 minute, doubling, capped at 15 minutes. */
export const JOB_RETRY_BASE_MS = 60_000;
export const JOB_RETRY_MAX_MS = 15 * 60_000;

export const SCHEDULER_JOB_KIND = "orchestrator_cycle" as const;

export const schedulerSettingsSchema = z.object({
  enabled: z.boolean(),
  intervalMinutes: z.number().int().min(SCHEDULE_LIMITS.intervalMinutes.min).max(SCHEDULE_LIMITS.intervalMinutes.max),
  timezone: z.string().min(3).max(64).refine(isValidTimezone, "Unknown timezone."),
  leaseSeconds: z.number().int().min(SCHEDULE_LIMITS.leaseSeconds.min).max(SCHEDULE_LIMITS.leaseSeconds.max),
  maxAttempts: z.number().int().min(SCHEDULE_LIMITS.maxAttempts.min).max(SCHEDULE_LIMITS.maxAttempts.max),
});

export type SchedulerSettings = z.infer<typeof schedulerSettingsSchema>;

/** Disabled by default. The owner turns the scheduler on; nothing runs before that. */
export const DEFAULT_SCHEDULER_SETTINGS: SchedulerSettings = {
  enabled: false,
  intervalMinutes: 5,
  timezone: "Africa/Algiers",
  leaseSeconds: 300,
  maxAttempts: 3,
};

export function isValidTimezone(zone: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: zone });
    return true;
  } catch {
    return false;
  }
}

export interface Slot {
  /** Stable key. Two enqueues for the same slot collide on this key, so a slot runs once. */
  key: string;
  startMs: number;
  endMs: number;
}

/** The epoch-aligned slot that contains `nowMs`. Pure arithmetic on UTC milliseconds. */
export function slotFor(nowMs: number, intervalMinutes: number): Slot {
  const size = intervalMinutes * 60_000;
  const startMs = Math.floor(nowMs / size) * size;
  return { key: `${SCHEDULER_JOB_KIND}:${startMs}`, startMs, endMs: startMs + size };
}

/** Exponential backoff after a failed attempt. `attempt` is the number of attempts made so far (1-based). */
export function retryDelayMs(attempt: number): number {
  const exponent = Math.max(0, attempt - 1);
  return Math.min(JOB_RETRY_MAX_MS, JOB_RETRY_BASE_MS * 2 ** exponent);
}

/** A queued job is overdue when it should have started more than `graceMs` ago and still has not. */
export function isOverdue(runAtIso: string, nowMs: number, graceMs: number): boolean {
  return Date.parse(runAtIso) + graceMs < nowMs;
}

/** A running job's lease has lapsed, so another worker may take it over. */
export function isLeaseExpired(leaseExpiresAtIso: string | null, nowMs: number): boolean {
  if (!leaseExpiresAtIso) return true;
  return Date.parse(leaseExpiresAtIso) <= nowMs;
}

/** A worker that has not been seen for longer than `staleAfterMs` is considered gone. */
export function isWorkerStale(lastSeenIso: string, nowMs: number, staleAfterMs: number): boolean {
  return Date.parse(lastSeenIso) + staleAfterMs < nowMs;
}

/** Renders an instant in the owner's timezone for display. Never used to schedule work. */
export function formatInZone(iso: string, timezone: string): string {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(iso));
}

/** Grace period before a queued slot counts as overdue: one full interval, at least one minute. */
export function overdueGraceMs(intervalMinutes: number): number {
  return Math.max(1, intervalMinutes) * 60_000;
}
