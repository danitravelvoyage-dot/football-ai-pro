import { describe, expect, it } from "vitest";
import { poissonDcModel, headToHeadAdjustment, H2H_MAX_EFFECT } from "@/models/engine";
import { fitRatings, DEFAULT_RATING_OPTIONS } from "@/models/ratings";
import type { Match } from "@/types";

const comp = { code: "TL", name: "Test", country: "X", countryCode: "X", type: "LEAGUE" as const };
const team = (id: string) => ({ id, name: id, shortName: id, tla: id.toUpperCase() });
let n = 0;
function mk(h: string, a: string, gh: number, ga: number, daysAgo: number): Match {
  return {
    id: String(++n), competition: comp, utcDate: new Date(Date.now() - daysAgo * 864e5).toISOString(),
    status: "FINISHED", homeTeam: team(h), awayTeam: team(a),
    score: { fullTime: { home: gh, away: ga }, halfTime: { home: Math.floor(gh / 2), away: Math.floor(ga / 2) } },
  };
}

// strong (s) beats everyone, weak (w) loses to everyone
const hist: Match[] = [];
const teams = ["s", "m1", "m2", "w"];
for (let r = 0; r < 6; r++)
  for (const h of teams) for (const a of teams) {
    if (h === a) continue;
    const gh = h === "s" ? 3 : h === "w" ? 0 : a === "w" ? 2 : 1;
    const ga = a === "s" ? 3 : a === "w" ? 0 : h === "w" ? 2 : 1;
    hist.push(mk(h, a, gh, ga, 10 + r * 20));
  }

describe("ratings", () => {
  const f = fitRatings(hist, { ...DEFAULT_RATING_OPTIONS, asOf: new Date() });
  it("orders attack and defence sensibly", () => {
    expect(f.teams.get("s")!.attack).toBeGreaterThan(f.teams.get("w")!.attack);
    expect(f.teams.get("s")!.defence).toBeLessThan(f.teams.get("w")!.defence);
  });
  it("ignores matches after asOf (no look-ahead)", () => {
    const g = fitRatings(hist, { ...DEFAULT_RATING_OPTIONS, asOf: new Date(Date.now() - 1000 * 864e5) });
    expect(g.matchesUsed).toBe(0);
  });
});

describe("engine", () => {
  const upcoming: Match = { ...mk("s", "w", 0, 0, -2), status: "SCHEDULED", score: { fullTime: { home: null, away: null }, halfTime: { home: null, away: null } } };
  const r = poissonDcModel.predict({ match: upcoming, asOf: new Date(), leagueMatches: hist, homeRecent: [], awayRecent: [], h2h: [] });
  it("1X2 sums to 1 and strong team is favoured", () => {
    expect(Math.abs(r.oneXTwo.home + r.oneXTwo.draw + r.oneXTwo.away - 1)).toBeLessThan(1e-9);
    expect(r.oneXTwo.home).toBeGreaterThan(0.6);
  });
  it("double chance consistent", () => {
    expect(Math.abs(r.doubleChance.homeOrDraw - (r.oneXTwo.home + r.oneXTwo.draw))).toBeLessThan(1e-12);
  });
  it("first half has fewer expected goals", () => {
    expect(r.firstHalf.lambdaHome).toBeLessThan(r.lambdaHome);
  });
  it("no corners/cards market without provider stats", () => {
    expect(r.corners).toBeNull();
    expect(r.cards).toBeNull();
  });
  it("h2h effect is capped", () => {
    const h2h = Array.from({ length: 10 }, (_, i) => mk("w", "s", 5, 0, 30 + i));
    const adj = headToHeadAdjustment(h2h, upcoming, new Date(), 3, 0.3);
    expect(adj).toBeGreaterThanOrEqual(1 - H2H_MAX_EFFECT - 1e-12);
    expect(adj).toBeLessThanOrEqual(1 + H2H_MAX_EFFECT + 1e-12);
  });
});

import { probabilityUncertainty } from "@/models/engine";
describe("probability uncertainty", () => {
  it("shrinks with sample size and matches the fitted values", () => {
    expect(probabilityUncertainty(5)).toBeGreaterThan(probabilityUncertainty(20));
    expect(Math.abs(probabilityUncertainty(11) - 0.0802)).toBeLessThan(0.001);
  });
});
