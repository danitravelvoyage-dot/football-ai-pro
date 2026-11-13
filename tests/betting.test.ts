import { describe, expect, it } from "vitest";
import {
  assessValue, expectedValue, fairOdds, impliedProbability, kellyFraction, overround,
  removeMarginPower, removeMarginProportional, suggestedStake, MAX_STAKE_FRACTION,
} from "@/lib/betting";

const close = (a: number, b: number, eps = 1e-9) => expect(Math.abs(a - b)).toBeLessThan(eps);

describe("betting maths", () => {
  it("implied probability and fair odds", () => {
    close(impliedProbability(2), 0.5);
    close(fairOdds(0.25), 4);
    expect(() => impliedProbability(1)).toThrow();
  });
  it("EV formula = p*odds - 1", () => {
    close(expectedValue(0.55, 2.0), 0.1);
    close(expectedValue(0.4, 2.0), -0.2);
  });
  it("overround of a 1X2 book", () => {
    close(overround([2.0, 3.4, 3.8]), 1 / 2 + 1 / 3.4 + 1 / 3.8 - 1);
  });
  it("margin removal sums to 1", () => {
    for (const f of [removeMarginProportional, removeMarginPower]) {
      const p = f([1.8, 3.6, 4.5]);
      close(p.reduce((a, b) => a + b, 0), 1, 1e-9);
    }
  });
  it("power method shifts probability toward favourite vs proportional", () => {
    const prop = removeMarginProportional([1.3, 5.5, 10]);
    const pow = removeMarginPower([1.3, 5.5, 10]);
    expect(pow[0]).toBeGreaterThan(prop[0]);
  });
  it("Kelly matches closed form and is 0 without edge", () => {
    close(kellyFraction(0.55, 2.0), (1 * 0.55 - 0.45) / 1);
    expect(kellyFraction(0.4, 2.0)).toBe(0);
  });
  it("stake is fractional and capped", () => {
    close(suggestedStake(1000, 0.55, 2.0, 0.25), 1000 * Math.min(0.1 * 0.25, MAX_STAKE_FRACTION));
    expect(suggestedStake(1000, 0.95, 3.0, 0.5)).toBeLessThanOrEqual(1000 * MAX_STAKE_FRACTION + 1e-9);
  });
  it("value requires positive EV AND reliable data", () => {
    expect(assessValue(0.55, 2.0, 0.5, 0.8).isValue).toBe(true);
    expect(assessValue(0.55, 2.0, 0.5, 0.2).isValue).toBe(false);
    expect(assessValue(0.45, 2.0, 0.5, 0.9).isValue).toBe(false);
  });
});

import { MAX_PLAUSIBLE_EDGE } from "@/lib/betting";
describe("value plausibility guard", () => {
  it("implausibly large model-market gaps are flagged, not labelled value", () => {
    const a = assessValue(0.6, 2.6, 0.38, 0.9);
    expect(a.ev).toBeGreaterThan(0);
    expect(a.edge).toBeGreaterThan(MAX_PLAUSIBLE_EDGE);
    expect(a.isValue).toBe(false);
    expect(a.reasonKey).toBe("value.suspicious");
  });
  it("a modest edge with good data is value", () => {
    const a = assessValue(0.45, 2.4, 0.41, 0.9);
    expect(a.isValue).toBe(true);
  });
});

describe("uncertainty-adjusted value rule", () => {
  it("positive EV inside the model's uncertainty is not labelled value", () => {
    const a = assessValue(0.52, 2.0, 0.5, 0.9, 0.05); // EV +4%, conservative (0.47*2-1) = -6%
    expect(a.ev).toBeGreaterThan(0);
    expect(a.conservativeEv).toBeLessThan(0);
    expect(a.isValue).toBe(false);
    expect(a.reasonKey).toBe("value.withinNoise");
  });
  it("an edge larger than the uncertainty is value", () => {
    const a = assessValue(0.5, 2.3, 0.42, 0.9, 0.05); // (0.45*2.3-1)=+3.5%
    expect(a.conservativeEv).toBeGreaterThan(0);
    expect(a.isValue).toBe(true);
  });
});
