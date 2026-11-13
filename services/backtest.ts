// Walk-forward backtest: every match is predicted using ONLY matches played before its kickoff.
import "server-only";
import { cached } from "@/lib/cache";
import { brier1x2, logLoss1x2, outcomeOf } from "@/lib/metrics";
import { getModel } from "@/models/engine";
import { getFixturesProvider } from "@/services/providers";
import { isUnavailable } from "@/types";

export interface BacktestResult {
  competition: string;
  modelVersion: string;
  n: number;
  accuracy: number;
  brier: number;
  logLoss: number;
  baselineBrier: number; // uniform 1/3 forecast
  calibration: { bucket: string; predicted: number; observed: number; n: number }[];
  over25: { n: number; accuracy: number };
  demo: boolean;
  provider: string;
}

export async function runBacktest(code: string): Promise<BacktestResult | null> {
  const fx = getFixturesProvider();
  const { value } = await cached(`backtest:${fx.name}:${code}`, 60 * 60_000, async () => {
    const res = await fx.getCompetitionMatches(code);
    if (isUnavailable(res)) return null;
    const all = res.data.filter((m) => m.status === "FINISHED").sort((a, b) => a.utcDate.localeCompare(b.utcDate));
    const warmup = Math.max(30, Math.floor(all.length * 0.3));
    const model = getModel();
    let n = 0, correct = 0, brier = 0, ll = 0, ouN = 0, ouCorrect = 0;
    const buckets = Array.from({ length: 10 }, () => ({ p: 0, o: 0, n: 0 }));
    for (let i = warmup; i < all.length; i++) {
      const m = all[i];
      const asOf = new Date(m.utcDate);
      const pred = model.predict({ match: m, asOf, leagueMatches: all.slice(0, i), homeRecent: [], awayRecent: [], h2h: [] });
      const o = outcomeOf(m.score.fullTime.home!, m.score.fullTime.away!);
      const p = pred.oneXTwo;
      const arg = p.home >= p.draw && p.home >= p.away ? "HOME" : p.draw >= p.away ? "DRAW" : "AWAY";
      if (arg === o) correct++;
      brier += brier1x2(p, o);
      ll += logLoss1x2(p, o);
      n++;
      const pHome = p.home;
      const b = buckets[Math.min(9, Math.floor(pHome * 10))];
      b.p += pHome; b.o += o === "HOME" ? 1 : 0; b.n++;
      const over = pred.totals.find((t) => t.line === 2.5)!.over;
      const goals = m.score.fullTime.home! + m.score.fullTime.away!;
      ouN++;
      if ((over >= 0.5) === goals > 2.5) ouCorrect++;
    }
    if (n === 0) return null;
    return {
      competition: code,
      modelVersion: model.version,
      n,
      accuracy: correct / n,
      brier: brier / n,
      logLoss: ll / n,
      baselineBrier: 2 / 3,
      calibration: buckets.map((b, i) => ({ bucket: `${i * 10}-${i * 10 + 10}%`, predicted: b.n ? b.p / b.n : 0, observed: b.n ? b.o / b.n : 0, n: b.n })).filter((b) => b.n > 0),
      over25: { n: ouN, accuracy: ouN ? ouCorrect / ouN : 0 },
      demo: fx.demo,
      provider: fx.name,
    } satisfies BacktestResult;
  });
  return value;
}
