import { describe, expect, it } from "vitest";
import {
  asianHandicap, btts, dixonColesTau, oneXTwo, poissonPmf, poissonVector,
  roundToHundred, scoreMatrix, teamGoals, topScores, totalGoals,
} from "@/models/poisson";

const close = (a: number, b: number, eps = 1e-9) => expect(Math.abs(a - b)).toBeLessThan(eps);

describe("poisson pmf", () => {
  it("matches closed-form values", () => {
    close(poissonPmf(0, 1.5), Math.exp(-1.5));
    close(poissonPmf(2, 1.5), (1.5 ** 2 * Math.exp(-1.5)) / 2);
    expect(poissonPmf(-1, 1)).toBe(0);
    expect(poissonPmf(0, 0)).toBe(1);
  });
  it("vector sums to 1 including tail", () => {
    close(poissonVector(2.7).reduce((a, b) => a + b, 0), 1);
  });
});

describe("score matrix", () => {
  for (const rho of [0, -0.06]) {
    it(`sums to 1 (rho=${rho})`, () => {
      const m = scoreMatrix(1.6, 1.1, rho);
      close(m.flat().reduce((a, b) => a + b, 0), 1);
    });
  }
  it("1X2 sums to 1 and favours the stronger side", () => {
    const r = oneXTwo(scoreMatrix(2.0, 0.8));
    close(r.home + r.draw + r.away, 1);
    expect(r.home).toBeGreaterThan(r.away);
  });
  it("is symmetric for equal rates", () => {
    const r = oneXTwo(scoreMatrix(1.3, 1.3));
    close(r.home, r.away, 1e-12);
  });
  it("Dixon-Coles negative rho raises 0-0 and lowers 1-0", () => {
    expect(dixonColesTau(0, 0, 1.4, 1.1, -0.1)).toBeGreaterThan(1);
    expect(dixonColesTau(1, 0, 1.4, 1.1, -0.1)).toBeLessThan(1);
    expect(dixonColesTau(2, 3, 1.4, 1.1, -0.1)).toBe(1);
  });
});

describe("goal markets", () => {
  const lh = 1.5, la = 1.2;
  const m = scoreMatrix(lh, la);
  it("over/under are complements and monotone", () => {
    const t = totalGoals(m, [0.5, 1.5, 2.5, 3.5]);
    for (const x of t) close(x.over + x.under, 1);
    for (let i = 1; i < t.length; i++) expect(t[i].over).toBeLessThan(t[i - 1].over);
  });
  it("under 0.5 equals P(0-0) = e^-(lh+la) for independent Poisson", () => {
    close(totalGoals(m, [0.5])[0].under, Math.exp(-(lh + la)), 1e-6);
  });
  it("BTTS equals (1-e^-lh)(1-e^-la) for independent Poisson", () => {
    close(btts(m).yes, (1 - Math.exp(-lh)) * (1 - Math.exp(-la)), 1e-6);
  });
  it("team goals over 0.5 = 1 - e^-lambda", () => {
    close(teamGoals(m, "home", [0.5])[0].over, 1 - Math.exp(-lh), 1e-6);
    close(teamGoals(m, "away", [0.5])[0].over, 1 - Math.exp(-la), 1e-6);
  });
  it("correct scores sorted descending", () => {
    const s = topScores(m, 5);
    for (let i = 1; i < s.length; i++) expect(s[i].p).toBeLessThanOrEqual(s[i - 1].p);
  });
});

describe("asian handicap", () => {
  const m = scoreMatrix(1.7, 1.0);
  const x = oneXTwo(m);
  it("-0.5 equals home win, +0.5 equals home or draw", () => {
    close(asianHandicap(m, -0.5).homeWin, x.home);
    close(asianHandicap(m, 0.5).homeWin, x.home + x.draw);
  });
  it("level ball (0) pushes on draw", () => {
    const ah = asianHandicap(m, 0);
    close(ah.push, x.draw);
    close(ah.homeWin + ah.push + ah.awayWin, 1);
  });
  it("quarter line averages neighbours", () => {
    const q = asianHandicap(m, -0.25), a = asianHandicap(m, -0.5), b = asianHandicap(m, 0);
    close(q.homeWin, (a.homeWin + b.homeWin) / 2);
  });
});

describe("roundToHundred", () => {
  it("always sums to exactly 100.0", () => {
    const cases = [[1 / 3, 1 / 3, 1 / 3], [0.4567, 0.2711, 0.2722], [0.999, 0.0005, 0.0005], [0.2, 0.3, 0.5]];
    for (const c of cases) {
      const r = roundToHundred(c, 1);
      expect(Math.round(r.reduce((a, b) => a + b, 0) * 10)).toBe(1000);
    }
  });
});
