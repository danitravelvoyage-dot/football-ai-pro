// DEMO provider: serves the simulated dataset through the same interfaces as live providers.
import type { Match, Maybe, Sourced, StandingRow, Standings, TeamDetails } from "@/types";
import { getCompetition } from "@/lib/competitions";
import { demoAvailability, demoHeadToHead, demoOdds, getDemoDataset, resolveDemoMatch } from "./demoData";
import type { FixturesProvider, OddsProvider, TeamNewsProvider } from "./types";

const NAME = "DEMO";

/** All demo matches with past-kickoff fixtures resolved to deterministic results. */
function allMatches(): Match[] {
  const set = getDemoDataset();
  return set.matches.map((m) => resolveDemoMatch(m, set));
}

function src() {
  const set = getDemoDataset();
  return { provider: NAME, fetchedAt: set.generatedAt, cached: false, demo: true };
}

export function computeStandings(matches: Match[], filter?: "HOME" | "AWAY"): StandingRow[] {
  const rows = new Map<string, StandingRow & { results: string[] }>();
  const get = (t: Match["homeTeam"]) => {
    let r = rows.get(t.id);
    if (!r) {
      r = { position: 0, team: t, played: 0, won: 0, draw: 0, lost: 0, goalsFor: 0, goalsAgainst: 0, goalDifference: 0, points: 0, form: null, results: [] };
      rows.set(t.id, r);
    }
    return r;
  };
  const fin = matches.filter((m) => m.status === "FINISHED").sort((a, b) => a.utcDate.localeCompare(b.utcDate));
  for (const m of matches) {
    get(m.homeTeam);
    get(m.awayTeam);
  }
  for (const m of fin) {
    const gh = m.score.fullTime.home!, ga = m.score.fullTime.away!;
    const sides: [Match["homeTeam"], number, number, "HOME" | "AWAY"][] = [
      [m.homeTeam, gh, ga, "HOME"],
      [m.awayTeam, ga, gh, "AWAY"],
    ];
    for (const [t, f, a, side] of sides) {
      if (filter && filter !== side) continue;
      const r = get(t);
      r.played++;
      r.goalsFor += f;
      r.goalsAgainst += a;
      const res = f > a ? "W" : f === a ? "D" : "L";
      if (res === "W") {
        r.won++;
        r.points += 3;
      } else if (res === "D") {
        r.draw++;
        r.points += 1;
      } else r.lost++;
      r.results.push(res);
    }
  }
  const out = [...rows.values()].map((r) => ({ ...r, goalDifference: r.goalsFor - r.goalsAgainst, form: r.results.slice(-5).reverse().join(",") || null }));
  out.sort((a, b) => b.points - a.points || b.goalDifference - a.goalDifference || b.goalsFor - a.goalsFor || a.team.name.localeCompare(b.team.name));
  return out.map((r, i) => ({
    position: i + 1, team: r.team, played: r.played, won: r.won, draw: r.draw, lost: r.lost, goalsFor: r.goalsFor,
    goalsAgainst: r.goalsAgainst, goalDifference: r.goalDifference, points: r.points, form: r.form,
  }));
}

export class DemoFixturesProvider implements FixturesProvider {
  readonly name = NAME;
  readonly demo = true;
  readonly supportsLive = false; // DEMO never simulates live play

  async listMatches(dateFrom: string, dateTo: string): Promise<Sourced<Match[]>> {
    const from = new Date(dateFrom + "T00:00:00Z").getTime();
    const to = new Date(dateTo + "T23:59:59Z").getTime();
    const data = allMatches().filter((m) => {
      const t = new Date(m.utcDate).getTime();
      return t >= from && t <= to;
    });
    return { data, source: src() };
  }

  async getMatch(id: string): Promise<Sourced<Match> | null> {
    const m = allMatches().find((x) => x.id === id);
    return m ? { data: m, source: src() } : null;
  }

  async getCompetitionMatches(code: string): Promise<Maybe<Match[]>> {
    const data = allMatches().filter((m) => m.competition.code === code);
    if (data.length === 0) return { unavailable: true, reasonKey: "provider.noDemoData", provider: NAME };
    return { data, source: src() };
  }

  async getStandings(code: string): Promise<Maybe<Standings>> {
    const meta = getCompetition(code);
    const ms = allMatches().filter((m) => m.competition.code === code);
    if (!meta || ms.length === 0) return { unavailable: true, reasonKey: "provider.noDemoData", provider: NAME };
    return {
      data: {
        competition: { code: meta.code, name: meta.name, country: meta.country, countryCode: meta.countryCode, type: meta.type },
        season: "DEMO",
        total: computeStandings(ms),
        home: computeStandings(ms, "HOME"),
        away: computeStandings(ms, "AWAY"),
      },
      source: src(),
    };
  }

  async getTeamMatches(teamId: string, limit = 15): Promise<Maybe<Match[]>> {
    const data = allMatches()
      .filter((m) => m.status === "FINISHED" && (m.homeTeam.id === teamId || m.awayTeam.id === teamId))
      .slice(-limit);
    return { data, source: src() };
  }

  async getHeadToHead(match: Match): Promise<Maybe<Match[]>> {
    return { data: demoHeadToHead(match.homeTeam.id, match.awayTeam.id, getDemoDataset()), source: src() };
  }

  async getTeam(teamId: string): Promise<Maybe<TeamDetails>> {
    const t = getDemoDataset().teams.get(teamId);
    if (!t) return { unavailable: true, reasonKey: "provider.notFound", provider: NAME };
    const comps = new Set(getDemoDataset().matches.filter((m) => m.homeTeam.id === teamId || m.awayTeam.id === teamId).map((m) => m.competition.code));
    return {
      data: { team: { id: t.id, name: t.name, shortName: t.shortName, tla: t.tla }, squad: [], runningCompetitions: [...comps], coach: null, venue: null, founded: null, area: getCompetition(t.league)?.country ?? null },
      source: src(),
    };
  }
}

export class DemoOddsProvider implements OddsProvider {
  readonly name = NAME;
  async getOdds(match: Match) {
    const books = demoOdds(match, getDemoDataset());
    if (books.length === 0) return { unavailable: true as const, reasonKey: "odds.none", provider: NAME };
    return { data: { matchId: match.id, bookmakers: books }, source: src() };
  }
}

export class DemoTeamNewsProvider implements TeamNewsProvider {
  readonly name = NAME;
  async getAvailability(match: Match) {
    const k = getDemoDataset().dayKey;
    return { data: { home: demoAvailability(match.homeTeam.id, k), away: demoAvailability(match.awayTeam.id, k) }, source: src() };
  }
  async getLineups() {
    // Even in DEMO we do not invent lineups: they are "not yet published".
    return { unavailable: true as const, reasonKey: "lineups.notPublished", provider: NAME };
  }
  async getNews() {
    return { unavailable: true as const, reasonKey: "news.demo", provider: NAME };
  }
}
