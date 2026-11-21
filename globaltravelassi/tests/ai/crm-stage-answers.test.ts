import { describe, it, expect } from "vitest";
import { makeHarness, OWNER, ScriptedProvider } from "./helpers";
import { StageAnswerService, STAGE_ANSWER_SCHEMA } from "@/lib/ai/factual/stage-answer";
import { CrmService, CrmValidationError } from "@/lib/ai/crm/service";
import { MemoryCrmStore } from "@/lib/ai/crm/memory-store";
import { MemoryAuditSink } from "@/lib/ai/audit";
import { LEAD_STAGES } from "@/lib/ai/crm/rules";

const CONFIG = { id: "scripted", kind: "mock" as const, costTier: "free" as const, enabled: true, ownerApproved: true, dailyRequestLimit: 1000 };
const QUESTION = "Which stage should a new family visa enquiry start in?";

/** Builds the stage service on a real runtime whose model replies with the given text, and a CRM with one lead. */
async function setup(reply: string) {
  const provider = new ScriptedProvider("scripted", async () => reply);
  const h = makeHarness({ providers: [{ config: CONFIG, provider }] });
  const audit = new MemoryAuditSink();
  const crm = new CrmService({ store: new MemoryCrmStore(), audit, now: h.clock.now, newId: h.ids });
  const lead = await crm.createLead(OWNER, { label: "Family visa enquiry", source: "manual", applicationId: null, destinationCountry: "FR", nationality: "DZ", travelDate: null, interest: "visa" });
  const stages = new StageAnswerService({ runtime: h.runtime, crm, audit, now: h.clock.now, newId: h.ids });
  return { stages, lead, audit, crm };
}

describe("reproduction: the model's invented stage is never the answer", () => {
  it('a model that answers "Boundaries" is refused, and the stored stage ("new") is the answer', async () => {
    const { stages, lead, audit } = await setup(JSON.stringify({ stage: "Boundaries", reason: "It fits the boundaries." }));
    const answer = await stages.answer(OWNER, lead.id, QUESTION);
    expect(answer.stage).toBe("new");
    expect(answer.source).toBe("crm_record");
    expect(answer.modelCheck).toBe("refused");
    expect(answer.status).toBe("answered");
    expect(answer.reasons).toEqual(["model_output_refused"]);
    expect(JSON.stringify(answer)).not.toContain("Boundaries");
    expect(audit.events.find((e) => e.type === "crm.stage_answered")?.meta).toMatchObject({ modelCheck: "refused" });
  });

  it("the schema accepts only the CRM's own stages", () => {
    expect(STAGE_ANSWER_SCHEMA.safeParse({ stage: "Boundaries" }).success).toBe(false);
    expect(STAGE_ANSWER_SCHEMA.safeParse({ stage: "New" }).success).toBe(false);
    for (const s of LEAD_STAGES) expect(STAGE_ANSWER_SCHEMA.safeParse({ stage: s }).success).toBe(true);
  });
});

describe("cross-check against the stored record", () => {
  it("a model that agrees with the record is marked agreed, and the record is the answer", async () => {
    const { stages, lead } = await setup(JSON.stringify({ stage: "new", reason: "A new enquiry starts as new." }));
    const answer = await stages.answer(OWNER, lead.id, QUESTION);
    expect(answer).toMatchObject({ stage: "new", modelCheck: "agreed", status: "answered", reasons: [] });
  });

  it("a model that names a different defined stage disagrees: the record is still the answer, and it is escalated", async () => {
    const { stages, lead } = await setup(JSON.stringify({ stage: "contacted", reason: "Already contacted." }));
    const answer = await stages.answer(OWNER, lead.id, QUESTION);
    expect(answer.stage).toBe("new");
    expect(answer.modelCheck).toBe("disagreed");
    expect(answer.status).toBe("escalated");
    expect(answer.reasons).toEqual(["contradicts_record"]);
  });
});

describe("owner only, and only for leads that exist", () => {
  it("refuses an agent, the system and an owner without identity", async () => {
    const { stages, lead } = await setup(JSON.stringify({ stage: "new", reason: "x" }));
    await expect(stages.answer({ kind: "agent", agent: "CRMAgent" }, lead.id, QUESTION)).rejects.toThrow(/Only the owner/);
    await expect(stages.answer({ kind: "system" }, lead.id, QUESTION)).rejects.toThrow(/Only the owner/);
    await expect(stages.answer({ kind: "owner", id: " " }, lead.id, QUESTION)).rejects.toThrow(/Only the owner/);
  });

  it("refuses a lead that does not exist, rather than answering", async () => {
    const { stages } = await setup(JSON.stringify({ stage: "new", reason: "x" }));
    await expect(stages.answer(OWNER, "00000000-0000-4000-8000-000000000999", QUESTION)).rejects.toBeInstanceOf(CrmValidationError);
  });

  it("the audit entry holds the status and codes, never the question", async () => {
    const { stages, lead, audit } = await setup(JSON.stringify({ stage: "new", reason: "x" }));
    await stages.answer(OWNER, lead.id, QUESTION);
    expect(JSON.stringify(audit.events.find((e) => e.type === "crm.stage_answered"))).not.toContain("family visa");
  });
});
