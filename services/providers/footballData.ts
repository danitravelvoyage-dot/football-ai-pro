// football-data.org v4 provider (free tier: selected competitions, ~10 requests/minute).
// Docs: https://www.football-data.org/documentation/quickstart
// The API key is only ever read server-side and sent in the X-Auth-Token header.
import "server-only";
import { cached } from "@/lib/cache";
import { getCompetition } from "@/lib/competitions";
import { env } from "@/lib/env";
import { RateLimitedError } from "@/lib/rateLimit";
import type { Competition, Match, MatchStatus, Maybe, Sourced, StandingRow, Standings, TeamDetails, TeamRef } from "@/types";
import { getJson, ProviderError } from "./http";
import type { FixturesProvider } from "./types";

const BASE = "https://api.football-data.org/v4";
const NAME = "football-data.org";

// ---- raw API shapes (subset) ----
interface FdTeam { id: number; name: string; shortName?: string; tla?: string; crest?: string }
interface FdScore { home: number | null; away: number | null }
interface FdMatch {
  id: number;
  utcDate: string;
  status: string;
  matchday?: number | null;
  stage?: string | null;
  venue?: string | null;
  competition: { id: number; name: string; code: string; emblem?: string };
  area?: { name: string; code: string };
  homeTeam: FdTeam;
  awayTeam: FdTeam;
  score: { fullTime: FdScore; halfTime: FdScore };
}
interface FdStandingRow {
  position: number; team: FdTeam; playedGames: number; form?: string | null; won: number; draw: number; lost: number;
  points: number; goalsFor: number; goalsAgainst: number; goalDifference: number;
}

const TTL = {
  matchesToday: 60_000, // 1 min — scores during match days
  match: 60_000,
  competitionMatches: 30 * 60_000,
  standings: 60 * 60_000,
  teamMatches: 30 * 60_000,
  h2h: 6 * 60 * 60_000,
  team: 24 * 60 * 60_000,
};

function team(t: FdTeam): TeamRef {
  return {
    id: String(t.id),
    name: t.name ?? "TBD",
    shortName: t.shortName ?? t.name ?? "TBD",
    tla: t.tla ?? (t.name ?? "TBD").slice(0, 3).toUpperCase(),
    crest: t.crest,
  };
}

function competition(c: FdMatch["competition"], area?: FdMatch["area"]): Competition {
  const meta = getCompetition(c.code);
  return {
    code: c.code,
    name: c.name,
    country: area?.name ?? meta?.country ?? "",
    countryCode: area?.code ?? meta?.countryCode ?? "",
    type: meta?.type ?? "LEAGUE",
    emblem: c.emblem,
  };
}

const STATUS: Record<string, MatchStatus> = {
  SCHEDULED: "SCHEDULED", TIMED: "TIMED", IN_PLAY: "IN_PLAY", LIVE: "IN_PLAY", PAUSED: "PAUSED",
  FINISHED: "FINISHED", AWARDED: "FINISHED", POSTPONED: "POSTPONED", SUSPENDED: "SUSPENDED", CANCELLED: "CANCELLED",
};

export function mapFdMatch(m: FdMatch): Match {
  return {
    id: String(m.id),
    competition: competition(m.competition, m.area),
    utcDate: m.utcDate,
    status: STATUS[m.status] ?? "SCHEDULED",
    matchday: m.matchday ?? null,
    stage: m.stage ?? null,
    venue: m.venue ?? null,
    homeTeam: team(m.homeTeam),
    awayTeam: team(m.awayTeam),
    score: {
      fullTime: { home: m.score?.fullTime?.home ?? null, away: m.score?.fullTime?.away ?? null },
      halfTime: { home: m.score?.halfTime?.home ?? null, away: m.score?.halfTime?.away ?? null },
    },
    // football-data.org free tier does not supply shots / xG / corners / cards → stats left undefined
  };
}

function row(r: FdStandingRow): StandingRow {
  return {
    position: r.position, team: team(r.team), played: r.playedGames, won: r.won, draw: r.draw, lost: r.lost,
    goalsFor: r.goalsFor, goalsAgainst: r.goalsAgainst, goalDifference: r.goalDifference, points: r.points, form: r.form ?? null,
  };
}

export class FootballDataProvider implements FixturesProvider {
  readonly name = NAME;
  readonly demo = false;
  readonly supportsLive = true; // free tier scores may be delayed; shown with fetch timestamp

  constructor(private key: string) {}

  private async get<T>(path: string, ttl: number): Promise<{ value: T; cached: boolean; storedAt: number }> {
    return cached(`fd:${path}`, ttl, () =>
      getJson<T>(NAME, `${BASE}${path}`, { "X-Auth-Token": this.key }, env.footballDataRpm),
    );
  }

  private src(r: { cached: boolean; storedAt: number }, path: string) {
    return { provider: NAME, fetchedAt: new Date(r.storedAt).toISOString(), cached: r.cached, demo: false, url: `${BASE}${path}` };
  }

  private unavailable(err: unknown): Maybe<never> {
    if (err instanceof RateLimitedError) return { unavailable: true, reasonKey: "provider.rateLimited", provider: NAME };
    if (err instanceof ProviderError && (err.status === 403 || err.status === 401))
      return { unavailable: true, reasonKey: "provider.notInPlan", provider: NAME };
    if (err instanceof ProviderError && err.status === 404)
      return { unavailable: true, reasonKey: "provider.notFound", provider: NAME };
    return { unavailable: true, reasonKey: "provider.error", provider: NAME };
  }

  async listMatches(dateFrom: string, dateTo: string): Promise<Sourced<Match[]>> {
    const path = `/matches?dateFrom=${dateFrom}&dateTo=${dateTo}`;
    const r = await this.get<{ matches: FdMatch[] }>(path, TTL.matchesToday);
    return { data: (r.value.matches ?? []).map(mapFdMatch), source: this.src(r, path) };
  }

  async getMatch(id: string): Promise<Sourced<Match> | null> {
    if (!/^\d{1,10}$/.test(id)) return null;
    const path = `/matches/${id}`;
    try {
      const r = await this.get<FdMatch>(path, TTL.match);
      return { data: mapFdMatch(r.value), source: this.src(r, path) };
    } catch (e) {
      if (e instanceof ProviderError && e.status === 404) return null;
      throw e;
    }
  }

  async getCompetitionMatches(code: string): Promise<Maybe<Match[]>> {
    const path = `/competitions/${encodeURIComponent(code)}/matches`;
    try {
      const r = await this.get<{ matches: FdMatch[] }>(path, TTL.competitionMatches);
      return { data: (r.value.matches ?? []).map(mapFdMatch), source: this.src(r, path) };
    } catch (e) {
      return this.unavailable(e);
    }
  }

  async getStandings(code: string): Promise<Maybe<Standings>> {
    const path = `/competitions/${encodeURIComponent(code)}/standings`;
    try {
      const r = await this.get<{
        competition: FdMatch["competition"]; area?: FdMatch["area"]; season?: { startDate: string; endDate: string };
        standings: { type: string; table: FdStandingRow[] }[];
      }>(path, TTL.standings);
      const pick = (t: string) => r.value.standings?.find((s) => s.type === t)?.table.map(row);
      const total = pick("TOTAL");
      if (!total || total.length === 0) return { unavailable: true, reasonKey: "provider.noStandings", provider: NAME };
      return {
        data: {
          competition: competition(r.value.competition, r.value.area),
          season: r.value.season ? `${r.value.season.startDate.slice(0, 4)}/${r.value.season.endDate.slice(2, 4)}` : undefined,
          total,
          home: pick("HOME"),
          away: pick("AWAY"),
        },
        source: this.src(r, path),
      };
    } catch (e) {
      return this.unavailable(e);
    }
  }

  async getTeamMatches(teamId: string, limit = 15): Promise<Maybe<Match[]>> {
    if (!/^\d{1,10}$/.test(teamId)) return { unavailable: true, reasonKey: "provider.notFound", provider: NAME };
    const to = new Date();
    const from = new Date(to.getTime() - 200 * 864e5);
    const d = (x: Date) => x.toISOString().slice(0, 10);
    const path = `/teams/${teamId}/matches?status=FINISHED&dateFrom=${d(from)}&dateTo=${d(to)}`;
    try {
      const r = await this.get<{ matches: FdMatch[] }>(path, TTL.teamMatches);
      const ms = (r.value.matches ?? []).map(mapFdMatch).sort((a, b) => a.utcDate.localeCompare(b.utcDate));
      return { data: ms.slice(-limit), source: this.src(r, path) };
    } catch (e) {
      return this.unavailable(e);
    }
  }

  async getHeadToHead(match: Match): Promise<Maybe<Match[]>> {
    const path = `/matches/${match.id}/head2head?limit=10`;
    try {
      const r = await this.get<{ matches: FdMatch[] }>(path, TTL.h2h);
      return { data: (r.value.matches ?? []).map(mapFdMatch), source: this.src(r, path) };
    } catch (e) {
      return this.unavailable(e);
    }
  }

  async getTeam(teamId: string): Promise<Maybe<TeamDetails>> {
    if (!/^\d{1,10}$/.test(teamId)) return { unavailable: true, reasonKey: "provider.notFound", provider: NAME };
    const path = `/teams/${teamId}`;
    try {
      const r = await this.get<FdTeam & {
        founded?: number; venue?: string; area?: { name: string }; coach?: { name?: string };
        squad?: { id: number; name: string; position?: string; nationality?: string; dateOfBirth?: string }[];
        runningCompetitions?: { code: string }[];
      }>(path, TTL.team);
      const v = r.value;
      return {
        data: {
          team: team(v),
          founded: v.founded ?? null,
          venue: v.venue ?? null,
          coach: v.coach?.name ?? null,
          area: v.area?.name ?? null,
          squad: (v.squad ?? []).map((p) => ({ id: String(p.id), name: p.name, position: p.position ?? null, nationality: p.nationality ?? null, dateOfBirth: p.dateOfBirth ?? null })),
          runningCompetitions: (v.runningCompetitions ?? []).map((c) => c.code),
        },
        source: this.src(r, path),
      };
    } catch (e) {
      return this.unavailable(e);
    }
  }
}
