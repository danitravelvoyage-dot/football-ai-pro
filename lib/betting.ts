// Betting maths: implied probability, margin removal, expected value, Kelly staking.
// Positive EV is *model-dependent* and never a guarantee of profit.

export function impliedProbability(decimalOdds: number): number {
  if (!(decimalOdds > 1)) throw new Error("Decimal odds must be greater than 1");
  return 1 / decimalOdds;
}

/** Bookmaker overround (margin) of a complete market, e.g. 0.05 = 5%. */
export function overround(odds: number[]): number {
  return odds.reduce((s, o) => s + 1 / o, 0) - 1;
}

/** Proportional (basic normalisation) margin removal. */
export function removeMarginProportional(odds: number[]): number[] {
  const inv = odds.map((o) => 1 / o);
  const s = inv.reduce((a, b) => a + b, 0);
  return inv.map((p) => p / s);
}

/**
 * Power method margin removal: find k such that sum(p_i^k) = 1 where p_i = 1/odds_i.
 * Handles favourite–longshot bias better than proportional normalisation.
 */
export function removeMarginPower(odds: number[]): number[] {
  const inv = odds.map((o) => 1 / o);
  const sum = (k: number) => inv.reduce((s, p) => s + Math.pow(p, k), 0);
  if (Math.abs(sum(1) - 1) < 1e-12) return inv;
  let lo = 0.5,
    hi = 3;
  for (let i = 0; i < 100; i++) {
    const mid = (lo + hi) / 2;
    if (sum(mid) > 1) lo = mid;
    else hi = mid;
  }
  const k = (lo + hi) / 2;
  const out = inv.map((p) => Math.pow(p, k));
  const s = out.reduce((a, b) => a + b, 0);
  return out.map((p) => p / s);
}

/** Expected value per unit stake: EV = p × odds − 1. */
export function expectedValue(modelProb: number, decimalOdds: number): number {
  return modelProb * decimalOdds - 1;
}

/** Fair (zero-margin) decimal odds for a probability. */
export function fairOdds(p: number): number {
  return p > 0 ? 1 / p : Infinity;
}

/**
 * Full Kelly fraction f* = (b·p − q) / b with b = odds − 1. Returns 0 when there is no edge.
 */
export function kellyFraction(modelProb: number, decimalOdds: number): number {
  const b = decimalOdds - 1;
  if (b <= 0) return 0;
  const f = (b * modelProb - (1 - modelProb)) / b;
  return Math.max(0, f);
}

export const KELLY_FRACTIONS = [0.1, 0.25, 0.5] as const;
export const MAX_STAKE_FRACTION = 0.05; // hard cap: never suggest more than 5% of bankroll

export function suggestedStake(bankroll: number, modelProb: number, odds: number, fraction: number): number {
  const f = Math.min(kellyFraction(modelProb, odds) * fraction, MAX_STAKE_FRACTION);
  return Math.max(0, bankroll * f);
}

export interface ValueAssessment {
  modelProb: number;
  odds: number;
  impliedProb: number;
  fairMarketProb: number | null;
  edge: number; // model − fair market (or implied when no fair available)
  ev: number;
  /** EV after subtracting the model's probability uncertainty: (p − SE) × odds − 1. */
  conservativeEv: number;
  kelly: number;
  isValue: boolean;
  reasonKey: string;
}

export const MIN_QUALITY_FOR_VALUE = 0.45;
/**
 * Sanity guard: bookmaker markets are usually well calibrated. When the model exceeds the
 * margin-free market probability by more than this, the gap is far more likely to be model error
 * or information the model lacks (injuries, lineups, small samples) than a genuine edge.
 */
export const MAX_PLAUSIBLE_EDGE = 0.1;

/**
 * A selection is labelled "value" ONLY when EV stays positive after subtracting the model's
 * probability uncertainty, the data quality score is sufficient, and the model–market gap is plausible.
 */
export function assessValue(
  modelProb: number,
  odds: number,
  fairMarketProb: number | null,
  dataQualityScore: number,
  uncertainty = 0,
): ValueAssessment {
  const ev = expectedValue(modelProb, odds);
  const conservativeEv = expectedValue(Math.max(0, modelProb - uncertainty), odds);
  const impliedProb = impliedProbability(odds);
  const edge = modelProb - (fairMarketProb ?? impliedProb);
  const reliable = dataQualityScore >= MIN_QUALITY_FOR_VALUE;
  const plausible = edge <= MAX_PLAUSIBLE_EDGE;
  let reasonKey = "value.noEdge";
  if (ev > 0 && !reliable) reasonKey = "value.unreliable";
  else if (ev > 0 && !plausible) reasonKey = "value.suspicious";
  else if (ev > 0 && conservativeEv <= 0) reasonKey = "value.withinNoise";
  else if (ev > 0) reasonKey = "value.positive";
  return {
    modelProb,
    odds,
    impliedProb,
    fairMarketProb,
    edge,
    ev,
    conservativeEv,
    kelly: kellyFraction(modelProb, odds),
    isValue: conservativeEv > 0 && reliable && plausible,
    reasonKey,
  };
}
