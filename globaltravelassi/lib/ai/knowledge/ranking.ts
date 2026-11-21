import type { KbEntry, KbQuery } from "./rules";
import { freshnessOf, FRESHNESS_DAYS } from "./rules";

/**
 * Relevance ranking for agent retrieval. Pure. It orders entries that already passed the gate (current, same language,
 * allowed category). It never admits an entry the gate refused. The reasons are returned so the ranking can be audited.
 */
export interface RankedEntry {
  entry: KbEntry;
  score: number;
  reasons: string[];
}

const RELIABILITY_WEIGHT: Record<KbEntry["reliabilityStatus"], number> = {
  verified_official: 1,
  verified_internal: 0.6,
  unverified: 0,
  disputed: 0,
  retired: 0,
};

/** Lowercase words of three or more letters, without repeats. Works for Latin and Arabic script alike. */
export function termsOf(text: string): string[] {
  const words = text.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter((w) => w.length >= 3);
  return [...new Set(words)];
}

export function rankEntries(entries: KbEntry[], query: KbQuery, now: Date): RankedEntry[] {
  const terms = termsOf(query.objective ?? "");
  const queryTags = (query.tags ?? []).map((t) => t.toLowerCase());
  return entries
    .filter((e) => (queryTags.length === 0 ? true : e.tags.some((t) => queryTags.includes(t))))
    .map((entry) => {
      const reasons: string[] = [];
      let score = 0;

      const reliability = RELIABILITY_WEIGHT[entry.reliabilityStatus] * 0.4;
      if (reliability > 0) {
        score += reliability;
        reasons.push(`reliability:${entry.reliabilityStatus}`);
      }

      if (entry.country === query.country) {
        score += 0.2;
        reasons.push("country:exact");
      } else if (entry.country === "all") {
        score += 0.1;
        reasons.push("country:all");
      }

      if (terms.length > 0) {
        const haystack = termsOf(`${entry.title} ${entry.body} ${entry.tags.join(" ")}`);
        const hits = terms.filter((t) => haystack.includes(t)).length;
        if (hits > 0) {
          score += 0.3 * (hits / terms.length);
          reasons.push(`terms:${hits}/${terms.length}`);
        }
      }

      const tagHits = entry.tags.filter((t) => terms.includes(t) || queryTags.includes(t));
      if (tagHits.length > 0) {
        score += Math.min(0.2, 0.1 * tagHits.length);
        reasons.push(`tags:${tagHits.length}`);
      }

      // Freshness: the closer an entry is to its review date, the more it counts. Ranges from 0 to 0.1.
      if (entry.verifiedAt && (entry.reliabilityStatus === "verified_official" || entry.reliabilityStatus === "verified_internal")) {
        const days = FRESHNESS_DAYS[entry.reliabilityStatus];
        const ageDays = (now.getTime() - Date.parse(entry.verifiedAt)) / 86_400_000;
        const remaining = Math.max(0, Math.min(1, 1 - ageDays / days));
        score += 0.1 * remaining;
        if (freshnessOf(entry, now) === "current") reasons.push("fresh");
      }

      return { entry, score: Math.round(score * 1000) / 1000, reasons };
    })
    .sort((a, b) => b.score - a.score || a.entry.slug.localeCompare(b.entry.slug));
}
