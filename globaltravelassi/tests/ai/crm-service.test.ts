import { describe, it, expect } from "vitest";
import { CrmService, CrmForbiddenError, CrmRuleError, CrmValidationError, CrmRequiresApprovalError, type LeadRecord } from "@/lib/ai/crm/service";
import { MemoryCrmStore } from "@/lib/ai/crm/memory-store";
import { MemoryAuditSink } from "@/lib/ai/audit";
import { makeClock, makeIds, OWNER } from "./helpers";

const OWNER_ACTOR = OWNER;

/** Reads the lead's current version and moves it, as the owner's screen does. */
async function move(svc: CrmService, actor: typeof OWNER, leadId: string, to: string, reason: string | null) {
  const { lead } = await svc.view(actor, leadId);
  return svc.changeStage(actor, leadId, { to, reason, expectedVersion: lead.version });
}
const AGENT = { kind: "agent" as const, agent: "CRMAgent" as const };
const SYSTEM = { kind: "system" as const };
const T = "2026-11-21T09:00:00.000Z";

function setup() {
  const clock = makeClock(T);
  const audit = new MemoryAuditSink();
  const store = new MemoryCrmStore();
  const svc = new CrmService({ store, audit, now: clock.now, newId: makeIds("crm"), requestApproval: async () => "review-stub" });
  return { svc, store, audit, clock };
}

const leadInput = (over: Record<string, unknown> = {}) => ({
  label: "Family visa enquiry",
  source: "manual",
  applicationId: null,
  destinationCountry: "FR",
  nationality: "DZ",
  travelDate: null,
  interest: "visa",
  ...over,
});

describe("authorization", () => {
  it("refuses every CRM action to agents and the system", async () => {
    const { svc } = setup();
    const lead = await svc.createLead(OWNER_ACTOR, leadInput());
    for (const actor of [AGENT, SYSTEM]) {
      await expect(svc.createLead(actor, leadInput())).rejects.toBeInstanceOf(CrmForbiddenError);
      await expect(svc.changeStage(actor, lead.id, { to: "contacted", reason: null })).rejects.toBeInstanceOf(CrmForbiddenError);
      await expect(svc.addInteraction(actor, lead.id, { kind: "note", summary: "Called back" })).rejects.toBeInstanceOf(CrmForbiddenError);
      await expect(svc.list(actor, { includeArchived: false, limit: 10 })).rejects.toBeInstanceOf(CrmForbiddenError);
      await expect(svc.view(actor, lead.id)).rejects.toBeInstanceOf(CrmForbiddenError);
      await expect(svc.proposeFollowUps(actor)).rejects.toBeInstanceOf(CrmForbiddenError);
      await expect(svc.funnel(actor)).rejects.toBeInstanceOf(CrmForbiddenError);
    }
  });

  it("refuses an owner actor with an empty identity", async () => {
    const { svc } = setup();
    await expect(svc.createLead({ kind: "owner", id: "  " }, leadInput())).rejects.toBeInstanceOf(CrmForbiddenError);
  });
});

describe("leads and stages", () => {
  it("creates a lead at the new stage and audits it without personal data", async () => {
    const { svc, audit } = setup();
    const lead = await svc.createLead(OWNER_ACTOR, leadInput({ label: "Enquiry from Oran" }));
    expect(lead.stage).toBe("new");
    const entry = audit.events.find((e) => e.type === "crm.lead_created");
    expect(JSON.stringify(entry)).not.toContain("Oran");
  });

  it("moves a lead along a valid path and records each move", async () => {
    const { svc, store } = setup();
    const lead = await svc.createLead(OWNER_ACTOR, leadInput());
    await move(svc, OWNER_ACTOR, lead.id, "contacted", null);
    await move(svc, OWNER_ACTOR, lead.id, "qualified", null);
    const view = await svc.view(OWNER_ACTOR, lead.id);
    expect(view.lead.stage).toBe("qualified");
    expect(view.history.map((h) => `${h.fromStage}>${h.toStage}`)).toEqual(["contacted>qualified", "new>contacted"]);
    expect((await store.listHistory([lead.id])).length).toBe(2);
  });

  it("refuses a move the pipeline does not allow, and writes nothing", async () => {
    const { svc, store } = setup();
    const lead = await svc.createLead(OWNER_ACTOR, leadInput());
    await expect(move(svc, OWNER_ACTOR, lead.id, "converted", null)).rejects.toBeInstanceOf(CrmRuleError);
    expect((await store.getLead(lead.id))?.stage).toBe("new");
    expect(await store.listHistory([lead.id])).toHaveLength(0);
  });

  it("requires a reason to mark a lead lost", async () => {
    const { svc } = setup();
    const lead = await svc.createLead(OWNER_ACTOR, leadInput());
    await expect(move(svc, OWNER_ACTOR, lead.id, "lost", null)).rejects.toBeInstanceOf(CrmValidationError);
    const lost = await move(svc, OWNER_ACTOR, lead.id, "lost", "Booked with another agency");
    expect(lost.stageReason).toBe("Booked with another agency");
  });

  it("reopening a lost lead is exceptional: it waits for the owner's approval rather than applying", async () => {
    const { svc } = setup();
    const lead = await svc.createLead(OWNER_ACTOR, leadInput());
    await move(svc, OWNER_ACTOR, lead.id, "lost", "No reply after two weeks");
    await expect(move(svc, OWNER_ACTOR, lead.id, "qualified", null)).rejects.toBeInstanceOf(CrmRuleError);
    await expect(move(svc, OWNER_ACTOR, lead.id, "new", null)).rejects.toBeInstanceOf(CrmRequiresApprovalError);
    expect((await svc.view(OWNER_ACTOR, lead.id)).lead.stage).toBe("lost");
  });

  it("refuses personal data in free text", async () => {
    const { svc } = setup();
    const lead = await svc.createLead(OWNER_ACTOR, leadInput());
    await expect(svc.addInteraction(OWNER_ACTOR, lead.id, { kind: "note", summary: "Reach them at client@example.dz" })).rejects.toBeInstanceOf(CrmValidationError);
    await expect(svc.createLead(OWNER_ACTOR, leadInput({ label: "Call +213612345678" }))).rejects.toBeInstanceOf(CrmValidationError);
  });

  it("requires an application link for application leads", async () => {
    const { svc } = setup();
    await expect(svc.createLead(OWNER_ACTOR, leadInput({ source: "application", applicationId: null }))).rejects.toBeInstanceOf(CrmValidationError);
    const lead = await svc.createLead(OWNER_ACTOR, leadInput({ source: "application", applicationId: "00000000-0000-4000-8000-000000000042" }));
    expect(lead.applicationId).toBe("00000000-0000-4000-8000-000000000042");
  });

  it("refuses changes to an archived lead", async () => {
    const { svc, store } = setup();
    const lead = await svc.createLead(OWNER_ACTOR, leadInput());
    const archived: LeadRecord = { ...(await store.getLead(lead.id))!, archivedAt: T };
    await store.saveLead(archived, OWNER.id, archived.version);
    await expect(svc.addInteraction(OWNER_ACTOR, lead.id, { kind: "note", summary: "Still interested" })).rejects.toBeInstanceOf(CrmRuleError);
  });
});

describe("interactions and scoring", () => {
  it("stores interactions and scores them from the owner's notes", async () => {
    const { svc } = setup();
    const lead = await svc.createLead(OWNER_ACTOR, leadInput({ source: "referral", destinationCountry: "FR" }));
    await svc.addInteraction(OWNER_ACTOR, lead.id, { kind: "call", summary: "Asked how much the package costs" });
    const [item] = await svc.list(OWNER_ACTOR, { includeArchived: false, limit: 10 });
    expect(item?.assessment.intent).toBe("high");
    expect(item?.assessment.reasons.map((r) => r.code)).toEqual(expect.arrayContaining(["source_referral", "destination_known", "intent_high"]));
  });
});

describe("follow-ups", () => {
  it("proposes a follow-up for a quiet lead once, and never sends anything", async () => {
    const { svc, clock } = setup();
    await svc.createLead(OWNER_ACTOR, leadInput());
    clock.advance(3 * 86_400_000);
    expect(await svc.proposeFollowUps(OWNER_ACTOR)).toBe(1);
    expect(await svc.proposeFollowUps(OWNER_ACTOR)).toBe(0);
    const [item] = await svc.list(OWNER_ACTOR, { includeArchived: false, limit: 10 });
    const view = await svc.view(OWNER_ACTOR, item!.lead.id);
    expect(view.followUps).toHaveLength(1);
    expect(view.followUps[0]?.status).toBe("suggested");
  });

  it("walks a suggestion through approve and complete, and refuses invalid decisions", async () => {
    const { svc, clock } = setup();
    const lead = await svc.createLead(OWNER_ACTOR, leadInput());
    clock.advance(3 * 86_400_000);
    await svc.proposeFollowUps(OWNER_ACTOR);
    const view = await svc.view(OWNER_ACTOR, lead.id);
    const f = view.followUps[0]!;
    await expect(svc.decideFollowUp(OWNER_ACTOR, f.id, "complete")).rejects.toBeInstanceOf(CrmRuleError);
    const approved = await svc.decideFollowUp(OWNER_ACTOR, f.id, "approve");
    expect(approved.status).toBe("scheduled");
    expect(approved.decidedBy).toBe(OWNER.id);
    await expect(svc.decideFollowUp(OWNER_ACTOR, f.id, "approve")).rejects.toBeInstanceOf(CrmRuleError);
    expect((await svc.decideFollowUp(OWNER_ACTOR, f.id, "complete")).status).toBe("done");
  });

  it("dismisses open follow-ups when a lead is closed", async () => {
    const { svc, clock } = setup();
    const lead = await svc.createLead(OWNER_ACTOR, leadInput());
    clock.advance(3 * 86_400_000);
    await svc.proposeFollowUps(OWNER_ACTOR);
    await move(svc, OWNER_ACTOR, lead.id, "contacted", null);
    await move(svc, OWNER_ACTOR, lead.id, "lost", "Not travelling this year");
    const view = await svc.view(OWNER_ACTOR, lead.id);
    expect(view.followUps.map((f) => f.status)).toEqual(["dismissed"]);
  });

  it("does not propose follow-ups for terminal leads", async () => {
    const { svc, clock } = setup();
    const lead = await svc.createLead(OWNER_ACTOR, leadInput());
    await move(svc, OWNER_ACTOR, lead.id, "lost", "Changed their mind");
    clock.advance(10 * 86_400_000);
    expect(await svc.proposeFollowUps(OWNER_ACTOR)).toBe(0);
  });
});

describe("sales funnel", () => {
  it("reports reached counts and conversion from stored rows", async () => {
    const { svc } = setup();
    const a = await svc.createLead(OWNER_ACTOR, leadInput());
    const b = await svc.createLead(OWNER_ACTOR, leadInput({ label: "Second enquiry" }));
    await move(svc, OWNER_ACTOR, a.id, "contacted", null);
    await move(svc, OWNER_ACTOR, a.id, "qualified", null);
    await move(svc, OWNER_ACTOR, a.id, "converted", null);
    await move(svc, OWNER_ACTOR, b.id, "lost", "No budget");
    const f = await svc.funnel(OWNER_ACTOR);
    expect(f.conversionRate).toBe(50);
    expect(f.rows.find((r) => r.stage === "qualified")?.reached).toBe(1);
    expect(f.rows.find((r) => r.stage === "lost")?.reached).toBe(1);
    expect(f.activeCount).toBe(0);
  });
});
