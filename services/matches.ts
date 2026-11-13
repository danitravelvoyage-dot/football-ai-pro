import "server-only";
import { addDaysYmd, ymdInTz } from "@/lib/dates";
import { LEAGUE_CODES } from "@/lib/competitions";
import { getFixturesProvider } from "@/services/providers";
import type { Match, SourceInfo } from "@/types";

export interface MatchFeed {
  matches: Match[];
  source: SourceInfo;
  liveSupported: boolean;
  error?: string;
}

export const LIVE_STATUSES = new Set(["IN_PLAY", "PAUSED"]);

/** Fetch matches whose local date (in tz) lies within [fromYmd, toYmd]. Never throws. */
export async function getMatchesBetween(fromYmd: string, toYmd: string, tz: string): Promise<MatchFeed> {
  const fx = getFixturesProvider();
  try {
    // Query one extra UTC day each side, then filter by local date (timezone safety).
    // football-data.org limits a single request to a 10-day window, so longer ranges are split.
    const start = addDaysYmd(fromYmd, -1);
    const end = addDaysYmd(toYmd, 1);
    const chunks: [string, string][] = [];
    for (let a = start; a <= end; a = addDaysYmd(a, 8)) {
      const b = addDaysYmd(a, 7);
      chunks.push([a, b < end ? b : end]);
    }
    const parts = await Promise.all(chunks.map(([a, b]) => fx.listMatches(a, b)));
    const seen = new Set<string>();
    const all = parts.flatMap((p) => p.data).filter((m) => (seen.has(m.id) ? false : (seen.add(m.id), true)));
    // report the oldest fetch time so freshness is never overstated
    const res = { source: parts.reduce((o, p) => (p.source.fetchedAt < o.source.fetchedAt ? p : o)).source };
    const matches = all
      .filter((m) => LEAGUE_CODES.includes(m.competition.code))
      .filter((m) => {
        const local = ymdInTz(new Date(m.utcDate), tz);
        return local >= fromYmd && local <= toYmd;
      })
      .sort((a, b) => a.utcDate.localeCompare(b.utcDate));
    return { matches, source: res.source, liveSupported: fx.supportsLive };
  } catch (e) {
    return {
      matches: [],
      source: { provider: fx.name, fetchedAt: new Date().toISOString(), cached: false, demo: fx.demo },
      liveSupported: fx.supportsLive,
      error: e instanceof Error ? e.message : "provider error",
    };
  }
}

export interface MatchFilters {
  league?: string;
  country?: string;
  q?: string;
  status?: string;
}

export function applyFilters(ms: Match[], f: MatchFilters): Match[] {
  const q = f.q?.trim().toLowerCase();
  return ms.filter(
    (m) =>
      (!f.league || m.competition.code === f.league) &&
      (!f.country || m.competition.country === f.country) &&
      (!f.status ||
        (f.status === "live" ? LIVE_STATUSES.has(m.status) : f.status === "finished" ? m.status === "FINISHED" : ["SCHEDULED", "TIMED"].includes(m.status))) &&
      (!q || [m.homeTeam.name, m.awayTeam.name, m.homeTeam.shortName, m.awayTeam.shortName].some((n) => n.toLowerCase().includes(q))),
  );
}
