// The Odds API v4 provider (free tier: a limited number of credits per month).
// Docs: https://the-odds-api.com/liveapi/guides/v4/
// One call returns all upcoming events for a league, so results are cached aggressively (30 min)
// to stay within the free monthly quota. The key is sent as a query param server-side only.
import "server-only";
import { cached } from "@/lib/cache";
import { getCompetition } from "@/lib/competitions";
import { env } from "@/lib/env";
import { RateLimitedError } from "@/lib/rateLimit";
import type { BookmakerOdds, Match, MatchOdds, Maybe } from "@/types";
import { getJson, ProviderError } from "./http";
import type { OddsProvider } from "./types";
import { teamsMatch } from "./nameMatch";

const NAME = "The Odds API";
const BASE = "https://api.the-odds-api.com/v4";

interface OaEvent {
  id: string;
  commence_time: string;
  home_team: string;
  away_team: string;
  bookmakers: {
    key: string;
    title: string;
    last_update: string;
    markets: { key: string; outcomes: { name: string; price: number; point?: number }[] }[];
  }[];
}

export class OddsApiProvider implements OddsProvider {
  readonly name = NAME;
  constructor(private key: string) {}

  async getOdds(match: Match): Promise<Maybe<MatchOdds>> {
    const sport = getCompetition(match.competition.code)?.oddsApiKey;
    if (!sport) return { unavailable: true, reasonKey: "odds.leagueNotCovered", provider: NAME };
    const path = `/sports/${sport}/odds?regions=${encodeURIComponent(env.oddsRegions)}&markets=h2h,totals&oddsFormat=decimal&dateFormat=iso`;
    try {
      const r = await cached(`odds:${path}`, 30 * 60_000, () =>
        getJson<OaEvent[]>(NAME, `${BASE}${path}&apiKey=${encodeURIComponent(this.key)}`, {}, 5),
      );
      const kickoff = new Date(match.utcDate).getTime();
      const ev = r.value.find(
        (e) =>
          Math.abs(new Date(e.commence_time).getTime() - kickoff) < 6 * 3600_000 &&
          teamsMatch(e.home_team, match.homeTeam) &&
          teamsMatch(e.away_team, match.awayTeam),
      );
      if (!ev) return { unavailable: true, reasonKey: "odds.eventNotFound", provider: NAME };
      const books: BookmakerOdds[] = ev.bookmakers.map((b) => ({
        bookmaker: b.title,
        lastUpdate: b.last_update,
        markets: b.markets
          .filter((m) => m.key === "h2h" || m.key === "totals")
          .map((m) => ({
            key: m.key as "h2h" | "totals",
            outcomes: m.outcomes.map((o) => ({
              label:
                m.key === "totals"
                  ? o.name.toUpperCase()
                  : o.name === ev.home_team
                    ? "HOME"
                    : o.name === ev.away_team
                      ? "AWAY"
                      : "DRAW",
              price: o.price,
              point: o.point,
            })),
          })),
      }));
      return {
        data: { matchId: match.id, bookmakers: books },
        source: { provider: NAME, fetchedAt: new Date(r.storedAt).toISOString(), cached: r.cached, demo: false, url: `${BASE}${path}` },
      };
    } catch (e) {
      if (e instanceof RateLimitedError) return { unavailable: true, reasonKey: "provider.rateLimited", provider: NAME };
      if (e instanceof ProviderError && (e.status === 401 || e.status === 429))
        return { unavailable: true, reasonKey: "odds.quota", provider: NAME };
      return { unavailable: true, reasonKey: "provider.error", provider: NAME };
    }
  }
}
