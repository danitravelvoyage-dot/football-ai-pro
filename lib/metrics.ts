// Forecast evaluation metrics for the prediction tracker.
import type { MarketKey, StoredPrediction } from "@/types";

export type Outcome = "HOME" | "DRAW" | "AWAY";

export function outcomeOf(h: number, a: number): Outcome {
  return h > a ? "HOME" : h === a ? "DRAW" : "AWAY";
}

/** Multi-class Brier score for a 1X2 forecast (0 = perfect, 2 = worst). */
export function brier1x2(p: { home: number; draw: number; away: number }, o: Outcome): number {
  const y = { home: o === "HOME" ? 1 : 0, draw: o === "DRAW" ? 1 : 0, away: o === "AWAY" ? 1 : 0 };
  return (p.home - y.home) ** 2 + (p.draw - y.draw) ** 2 + (p.away - y.away) ** 2;
}

/** Log loss (natural log) of the probability given to the realised outcome. */
export function logLoss1x2(p: { home: number; draw: number; away: number }, o: Outcome): number {
  const q = o === "HOME" ? p.home : o === "DRAW" ? p.draw : p.away;
  return -Math.log(Math.max(q, 1e-15));
}

export function marketWon(market: MarketKey, h: number, a: number): boolean {
  switch (market) {
    case "1X2_HOME":
      return h > a;
    case "1X2_DRAW":
      return h === a;
    case "1X2_AWAY":
      return h < a;
    case "OU25_OVER":
      return h + a > 2.5;
    case "OU25_UNDER":
      return h + a < 2.5;
    case "BTTS_YES":
      return h > 0 && a > 0;
    case "BTTS_NO":
      return h === 0 || a === 0;
  }
}

export function marketGroup(m: MarketKey): "1X2" | "OU25" | "BTTS" {
  return m.startsWith("1X2") ? "1X2" : m.startsWith("OU25") ? "OU25" : "BTTS";
}

/** Closing-line value: positive when the odds taken beat the closing odds. */
export function closingLineValue(oddsTaken: number, closingOdds: number): number {
  return oddsTaken / closingOdds - 1;
}

export interface TrackerSummary {
  total: number;
  settled: number;
  pending: number;
  accuracy1x2: number | null; // argmax of 1X2 probabilities correct
  selectedHitRate: number | null;
  byMarket: { group: string; n: number; hitRate: number | null }[];
  brier: number | null;
  logLoss: number | null;
  staked: number;
  profit: number;
  roi: number | null;
  clv: number | null;
  clvSamples: number;
}

export function summarise(preds: StoredPrediction[]): TrackerSummary {
  const settled = preds.filter((p) => p.status === "SETTLED" && p.homeGoals !== null && p.awayGoals !== null);
  let argmaxCorrect = 0,
    brier = 0,
    ll = 0,
    hits = 0,
    staked = 0,
    profit = 0,
    clv = 0,
    clvN = 0;
  const groups = new Map<string, { n: number; hits: number }>();
  for (const p of settled) {
    const o = outcomeOf(p.homeGoals!, p.awayGoals!);
    const probs = { home: p.probHome, draw: p.probDraw, away: p.probAway };
    const arg: Outcome =
      probs.home >= probs.draw && probs.home >= probs.away ? "HOME" : probs.draw >= probs.away ? "DRAW" : "AWAY";
    if (arg === o) argmaxCorrect++;
    brier += brier1x2(probs, o);
    ll += logLoss1x2(probs, o);
    const won = marketWon(p.selectedMarket, p.homeGoals!, p.awayGoals!);
    if (won) hits++;
    const g = marketGroup(p.selectedMarket);
    const cur = groups.get(g) ?? { n: 0, hits: 0 };
    cur.n++;
    if (won) cur.hits++;
    groups.set(g, cur);
    if (p.oddsTaken) {
      staked += 1;
      profit += won ? p.oddsTaken - 1 : -1;
    }
    if (p.oddsTaken && p.closingOdds) {
      clv += closingLineValue(p.oddsTaken, p.closingOdds);
      clvN++;
    }
  }
  const n = settled.length;
  return {
    total: preds.length,
    settled: n,
    pending: preds.filter((p) => p.status === "PENDING").length,
    accuracy1x2: n ? argmaxCorrect / n : null,
    selectedHitRate: n ? hits / n : null,
    byMarket: ["1X2", "OU25", "BTTS"].map((g) => {
      const v = groups.get(g);
      return { group: g, n: v?.n ?? 0, hitRate: v && v.n ? v.hits / v.n : null };
    }),
    brier: n ? brier / n : null,
    logLoss: n ? ll / n : null,
    staked,
    profit,
    roi: staked ? profit / staked : null,
    clv: clvN ? clv / clvN : null,
    clvSamples: clvN,
  };
}
