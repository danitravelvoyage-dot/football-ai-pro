import { describe, expect, it } from "vitest";
import { brier1x2, closingLineValue, logLoss1x2, marketWon, summarise } from "@/lib/metrics";
import type { StoredPrediction } from "@/types";

const close = (a: number, b: number, eps = 1e-9) => expect(Math.abs(a - b)).toBeLessThan(eps);

describe("metrics", () => {
  it("brier score", () => {
    close(brier1x2({ home: 1, draw: 0, away: 0 }, "HOME"), 0);
    close(brier1x2({ home: 0.5, draw: 0.3, away: 0.2 }, "AWAY"), 0.25 + 0.09 + 0.64);
  });
  it("log loss", () => {
    close(logLoss1x2({ home: 0.5, draw: 0.3, away: 0.2 }, "HOME"), -Math.log(0.5));
  });
  it("market settlement", () => {
    expect(marketWon("OU25_OVER", 2, 1)).toBe(true);
    expect(marketWon("OU25_UNDER", 1, 1)).toBe(true);
    expect(marketWon("BTTS_YES", 1, 0)).toBe(false);
    expect(marketWon("1X2_DRAW", 0, 0)).toBe(true);
  });
  it("CLV", () => close(closingLineValue(2.2, 2.0), 0.1));
  it("summary ROI and accuracy", () => {
    const base: StoredPrediction = {
      id: "1", matchId: "m", competitionCode: "PL", homeTeam: "A", awayTeam: "B", kickoff: "", createdAt: "",
      modelVersion: "t", probHome: 0.6, probDraw: 0.25, probAway: 0.15, probOver25: 0.5, probBttsYes: 0.5,
      selectedMarket: "1X2_HOME", selectedProb: 0.6, oddsTaken: 2, closingOdds: 1.9, demo: true,
      status: "SETTLED", homeGoals: 2, awayGoals: 0, settledAt: "", correct: true, profit: 1,
    };
    const s = summarise([base, { ...base, id: "2", homeGoals: 0, awayGoals: 1 }]);
    expect(s.settled).toBe(2);
    close(s.accuracy1x2!, 0.5);
    close(s.profit, 0);
    close(s.roi!, 0);
  });
});
