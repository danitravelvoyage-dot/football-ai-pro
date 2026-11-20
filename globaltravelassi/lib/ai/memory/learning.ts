import { COUNT_METRICS, MIN_EVIDENCE_SAMPLE, MIN_RELATIVE_LIFT, OUTDATED_AFTER_DAYS } from "./types";
import type { DecisionRecord, ExperimentRecord, ResultRecord } from "./store";

export class EvidenceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EvidenceError";
  }
}

export interface Evidence {
  experimentId: string;
  metric: string;
  variant: string;
  sampleSize: number;
}

export interface Recommendation {
  kind: "hypothesis" | "next_experiment" | "review_strategy";
  statement: string;
  evidence: Evidence[];
}

/** A recommendation must cite evidence, and every cited result must meet the minimum sample. Otherwise it is refused. */
export function requireEvidence(rec: Recommendation): Recommendation {
  if (rec.evidence.length === 0) throw new EvidenceError("A recommendation needs evidence.");
  if (rec.evidence.some((e) => e.sampleSize < MIN_EVIDENCE_SAMPLE)) {
    throw new EvidenceError(`Every result behind a recommendation needs at least ${MIN_EVIDENCE_SAMPLE} samples.`);
  }
  return rec;
}

/** Conversion-style rate for one variant: value over sample. Reply rate is already a rate. */
export function rateOf(r: ResultRecord): number {
  return r.metric === "reply_rate" ? r.value : r.value / r.sampleSize;
}

export type Comparison =
  | { verdict: "insufficient_data"; variants: string[] }
  | { verdict: "inconclusive"; variants: string[] }
  | { verdict: "winner"; winner: string; loser: string; lift: number; evidence: Evidence[] };

/**
 * Compares variants on one metric. A winner needs both variants above the minimum sample, and a relative
 * lift of at least MIN_RELATIVE_LIFT. Otherwise the result is inconclusive or has insufficient data.
 */
export function compareVariants(results: ResultRecord[], metric: string): Comparison {
  const rows = results.filter((r) => r.metric === metric);
  const variants = [...new Set(rows.map((r) => r.variant))].sort();
  if (variants.length < 2) return { verdict: "insufficient_data", variants };
  const perVariant = variants.map((variant) => {
    const mine = rows.filter((r) => r.variant === variant);
    const sample = mine.reduce((s, r) => s + r.sampleSize, 0);
    // Count metrics: total count over total sample. Reply rate: sample-weighted average of the rates.
    const total = mine.reduce((s, r) => s + (COUNT_METRICS.includes(metric as never) ? r.value : r.value * r.sampleSize), 0);
    const rate = total / sample;
    return { variant, sample, rate, rows: mine };
  });
  if (perVariant.some((v) => v.sample < MIN_EVIDENCE_SAMPLE)) return { verdict: "insufficient_data", variants };
  const sorted = [...perVariant].sort((a, b) => b.rate - a.rate);
  const [best, second] = sorted;
  const lift = second.rate === 0 ? (best.rate > 0 ? Infinity : 0) : (best.rate - second.rate) / second.rate;
  if (lift < MIN_RELATIVE_LIFT) return { verdict: "inconclusive", variants };
  const evidence = [best, second].flatMap((v) => v.rows.map((r) => ({ experimentId: r.experimentId, metric: r.metric, variant: r.variant, sampleSize: r.sampleSize })));
  return { verdict: "winner", winner: best.variant, loser: second.variant, lift, evidence };
}

/** Variants that win comparisons in at least two experiments of the same kind. */
export function repeatedPatterns(experiments: ExperimentRecord[], results: ResultRecord[], metric: string): { kind: string; variant: string; experiments: string[] }[] {
  const wins = new Map<string, Set<string>>();
  for (const kind of new Set(experiments.map((e) => e.kind))) {
    const ofKind = experiments.filter((e) => e.kind === kind);
    for (const exp of ofKind) {
      const cmp = compareVariants(results.filter((r) => r.experimentId === exp.id), metric);
      if (cmp.verdict !== "winner") continue;
      const key = `${kind}|${cmp.winner}`;
      wins.set(key, new Set([...(wins.get(key) ?? []), exp.id]));
    }
  }
  return [...wins.entries()]
    .filter(([, ids]) => ids.size >= 2)
    .map(([key, ids]) => {
      const [kind, variant] = key.split("|");
      return { kind, variant, experiments: [...ids].sort() };
    });
}

/** Hypotheses are phrased as things to test, and carry the evidence behind them. */
export function hypothesesFrom(patterns: ReturnType<typeof repeatedPatterns>, results: ResultRecord[], metric: string): Recommendation[] {
  return patterns.map((p) => {
    const evidence = results
      .filter((r) => r.metric === metric && r.variant === p.variant && p.experiments.includes(r.experimentId))
      .map((r) => ({ experimentId: r.experimentId, metric: r.metric, variant: r.variant, sampleSize: r.sampleSize }));
    return requireEvidence({
      kind: "hypothesis",
      statement: `Variant "${p.variant}" has won ${metric} comparisons in ${p.experiments.length} ${p.kind} experiments. Test whether it holds in the next one.`,
      evidence,
    });
  });
}

/** Approved strategies with no newer decision for longer than OUTDATED_AFTER_DAYS. */
export function outdatedStrategies(decisions: DecisionRecord[], now: Date): DecisionRecord[] {
  const cutoff = now.getTime() - OUTDATED_AFTER_DAYS * 86_400_000;
  return decisions.filter((d) => d.subjectType === "strategy" && d.decision === "approved" && Date.parse(d.decidedAt) < cutoff);
}
