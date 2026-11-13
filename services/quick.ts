// Lightweight predictions for match lists: one competition-matches request per competition (cached),
// instead of the full per-match analysis. Used by dashboard cards, markets list and the value scanner.
import "server-only";
import { cached } from "@/lib/cache";
import { getModel } from "@/models/engine";
import { buildMarket, type MarketRow } from "@/services/analysis";
import { getFixturesProvider, getOddsProvider } from "@/services/providers";
import type { Match, PredictionResult } from "@/types";
import { isUnavailable } from "@/types";

export async function quickPredictions(matches: Match[]): Promise<Map<string, PredictionResult>> {
  const fx = getFixturesProvider();
  const out = new Map<string, PredictionResult>();
  const byComp = new Map<string, Match[]>();
  for (const m of matches) byComp.set(m.competition.code, [...(byComp.get(m.competition.code) ?? []), m]);
  await Promise.all(
    [...byComp.entries()].map(async ([code, ms]) => {
      const res = await fx.getCompetitionMatches(code, { fast: true });
      // No data (rate limit, plan restriction) → no probabilities shown, never numbers from an empty model.
      if (isUnavailable(res)) return;
      const pool = res.data;
      if (pool.filter((x) => x.status === "FINISHED").length < 20) return;
      for (const m of ms) {
        const { value } = await cached(`quick:${fx.name}:${m.id}:${m.status}`, 10 * 60_000, async () => {
          const asOf = new Date(Math.min(Date.now(), new Date(m.utcDate).getTime()));
          return getModel().predict({ match: m, asOf, leagueMatches: pool, homeRecent: [], awayRecent: [], h2h: [] });
        });
        out.set(m.id, value);
      }
    }),
  );
  return out;
}

export interface ScannerRow {
  match: Match;
  row: MarketRow;
  quality: number;
  demo: boolean;
}

/** Model vs market rows for upcoming matches that have odds. */
export async function scanMarkets(matches: Match[]): Promise<{ rows: ScannerRow[]; oddsAvailable: boolean; oddsReason: string | null }> {
  const upcoming = matches.filter((m) => ["SCHEDULED", "TIMED"].includes(m.status)).slice(0, 60);
  const preds = await quickPredictions(upcoming);
  const odds = getOddsProvider();
  const rows: ScannerRow[] = [];
  let oddsReason: string | null = null;
  let any = false;
  for (const m of upcoming) {
    const p = preds.get(m.id);
    if (!p) continue;
    const o = await odds.getOdds(m);
    if (isUnavailable(o)) {
      oddsReason = oddsReason ?? o.reasonKey;
      continue;
    }
    any = true;
    const market = buildMarket(p, o.data, p.dataQuality.score);
    for (const r of market.rows) if (r.assessment) rows.push({ match: m, row: r, quality: p.dataQuality.score, demo: o.source.demo });
  }
  rows.sort((a, b) => b.row.assessment!.ev - a.row.assessment!.ev);
  return { rows, oddsAvailable: any, oddsReason: any ? null : oddsReason };
}
