import type { KbCategory, KbEntry, ReliabilityStatus } from "./rules";
import type { Country, Language } from "../types";

export interface KbSearch {
  /** Words matched against title, body and tags. Every word must appear (case-insensitive). */
  text?: string;
  category?: KbCategory;
  country?: Country;
  language?: Language;
  reliability?: ReliabilityStatus;
  tag?: string;
}

/**
 * Owner search over knowledge entries. Pure. It helps the owner find and maintain entries. Agents do not use it:
 * they receive only verified, current entries through the knowledge service's retrieval rules.
 */
export function searchEntries(entries: KbEntry[], q: KbSearch): KbEntry[] {
  const words = (q.text ?? "").toLowerCase().split(/\s+/).filter((w) => w.length > 0);
  const tag = q.tag?.trim().toLowerCase();
  return entries
    .filter((e) => (q.category ? e.category === q.category : true))
    .filter((e) => (q.country ? e.country === q.country : true))
    .filter((e) => (q.language ? e.language === q.language : true))
    .filter((e) => (q.reliability ? e.reliabilityStatus === q.reliability : true))
    .filter((e) => (tag ? e.tags.includes(tag) : true))
    .filter((e) => {
      if (words.length === 0) return true;
      const haystack = `${e.title} ${e.body} ${e.tags.join(" ")}`.toLowerCase();
      return words.every((w) => haystack.includes(w));
    });
}
