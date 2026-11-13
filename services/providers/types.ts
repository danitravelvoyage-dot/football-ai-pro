import type {
  Lineup, Match, MatchOdds, Maybe, NewsItem, PlayerAvailability, Sourced, Standings, TeamDetails,
} from "@/types";

/** Fixtures / results / standings provider (football-data.org, DEMO, …). */
export interface FixturesProvider {
  readonly name: string;
  readonly demo: boolean;
  readonly supportsLive: boolean;
  listMatches(dateFrom: string, dateTo: string): Promise<Sourced<Match[]>>;
  getMatch(id: string): Promise<Sourced<Match> | null>;
  /** `fast`: fail immediately when rate-limited instead of waiting (used for optional enrichments). */
  getCompetitionMatches(code: string, opts?: { fast?: boolean }): Promise<Maybe<Match[]>>;
  getStandings(code: string): Promise<Maybe<Standings>>;
  getTeamMatches(teamId: string, limit?: number): Promise<Maybe<Match[]>>;
  getHeadToHead(match: Match): Promise<Maybe<Match[]>>;
  getTeam(teamId: string): Promise<Maybe<TeamDetails>>;
}

export interface OddsProvider {
  readonly name: string;
  getOdds(match: Match): Promise<Maybe<MatchOdds>>;
}

export interface TeamNewsProvider {
  readonly name: string;
  getAvailability(match: Match): Promise<Maybe<{ home: PlayerAvailability[]; away: PlayerAvailability[] }>>;
  getLineups(match: Match): Promise<Maybe<Lineup[]>>;
  getNews(match: Match): Promise<Maybe<NewsItem[]>>;
}
