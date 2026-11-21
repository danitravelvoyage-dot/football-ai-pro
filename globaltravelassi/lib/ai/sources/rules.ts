/**
 * Source registry rules. A host on this list is an approved place for the agents to read from. Approving a host does
 * NOT verify any content on it: a page on an approved host still needs its own factual check.
 */

/** Retirement and reactivation requests are separate intents: a retired host cannot be edited, disabled or enabled. */
export const SOURCE_INTENTS = ["edit", "disable", "enable", "revalidate", "retire", "request_reactivation"] as const;

export const SOURCE_CATEGORIES = ["government", "immigration", "official_other", "other"] as const;
export type SourceCategory = (typeof SOURCE_CATEGORIES)[number];

export const JURISDICTIONS = ["dz", "ma", "tn", "fr", "all"] as const;
export type Jurisdiction = (typeof JURISDICTIONS)[number];

/**
 * active: agents may read it. disabled: paused by the owner, can be enabled again. retired: terminal for every owner
 * action except an approved reactivation. A row is never deleted, so its identity and history stay.
 */
export const SOURCE_STATUSES = ["active", "disabled", "retired"] as const;
export type SourceStatus = (typeof SOURCE_STATUSES)[number];

/** Lower rank is preferred. Official government sources come before anything else when several answer a question. */
export const CATEGORY_RANK: Record<SourceCategory, number> = { government: 0, immigration: 1, official_other: 2, other: 3 };

/** A host is revalidated at least this often; an older validation date makes it due. */
export const REVALIDATE_EVERY_DAYS = 90;

const DAY_MS = 86_400_000;
const HOST = /^(?=.{4,255}$)(?!-)([a-z0-9-]{1,63}\.)+[a-z]{2,63}$/;

export class SourceRuleError extends Error {
  constructor(message: string, public readonly code: "invalid_host" | "invalid_category" | "invalid_jurisdiction" | "invalid_expiry" | "invalid_purpose") {
    super(message);
    this.name = "SourceRuleError";
  }
}

/** Accepts a bare host only: no scheme, path, port, wildcard, IP address or credentials. */
export function normalizeHost(raw: string): string {
  const host = raw.trim().toLowerCase();
  if (host.includes("*") || host.includes("/") || host.includes(":") || host.includes("@") || host.includes(" ")) {
    throw new SourceRuleError("Give a bare host name, such as example.gov.dz.", "invalid_host");
  }
  if (/^\d+(\.\d+){3}$/.test(host)) throw new SourceRuleError("IP addresses cannot be approved.", "invalid_host");
  if (!HOST.test(host)) throw new SourceRuleError("This is not a valid host name.", "invalid_host");
  return host;
}

export function checkCategory(value: string): SourceCategory {
  if (!(SOURCE_CATEGORIES as readonly string[]).includes(value)) throw new SourceRuleError("Unknown source category.", "invalid_category");
  return value as SourceCategory;
}

export function checkJurisdiction(value: string): Jurisdiction {
  if (!(JURISDICTIONS as readonly string[]).includes(value)) throw new SourceRuleError("Unknown jurisdiction.", "invalid_jurisdiction");
  return value as Jurisdiction;
}

export function checkPurpose(value: string): string {
  const v = value.trim();
  if (v.length < 2 || v.length > 200) throw new SourceRuleError("Give a purpose of 2 to 200 characters.", "invalid_purpose");
  return v;
}

/** An expiry must be in the future when it is set. Null means no expiry date, and the host is still revalidated. */
export function checkExpiry(value: string | null, nowIso: string): string | null {
  if (value === null) return null;
  const t = Date.parse(value);
  if (Number.isNaN(t) || t <= Date.parse(nowIso)) throw new SourceRuleError("The expiry date must be a future date.", "invalid_expiry");
  return new Date(t).toISOString();
}

export interface SourceFacts {
  status: SourceStatus;
  expiresAt: string | null;
  validatedAt: string | null;
}

/** Usable for agents now: active, not expired. */
export function isUsable(s: SourceFacts, nowIso: string): boolean {
  if (s.status !== "active") return false;
  if (s.expiresAt !== null && Date.parse(s.expiresAt) <= Date.parse(nowIso)) return false;
  return true;
}

/** Due for revalidation: never validated, or validated more than REVALIDATE_EVERY_DAYS ago. */
export function revalidationDue(s: SourceFacts, nowIso: string): boolean {
  if (s.validatedAt === null) return true;
  return Date.parse(nowIso) - Date.parse(s.validatedAt) > REVALIDATE_EVERY_DAYS * DAY_MS;
}

/** Orders hosts so official government sources come first, then by name. Stable for the same input. */
export function prioritize<T extends { host: string; category: SourceCategory }>(sources: T[]): T[] {
  return [...sources].sort((a, b) => CATEGORY_RANK[a.category] - CATEGORY_RANK[b.category] || a.host.localeCompare(b.host));
}
