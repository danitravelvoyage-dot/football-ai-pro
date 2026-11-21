import { createHash, timingSafeEqual } from "node:crypto";

export const MIN_TRIGGER_SECRET_LENGTH = 32;

export type TriggerAuth =
  | { ok: true }
  | { ok: false; status: 401 | 503; code: "not_configured" | "unauthorized" };

/** Compares digests, so the comparison takes the same time whatever the presented value is. */
function matches(presented: string, expected: string): boolean {
  const a = createHash("sha256").update(presented).digest();
  const b = createHash("sha256").update(expected).digest();
  return timingSafeEqual(a, b);
}

/**
 * Checks the bearer secret of an external trigger. No default secret: a missing or short secret refuses every call.
 * Shared by the scheduler trigger and the watchdog.
 */
export function authorizeTrigger(authorization: string | null, expected: string | undefined): TriggerAuth {
  const secret = expected ?? "";
  if (secret.length < MIN_TRIGGER_SECRET_LENGTH) return { ok: false, status: 503, code: "not_configured" };
  const header = authorization ?? "";
  const presented = header.startsWith("Bearer ") ? header.slice("Bearer ".length).trim() : "";
  if (!presented || !matches(presented, secret)) return { ok: false, status: 401, code: "unauthorized" };
  return { ok: true };
}
