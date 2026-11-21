import { describe, it, expect } from "vitest";
import { CrmService, CrmStaleError, CrmRuleError, CrmForbiddenError, type LeadRecord } from "@/lib/ai/crm/service";
import { MemoryCrmStore } from "@/lib/ai/crm/memory-store";
import { transitionKind, canMoveStage } from "@/lib/ai/crm/rules";
import { MemoryAuditSink } from "@/lib/ai/audit";
import { makeClock, makeIds, OWNER } from "./helpers";

const AGENT = { kind: "agent" as const, agent: "CRMAgent" as const };

function setup() {
  const clock = makeClock("2026-11-21T09:00:00.000Z");
  const audit = new MemoryAuditSink();
  const store = new MemoryCrmStore();
  const requested: { leadId: string; from: string; to: string; expectedVersion: number }[] = [];
  const svc = new CrmService({
    store,
    audit,
    now: clock.now,
    newId: makeIds("c"),
    requestApproval: async (r) => {
      requested.push({ leadId: r.leadId, from: r.from, to: r.to, expectedVersion: r.expectedVersion });
      return `review-${requested.length}`;
    },
  });
  return { svc, store, audit, requested };
}

async function leadAt(svc: CrmService, stage: "new" | "contacted" | "qualified" | "lost" = "new"): Promise<LeadRecord> {
  const lead = await svc.createLead(OWNER, { label: "Family visa enquiry", source: "manual", applicationId: null, destinationCountry: "FR", nationality: "DZ", travelDate: null, interest: "visa" });
  const path: Record<string, string[]> = { new: [], contacted: ["contacted"], qualified: ["contacted", "qualified"], lost: ["lost"] };
  let version = lead.version;
  for (const to of path[stage]!) {
    const updated = await svc.changeStage(OWNER, lead.id, { to, reason: to === "lost" ? "Went elsewhere" : null, expectedVersion: version });
    version = updated.version;
  }
  return (await svc.view(OWNER, lead.id)).lead;
}

describe("transition rules", () => {
  it("classifies every move as standard, exceptional or forbidden", () => {
    expect(transitionKind("new", "contacted")).toBe("standard");
    expect(transitionKind("qualified", "converted")).toBe("standard");
    expect(transitionKind("qualified", "interested")).toBe("exceptional");
    expect(transitionKind("interested", "qualified")).toBe("exceptional");
    expect(transitionKind("lost", "new")).toBe("exceptional");
    expect(transitionKind("new", "converted")).toBe("forbidden");
    expect(transitionKind("converted", "new")).toBe("forbidden");
    expect(transitionKind("lost", "contacted")).toBe("forbidden");
    expect(canMoveStage("new", "new")).toBe(false);
  });
});

describe("unauthorized and invalid transitions do not execute", () => {
  it("a move the pipeline never allows is refused, and nothing is written", async () => {
    const { svc, store } = setup();
    const lead = await leadAt(svc, "new");
    await expect(svc.changeStage(OWNER, lead.id, { to: "converted", reason: null, expectedVersion: lead.version })).rejects.toBeInstanceOf(CrmRuleError);
    expect((await store.getLead(lead.id))?.stage).toBe("new");
    expect(await store.listHistory([lead.id])).toHaveLength(0);
  });

  it("an agent cannot move a lead, even with the right version", async () => {
    const { svc } = setup();
    const lead = await leadAt(svc, "new");
    await expect(svc.changeStage(AGENT, lead.id, { to: "contacted", reason: null, expectedVersion: lead.version })).rejects.toBeInstanceOf(CrmForbiddenError);
  });
});

describe("exceptional transitions wait for the owner", () => {
  it("reopening a lost lead creates an owner request and changes nothing yet", async () => {
    const { svc, store, requested } = setup();
    const lead = await leadAt(svc, "lost");
    const result = await svc.requestStageChange(OWNER, lead.id, { to: "new", reason: "Customer came back.", expectedVersion: lead.version });
    expect(result).toEqual({ status: "pending_owner", reviewId: "review-1" });
    expect(requested).toEqual([{ leadId: lead.id, from: "lost", to: "new", expectedVersion: lead.version }]);
    expect((await store.getLead(lead.id))?.stage).toBe("lost");
  });

  it("an approved exceptional move is applied, once", async () => {
    const { svc, store } = setup();
    const lead = await leadAt(svc, "lost");
    const request = { leadId: lead.id, from: "lost" as const, to: "new" as const, expectedVersion: lead.version, reason: "Came back." };
    await svc.checkApprovedTransition(request);
    const applied = await svc.applyApprovedTransition(OWNER.id, request);
    expect(applied).toMatchObject({ stage: "new", version: lead.version + 1 });
    expect((await store.getLead(lead.id))?.stage).toBe("new");
  });

  it("an approval replayed after it was applied is refused: the lead has moved on", async () => {
    const { svc } = setup();
    const lead = await leadAt(svc, "lost");
    const request = { leadId: lead.id, from: "lost" as const, to: "new" as const, expectedVersion: lead.version, reason: "Came back." };
    await svc.applyApprovedTransition(OWNER.id, request);
    await expect(svc.applyApprovedTransition(OWNER.id, request)).rejects.toBeInstanceOf(CrmStaleError);
  });

  it("an approval for a lead that changed since the request is refused, not applied to the newer state", async () => {
    const { svc, store } = setup();
    const lead = await leadAt(svc, "lost");
    const stale = { leadId: lead.id, from: "lost" as const, to: "new" as const, expectedVersion: lead.version, reason: "Came back." };
    // Someone else changed the lead in the meantime (the version moved on).
    await store.saveLead({ ...lead, label: "Changed label" }, OWNER.id, lead.version);
    await expect(svc.checkApprovedTransition(stale)).rejects.toBeInstanceOf(CrmStaleError);
    await expect(svc.applyApprovedTransition(OWNER.id, stale)).rejects.toBeInstanceOf(CrmStaleError);
    expect((await store.getLead(lead.id))?.stage).toBe("lost");
  });
});

describe("prevent stale updates: concurrency control", () => {
  it("a change made from an out-of-date screen is refused, even when the move itself is allowed", async () => {
    const { svc } = setup();
    const lead = await leadAt(svc, "new");
    await svc.changeStage(OWNER, lead.id, { to: "contacted", reason: null, expectedVersion: lead.version });
    // The owner's screen still shows the old version.
    await expect(svc.changeStage(OWNER, lead.id, { to: "qualified", reason: null, expectedVersion: lead.version })).rejects.toBeInstanceOf(CrmStaleError);
  });

  it("two changes racing on the same version: exactly one applies, and the stored history has one row for it", async () => {
    const { svc, store } = setup();
    const lead = await leadAt(svc, "new");
    const results = await Promise.allSettled([
      svc.changeStage(OWNER, lead.id, { to: "contacted", reason: "First.", expectedVersion: lead.version }),
      svc.changeStage(OWNER, lead.id, { to: "contacted", reason: "Second.", expectedVersion: lead.version }),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const failed = results.find((r) => r.status === "rejected") as PromiseRejectedResult;
    expect(failed.reason).toBeInstanceOf(CrmStaleError);
    const history = await store.listHistory([lead.id]);
    expect(history).toHaveLength(1);
    expect((await store.getLead(lead.id))?.version).toBe(lead.version + 1);
  });

  it("every applied change records the previous and new version and stage in the audit trail", async () => {
    const { svc, audit } = setup();
    const lead = await leadAt(svc, "new");
    await svc.changeStage(OWNER, lead.id, { to: "contacted", reason: null, expectedVersion: lead.version });
    const entry = audit.events.filter((e) => e.type === "crm.stage_changed").at(-1);
    expect(entry?.meta).toMatchObject({ from: "new", to: "contacted", previousVersion: lead.version, newVersion: lead.version + 1 });
  });
});
