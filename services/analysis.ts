// Match analysis orchestration: gathers provider data, runs the model, compares with the market.
import "server-only";
import { cached } from "@/lib/cache";
import { assessValue, removeMarginPower, type ValueAssessment } from "@/lib/betting";
import { getModel } from "@/models/engine";
import { finishedBefore } from "@/models/ratings";
import { getFixturesProvider, getOddsProvider, getTeamNewsProvider } from "@/services/providers";
import type {
  Lineup, Match, MatchOdds, Maybe, NewsItem, PlayerAvailability, PredictionResult, Sourced, StandingRow, Standings,
} from "@/types";
import { isUnavailable } from "@/types";

export interface TeamStatSummary {
  teamId: string;
  matches: number;
  last5: ("W" | "D" | "L")[];
  last10: ("W" | "D" | "L")[];
  recent: Match[];
  goalsFor: number;
  goalsAgainst: number;
  avgFor: number;
  avgAgainst: number;
  cleanSheets: number;
  failedToScore: number;
  over25Rate: number;
  bttsRate: number;
  home: { played: number; avgFor: number; avgAgainst: number; points: number };
  away: { played: number; avgFor: number; avgAgainst: number; points: number };
  xgFor: number | null;
  xgAgainst: number | null;
  shots: number | null;
  shotsOnTarget: number | null;
  possession: number | null;
  statsMatches: number;
  standing: StandingRow | null;
  formPoints5: number;
}

export interface TeamContext {
  restDays: number | null;
  matchesLast14: number;
  matchesLast30: number;
  nextMatchDays: number | null;
  situationKey: string | null; // i18n key, e.g. context.titleRace
  pointsFromTop: number | null;
  pointsFromEurope: number | null;
  pointsAboveDrop: number | null;
}

export interface MarketRow {
  key: "HOME" | "DRAW" | "AWAY" | "OVER25" | "UNDER25";
  modelProb: number;
  bestOdds: number | null;
  bestBook: string | null;
  fairMarketProb: number | null;
  assessment: ValueAssessment | null;
}

export interface MatchAnalysis {
  match: Sourced<Match>;
  asOf: string;
  prediction: PredictionResult;
  standings: Maybe<Standings>;
  leagueMatches: Maybe<Match[]>;
  homeRecent: Maybe<Match[]>;
  awayRecent: Maybe<Match[]>;
  h2h: Maybe<Match[]>;
  h2hFinished: Match[];
  odds: Maybe<MatchOdds>;
  availability: Maybe<{ home: PlayerAvailability[]; away: PlayerAvailability[] }>;
  lineups: Maybe<Lineup[]>;
  news: Maybe<NewsItem[]>;
  stats: { home: TeamStatSummary; away: TeamStatSummary };
  context: { home: TeamContext; away: TeamContext };
  market: MarketRow[];
  bookmakerMargin: number | null;
  generatedAt: string;
}

const val = <T,>(m: Maybe<T>): T | null => (isUnavailable(m) ? null : m.data);

export function resultFor(m: Match, teamId: string): "W" | "D" | "L" {
  const h = m.score.fullTime.home!, a = m.score.fullTime.away!;
  const f = m.homeTeam.id === teamId ? h : a, g = m.homeTeam.id === teamId ? a : h;
  return f > g ? "W" : f === g ? "D" : "L";
}

export function summariseTeam(teamId: string, pool: Match[], asOf: Date, standings: Standings | null): TeamStatSummary {
  const seen = new Set<string>();
  const ms = finishedBefore(pool, asOf)
    .filter((m) => (m.homeTeam.id === teamId || m.awayTeam.id === teamId) && !seen.has(m.id) && (seen.add(m.id), true))
    .sort((a, b) => b.utcDate.localeCompare(a.utcDate))
    .slice(0, 20);
  let gf = 0, ga = 0, cs = 0, fts = 0, o25 = 0, bt = 0;
  let xgf = 0, xga = 0, sh = 0, sot = 0, pos = 0, ns = 0;
  const home = { played: 0, f: 0, a: 0, points: 0 }, away = { played: 0, f: 0, a: 0, points: 0 };
  for (const m of ms) {
    const isHome = m.homeTeam.id === teamId;
    const f = (isHome ? m.score.fullTime.home : m.score.fullTime.away)!;
    const a = (isHome ? m.score.fullTime.away : m.score.fullTime.home)!;
    gf += f; ga += a;
    if (a === 0) cs++;
    if (f === 0) fts++;
    if (f + a > 2.5) o25++;
    if (f > 0 && a > 0) bt++;
    const pts = f > a ? 3 : f === a ? 1 : 0;
    const side = isHome ? home : away;
    side.played++; side.f += f; side.a += a; side.points += pts;
    const s = m.stats;
    if (s?.xg && s.xg.home !== null && s.xg.away !== null) {
      ns++;
      xgf += (isHome ? s.xg.home : s.xg.away)!;
      xga += (isHome ? s.xg.away : s.xg.home)!;
      sh += (isHome ? s.shots?.home : s.shots?.away) ?? 0;
      sot += (isHome ? s.shotsOnTarget?.home : s.shotsOnTarget?.away) ?? 0;
      pos += (isHome ? s.possession?.home : s.possession?.away) ?? 0;
    }
  }
  const n = ms.length || 1;
  const form = ms.map((m) => resultFor(m, teamId));
  return {
    teamId,
    matches: ms.length,
    last5: form.slice(0, 5),
    last10: form.slice(0, 10),
    recent: ms.slice(0, 10),
    goalsFor: gf,
    goalsAgainst: ga,
    avgFor: gf / n,
    avgAgainst: ga / n,
    cleanSheets: cs,
    failedToScore: fts,
    over25Rate: o25 / n,
    bttsRate: bt / n,
    home: { played: home.played, avgFor: home.f / (home.played || 1), avgAgainst: home.a / (home.played || 1), points: home.points },
    away: { played: away.played, avgFor: away.f / (away.played || 1), avgAgainst: away.a / (away.played || 1), points: away.points },
    xgFor: ns ? xgf / ns : null,
    xgAgainst: ns ? xga / ns : null,
    shots: ns ? sh / ns : null,
    shotsOnTarget: ns ? sot / ns : null,
    possession: ns ? pos / ns : null,
    statsMatches: ns,
    standing: standings?.total.find((r) => r.team.id === teamId) ?? null,
    formPoints5: form.slice(0, 5).reduce((s, r) => s + (r === "W" ? 3 : r === "D" ? 1 : 0), 0),
  };
}

export function teamContext(teamId: string, match: Match, pool: Match[], standings: Standings | null): TeamContext {
  const kickoff = new Date(match.utcDate).getTime();
  const seen = new Set<string>();
  const ms = pool.filter((m) => (m.homeTeam.id === teamId || m.awayTeam.id === teamId) && !seen.has(m.id) && (seen.add(m.id), true));
  const before = ms.filter((m) => new Date(m.utcDate).getTime() < kickoff - 3600_000).map((m) => new Date(m.utcDate).getTime());
  const after = ms.filter((m) => m.id !== match.id && new Date(m.utcDate).getTime() > kickoff + 3600_000).map((m) => new Date(m.utcDate).getTime());
  const last = before.length ? Math.max(...before) : null;
  const next = after.length ? Math.min(...after) : null;
  const ctx: TeamContext = {
    restDays: last ? Math.floor((kickoff - last) / 864e5) : null,
    matchesLast14: before.filter((t) => kickoff - t <= 14 * 864e5).length,
    matchesLast30: before.filter((t) => kickoff - t <= 30 * 864e5).length,
    nextMatchDays: next ? Math.floor((next - kickoff) / 864e5) : null,
    situationKey: null,
    pointsFromTop: null,
    pointsFromEurope: null,
    pointsAboveDrop: null,
  };
  const table = standings?.total;
  const row = table?.find((r) => r.team.id === teamId);
  if (table && row && match.competition.type === "LEAGUE" && table.length >= 10) {
    const top = table[0].points;
    const euro = table[Math.min(3, table.length - 1)].points;
    const dropIdx = table.length - 3; // first relegation place (18th of 20)
    const safe = table[dropIdx - 1].points;
    ctx.pointsFromTop = top - row.points;
    ctx.pointsFromEurope = euro - row.points;
    ctx.pointsAboveDrop = row.points - table[dropIdx].points;
    if (row.position <= 3 && ctx.pointsFromTop <= 6) ctx.situationKey = "context.titleRace";
    else if (row.position >= dropIdx + 1 || row.points - safe <= 3) ctx.situationKey = "context.relegationBattle";
    else if (row.position <= 7 && ctx.pointsFromEurope <= 6) ctx.situationKey = "context.europeRace";
    else ctx.situationKey = "context.midtable";
  }
  return ctx;
}

export function buildMarket(pred: PredictionResult, odds: MatchOdds | null, quality: number): { rows: MarketRow[]; margin: number | null } {
  const over25 = pred.totals.find((t) => t.line === 2.5)!;
  const model: Record<MarketRow["key"], number> = {
    HOME: pred.oneXTwo.home, DRAW: pred.oneXTwo.draw, AWAY: pred.oneXTwo.away, OVER25: over25.over, UNDER25: over25.under,
  };
  const best: Partial<Record<MarketRow["key"], { odds: number; book: string }>> = {};
  const fairSum: Partial<Record<MarketRow["key"], { s: number; n: number }>> = {};
  const margins: number[] = [];
  for (const b of odds?.bookmakers ?? []) {
    const h2h = b.markets.find((m) => m.key === "h2h");
    if (h2h) {
      const o = ["HOME", "DRAW", "AWAY"].map((l) => h2h.outcomes.find((x) => x.label === l)?.price);
      if (o.every((x): x is number => !!x && x > 1)) {
        margins.push(o.reduce((s, x) => s + 1 / x, 0) - 1);
        const fair = removeMarginPower(o);
        (["HOME", "DRAW", "AWAY"] as const).forEach((k, i) => {
          if (!best[k] || o[i] > best[k]!.odds) best[k] = { odds: o[i], book: b.bookmaker };
          const f = fairSum[k] ?? { s: 0, n: 0 };
          fairSum[k] = { s: f.s + fair[i], n: f.n + 1 };
        });
      }
    }
    const tot = b.markets.find((m) => m.key === "totals");
    if (tot) {
      const ov = tot.outcomes.find((x) => x.label === "OVER" && x.point === 2.5)?.price;
      const un = tot.outcomes.find((x) => x.label === "UNDER" && x.point === 2.5)?.price;
      if (ov && un && ov > 1 && un > 1) {
        const fair = removeMarginPower([ov, un]);
        ([["OVER25", ov, fair[0]], ["UNDER25", un, fair[1]]] as const).forEach(([k, price, fp]) => {
          if (!best[k] || price > best[k]!.odds) best[k] = { odds: price, book: b.bookmaker };
          const f = fairSum[k] ?? { s: 0, n: 0 };
          fairSum[k] = { s: f.s + fp, n: f.n + 1 };
        });
      }
    }
  }
  const rows = (Object.keys(model) as MarketRow["key"][]).map((key) => {
    const b = best[key];
    const fair = fairSum[key] ? fairSum[key]!.s / fairSum[key]!.n : null;
    return {
      key,
      modelProb: model[key],
      bestOdds: b?.odds ?? null,
      bestBook: b?.book ?? null,
      fairMarketProb: fair,
      assessment: b ? assessValue(model[key], b.odds, fair, quality, pred.probUncertainty) : null,
    };
  });
  return { rows, margin: margins.length ? margins.reduce((a, c) => a + c, 0) / margins.length : null };
}

export async function analyseMatch(matchId: string): Promise<MatchAnalysis | null> {
  const fx = getFixturesProvider();
  const m = await fx.getMatch(matchId);
  if (!m) return null;
  const { value } = await cached(`analysis:${fx.name}:${matchId}:${m.data.status}`, 5 * 60_000, () => runAnalysis(m));
  return value;
}

async function runAnalysis(m: Sourced<Match>): Promise<MatchAnalysis> {
  const fx = getFixturesProvider();
  const match = m.data;
  const kickoff = new Date(match.utcDate);
  const asOf = new Date(Math.min(Date.now(), kickoff.getTime()));

  const [leagueMatches, standings, homeRecent, awayRecent, h2h, odds, availability, lineups, news] = await Promise.all([
    fx.getCompetitionMatches(match.competition.code),
    match.competition.type === "LEAGUE" ? fx.getStandings(match.competition.code) : Promise.resolve<Maybe<Standings>>({ unavailable: true, reasonKey: "standings.cupOnly" }),
    fx.getTeamMatches(match.homeTeam.id, 15),
    fx.getTeamMatches(match.awayTeam.id, 15),
    fx.getHeadToHead(match),
    getOddsProvider().getOdds(match),
    getTeamNewsProvider().getAvailability(match),
    getTeamNewsProvider().getLineups(match),
    getTeamNewsProvider().getNews(match),
  ]);

  const lm = val(leagueMatches) ?? [];
  const hr = val(homeRecent) ?? [];
  const ar = val(awayRecent) ?? [];
  const h2hList = val(h2h) ?? [];
  const st = val(standings);

  const prediction = getModel().predict({ match, asOf, leagueMatches: lm, homeRecent: hr, awayRecent: ar, h2h: h2hList });
  const pool = [...lm, ...hr, ...ar];
  const market = buildMarket(prediction, val(odds), prediction.dataQuality.score);

  return {
    match: m,
    asOf: asOf.toISOString(),
    prediction,
    standings,
    leagueMatches,
    homeRecent,
    awayRecent,
    h2h,
    h2hFinished: finishedBefore(h2hList, asOf).sort((a, b) => b.utcDate.localeCompare(a.utcDate)).slice(0, 10),
    odds,
    availability,
    lineups,
    news,
    stats: { home: summariseTeam(match.homeTeam.id, pool, asOf, st), away: summariseTeam(match.awayTeam.id, pool, asOf, st) },
    context: { home: teamContext(match.homeTeam.id, match, pool, st), away: teamContext(match.awayTeam.id, match, pool, st) },
    market: market.rows,
    bookmakerMargin: market.margin,
    generatedAt: new Date().toISOString(),
  };
}
