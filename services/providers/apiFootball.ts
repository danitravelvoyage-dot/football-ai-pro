// API-Football (api-sports.io) v3 — used ONLY for team news: injuries/suspensions and lineups.
// Docs: https://www.api-football.com/documentation-v3
// The free plan has a small daily request quota and may restrict which seasons are accessible;
// any plan restriction returned in the `errors` field is surfaced as "unavailable", never faked.
import "server-only";
import { cached } from "@/lib/cache";
import { getCompetition } from "@/lib/competitions";
import { env } from "@/lib/env";
import type { Lineup, Match, Maybe, PlayerAvailability } from "@/types";
import { getJson } from "./http";
import { teamsMatch } from "./nameMatch";
import type { TeamNewsProvider } from "./types";

const NAME = "API-Football";
const BASE = "https://v3.football.api-sports.io";

interface AfEnvelope<T> {
  errors: unknown;
  response: T[];
}
interface AfFixture {
  fixture: { id: number; date: string };
  teams: { home: { id: number; name: string }; away: { id: number; name: string } };
}

function hasErrors(e: unknown) {
  if (!e) return false;
  if (Array.isArray(e)) return e.length > 0;
  return typeof e === "object" && Object.keys(e as object).length > 0;
}

function seasonFor(match: Match): number {
  const d = new Date(match.utcDate);
  if (match.competition.type === "INTERNATIONAL") return d.getUTCFullYear();
  return d.getUTCMonth() >= 6 ? d.getUTCFullYear() : d.getUTCFullYear() - 1;
}

export class ApiFootballProvider implements TeamNewsProvider {
  readonly name = NAME;
  constructor(private key: string) {}

  private async call<T>(path: string, ttl: number) {
    return cached(`af:${path}`, ttl, async () => {
      const body = await getJson<AfEnvelope<T>>(NAME, `${BASE}${path}`, { "x-apisports-key": this.key }, env.apiFootballRpm);
      if (hasErrors(body.errors)) throw new Error("api-football plan/error: " + JSON.stringify(body.errors));
      return body.response;
    });
  }

  private src(storedAt: number, isCached: boolean, path: string) {
    return { provider: NAME, fetchedAt: new Date(storedAt).toISOString(), cached: isCached, demo: false, url: `${BASE}${path}` };
  }

  private async findFixture(match: Match): Promise<{ id: number; homeId: number; awayId: number } | null> {
    const league = getCompetition(match.competition.code)?.apiFootballLeague;
    if (!league) return null;
    const date = match.utcDate.slice(0, 10);
    const r = await this.call<AfFixture>(`/fixtures?date=${date}&league=${league}&season=${seasonFor(match)}`, 6 * 3600_000);
    const f = r.value.find((x) => teamsMatch(x.teams.home.name, match.homeTeam) && teamsMatch(x.teams.away.name, match.awayTeam));
    return f ? { id: f.fixture.id, homeId: f.teams.home.id, awayId: f.teams.away.id } : null;
  }

  async getAvailability(match: Match): Promise<Maybe<{ home: PlayerAvailability[]; away: PlayerAvailability[] }>> {
    try {
      const fx = await this.findFixture(match);
      if (!fx) return { unavailable: true, reasonKey: "teamnews.fixtureNotFound", provider: NAME };
      const path = `/injuries?fixture=${fx.id}`;
      const r = await this.call<{ player: { name: string; type: string; reason: string }; team: { id: number } }>(path, 3 * 3600_000);
      const map = (x: { player: { name: string; type: string; reason: string } }): PlayerAvailability => ({
        player: x.player.name,
        type: /suspend|card/i.test(x.player.reason) ? "SUSPENSION" : /question|doubt/i.test(x.player.type) ? "DOUBTFUL" : "INJURY",
        reason: x.player.reason,
      });
      return {
        data: { home: r.value.filter((x) => x.team.id === fx.homeId).map(map), away: r.value.filter((x) => x.team.id === fx.awayId).map(map) },
        source: this.src(r.storedAt, r.cached, path),
      };
    } catch {
      return { unavailable: true, reasonKey: "teamnews.planOrError", provider: NAME };
    }
  }

  async getLineups(match: Match): Promise<Maybe<Lineup[]>> {
    try {
      const fx = await this.findFixture(match);
      if (!fx) return { unavailable: true, reasonKey: "teamnews.fixtureNotFound", provider: NAME };
      const path = `/fixtures/lineups?fixture=${fx.id}`;
      const r = await this.call<{ team: { id: number }; formation: string | null; startXI: { player: { name: string; number: number; pos: string } }[] }>(path, 10 * 60_000);
      if (r.value.length === 0) return { unavailable: true, reasonKey: "lineups.notPublished", provider: NAME };
      return {
        data: r.value.map((l) => ({
          team: l.team.id === fx.homeId ? match.homeTeam : match.awayTeam,
          formation: l.formation,
          startXI: l.startXI.map((p) => ({ name: p.player.name, number: p.player.number, position: p.player.pos })),
          confirmed: true, // API-Football lineups are the official team sheets
        })),
        source: this.src(r.storedAt, r.cached, path),
      };
    } catch {
      return { unavailable: true, reasonKey: "teamnews.planOrError", provider: NAME };
    }
  }

  async getNews() {
    return { unavailable: true as const, reasonKey: "news.noSource", provider: NAME };
  }
}
