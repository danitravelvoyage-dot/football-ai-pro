// Team attack/defence ratings fitted with a time-weighted multiplicative Poisson model
// (Maher 1982 / Dixon–Coles 1997 style) solved by iterative proportional fitting.
//
//   lambda_home = base * homeAdv * attack[home] * defence[away]
//   lambda_away = base *           attack[away] * defence[home]
//
// - Exponential time decay gives recent matches more weight (form weighting).
// - Shrinkage toward 1.0 (league average) protects against small samples.
// - When xG is available, the "goal" signal is a blend of xG and actual goals.
import type { Match, TeamRatings } from "@/types";

export interface RatingOptions {
  asOf: Date; // only matches strictly before this instant are used (no look-ahead)
  halfLifeDays: number;
  shrinkageMatches: number; // pseudo-matches at league average added to every team
  xgWeight: number; // 0..1 weight of xG vs goals when xG exists
  iterations: number;
}

export const DEFAULT_RATING_OPTIONS: Omit<RatingOptions, "asOf"> = {
  halfLifeDays: 120,
  shrinkageMatches: 4,
  xgWeight: 0.6,
  iterations: 40,
};

export interface FittedRatings {
  teams: Map<string, TeamRatings>;
  base: number; // average away-goal rate (goals per team per match without home advantage)
  homeAdvantage: number;
  matchesUsed: number;
  usesXg: boolean;
  avgHomeGoals: number;
  avgAwayGoals: number;
}

interface Obs {
  home: string;
  away: string;
  gh: number;
  ga: number;
  w: number;
}

export function finishedBefore(matches: Match[], asOf: Date): Match[] {
  return matches.filter(
    (m) =>
      m.status === "FINISHED" &&
      m.score.fullTime.home !== null &&
      m.score.fullTime.away !== null &&
      new Date(m.utcDate).getTime() < asOf.getTime(),
  );
}

export function fitRatings(allMatches: Match[], opts: RatingOptions): FittedRatings {
  const matches = dedupe(finishedBefore(allMatches, opts.asOf));
  const decay = Math.log(2) / opts.halfLifeDays;
  let usesXg = false;

  const obs: Obs[] = matches.map((m) => {
    const days = (opts.asOf.getTime() - new Date(m.utcDate).getTime()) / 86_400_000;
    const w = Math.exp(-decay * Math.max(0, days));
    let gh = m.score.fullTime.home as number;
    let ga = m.score.fullTime.away as number;
    const xg = m.stats?.xg;
    if (xg && xg.home !== null && xg.away !== null) {
      usesXg = true;
      gh = opts.xgWeight * xg.home + (1 - opts.xgWeight) * gh;
      ga = opts.xgWeight * xg.away + (1 - opts.xgWeight) * ga;
    }
    return { home: m.homeTeam.id, away: m.awayTeam.id, gh, ga, w };
  });

  const teamIds = new Set<string>();
  const counts = new Map<string, number>();
  for (const o of obs) {
    teamIds.add(o.home);
    teamIds.add(o.away);
    counts.set(o.home, (counts.get(o.home) ?? 0) + 1);
    counts.set(o.away, (counts.get(o.away) ?? 0) + 1);
  }

  const sumW = obs.reduce((s, o) => s + o.w, 0);
  const avgHome = sumW > 0 ? obs.reduce((s, o) => s + o.w * o.gh, 0) / sumW : 1.5;
  const avgAway = sumW > 0 ? obs.reduce((s, o) => s + o.w * o.ga, 0) / sumW : 1.2;
  // Long-run football priors used when there is little data
  const base = sumW > 0 ? Math.max(0.3, avgAway) : 1.2;
  let homeAdv = sumW > 0 ? clamp(avgHome / Math.max(0.3, avgAway), 0.9, 1.6) : 1.25;

  const att = new Map<string, number>();
  const def = new Map<string, number>();
  for (const t of teamIds) {
    att.set(t, 1);
    def.set(t, 1);
  }
  const k = opts.shrinkageMatches;

  for (let it = 0; it < opts.iterations && obs.length > 0; it++) {
    // update attack
    const scored = new Map<string, number>();
    const expScored = new Map<string, number>();
    const conceded = new Map<string, number>();
    const expConceded = new Map<string, number>();
    for (const o of obs) {
      const eh = base * homeAdv * def.get(o.away)!; // expected for home before its attack
      const ea = base * def.get(o.home)!;
      add(scored, o.home, o.w * o.gh);
      add(expScored, o.home, o.w * eh);
      add(scored, o.away, o.w * o.ga);
      add(expScored, o.away, o.w * ea);
    }
    for (const t of teamIds) {
      // shrinkage: k pseudo-matches where the team performs exactly at average
      const prior = k * base * Math.sqrt(homeAdv);
      att.set(t, (scored.get(t)! + prior) / (expScored.get(t)! + prior));
    }
    normaliseMean(att);
    // update defence
    for (const o of obs) {
      const eh = base * homeAdv * att.get(o.home)!; // expected conceded by away before its defence
      const ea = base * att.get(o.away)!;
      add(conceded, o.away, o.w * o.gh);
      add(expConceded, o.away, o.w * eh);
      add(conceded, o.home, o.w * o.ga);
      add(expConceded, o.home, o.w * ea);
    }
    for (const t of teamIds) {
      const prior = k * base * Math.sqrt(homeAdv);
      def.set(t, (conceded.get(t)! + prior) / (expConceded.get(t)! + prior));
    }
    normaliseMean(def);
    // update home advantage
    let num = 0,
      den = 0;
    for (const o of obs) {
      num += o.w * o.gh;
      den += o.w * base * att.get(o.home)! * def.get(o.away)!;
    }
    if (den > 0) homeAdv = clamp(num / den, 0.9, 1.6);
  }

  const teams = new Map<string, TeamRatings>();
  for (const t of teamIds)
    teams.set(t, { teamId: t, attack: att.get(t)!, defence: def.get(t)!, matches: counts.get(t) ?? 0 });

  return {
    teams,
    base,
    homeAdvantage: homeAdv,
    matchesUsed: obs.length,
    usesXg,
    avgHomeGoals: avgHome,
    avgAwayGoals: avgAway,
  };
}

export function ratingFor(f: FittedRatings, teamId: string): TeamRatings {
  return f.teams.get(teamId) ?? { teamId, attack: 1, defence: 1, matches: 0 };
}

function dedupe(ms: Match[]): Match[] {
  const seen = new Set<string>();
  return ms.filter((m) => (seen.has(m.id) ? false : (seen.add(m.id), true)));
}
function add(m: Map<string, number>, k: string, v: number) {
  m.set(k, (m.get(k) ?? 0) + v);
}
function normaliseMean(m: Map<string, number>) {
  if (m.size === 0) return;
  // geometric mean normalisation keeps the multiplicative model identifiable
  let s = 0;
  for (const v of m.values()) s += Math.log(Math.max(v, 1e-6));
  const g = Math.exp(s / m.size);
  for (const [k, v] of m) m.set(k, v / g);
}
export function clamp(x: number, lo: number, hi: number) {
  return Math.min(hi, Math.max(lo, x));
}
