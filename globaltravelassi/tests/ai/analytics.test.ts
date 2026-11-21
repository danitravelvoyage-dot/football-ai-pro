import { describe, it, expect } from "vitest";
import { bucketOf, bucketsEndingAt, rate, approvalConversion, contentPerformance, agentPerformance, leadConversion, revenueTracking, executionCost } from "@/lib/ai/analytics/engine";

const NOW = new Date("2026-11-21T12:00:00.000Z"); // a Saturday

describe("periods", () => {
  it("weeks start on Monday, months are calendar months", () => {
    expect(bucketOf("2026-11-21T08:00:00.000Z", "weekly")).toBe("2026-11-16"); // Saturday belongs to the week of Monday 16 Nov
    expect(bucketOf("2026-11-16T00:00:00.000Z", "weekly")).toBe("2026-11-16");
    expect(bucketOf("2026-11-21T08:00:00.000Z", "monthly")).toBe("2026-11");
    expect(bucketOf("2026-11-21T08:00:00.000Z", "daily")).toBe("2026-11-21");
  });

  it("the window ends with the current period and has no duplicates", () => {
    const months = bucketsEndingAt(NOW, "monthly");
    expect(months.at(-1)).toBe("2026-11");
    expect(months).toHaveLength(6);
    expect(new Set(bucketsEndingAt(NOW, "weekly")).size).toBe(8);
  });

  it("a rate with no denominator is unknown, never zero", () => {
    expect(rate(0, 0)).toBeNull();
    expect(rate(1, 4)).toBe(25);
  });
});

describe("approvals and content", () => {
  it("approval conversion counts only decided items in the rate", () => {
    const r = approvalConversion([
      { actionClass: "external_publish", status: "approved", createdAt: T() },
      { actionClass: "external_publish", status: "rejected", createdAt: T() },
      { actionClass: "external_publish", status: "pending", createdAt: T() },
      { actionClass: "external_send_message", status: "expired", createdAt: T() },
    ]);
    // The expired item was decided by nobody, so the rate is one approval out of two owner decisions.
    expect(r).toMatchObject({ requested: 4, decided: 2, approved: 1, rejected: 1, expired: 1, approvalRate: 50 });
    expect(r.byClass.find((c) => c.actionClass === "external_send_message")?.approvalRate).toBeNull();
  });

  it("content performance reports acceptance over decided items per kind", () => {
    const [caption] = contentPerformance([
      { kind: "caption", status: "approved" },
      { kind: "caption", status: "rejected" },
      { kind: "caption", status: "awaiting_owner" },
    ]);
    expect(caption).toMatchObject({ produced: 3, approved: 1, rejected: 1, waiting: 1, approvalRate: 50 });
  });
});

describe("agents and leads", () => {
  it("agent performance is per agent per period, and omits empty periods", () => {
    const rows = agentPerformance(
      [
        { agent: "SalesAgent", status: "succeeded", durationMs: 100, finishedAt: "2026-11-20T08:00:00.000Z" },
        { agent: "SalesAgent", status: "failed", durationMs: 300, finishedAt: "2026-11-20T09:00:00.000Z" },
        { agent: "SalesAgent", status: "succeeded", durationMs: 50, finishedAt: "2026-09-01T08:00:00.000Z" },
      ],
      NOW,
      "daily",
    );
    expect(rows).toEqual([{ agent: "SalesAgent", period: "2026-11-20", runs: 2, failureRate: 50, avgDurationMs: 200 }]);
  });

  it("lead conversion uses only concluded leads in the rate; open leads are counted but not judged", () => {
    const r = leadConversion(
      [
        { status: "completed", createdAt: T() },
        { status: "rejected", createdAt: T() },
        { status: "in_review", createdAt: T() },
      ],
      NOW,
      "monthly",
    );
    expect(r).toMatchObject({ leads: 3, concluded: 2, converted: 1, conversionRate: 50 });
  });
});

describe("revenue and cost", () => {
  it("revenue is what was received, per currency; pending money is shown apart and not counted", () => {
    const r = revenueTracking(
      [
        { amount: 1000, currency: "DZD", status: "received", receivedAt: "2026-11-10T00:00:00.000Z" },
        { amount: 500, currency: "DZD", status: "received", receivedAt: "2026-11-18T00:00:00.000Z" },
        { amount: 900, currency: "EUR", status: "pending", receivedAt: null },
        { amount: 700, currency: "DZD", status: "cancelled", receivedAt: null },
      ],
      NOW,
      "monthly",
    );
    expect(r.receivedByCurrency).toEqual({ DZD: 1500 });
    expect(r.pendingByCurrency).toEqual({ EUR: 900 });
    expect(r.byPeriod.at(-1)?.received).toEqual({ DZD: 1500 });
  });

  it("execution cost is null for an unpriced provider and for the total while any provider is unpriced", () => {
    const usage = [
      { providerId: "local", day: "2026-11-20", tokensIn: 2000, tokensOut: 1000, requests: 3 },
      { providerId: "hosted", day: "2026-11-20", tokensIn: 1000, tokensOut: 1000, requests: 1 },
    ];
    expect(executionCost(usage, { hosted: { inPer1k: 0.2, outPer1k: 0.4 } })).toMatchObject({ totalCost: null });
    const priced = executionCost(usage, { local: { inPer1k: 0, outPer1k: 0 }, hosted: { inPer1k: 0.2, outPer1k: 0.4 } });
    expect(priced.providers.find((p) => p.providerId === "hosted")?.cost).toBe(0.6);
    expect(priced.totalCost).toBe(0.6);
  });
});

function T() {
  return "2026-11-20T10:00:00.000Z";
}
