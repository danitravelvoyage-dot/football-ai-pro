// Poisson goal model utilities (pure functions, fully unit-tested).
import type { AsianHandicapLine, OneXTwo, OverUnder, ScoreProb } from "@/types";

export const MAX_GOALS = 10;

/** Poisson probability mass function P(X = k) for rate lambda. */
export function poissonPmf(k: number, lambda: number): number {
  if (k < 0 || !Number.isInteger(k)) return 0;
  if (lambda <= 0) return k === 0 ? 1 : 0;
  // compute in log space for numerical stability
  let logFact = 0;
  for (let i = 2; i <= k; i++) logFact += Math.log(i);
  return Math.exp(k * Math.log(lambda) - lambda - logFact);
}

/** Vector of P(X=k) for k = 0..max, with the tail mass folded into the last bucket so it sums to 1. */
export function poissonVector(lambda: number, max = MAX_GOALS): number[] {
  const v: number[] = [];
  let s = 0;
  for (let k = 0; k < max; k++) {
    const p = poissonPmf(k, lambda);
    v.push(p);
    s += p;
  }
  v.push(Math.max(0, 1 - s));
  return v;
}

/**
 * Dixon–Coles low-score dependence correction tau(x, y).
 * rho < 0 slightly increases 0-0 and 1-1 and decreases 1-0 / 0-1.
 */
export function dixonColesTau(x: number, y: number, lh: number, la: number, rho: number): number {
  if (x === 0 && y === 0) return 1 - lh * la * rho;
  if (x === 0 && y === 1) return 1 + lh * rho;
  if (x === 1 && y === 0) return 1 + la * rho;
  if (x === 1 && y === 1) return 1 - rho;
  return 1;
}

/** Joint score probability matrix m[h][a], normalised to sum exactly to 1. */
export function scoreMatrix(lambdaHome: number, lambdaAway: number, rho = 0, max = MAX_GOALS): number[][] {
  const ph = poissonVector(lambdaHome, max);
  const pa = poissonVector(lambdaAway, max);
  const m: number[][] = [];
  let total = 0;
  for (let h = 0; h <= max; h++) {
    const row: number[] = [];
    for (let a = 0; a <= max; a++) {
      const tau = rho !== 0 ? Math.max(0, dixonColesTau(h, a, lambdaHome, lambdaAway, rho)) : 1;
      const p = ph[h] * pa[a] * tau;
      row.push(p);
      total += p;
    }
    m.push(row);
  }
  return m.map((row) => row.map((p) => p / total));
}

export function oneXTwo(m: number[][]): OneXTwo {
  let home = 0,
    draw = 0,
    away = 0;
  for (let h = 0; h < m.length; h++)
    for (let a = 0; a < m[h].length; a++) {
      if (h > a) home += m[h][a];
      else if (h === a) draw += m[h][a];
      else away += m[h][a];
    }
  const s = home + draw + away;
  return { home: home / s, draw: draw / s, away: away / s };
}

export function totalGoals(m: number[][], lines: number[]): OverUnder[] {
  return lines.map((line) => {
    let under = 0;
    for (let h = 0; h < m.length; h++)
      for (let a = 0; a < m[h].length; a++) if (h + a < line) under += m[h][a];
    return { line, under, over: 1 - under };
  });
}

export function btts(m: number[][]): { yes: number; no: number } {
  let yes = 0;
  for (let h = 1; h < m.length; h++) for (let a = 1; a < m[h].length; a++) yes += m[h][a];
  return { yes, no: 1 - yes };
}

/** Marginal over/under lines for a single team, taken from the joint matrix. */
export function teamGoals(m: number[][], side: "home" | "away", lines: number[]): OverUnder[] {
  const marg = new Array(m.length).fill(0);
  for (let h = 0; h < m.length; h++)
    for (let a = 0; a < m[h].length; a++) marg[side === "home" ? h : a] += m[h][a];
  return lines.map((line) => {
    let under = 0;
    for (let k = 0; k < marg.length; k++) if (k < line) under += marg[k];
    return { line, under, over: 1 - under };
  });
}

export function topScores(m: number[][], n = 10): ScoreProb[] {
  const all: ScoreProb[] = [];
  for (let h = 0; h < m.length; h++) for (let a = 0; a < m[h].length; a++) all.push({ home: h, away: a, p: m[h][a] });
  return all.sort((x, y) => y.p - x.p).slice(0, n);
}

/** Distribution of goal difference (home - away). */
export function goalDiffDistribution(m: number[][]): Map<number, number> {
  const d = new Map<number, number>();
  for (let h = 0; h < m.length; h++)
    for (let a = 0; a < m[h].length; a++) d.set(h - a, (d.get(h - a) ?? 0) + m[h][a]);
  return d;
}

/**
 * Asian handicap for whole and half lines (handicap applied to HOME).
 * Quarter lines (e.g. -0.25) are split stakes: half on each adjacent line.
 */
export function asianHandicap(m: number[][], line: number): AsianHandicapLine {
  const frac = Math.abs(line * 4) % 2;
  if (frac === 1) {
    // quarter line: average of the two neighbouring lines
    const lo = asianHandicap(m, line - 0.25);
    const hi = asianHandicap(m, line + 0.25);
    return {
      line,
      homeWin: (lo.homeWin + hi.homeWin) / 2,
      push: (lo.push + hi.push) / 2,
      awayWin: (lo.awayWin + hi.awayWin) / 2,
    };
  }
  const dist = goalDiffDistribution(m);
  let homeWin = 0,
    push = 0,
    awayWin = 0;
  for (const [gd, p] of dist) {
    const adj = gd + line;
    if (Math.abs(adj) < 1e-9) push += p;
    else if (adj > 0) homeWin += p;
    else awayWin += p;
  }
  return { line, homeWin, push, awayWin };
}

/** Poisson over/under for count markets (corners, cards). */
export function poissonOverUnder(lambda: number, lines: number[]): OverUnder[] {
  return lines.map((line) => {
    let under = 0;
    for (let k = 0; k < line; k++) under += poissonPmf(k, lambda);
    return { line, under, over: 1 - under };
  });
}

/**
 * Round a set of probabilities to percentages with `decimals` places so that the
 * displayed values sum to EXACTLY 100 (largest remainder method).
 */
export function roundToHundred(probs: number[], decimals = 1): number[] {
  const factor = Math.pow(10, decimals);
  const total = probs.reduce((a, b) => a + b, 0);
  const target = 100 * factor;
  const raw = probs.map((p) => (total > 0 ? (p / total) * target : target / probs.length));
  const floored = raw.map(Math.floor);
  let remainder = target - floored.reduce((a, b) => a + b, 0);
  const order = raw
    .map((r, i) => ({ i, frac: r - Math.floor(r) }))
    .sort((a, b) => b.frac - a.frac);
  for (let k = 0; remainder > 0 && k < order.length; k++, remainder--) floored[order[k].i] += 1;
  return floored.map((x) => x / factor);
}
