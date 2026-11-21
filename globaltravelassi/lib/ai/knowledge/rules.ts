import { z } from "zod";
import { COUNTRIES, LANGUAGES, type Country, type Language } from "../types";

export const KB_CATEGORIES = [
  "company_information",
  "service_catalogue",
  "country_information",
  "visa_requirements",
  "sales_knowledge",
  "customer_faq",
  "content_policies",
] as const;
export type KbCategory = (typeof KB_CATEGORIES)[number];

export const RELIABILITY_STATUSES = ["unverified", "verified_official", "verified_internal", "disputed", "retired"] as const;
export type ReliabilityStatus = (typeof RELIABILITY_STATUSES)[number];

/** Categories where a fact must always cite an official source, even while unverified. */
export const SOURCE_REQUIRED_CATEGORIES: readonly KbCategory[] = ["visa_requirements", "country_information"];

/** Days after verification before an entry is no longer current. Official facts change faster than internal ones. */
export const FRESHNESS_DAYS: Record<"verified_official" | "verified_internal", number> = { verified_official: 90, verified_internal: 180 };

export const KB_BODY_LIMIT_FOR_AGENTS = 1_500;
export const KB_MAX_TAGS = 10;

export const kbEntryInputSchema = z
  .object({
    category: z.enum(KB_CATEGORIES),
    slug: z.string().regex(/^[a-z0-9][a-z0-9-]{1,79}$/),
    language: z.enum(LANGUAGES),
    country: z.enum(COUNTRIES),
    title: z.string().min(3).max(160),
    body: z.string().min(10).max(8000),
    officialSourceUrl: z
      .string()
      .max(500)
      .regex(/^https:\/\/[^\s]+$/, { message: "The source must be an https address." })
      .nullable()
      .default(null),
    verifiedAt: z.string().datetime().nullable().default(null),
    reliabilityStatus: z.enum(RELIABILITY_STATUSES).default("unverified"),
    /** Short lowercase labels for finding an entry. Never used to decide what an agent may read. */
    tags: z.array(z.string().regex(/^[a-z0-9][a-z0-9-]{1,23}$/, { message: "Tags are 2 to 24 lowercase letters, digits or hyphens." })).max(KB_MAX_TAGS).default([]),
  })
  .superRefine((v, ctx) => {
    if (SOURCE_REQUIRED_CATEGORIES.includes(v.category) && !v.officialSourceUrl) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["officialSourceUrl"], message: "This category needs an official source." });
    }
    if (v.reliabilityStatus === "verified_official" && (!v.officialSourceUrl || !v.verifiedAt)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["reliabilityStatus"], message: "Official verification needs a source and a date." });
    }
    if (v.reliabilityStatus === "verified_internal" && !v.verifiedAt) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["verifiedAt"], message: "Verification needs a date." });
    }
  });
export type KbEntryInput = z.infer<typeof kbEntryInputSchema>;

export interface KbEntry extends KbEntryInput {
  id: string;
  version: number;
  createdBy: string;
  updatedAt: string;
}

export type Freshness = "current" | "stale" | "not_verified" | "excluded";

/** Decides whether an entry may be used as fact at `now`. Pure. */
export function freshnessOf(entry: Pick<KbEntry, "reliabilityStatus" | "verifiedAt">, now: Date): Freshness {
  if (entry.reliabilityStatus === "retired" || entry.reliabilityStatus === "disputed") return "excluded";
  if (entry.reliabilityStatus === "unverified" || !entry.verifiedAt) return "not_verified";
  const verified = Date.parse(entry.verifiedAt);
  if (Number.isNaN(verified)) return "not_verified";
  const ageDays = (now.getTime() - verified) / 86_400_000;
  return ageDays > FRESHNESS_DAYS[entry.reliabilityStatus] ? "stale" : "current";
}

export interface KbQuery {
  country: Country;
  language: Language;
  categories?: readonly KbCategory[];
  limit?: number;
}

/**
 * Entries an agent may use. Only current, verified entries pass. Country-specific entries must match the
 * requested country. Language matches exactly: nothing is translated or guessed. Official sources rank first.
 */
export function selectForAgent(entries: readonly KbEntry[], query: KbQuery, now: Date): KbEntry[] {
  const rank = (e: KbEntry) => (e.reliabilityStatus === "verified_official" ? 0 : 1);
  return entries
    .filter((e) => freshnessOf(e, now) === "current")
    .filter((e) => e.language === query.language)
    .filter((e) => e.country === "all" || e.country === query.country)
    .filter((e) => !query.categories || query.categories.includes(e.category))
    .sort((a, b) => rank(a) - rank(b) || (b.verifiedAt ?? "").localeCompare(a.verifiedAt ?? "") || a.slug.localeCompare(b.slug))
    .slice(0, query.limit ?? 10);
}

/** The shape given to an agent. Body is shortened and the freshness is always "current". */
export function toAgentFact(entry: KbEntry) {
  return {
    category: entry.category,
    title: entry.title,
    body: entry.body.slice(0, KB_BODY_LIMIT_FOR_AGENTS),
    reliability: entry.reliabilityStatus,
    verifiedAt: entry.verifiedAt,
    officialSourceUrl: entry.officialSourceUrl,
  };
}
