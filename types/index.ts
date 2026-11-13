// Core domain types for FOOTBALL AI PRO.
// Every piece of externally sourced data is wrapped in a `Sourced<T>` envelope so the UI
// can always show where it came from, when it was fetched, and whether it is DEMO data.

export type Locale = "ar" | "en";

export type MatchStatus =
  | "SCHEDULED"
  | "TIMED"
  | "IN_PLAY"
  | "PAUSED"
  | "FINISHED"
  | "POSTPONED"
  | "SUSPENDED"
  | "CANCELLED";

export interface Competition {
  code: string; // e.g. PL, PD, SA, BL1, FL1, CL, EL, WC, EC
  name: string;
  country: string;
  countryCode: string;
  type: "LEAGUE" | "CUP" | "INTERNATIONAL";
  emblem?: string;
}

export interface TeamRef {
  id: string;
  name: string;
  shortName: string;
  tla: string;
  crest?: string;
}

export interface ScorePair {
  home: number | null;
  away: number | null;
}

/** Per-match team statistics. Only present when the provider supplies them. */
export interface MatchStats {
  xg?: ScorePair;
  shots?: ScorePair;
  shotsOnTarget?: ScorePair;
  possession?: ScorePair;
  corners?: ScorePair;
  cards?: ScorePair; // yellow + red, counted as cards
}

export interface Match {
  id: string;
  competition: Competition;
  utcDate: string;
  status: MatchStatus;
  matchday?: number | null;
  stage?: string | null;
  homeTeam: TeamRef;
  awayTeam: TeamRef;
  score: { fullTime: ScorePair; halfTime: ScorePair };
  stats?: MatchStats;
  venue?: string | null;
}

export interface StandingRow {
  position: number;
  team: TeamRef;
  played: number;
  won: number;
  draw: number;
  lost: number;
  goalsFor: number;
  goalsAgainst: number;
  goalDifference: number;
  points: number;
  form?: string | null; // e.g. "W,D,L,W,W"
}

export interface Standings {
  competition: Competition;
  season?: string;
  total: StandingRow[];
  home?: StandingRow[];
  away?: StandingRow[];
}

export interface PlayerAvailability {
  player: string;
  position?: string;
  type: "INJURY" | "SUSPENSION" | "DOUBTFUL" | "OTHER";
  reason: string;
  expectedReturn?: string | null;
}

export interface Lineup {
  team: TeamRef;
  formation?: string | null;
  startXI: { name: string; position?: string; number?: number }[];
  confirmed: boolean;
}

export interface SquadPlayer {
  id?: string;
  name: string;
  position?: string | null;
  nationality?: string | null;
  dateOfBirth?: string | null;
}

export interface TeamDetails {
  team: TeamRef;
  founded?: number | null;
  venue?: string | null;
  coach?: string | null;
  area?: string | null;
  squad: SquadPlayer[];
  runningCompetitions: string[];
}

export interface OddsOutcome {
  label: string; // "HOME" | "DRAW" | "AWAY" | "OVER" | "UNDER"
  price: number;
  point?: number;
}

export interface BookmakerOdds {
  bookmaker: string;
  lastUpdate: string;
  markets: { key: "h2h" | "totals"; outcomes: OddsOutcome[] }[];
}

export interface MatchOdds {
  matchId: string;
  bookmakers: BookmakerOdds[];
}

export interface NewsItem {
  title: string;
  url: string;
  source: string;
  publishedAt: string;
}

/** Provenance envelope attached to every provider response. */
export interface SourceInfo {
  provider: string; // e.g. "football-data.org", "DEMO", "The Odds API"
  fetchedAt: string; // ISO timestamp when data was obtained from the upstream
  cached: boolean;
  demo: boolean;
  url?: string;
}

export interface Sourced<T> {
  data: T;
  source: SourceInfo;
}

/** Explicit "this capability is not available" result — never filled with invented data. */
export interface Unavailable {
  unavailable: true;
  reasonKey: string; // i18n key explaining why
  provider?: string;
}

export type Maybe<T> = Sourced<T> | Unavailable;

export function isUnavailable<T>(x: Maybe<T>): x is Unavailable {
  return (x as Unavailable).unavailable === true;
}

// ---------- Model outputs ----------

export interface OneXTwo {
  home: number;
  draw: number;
  away: number;
}

export interface OverUnder {
  line: number;
  over: number;
  under: number;
}

export interface ScoreProb {
  home: number;
  away: number;
  p: number;
}

export interface AsianHandicapLine {
  line: number; // handicap applied to the HOME team, e.g. -0.5
  homeWin: number;
  push: number;
  awayWin: number;
}

export interface CountMarket {
  expected: number;
  lines: OverUnder[];
  basedOnMatches: number;
}

export interface TeamRatings {
  teamId: string;
  attack: number; // multiplicative, 1 = league average
  defence: number; // multiplicative, <1 = better than average (concedes less)
  matches: number;
}

export interface PredictionResult {
  modelVersion: string;
  lambdaHome: number;
  lambdaAway: number;
  oneXTwo: OneXTwo;
  doubleChance: { homeOrDraw: number; awayOrDraw: number; homeOrAway: number };
  totals: OverUnder[];
  btts: { yes: number; no: number };
  correctScores: ScoreProb[];
  scoreGrid: number[][]; // P(home=h, away=a) for h,a in 0..5
  homeGoals: OverUnder[];
  awayGoals: OverUnder[];
  firstHalf: {
    lambdaHome: number;
    lambdaAway: number;
    oneXTwo: OneXTwo;
    totals: OverUnder[];
    shareOfGoals: number;
  };
  asianHandicap: AsianHandicapLine[] | null; // null when data is insufficient
  corners: CountMarket | null;
  cards: CountMarket | null;
  ratings: { home: TeamRatings; away: TeamRatings; homeAdvantage: number; baseRate: number };
  h2hAdjustment: number; // multiplier applied (1 = none)
  /** Estimated standard error of the model's outcome probabilities (empirical, sample-size based). */
  probUncertainty: number;
  dataQuality: DataQuality;
}

export interface DataQuality {
  score: number; // 0..1
  level: "LOW" | "MEDIUM" | "HIGH";
  homeMatches: number;
  awayMatches: number;
  leagueMatches: number;
  usesXg: boolean;
  notes: string[]; // i18n keys
}

// ---------- Prediction tracker ----------

export type MarketKey =
  | "1X2_HOME"
  | "1X2_DRAW"
  | "1X2_AWAY"
  | "OU25_OVER"
  | "OU25_UNDER"
  | "BTTS_YES"
  | "BTTS_NO";

export interface StoredPrediction {
  id: string;
  matchId: string;
  competitionCode: string;
  homeTeam: string;
  awayTeam: string;
  kickoff: string;
  createdAt: string;
  modelVersion: string;
  probHome: number;
  probDraw: number;
  probAway: number;
  probOver25: number;
  probBttsYes: number;
  selectedMarket: MarketKey;
  selectedProb: number;
  oddsTaken: number | null;
  closingOdds: number | null;
  demo: boolean;
  // settlement (filled after the match, never changes the prediction fields above)
  status: "PENDING" | "SETTLED" | "VOID";
  homeGoals: number | null;
  awayGoals: number | null;
  settledAt: string | null;
  correct: boolean | null;
  profit: number | null; // unit stake P/L, null when no odds were recorded
}
