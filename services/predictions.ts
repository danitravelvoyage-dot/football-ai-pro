import "server-only";
import { DuplicatePredictionError, getStore, KickoffPassedError } from "@/database/store";
import { marketWon, summarise } from "@/lib/metrics";
import { analyseMatch } from "@/services/analysis";
import { getFixturesProvider } from "@/services/providers";
import type { MarketKey, StoredPrediction } from "@/types";

export const MARKETS: MarketKey[] = ["1X2_HOME", "1X2_DRAW", "1X2_AWAY", "OU25_OVER", "OU25_UNDER", "BTTS_YES", "BTTS_NO"];

export type RecordResult =
  | { ok: true; prediction: StoredPrediction }
  | { ok: false; code: "NOT_FOUND" | "STARTED" | "DUPLICATE" | "INVALID_ODDS" };

/**
 * Record a prediction. Probabilities are recomputed SERVER-SIDE from the model at this moment —
 * the client only chooses the market and (optionally) the odds it saw.
 */
export async function recordPrediction(matchId: string, market: MarketKey, oddsTaken: number | null): Promise<RecordResult> {
  const a = await analyseMatch(matchId);
  if (!a) return { ok: false, code: "NOT_FOUND" };
  const m = a.match.data;
  if (!["SCHEDULED", "TIMED"].includes(m.status) || Date.now() >= new Date(m.utcDate).getTime()) return { ok: false, code: "STARTED" };
  if (oddsTaken !== null && !(oddsTaken > 1 && oddsTaken < 1000)) return { ok: false, code: "INVALID_ODDS" };
  const p = a.prediction;
  const over = p.totals.find((t) => t.line === 2.5)!.over;
  const probs: Record<MarketKey, number> = {
    "1X2_HOME": p.oneXTwo.home, "1X2_DRAW": p.oneXTwo.draw, "1X2_AWAY": p.oneXTwo.away,
    OU25_OVER: over, OU25_UNDER: 1 - over, BTTS_YES: p.btts.yes, BTTS_NO: p.btts.no,
  };
  try {
    const prediction = await getStore().insert({
      matchId: m.id, competitionCode: m.competition.code, homeTeam: m.homeTeam.name, awayTeam: m.awayTeam.name, kickoff: m.utcDate,
      modelVersion: p.modelVersion, probHome: p.oneXTwo.home, probDraw: p.oneXTwo.draw, probAway: p.oneXTwo.away,
      probOver25: over, probBttsYes: p.btts.yes, selectedMarket: market, selectedProb: probs[market], oddsTaken, demo: a.match.source.demo,
    });
    return { ok: true, prediction };
  } catch (e) {
    if (e instanceof DuplicatePredictionError) return { ok: false, code: "DUPLICATE" };
    if (e instanceof KickoffPassedError) return { ok: false, code: "STARTED" };
    throw e;
  }
}

/** Settle pending predictions whose matches have finished (only result columns are written). */
export async function settlePending(): Promise<number> {
  const store = getStore();
  const fx = getFixturesProvider();
  let settled = 0;
  for (const p of (await store.pending()).slice(0, 10)) {
    try {
      const m = await fx.getMatch(p.matchId);
      if (!m) continue;
      const { status, score } = m.data;
      if (status === "CANCELLED") {
        await store.voidPrediction(p.id);
        continue;
      }
      if (status !== "FINISHED" || score.fullTime.home === null || score.fullTime.away === null) continue;
      const won = marketWon(p.selectedMarket, score.fullTime.home, score.fullTime.away);
      await store.settle(p.id, score.fullTime.home, score.fullTime.away, won, p.oddsTaken ? (won ? p.oddsTaken - 1 : -1) : null);
      settled++;
    } catch {
      // provider failure: try again on the next request
    }
  }
  return settled;
}

export async function listPredictions() {
  await settlePending();
  const all = await getStore().list();
  return { predictions: all, summary: summarise(all), store: getStore().kind };
}
