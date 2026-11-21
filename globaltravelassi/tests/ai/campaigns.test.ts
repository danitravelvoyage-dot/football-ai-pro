import { describe, it, expect } from "vitest";
import { CampaignService, CampaignForbiddenError, CampaignRuleError, CampaignValidationError } from "@/lib/ai/campaigns/service";
import { MemoryCampaignStore } from "@/lib/ai/campaigns/memory-store";
import { campaignInputSchema, canMove, budgetState, canSpend, kpiProgress, OBJECTIVE_METRICS } from "@/lib/ai/campaigns/rules";
import { MemoryAuditSink } from "@/lib/ai/audit";
import { makeClock, makeIds, OWNER } from "./helpers";

const AGENT = { kind: "agent" as const, agent: "SalesAgent" as const };
const T = "2026-11-20T09:00:00.000Z";

function setup(approved: Record<string, string> = {}) {
  const clock = makeClock(T);
  const audit = new MemoryAuditSink();
  const svc = new CampaignService({
    store: new MemoryCampaignStore(),
    audit,
    now: clock.now,
    newId: makeIds("c"),
    contentStatus: async (ids) => new Map(ids.filter((i) => i in approved || i.startsWith("art-")).map((i) => [i, approved[i] ?? "draft"])),
  });
  return { svc, audit, clock };
}

const input = (over: Record<string, unknown> = {}) => ({
  name: "Spring visa push",
  goal: "Book more family visa consultations this spring.",
  objective: "leads",
  kpis: [{ metric: "leads", target: 120 }],
  budgetMinor: 500_000,
  currency: "DZD",
  channel: "whatsapp",
  country: "dz",
  language: "fr",
  startsOn: "2026-12-01",
  endsOn: "2027-02-28",
  ...over,
});

describe("campaign rules (pure)", () => {
  it("the lifecycle allows only the defined moves", () => {
    expect(canMove("draft", "active")).toBe(true);
    expect(canMove("active", "paused")).toBe(true);
    expect(canMove("paused", "active")).toBe(true);
    expect(canMove("draft", "finished")).toBe(false);
    expect(canMove("finished", "active")).toBe(false);
  });

  it("a KPI must be measured by its objective", () => {
    const bad = campaignInputSchema.safeParse(input({ kpis: [{ metric: "revenue", target: 10 }] }));
    expect(bad.success).toBe(false);
    expect(OBJECTIVE_METRICS.leads).toContain("leads");
  });

  it("the end date may not be before the start date", () => {
    expect(campaignInputSchema.safeParse(input({ startsOn: "2027-03-01", endsOn: "2027-02-01" })).success).toBe(false);
  });

  it("budget arithmetic: a spend is allowed only up to what remains", () => {
    const state = budgetState(1000, [400, 300]);
    expect(state.remainingMinor).toBe(300);
    expect(state.percentSpent).toBe(70);
    expect(canSpend(state, 300)).toBe(true);
    expect(canSpend(state, 301)).toBe(false);
    expect(canSpend(state, 0)).toBe(false);
  });

  it("KPI progress is null without a reading; it is never estimated", () => {
    const [p] = kpiProgress([{ metric: "leads", target: 100 }], []);
    expect(p).toMatchObject({ actual: null, percent: null });
    const [q] = kpiProgress([{ metric: "leads", target: 100 }], [{ metric: "leads", value: 25, recordedAt: T }]);
    expect(q?.percent).toBe(25);
  });
});

describe("campaign management", () => {
  it("only the owner creates, reads and changes campaigns", async () => {
    const { svc } = setup();
    await expect(svc.create(AGENT, input())).rejects.toBeInstanceOf(CampaignForbiddenError);
    const c = await svc.create(OWNER, input());
    expect(c.status).toBe("draft");
    await expect(svc.list(AGENT)).rejects.toBeInstanceOf(CampaignForbiddenError);
  });

  it("personal data in a campaign's goal is refused", async () => {
    const { svc } = setup();
    await expect(svc.create(OWNER, input({ goal: "Send offers to client@example.com this week." }))).rejects.toBeInstanceOf(CampaignValidationError);
  });

  it("editing is blocked once the campaign is running, and fixed fields cannot be changed", async () => {
    const { svc } = setup();
    const c = await svc.create(OWNER, input());
    await svc.assignAgent(OWNER, c.id, "SalesAgent");
    const edited = await svc.edit(OWNER, c.id, { name: "Spring push", goal: "Book more visa consultations.", channel: "whatsapp", startsOn: null, endsOn: null });
    expect(edited.name).toBe("Spring push");
    await svc.transition(OWNER, c.id, "active");
    await expect(svc.edit(OWNER, c.id, { name: "Late change", goal: "Changing the goal now.", channel: "whatsapp", startsOn: null, endsOn: null })).rejects.toBeInstanceOf(CampaignRuleError);
  });

  it("launching needs at least one agent", async () => {
    const { svc } = setup();
    const c = await svc.create(OWNER, input());
    await expect(svc.transition(OWNER, c.id, "active")).rejects.toThrow("Assign at least one agent");
  });

  it("launching needs every assigned content item approved", async () => {
    const { svc } = setup({ "art-1": "awaiting_owner" });
    const c = await svc.create(OWNER, input());
    await svc.assignAgent(OWNER, c.id, "SalesAgent");
    await svc.assignContent(OWNER, c.id, "art-1");
    await expect(svc.transition(OWNER, c.id, "active")).rejects.toThrow("not approved");
  });

  it("launching succeeds once the team is set and the content is approved", async () => {
    const { svc } = setup({ "art-2": "approved" });
    const c = await svc.create(OWNER, input());
    await svc.assignAgent(OWNER, c.id, "SalesAgent");
    await svc.assignContent(OWNER, c.id, "art-2");
    const running = await svc.transition(OWNER, c.id, "active");
    expect(running.status).toBe("active");
  });

  it("assigning content that does not exist is refused", async () => {
    const { svc } = setup({});
    const c = await svc.create(OWNER, input());
    await expect(svc.assignContent(OWNER, c.id, "missing")).rejects.toThrow("does not exist");
  });

  it("spend is refused in draft and beyond the budget; spend within the budget is recorded", async () => {
    const { svc } = setup({ "art-3": "approved" });
    const c = await svc.create(OWNER, input({ budgetMinor: 1000 }));
    await expect(svc.addSpend(OWNER, c.id, { amountMinor: 100, note: "Ads" })).rejects.toThrow("Launch");
    await svc.assignAgent(OWNER, c.id, "SalesAgent");
    await svc.assignContent(OWNER, c.id, "art-3");
    await svc.transition(OWNER, c.id, "active");
    const after = await svc.addSpend(OWNER, c.id, { amountMinor: 600, note: "Ads week 1" });
    expect(after.remainingMinor).toBe(400);
    await expect(svc.addSpend(OWNER, c.id, { amountMinor: 401, note: "Too much" })).rejects.toThrow("over its budget");
  });

  it("a KPI reading must match a KPI of the campaign, and progress reflects the latest reading", async () => {
    const { svc } = setup({ "art-4": "approved" });
    const c = await svc.create(OWNER, input());
    await svc.assignAgent(OWNER, c.id, "SalesAgent");
    await svc.assignContent(OWNER, c.id, "art-4");
    await svc.transition(OWNER, c.id, "active");
    await expect(svc.recordKpi(OWNER, c.id, { metric: "clicks", value: 5, period: "2026-12" })).rejects.toThrow("not a KPI");
    const progress = await svc.recordKpi(OWNER, c.id, { metric: "leads", value: 30, period: "2026-12" });
    expect(progress[0]?.percent).toBe(25);
  });

  it("archiving is blocked while running, and archived campaigns are hidden by default", async () => {
    const { svc } = setup({ "art-5": "approved" });
    const c = await svc.create(OWNER, input());
    await svc.assignAgent(OWNER, c.id, "SalesAgent");
    await svc.assignContent(OWNER, c.id, "art-5");
    await svc.transition(OWNER, c.id, "active");
    await expect(svc.archive(OWNER, c.id)).rejects.toThrow("Pause or finish");
    await svc.transition(OWNER, c.id, "paused");
    await svc.archive(OWNER, c.id);
    expect((await svc.list(OWNER)).length).toBe(0);
    expect((await svc.list(OWNER, { includeArchived: true })).length).toBe(1);
  });

  it("every change is in the campaign history, newest first", async () => {
    const { svc } = setup();
    const c = await svc.create(OWNER, input());
    await svc.assignAgent(OWNER, c.id, "SalesAgent");
    const view = await svc.view(OWNER, c.id);
    expect(view.events.map((e) => e.type)).toEqual(["agent_assigned", "created"]);
    expect(view.budget.budgetMinor).toBe(500_000);
  });
});
