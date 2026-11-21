import { describe, it, expect } from "vitest";
import {
  LEAD_STAGES,
  assessLead,
  canMoveStage,
  detectIntent,
  leadInputSchema,
  priorityFor,
  rate,
  salesFunnel,
  stageChangeSchema,
  suggestFollowUp,
  type LeadFacts,
} from "@/lib/ai/crm/rules";

const NOW = "2026-11-21T10:00:00.000Z";
const DAY = 86_400_000;
const daysAgo = (n: number) => new Date(Date.parse(NOW) - n * DAY).toISOString();

const facts = (over: Partial<LeadFacts> = {}): LeadFacts => ({
  stage: "new",
  source: "manual",
  destinationCountry: null,
  travelDate: null,
  createdAt: daysAgo(0),
  lastActivityAt: null,
  interactionSummaries: [],
  ...over,
});

describe("pipeline stages", () => {
  it("allows only the defined moves", () => {
    expect(canMoveStage("new", "contacted")).toBe(true);
    expect(canMoveStage("new", "converted")).toBe(false);
    expect(canMoveStage("contacted", "qualified")).toBe(true);
    expect(canMoveStage("qualified", "converted")).toBe(true);
    expect(canMoveStage("lost", "new")).toBe(true);
    expect(canMoveStage("lost", "contacted")).toBe(false);
  });

  it("treats converted as terminal and never allows a same-stage move", () => {
    for (const s of LEAD_STAGES) expect(canMoveStage(s, s)).toBe(false);
    for (const s of LEAD_STAGES) expect(canMoveStage("converted", s)).toBe(false);
  });

  it("requires a reason to mark a lead lost", () => {
    expect(stageChangeSchema.safeParse({ to: "lost", reason: null, expectedVersion: 1 }).success).toBe(false);
    expect(stageChangeSchema.safeParse({ to: "lost", reason: "Went elsewhere", expectedVersion: 1 }).success).toBe(true);
    expect(stageChangeSchema.safeParse({ to: "contacted", reason: null, expectedVersion: 1 }).success).toBe(true);
  });
});

describe("lead input", () => {
  const base = { label: "Family visa enquiry", source: "manual", applicationId: null, destinationCountry: "FR", nationality: "DZ", travelDate: null, interest: "visa" };

  it("links application leads to an application, and only those", () => {
    expect(leadInputSchema.safeParse({ ...base, source: "application", applicationId: null }).success).toBe(false);
    expect(leadInputSchema.safeParse({ ...base, source: "application", applicationId: "00000000-0000-4000-8000-000000000001" }).success).toBe(true);
    expect(leadInputSchema.safeParse({ ...base, applicationId: "00000000-0000-4000-8000-000000000001" }).success).toBe(false);
  });

  it("rejects malformed country codes and dates", () => {
    expect(leadInputSchema.safeParse({ ...base, destinationCountry: "France" }).success).toBe(false);
    expect(leadInputSchema.safeParse({ ...base, travelDate: "21/11/2026" }).success).toBe(false);
  });
});

describe("purchase intent", () => {
  it("detects high intent in English, French and Arabic", () => {
    expect(detectIntent(["How much for the family package?"])).toBe("high");
    expect(detectIntent(["Je veux réserver la semaine prochaine"])).toBe("high");
    expect(detectIntent(["أريد معرفة السعر"])).toBe("high");
  });

  it("detects medium intent and returns no intent for neutral notes", () => {
    expect(detectIntent(["Asked for general information"])).toBe("medium");
    expect(detectIntent(["Called, no answer"])).toBe("none");
    expect(detectIntent([])).toBe("none");
  });

  it("returns the strongest level across several notes", () => {
    expect(detectIntent(["general question", "ready to pay now"])).toBe("high");
  });
});

describe("explainable scoring", () => {
  it("names every point with a reason code", () => {
    const a = assessLead(facts({ source: "application", destinationCountry: "FR", stage: "interested", lastActivityAt: daysAgo(1), interactionSummaries: ["how much?"] }), NOW);
    const codes = a.reasons.map((r) => r.code);
    expect(codes).toEqual(expect.arrayContaining(["source_application", "destination_known", "stage_interested", "intent_high", "recent_activity"]));
    expect(a.reasons.reduce((s, r) => s + r.points, 0)).toBe(a.score);
  });

  it("adds the travel-soon reason only inside the window", () => {
    const soon = assessLead(facts({ travelDate: "2026-12-15" }), NOW);
    const far = assessLead(facts({ travelDate: "2027-06-01" }), NOW);
    expect(soon.reasons.map((r) => r.code)).toContain("travel_within_90_days");
    expect(far.reasons.map((r) => r.code)).not.toContain("travel_within_90_days");
  });

  it("marks a long-idle open lead dormant and lowers its score", () => {
    const a = assessLead(facts({ stage: "contacted", createdAt: daysAgo(45), lastActivityAt: daysAgo(40) }), NOW);
    expect(a.dormant).toBe(true);
    expect(a.idleDays).toBe(40);
    expect(a.reasons.find((r) => r.code === "dormant")?.points).toBe(-15);
  });

  it("does not mark terminal leads dormant and gives fixed scores to them", () => {
    const lost = assessLead(facts({ stage: "lost", createdAt: daysAgo(90) }), NOW);
    const won = assessLead(facts({ stage: "converted", createdAt: daysAgo(90) }), NOW);
    expect(lost.dormant).toBe(false);
    expect(lost.score).toBe(0);
    expect(won.score).toBe(100);
  });

  it("keeps the score between 0 and 100", () => {
    const high = assessLead(facts({ source: "application", destinationCountry: "FR", stage: "interested", travelDate: "2026-12-01", lastActivityAt: daysAgo(0), interactionSummaries: ["pay now"] }), NOW);
    expect(high.score).toBeLessThanOrEqual(100);
    const low = assessLead(facts({ createdAt: daysAgo(60), stage: "new" }), NOW);
    expect(low.score).toBeGreaterThanOrEqual(0);
  });
});

describe("follow-up suggestions", () => {
  it("suggests nothing for a lead that is still active", () => {
    const f = facts({ stage: "qualified", lastActivityAt: daysAgo(1) });
    expect(suggestFollowUp(f, assessLead(f, NOW))).toBeNull();
  });

  it("suggests a follow-up once a stage's idle threshold is passed", () => {
    const f = facts({ stage: "new", createdAt: daysAgo(3) });
    const s = suggestFollowUp(f, assessLead(f, NOW));
    expect(s?.reason).toBe("idle_threshold_new");
  });

  it("uses the dormant reason for leads idle 30 days or more", () => {
    const f = facts({ stage: "qualified", createdAt: daysAgo(60), lastActivityAt: daysAgo(31) });
    expect(suggestFollowUp(f, assessLead(f, NOW))?.reason).toBe("dormant_30_days");
  });

  it("never suggests for terminal leads", () => {
    const f = facts({ stage: "converted", createdAt: daysAgo(90) });
    expect(suggestFollowUp(f, assessLead(f, NOW))).toBeNull();
  });

  it("maps score and intent to a priority", () => {
    expect(priorityFor(70, "none")).toBe("high");
    expect(priorityFor(10, "high")).toBe("high");
    expect(priorityFor(45, "none")).toBe("normal");
    expect(priorityFor(10, "none")).toBe("low");
  });
});

describe("sales funnel", () => {
  it("counts a lead for every stage it has passed through", () => {
    const out = salesFunnel([
      { stage: "converted", reached: ["contacted", "qualified", "converted"] },
      { stage: "lost", reached: ["contacted", "lost"] },
      { stage: "new", reached: [] },
    ]);
    const byStage = Object.fromEntries(out.rows.map((r) => [r.stage, r.reached]));
    expect(byStage).toEqual({ new: 3, contacted: 2, qualified: 1, interested: 0, converted: 1, lost: 1 });
    expect(out.conversionRate).toBe(33.3);
    expect(out.lostCount).toBe(1);
    expect(out.activeCount).toBe(1);
  });

  it("returns null rates instead of zero when there are no leads", () => {
    const out = salesFunnel([]);
    expect(out.conversionRate).toBeNull();
    expect(out.rows.every((r) => r.rate === null)).toBe(true);
    expect(rate(0, 0)).toBeNull();
  });
});
