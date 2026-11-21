import { describe, it, expect } from "vitest";
import { ReviewService, ReviewForbiddenError, ReviewRuleError, type ReviewItem } from "@/lib/ai/review/service";
import { MemoryReviewStore } from "@/lib/ai/review/store";
import { MemoryAuditSink } from "@/lib/ai/audit";
import { makeClock, makeIds, OWNER } from "./helpers";

const AGENT = { kind: "agent" as const, agent: "SalesAgent" as const };
const SYSTEM = { kind: "system" as const };

function setup() {
  const clock = makeClock("2026-11-21T09:00:00.000Z");
  const audit = new MemoryAuditSink();
  const effects: { kind: string; decision: string; actor: string }[] = [];
  const svc = new ReviewService({
    store: new MemoryReviewStore(),
    audit,
    now: clock.now,
    newId: makeIds("rv"),
    effects: {
      held_answer: async (item, decision, actor) => {
        effects.push({ kind: item.kind, decision, actor });
        return { delivered: decision === "approve" };
      },
    },
  });
  return { svc, audit, clock, effects };
}

const held = (over: Partial<Parameters<ReviewService["open"]>[0]> = {}) => ({
  kind: "held_answer" as const,
  agent: "CRMAgent",
  runId: null,
  taskId: null,
  leadId: null,
  subjectRef: "question-1",
  summary: "Answer held: no approved source.",
  evidence: { codes: ["unsupported_answer"], sources: [] },
  payload: { answer: "The enquiry starts in the new stage." },
  ...over,
});

describe("authorization: only the owner sees and decides", () => {
  it("refuses agents and the system from listing, reading and deciding", async () => {
    const { svc } = setup();
    const item = await svc.open(held());
    for (const actor of [AGENT, SYSTEM, { kind: "owner" as const, id: " " }]) {
      await expect(svc.list(actor, { limit: 10 })).rejects.toBeInstanceOf(ReviewForbiddenError);
      await expect(svc.get(actor, item.id)).rejects.toBeInstanceOf(ReviewForbiddenError);
      await expect(svc.decide(actor, item.id, "approve", "Looks right.", 1)).rejects.toBeInstanceOf(ReviewForbiddenError);
    }
  });

  it("an agent cannot approve the result it produced: the decision is refused and audited", async () => {
    const { svc, audit } = setup();
    const item = await svc.open(held());
    await expect(svc.decide(AGENT, item.id, "approve", "I checked it.", 1)).rejects.toBeInstanceOf(ReviewForbiddenError);
    // The refusal happens before anything is written: nothing is decided and no effect runs.
    expect((await svc.get(OWNER, item.id)).status).toBe("open");
    expect(audit.events.filter((e) => e.type === "review.decided")).toHaveLength(0);
  });
});

describe("visibility: every held item is listed to the owner", () => {
  it("lists every open item of every kind, newest first", async () => {
    const { svc, clock } = setup();
    await svc.open(held({ subjectRef: "q-1" }));
    clock.advance(1000);
    await svc.open({ ...held({ subjectRef: "lead-1:stage" }), kind: "crm_stage_disagreement", leadId: null });
    clock.advance(1000);
    await svc.open({ ...held({ subjectRef: "task-9" }), kind: "rejected_proposal", taskId: null });
    const open = await svc.list(OWNER, { status: "open", limit: 50 });
    expect(open.map((i) => i.kind)).toEqual(["rejected_proposal", "crm_stage_disagreement", "held_answer"]);
    expect(open.every((i) => i.evidence && i.createdAt)).toBe(true);
  });
});

describe("decisions and their effects", () => {
  it("approve applies the item's effect, records the status change and the reason, and audits both values", async () => {
    const { svc, audit, effects } = setup();
    const item = await svc.open(held());
    const { item: decided, effect } = await svc.decide(OWNER, item.id, "approve", "The answer is acceptable.", 1);
    expect(decided).toMatchObject({ status: "approved", decidedBy: OWNER.id, decisionReason: "The answer is acceptable.", version: 2 });
    expect(effect).toEqual({ delivered: true });
    expect(effects).toEqual([{ kind: "held_answer", decision: "approve", actor: OWNER.id }]);
    const entry = audit.events.find((e) => e.type === "review.decided");
    expect(entry).toMatchObject({ actor: `owner:${OWNER.id}`, entityId: item.id });
    expect(entry?.meta).toMatchObject({ previousStatus: "open", newStatus: "approved", decision: "approve", reason: "The answer is acceptable." });
  });

  it("reject and request_revision record their own status", async () => {
    const { svc } = setup();
    const a = await svc.open(held({ subjectRef: "a" }));
    const b = await svc.open(held({ subjectRef: "b" }));
    expect((await svc.decide(OWNER, a.id, "reject", "Not accurate.", 1)).item.status).toBe("rejected");
    expect((await svc.decide(OWNER, b.id, "request_revision", "Add a source.", 1)).item.status).toBe("revision_requested");
  });

  it("a refused proposal cannot be approved, because that would override the factual check", async () => {
    const { svc, audit } = setup();
    const item = await svc.open(held({ kind: "rejected_proposal", subjectRef: "task-7" }));
    await expect(svc.decide(OWNER, item.id, "approve", "Use it anyway.", 1)).rejects.toMatchObject({ code: "not_allowed_for_kind" });
    expect((await svc.get(OWNER, item.id)).status).toBe("open");
    expect(audit.events.find((e) => e.type === "review.refused")?.meta).toMatchObject({ reason: "not_allowed_for_kind" });
  });

  it("a CRM transition that needs owner approval can be approved or rejected only", async () => {
    const { svc } = setup();
    const item = await svc.open(held({ kind: "crm_transition", subjectRef: "lead-2:lost>new" }));
    await expect(svc.decide(OWNER, item.id, "request_revision", "Think again.", 1)).rejects.toMatchObject({ code: "not_allowed_for_kind" });
    expect((await svc.decide(OWNER, item.id, "approve", "Reopen the lead.", 1)).item.status).toBe("approved");
  });

  it("a reason is required", async () => {
    const { svc } = setup();
    const item = await svc.open(held());
    await expect(svc.decide(OWNER, item.id, "approve", " ", 1)).rejects.toMatchObject({ code: "invalid" });
  });
});

describe("duplicate actions and stale screens", () => {
  it("a second decision on the same item is refused, and only one decision is audited", async () => {
    const { svc, audit, effects } = setup();
    const item = await svc.open(held());
    await svc.decide(OWNER, item.id, "approve", "Fine.", 1);
    await expect(svc.decide(OWNER, item.id, "approve", "Fine again.", 2)).rejects.toMatchObject({ code: "already_decided" });
    expect(effects).toHaveLength(1);
    expect(audit.events.filter((e) => e.type === "review.decided")).toHaveLength(1);
  });

  it("two decisions racing on the same version: exactly one wins, the other is refused", async () => {
    const { svc, effects } = setup();
    const item = await svc.open(held());
    const results = await Promise.allSettled([svc.decide(OWNER, item.id, "approve", "First.", 1), svc.decide(OWNER, item.id, "reject", "Second.", 1)]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const failed = results.find((r) => r.status === "rejected") as PromiseRejectedResult;
    expect((failed.reason as ReviewRuleError).code).toMatch(/already_decided|stale/);
    expect(effects).toHaveLength(1);
  });

  it("a decision made from a screen that is out of date is refused, so a newer item is never decided blind", async () => {
    const { svc } = setup();
    const item = await svc.open(held());
    await expect(svc.decide(OWNER, item.id, "approve", "Based on an old view.", 99)).rejects.toMatchObject({ code: "stale" });
    expect((await svc.get(OWNER, item.id)).status).toBe("open");
  });
});

describe("expiry and replay", () => {
  it("an item past its window is marked expired and cannot be decided, even later", async () => {
    const { svc, clock } = setup();
    const item = await svc.open(held());
    clock.advance(8 * 24 * 3_600_000);
    await expect(svc.decide(OWNER, item.id, "approve", "Too late?", 1)).rejects.toMatchObject({ code: "expired" });
    const stored = await svc.get(OWNER, item.id);
    expect(stored.status).toBe("expired");
    // Replaying the request after expiry is refused the same way.
    await expect(svc.decide(OWNER, item.id, "approve", "Trying again.", stored.version)).rejects.toMatchObject({ code: "already_decided" });
  });

  it("an item inside its window can still be decided", async () => {
    const { svc, clock } = setup();
    const item = await svc.open(held());
    clock.advance(24 * 3_600_000);
    expect((await svc.decide(OWNER, item.id, "approve", "Within the window.", 1)).item.status).toBe("approved");
  });
});

export type { ReviewItem };
