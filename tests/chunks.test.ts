import { describe, expect, it, vi } from "vitest";

const calls: [string, string][] = [];
vi.mock("@/services/providers", () => ({
  getFixturesProvider: () => ({
    name: "mock", demo: false, supportsLive: true,
    async listMatches(a: string, b: string) {
      calls.push([a, b]);
      return { data: [], source: { provider: "mock", fetchedAt: new Date().toISOString(), cached: false, demo: false } };
    },
  }),
}));

describe("getMatchesBetween", () => {
  it("splits long ranges into requests of at most 10 days with full coverage", async () => {
    const { getMatchesBetween } = await import("@/services/matches");
    await getMatchesBetween("2026-11-13", "2026-11-23", "UTC");
    expect(calls.length).toBeGreaterThan(1);
    for (const [a, b] of calls) expect((Date.parse(b) - Date.parse(a)) / 864e5).toBeLessThanOrEqual(10);
    expect(calls[0][0]).toBe("2026-11-12");
    expect(calls[calls.length - 1][1]).toBe("2026-11-24");
    for (let i = 1; i < calls.length; i++) expect((Date.parse(calls[i][0]) - Date.parse(calls[i - 1][1])) / 864e5).toBe(1);
  });
});
