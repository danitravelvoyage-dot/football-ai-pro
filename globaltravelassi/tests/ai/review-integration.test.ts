import { describe, it, expect } from "vitest";
import { ReviewService, ReviewForbiddenError, ReviewRuleError, type ReviewItem, type ReviewOpenInput } from "@/lib/ai/review/service";
import { MemoryReviewStore } from "@/lib/ai/review/store";
import { createReviewCenter } from "@/lib/ai/review/center";
import { CrmService, CrmRequiresApprovalError } from "@/lib/ai/crm/service";
import { MemoryCrmStore } from "@/lib/ai/crm/memory-store";
import { MemoryAuditSink } from "@/lib/ai/audit";
import { makeClock, makeIds, OWNER } from "./helpers";

const AGENT = { kind: "agent" as const, agent: "CRMAgent" as const };
const SYSTEM = { kind: "system" as const };
const REASON = "Reviewed against the record";

/** A small center with real CRM and a stub communication service, so each effect can be counted. */
function center() {
  const clock = makeClock("2026-11-21T09:00:00.000Z");
  const audit = new MemoryAuditSink();
  const newId = makeIds("rv");
  const reviewStore = new MemoryReviewStore();
  const crmStore = new MemoryCrmStore();
  const delivered: { toAgent: string; questionId: string }[] = [];
  const crm = new CrmService({
    store: crmStore,
    audit,
    now: clock.now,
    newId: makeIds("lead"),
    requestApproval: async (r) => {
      const item = await review.open({
        kind: "crm_transition",
        agent: null,
        runId: null,
        taskId: null,
        leadId: r.leadId,
        subjectRef: r.leadId,
        summary: "Stage move needs approval",
        evidence: { from: r.from, to: r.to },
        payload: { leadId: r.leadId, from: r.from, to: r.to, expectedVersion: r.expectedVersion, reason: r.reason, requestedBy: r.requestedBy },
      });
      return item.id;
    },
  });
  const communication = {
    deliverApproved: async (_actor: unknown, p: { toAgent: string; questionId: string }) => {
      delivered.push({ toAgent: p.toAgent, questionId: p.questionId });
      return { eventId: `evt-${delivered.length}` };
    },
  };
  const review: ReviewService = createReviewCenter({ store: reviewStore, audit, now: clock.now, newId, crm, communication: communication as never });
  return { review, crm, crmStore, audit, clock, delivered, reviewStore };
}

const heldAnswer = (over: Partial<ReviewOpenInput> = {}): ReviewOpenInput => ({
  kind: "held_answer",
  agent: "ResearchAgent",
  runId: "run-1",
  taskId: null,
  leadId: null,
  subjectRef: "q-1",
  summary: "Answer held",
  evidence: { codes: ["unsupported_claim"], sources: ["https://www.example.gov/visa"] },
  payload: { runId: "run-1", questionId: "q-1", fromAgent: "ResearchAgent", toAgent: "SalesAgent", answer: "Visa takes 2 weeks.", question: "How long?" },
  ...over,
});

/** Makes a lead, moves it to lost and asks to reopen it. Returns the lead id and the review item the reopen created. */
async function reopenRequest(ctx: ReturnType<typeof center>) {
  const lead = await ctx.crm.createLead(OWNER, { label: "Enquiry", source: "manual", applicationId: null, destinationCountry: "FR", nationality: "DZ", travelDate: null, interest: "visa" });
  const lost = await ctx.crm.changeStage(OWNER, lead.id, { to: "lost", reason: "No reply", expectedVersion: lead.version });
  await expect(ctx.crm.changeStage(OWNER, lead.id, { to: "new", reason: null, expectedVersion: lost.version })).rejects.toBeInstanceOf(CrmRequiresApprovalError);
  const [item] = await ctx.reviewStore.list({ kind: "crm_transition", limit: 10 });
  return { leadId: lead.id, item: item!, leadVersion: lost.version };
}

describe("owner decides, effect applies once", () => {
  it("delivers an approved held answer once, and refuses a second decision on the same item", async () => {
    const ctx = center();
    const item = await ctx.review.open(heldAnswer());
    const first = await ctx.review.decide(OWNER, item.id, "approve", REASON, 1);
    expect(first.item.status).toBe("approved");
    expect(first.effect).toEqual({ delivered: true, eventId: "evt-1" });
    await expect(ctx.review.decide(OWNER, item.id, "approve", REASON, 2)).rejects.toMatchObject({ code: "already_decided" });
    expect(ctx.delivered).toHaveLength(1);
  });

  it("applies an approved CRM reopen exactly once, then refuses replays of it", async () => {
    const ctx = center();
    const { leadId, item, leadVersion } = await reopenRequest(ctx);
    expect(item.kind).toBe("crm_transition");
    const done = await ctx.review.decide(OWNER, item.id, "approve", REASON, item.version);
    expect(done.effect).toMatchObject({ applied: true, stage: "new" });
    expect((await ctx.crmStore.getLead(leadId))?.stage).toBe("new");
    const history = await ctx.crmStore.listHistory([leadId]);
    expect(history.filter((h) => h.toStage === "new")).toHaveLength(1);
    await expect(ctx.review.decide(OWNER, item.id, "approve", REASON, item.version + 1)).rejects.toMatchObject({ code: "already_decided" });
    expect(leadVersion).toBeGreaterThan(0);
  });

  it("refuses an approval for a lead that changed after the request, and leaves the item open", async () => {
    const ctx = center();
    const { leadId, item } = await reopenRequest(ctx);
    const lead = (await ctx.crmStore.getLead(leadId))!;
    await ctx.crmStore.saveLead({ ...lead, label: "Edited label" }, OWNER.id, lead.version);
    await expect(ctx.review.decide(OWNER, item.id, "approve", REASON, item.version)).rejects.toMatchObject({ code: "stale" });
    expect((await ctx.reviewStore.get(item.id))?.status).toBe("open");
    expect((await ctx.crmStore.getLead(leadId))?.stage).toBe("lost");
  });

  it("a rejected CRM reopen changes nothing", async () => {
    const ctx = center();
    const { leadId, item } = await reopenRequest(ctx);
    const out = await ctx.review.decide(OWNER, item.id, "reject", REASON, item.version);
    expect(out.item.status).toBe("rejected");
    expect(out.effect).toMatchObject({ applied: false });
    expect((await ctx.crmStore.getLead(leadId))?.stage).toBe("lost");
  });
});

describe("authorization", () => {
  it("refuses agents and the system from every review action, and records nothing", async () => {
    const ctx = center();
    const item = await ctx.review.open(heldAnswer());
    for (const actor of [AGENT, SYSTEM]) {
      await expect(ctx.review.list(actor, { limit: 10 })).rejects.toBeInstanceOf(ReviewForbiddenError);
      await expect(ctx.review.get(actor, item.id)).rejects.toBeInstanceOf(ReviewForbiddenError);
      await expect(ctx.review.decide(actor, item.id, "approve", REASON, 1)).rejects.toBeInstanceOf(ReviewForbiddenError);
    }
    expect((await ctx.reviewStore.get(item.id))?.status).toBe("open");
    expect(ctx.delivered).toHaveLength(0);
  });

  it("refuses an owner with an empty identity", async () => {
    const ctx = center();
    const item = await ctx.review.open(heldAnswer());
    await expect(ctx.review.decide({ kind: "owner", id: " " }, item.id, "approve", REASON, 1)).rejects.toBeInstanceOf(ReviewForbiddenError);
  });

  it("refuses approving a rejected proposal, which only allows reject or revision", async () => {
    const ctx = center();
    const item = await ctx.review.open({ ...heldAnswer(), kind: "rejected_proposal", payload: {} });
    await expect(ctx.review.decide(OWNER, item.id, "approve", REASON, 1)).rejects.toMatchObject({ code: "not_allowed_for_kind" });
    const out = await ctx.review.decide(OWNER, item.id, "request_revision", REASON, 1);
    expect(out.item.status).toBe("revision_requested");
  });
});

describe("stale and expired items", () => {
  it("refuses a decision made on an older version of the item", async () => {
    const ctx = center();
    const item = await ctx.review.open(heldAnswer());
    await expect(ctx.review.decide(OWNER, item.id, "reject", REASON, 99)).rejects.toMatchObject({ code: "stale" });
    expect((await ctx.reviewStore.get(item.id))?.status).toBe("open");
  });

  it("marks an item expired after 7 days and refuses to deliver it afterwards", async () => {
    const ctx = center();
    const item = await ctx.review.open(heldAnswer());
    ctx.clock.advance(8 * 24 * 3600 * 1000);
    await expect(ctx.review.decide(OWNER, item.id, "approve", REASON, 1)).rejects.toMatchObject({ code: "expired" });
    expect((await ctx.reviewStore.get(item.id))?.status).toBe("expired");
    expect(ctx.delivered).toHaveLength(0);
  });
});

describe("audit trail", () => {
  it("records each decision with the actor, previous and new status, and reason", async () => {
    const ctx = center();
    const item = await ctx.review.open(heldAnswer());
    await ctx.review.decide(OWNER, item.id, "approve", REASON, 1);
    const decided = (await ctx.reviewStore.get(item.id)) as ReviewItem;
    expect(decided.decidedBy).toBe(OWNER.id);
    const entry = ctx.audit.events.find((e) => e.type === "review.decided");
    expect(entry).toBeDefined();
    expect(entry!.actor).toBe(`owner:${OWNER.id}`);
    expect(entry!.meta).toMatchObject({ previousStatus: "open", newStatus: "approved", reason: REASON });
  });

  it("records refused attempts as review.refused", async () => {
    const ctx = center();
    const item = await ctx.review.open(heldAnswer());
    ctx.clock.advance(8 * 24 * 3600 * 1000);
    await expect(ctx.review.decide(OWNER, item.id, "approve", REASON, 1)).rejects.toBeInstanceOf(ReviewRuleError);
    const refused = ctx.audit.events.find((e) => e.type === "review.refused");
    expect(refused).toBeDefined();
    expect(refused!.meta).toMatchObject({ reason: "expired", previousStatus: "open" });
    expect(ctx.audit.events.some((e) => e.type === "review.decided")).toBe(false);
  });
});
