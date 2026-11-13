// Prediction engine: turns retrieved match data into a full market probability set.
// Modular: any model implementing `PredictionModel` can be registered (e.g. a future ML model).
import type { CountMarket, DataQuality, Match, PredictionResult } from "@/types";
import {
  asianHandicap,
  btts,
  oneXTwo,
  poissonOverUnder,
  scoreMatrix,
  teamGoals,
  topScores,
  totalGoals,
} from "./poisson";
import { clamp, DEFAULT_RATING_OPTIONS, finishedBefore, fitRatings, ratingFor } from "./ratings";

export interface ModelContext {
  match: Match;
  asOf: Date; // prediction time — no data on/after this instant is used
  leagueMatches: Match[]; // competition matches (season)
  homeRecent: Match[]; // home team's recent matches (any competition)
  awayRecent: Match[];
  h2h: Match[];
}

export interface PredictionModel {
  id: string;
  version: string;
  description: string;
  predict(ctx: ModelContext): PredictionResult;
}

export const GOAL_LINES = [0.5, 1.5, 2.5, 3.5, 4.5];
export const TEAM_LINES = [0.5, 1.5, 2.5];
export const AH_LINES = [-2.5, -2, -1.5, -1, -0.75, -0.5, -0.25, 0, 0.25, 0.5, 0.75, 1, 1.5, 2, 2.5];
export const DEFAULT_FIRST_HALF_SHARE = 0.45; // documented prior (≈45% of goals occur before half-time)
export const DC_RHO = -0.06; // Dixon–Coles low-score correction (literature range −0.03..−0.13)
export const H2H_MAX_EFFECT = 0.05; // head-to-head can move expected goals by at most ±5%

/**
 * Standard error of a model outcome probability as a function of the smaller team sample.
 * Fitted on walk-forward simulations (RMSE of model vs true probability: ≈0.094 at 5 matches,
 * ≈0.079 at 11, ≈0.077 at 16): SE(n) = 0.05 + 0.10 / √n.
 */
export function probabilityUncertainty(minTeamMatches: number): number {
  return 0.05 + 0.1 / Math.sqrt(Math.max(1, minTeamMatches));
}

export const poissonDcModel: PredictionModel = {
  id: "poisson-dc",
  version: "poisson-dc-1.0.0",
  description: "Time-weighted Poisson with Dixon–Coles correction, attack/defence ratings and home advantage",
  predict(ctx) {
    const { match, asOf } = ctx;
    const pool = [...ctx.leagueMatches, ...ctx.homeRecent, ...ctx.awayRecent];
    const fitted = fitRatings(pool, { ...DEFAULT_RATING_OPTIONS, asOf });
    const home = ratingFor(fitted, match.homeTeam.id);
    const away = ratingFor(fitted, match.awayTeam.id);

    let lh = fitted.base * fitted.homeAdvantage * home.attack * away.defence;
    let la = fitted.base * away.attack * home.defence;

    // Neutral venue (e.g. finals): remove home advantage symmetrically
    if (match.stage === "FINAL") {
      const g = Math.sqrt(fitted.homeAdvantage);
      lh /= g;
      la *= g;
    }

    // Head-to-head: low-weight, capped adjustment
    const h2hAdj = headToHeadAdjustment(ctx.h2h, match, asOf, lh, la);
    lh *= h2hAdj;
    la /= h2hAdj;

    lh = clamp(lh, 0.15, 5);
    la = clamp(la, 0.15, 5);

    const m = scoreMatrix(lh, la, DC_RHO);
    const x12 = oneXTwo(m);

    const share = firstHalfShare(pool, asOf);
    const mh = scoreMatrix(lh * share.share, la * share.share, 0);

    const quality = assessQuality(
      countTeam(pool, match.homeTeam.id, asOf),
      countTeam(pool, match.awayTeam.id, asOf),
      fitted.matchesUsed,
      fitted.usesXg,
      share.observed,
    );

    return {
      modelVersion: this.version,
      lambdaHome: lh,
      lambdaAway: la,
      oneXTwo: x12,
      doubleChance: {
        homeOrDraw: x12.home + x12.draw,
        awayOrDraw: x12.away + x12.draw,
        homeOrAway: x12.home + x12.away,
      },
      totals: totalGoals(m, GOAL_LINES),
      btts: btts(m),
      correctScores: topScores(m, 12),
      scoreGrid: m.slice(0, 6).map((r) => r.slice(0, 6)),
      homeGoals: teamGoals(m, "home", TEAM_LINES),
      awayGoals: teamGoals(m, "away", TEAM_LINES),
      firstHalf: {
        lambdaHome: lh * share.share,
        lambdaAway: la * share.share,
        oneXTwo: oneXTwo(mh),
        totals: totalGoals(mh, [0.5, 1.5, 2.5]),
        shareOfGoals: share.share,
      },
      asianHandicap: quality.level === "LOW" ? null : AH_LINES.map((l) => asianHandicap(m, l)),
      corners: countMarket(pool, match, asOf, "corners", [7.5, 8.5, 9.5, 10.5, 11.5]),
      cards: countMarket(pool, match, asOf, "cards", [2.5, 3.5, 4.5, 5.5]),
      ratings: { home, away, homeAdvantage: fitted.homeAdvantage, baseRate: fitted.base },
      h2hAdjustment: h2hAdj,
      probUncertainty: probabilityUncertainty(Math.min(quality.homeMatches, quality.awayMatches)),
      dataQuality: quality,
    };
  },
};

const MODELS: Record<string, PredictionModel> = { [poissonDcModel.id]: poissonDcModel };
export function getModel(id = "poisson-dc"): PredictionModel {
  return MODELS[id] ?? poissonDcModel;
}
export function registerModel(model: PredictionModel) {
  MODELS[model.id] = model;
}

// ------------------------------------------------------------------

export function headToHeadAdjustment(h2h: Match[], match: Match, asOf: Date, lh: number, la: number): number {
  const past = finishedBefore(h2h, asOf).filter(
    (m) =>
      [m.homeTeam.id, m.awayTeam.id].includes(match.homeTeam.id) &&
      [m.homeTeam.id, m.awayTeam.id].includes(match.awayTeam.id),
  );
  if (past.length < 3) return 1;
  let forHome = 0,
    total = 0;
  for (const m of past) {
    const gh = m.score.fullTime.home!,
      ga = m.score.fullTime.away!;
    forHome += m.homeTeam.id === match.homeTeam.id ? gh : ga;
    total += gh + ga;
  }
  if (total === 0) return 1;
  const observed = forHome / total;
  const expected = lh / (lh + la);
  // weight grows with sample size but never exceeds H2H_MAX_EFFECT
  const w = Math.min(1, past.length / 10);
  return clamp(1 + (observed - expected) * 0.2 * w, 1 - H2H_MAX_EFFECT, 1 + H2H_MAX_EFFECT);
}

export function firstHalfShare(ms: Match[], asOf: Date): { share: number; observed: boolean } {
  let ht = 0,
    ft = 0,
    n = 0;
  const seen = new Set<string>();
  for (const m of finishedBefore(ms, asOf)) {
    if (seen.has(m.id)) continue;
    seen.add(m.id);
    const { halfTime, fullTime } = m.score;
    if (halfTime.home === null || halfTime.away === null) continue;
    ht += halfTime.home + halfTime.away;
    ft += (fullTime.home ?? 0) + (fullTime.away ?? 0);
    n++;
  }
  if (n < 20 || ft === 0) return { share: DEFAULT_FIRST_HALF_SHARE, observed: false };
  return { share: clamp(ht / ft, 0.35, 0.55), observed: true };
}

function countTeam(ms: Match[], teamId: string, asOf: Date): number {
  const ids = new Set<string>();
  for (const m of finishedBefore(ms, asOf))
    if (m.homeTeam.id === teamId || m.awayTeam.id === teamId) ids.add(m.id);
  return ids.size;
}

export function assessQuality(
  homeMatches: number,
  awayMatches: number,
  leagueMatches: number,
  usesXg: boolean,
  halfTimeObserved: boolean,
): DataQuality {
  const score =
    0.35 * Math.min(1, homeMatches / 20) +
    0.35 * Math.min(1, awayMatches / 20) +
    0.2 * Math.min(1, leagueMatches / 150) +
    (usesXg ? 0.1 : 0);
  const notes: string[] = [];
  if (homeMatches < 10 || awayMatches < 10) notes.push("dq.fewTeamMatches");
  if (leagueMatches < 100) notes.push("dq.fewLeagueMatches");
  if (!usesXg) notes.push("dq.noXg");
  if (!halfTimeObserved) notes.push("dq.htPrior");
  return {
    score,
    level: score >= 0.75 ? "HIGH" : score >= 0.45 ? "MEDIUM" : "LOW",
    homeMatches,
    awayMatches,
    leagueMatches,
    usesXg,
    notes,
  };
}

function countMarket(
  pool: Match[],
  match: Match,
  asOf: Date,
  key: "corners" | "cards",
  lines: number[],
): CountMarket | null {
  const seen = new Set<string>();
  const agg = (teamId: string) => {
    let f = 0,
      a = 0,
      n = 0;
    for (const m of finishedBefore(pool, asOf)) {
      const s = m.stats?.[key];
      if (!s || s.home === null || s.away === null) continue;
      const k = `${teamId}:${m.id}`;
      if (seen.has(k)) continue;
      seen.add(k);
      if (m.homeTeam.id === teamId) {
        f += s.home;
        a += s.away;
        n++;
      } else if (m.awayTeam.id === teamId) {
        f += s.away;
        a += s.home;
        n++;
      }
    }
    return n ? { f: f / n, a: a / n, n } : null;
  };
  const h = agg(match.homeTeam.id);
  const aw = agg(match.awayTeam.id);
  if (!h || !aw || h.n < 5 || aw.n < 5) return null; // not enough provider data → no market
  const expected = (h.f + aw.a) / 2 + (aw.f + h.a) / 2;
  return { expected, lines: poissonOverUnder(expected, lines), basedOnMatches: Math.min(h.n, aw.n) };
}
