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
    // query one extra UTC day each side then filter by local date (timezone safety)
    const res = await fx.listMatches(addDaysYmd(fromYmd, -1), addDaysYmd(toYmd, 1));
    const matches = res.data
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
