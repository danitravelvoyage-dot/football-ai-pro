import { describe, expect, it } from "vitest";
import { getDemoDataset, demoOdds } from "@/services/providers/demoData";
import { computeStandings } from "@/services/providers/demo";
import { poissonDcModel } from "@/models/engine";
import { summariseLeague } from "@/services/leagues";

describe("demo dataset", () => {
  const set = getDemoDataset(new Date("2026-11-13T10:00:00Z"));
  it("never simulates live or future results", () => {
    const today = new Date("2026-11-13T00:00:00Z").getTime();
    for (const m of set.matches) {
      expect(["FINISHED", "TIMED"]).toContain(m.status);
      if (new Date(m.utcDate).getTime() >= today) {
        expect(m.status).toBe("TIMED");
        expect(m.score.fullTime.home).toBeNull();
      }
    }
  });
  it("has today's and tomorrow's fixtures", () => {
    const days = new Set(set.matches.map((m) => m.utcDate.slice(0, 10)));
    expect(days.has("2026-11-13")).toBe(true);
    expect(days.has("2026-11-14")).toBe(true);
  });
  it("standings are consistent", () => {
    const pl = computeStandings(set.matches.filter((m) => m.competition.code === "PL"));
    expect(pl).toHaveLength(20);
    const totalGf = pl.reduce((s, r) => s + r.goalsFor, 0);
    const totalGa = pl.reduce((s, r) => s + r.goalsAgainst, 0);
    expect(totalGf).toBe(totalGa);
    for (const r of pl) expect(r.points).toBe(3 * r.won + r.draw);
  });
  it("demo odds carry a bookmaker margin", () => {
    const m = set.matches.find((x) => x.status === "TIMED")!;
    const books = demoOdds(m, set);
    const h2h = books[0].markets.find((k) => k.key === "h2h")!;
    const over = h2h.outcomes.reduce((s, o) => s + 1 / o.price, 0) - 1;
    expect(over).toBeGreaterThan(0.01);
  });
  it("model runs on every upcoming demo match with probabilities summing to 1", () => {
    for (const m of set.matches.filter((x) => x.status === "TIMED").slice(0, 30)) {
      const pool = set.matches.filter((x) => x.competition.code === m.competition.code);
      const p = poissonDcModel.predict({ match: m, asOf: new Date("2026-11-13T00:00:00Z"), leagueMatches: pool, homeRecent: [], awayRecent: [], h2h: [] });
      expect(Math.abs(p.oneXTwo.home + p.oneXTwo.draw + p.oneXTwo.away - 1)).toBeLessThan(1e-9);
      expect(p.corners).not.toBeNull(); // demo supplies corner stats
    }
  });
  it("league summary rates are proportions", () => {
    const s = summariseLeague(set.matches.filter((m) => m.competition.code === "SA"))!;
    expect(s.homeWinRate + s.drawRate + s.awayWinRate).toBeCloseTo(1, 10);
  });
});

import { resolveDemoMatch } from "@/services/providers/demoData";
describe("demo resolution", () => {
  const set = getDemoDataset(new Date("2026-11-13T10:00:00Z"));
  const m = set.matches.find((x) => x.status === "TIMED")!;
  it("stays scheduled before kickoff + 2h and is deterministic after", () => {
    const k = new Date(m.utcDate).getTime();
    expect(resolveDemoMatch(m, set, k + 3600_000).status).toBe("TIMED");
    const r1 = resolveDemoMatch(m, set, k + 3 * 3600_000);
    const r2 = resolveDemoMatch(m, set, k + 5 * 3600_000);
    expect(r1.status).toBe("FINISHED");
    expect(r1.score.fullTime).toEqual(r2.score.fullTime);
  });
});
