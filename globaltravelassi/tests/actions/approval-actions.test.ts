import { describe, it, expect, beforeEach, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { buildApprovalServices, heldPayload, TEST_OWNER } from "../ai/approval-fixtures";

/**
 * The server actions, run as they are. Only the edges are replaced: the owner check (who is signed in), the services
 * (in-memory approval stack) and the cache revalidation. Every outcome below is read back from the real stores.
 */
type Services = ReturnType<typeof buildApprovalServices>;

const state = vi.hoisted(() => ({
  owner: null as string | null,
  services: null as unknown as Services,
}));

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("@/lib/actions/ai", () => ({ ownerId: async () => state.owner }));
vi.mock("@/lib/ai/services", () => ({ createAiServices: async () => state.services }));

const { decideReviewAction, recordReviewCorrectionAction } = await import("@/lib/actions/review");
const { addSourceAction, changeSourceAction } = await import("@/lib/actions/sources");
const { changeLeadStageAction } = await import("@/lib/actions/crm");

const form = (fields: Record<string, string>) => {
  const fd = new FormData();
  fd.set("locale", "en");
  for (const [k, v] of Object.entries(fields)) fd.set(k, v);
  return fd;
};

const LEAD_INPUT = { label: "Enquiry", source: "manual", applicationId: null, destinationCountry: "FR", nationality: "DZ", travelDate: null, interest: "visa" } as const;

async function heldItem() {
  return state.services.review.open({ kind: "held_answer", agent: "ResearchAgent", runId: "run-1", taskId: null, leadId: null, subjectRef: "q-1", summary: "Held", evidence: {}, payload: heldPayload });
}

beforeEach(() => {
  state.services = buildApprovalServices();
  state.owner = TEST_OWNER.id;
});

describe("review decisions through the action", () => {
  it("unauthorized requests change nothing (no owner session, which is also the agent's case)", async () => {
    const item = await heldItem();
    state.owner = null;
    const out = await decideReviewAction(form({ itemId: item.id, decision: "approve", reason: "Looks right", expectedVersion: "1" }));
    expect(out).toEqual({ ok: false, code: "unauthorized" });
    expect((await state.services.reviewStore.get(item.id))?.status).toBe("open");
    expect(state.services.deliveries).toHaveLength(0);
  });

  it("refuses malformed input before anything is decided", async () => {
    const item = await heldItem();
    const bad = [
      { itemId: "not-a-uuid", decision: "approve", reason: "Looks right", expectedVersion: "1" },
      { itemId: item.id, decision: "publish", reason: "Looks right", expectedVersion: "1" },
      { itemId: item.id, decision: "approve", reason: "no", expectedVersion: "1" },
      { itemId: item.id, decision: "approve", reason: "Looks right", expectedVersion: "0" },
    ];
    for (const fields of bad) {
      expect(await decideReviewAction(form(fields))).toEqual({ ok: false, code: "invalid_input" });
    }
    expect((await state.services.reviewStore.get(item.id))?.status).toBe("open");
  });

  it("an approval is saved, the answer is delivered, and the item shows who decided", async () => {
    const item = await heldItem();
    const out = await decideReviewAction(form({ itemId: item.id, decision: "approve", reason: "Matches the source", expectedVersion: "1" }));
    expect(out).toMatchObject({ ok: true, code: "saved" });
    const row = await state.services.reviewStore.get(item.id);
    expect(row).toMatchObject({ status: "approved", decidedBy: TEST_OWNER.id });
    expect(state.services.deliveries).toEqual([{ questionId: "q-1", toAgent: "SalesAgent" }]);
  });

  it("a duplicate approval is refused and the answer is not delivered again", async () => {
    const item = await heldItem();
    await decideReviewAction(form({ itemId: item.id, decision: "approve", reason: "Matches the source", expectedVersion: "1" }));
    const stale = await decideReviewAction(form({ itemId: item.id, decision: "approve", reason: "Again", expectedVersion: "1" }));
    expect(stale).toEqual({ ok: false, code: "stale" });
    const duplicate = await decideReviewAction(form({ itemId: item.id, decision: "approve", reason: "Again", expectedVersion: "2" }));
    expect(duplicate).toEqual({ ok: false, code: "already_decided" });
    expect(state.services.deliveries).toHaveLength(1);
  });

  it("two approvals at the same moment deliver one answer and one of them is refused", async () => {
    const item = await heldItem();
    const args = form({ itemId: item.id, decision: "approve", reason: "Matches the source", expectedVersion: "1" });
    const results = await Promise.all([decideReviewAction(args), decideReviewAction(args)]);
    expect(results.filter((r) => r.ok && r.code === "saved")).toHaveLength(1);
    const refused = results.find((r) => !r.ok)!;
    expect(["stale", "already_decided"]).toContain(refused.code);
    expect(state.services.deliveries).toHaveLength(1);
  });

  it("a decision the kind does not allow is refused and the item stays open", async () => {
    const item = await state.services.review.open({ kind: "rejected_proposal", agent: "ResearchAgent", runId: "run-1", taskId: "task-1", leadId: null, subjectRef: "task-1", summary: "Rejected", evidence: {}, payload: { taskId: "task-1", runId: "run-1", agent: "ResearchAgent", stepKey: "research" } });
    const out = await decideReviewAction(form({ itemId: item.id, decision: "approve", reason: "Looks right", expectedVersion: "1" }));
    expect(out).toEqual({ ok: false, code: "rule_refused" });
    expect((await state.services.reviewStore.get(item.id))?.status).toBe("open");
  });

  it("a request for an item that does not exist is refused", async () => {
    const out = await decideReviewAction(form({ itemId: randomUUID(), decision: "approve", reason: "Looks right", expectedVersion: "1" }));
    expect(out).toEqual({ ok: false, code: "not_found" });
  });

  it("a correction is recorded for a decided item only, and never changes the decision", async () => {
    const item = await heldItem();
    const early = await recordReviewCorrectionAction(form({ itemId: item.id, reason: "Too early" }));
    expect(early).toEqual({ ok: false, code: "rule_refused" });
    await decideReviewAction(form({ itemId: item.id, decision: "approve", reason: "Matches the source", expectedVersion: "1" }));
    const out = await recordReviewCorrectionAction(form({ itemId: item.id, reason: "Sent to the wrong agent" }));
    expect(out).toMatchObject({ ok: true, code: "saved" });
    expect((await state.services.reviewStore.get(item.id))?.status).toBe("approved");
    expect(state.services.audit.events.some((e) => e.type === "review.correction_recorded")).toBe(true);
    state.owner = null;
    expect(await recordReviewCorrectionAction(form({ itemId: item.id, reason: "Not signed in" }))).toEqual({ ok: false, code: "unauthorized" });
  });
});

describe("source mutations through the action", () => {
  const add = (over: Record<string, string> = {}) => ({ host: "visa.example.gov.dz", category: "government", jurisdiction: "dz", purpose: "Visa rules", expiresAt: "", reason: "Confirmed the address", ...over });

  it("unauthorized requests cannot add or change a host", async () => {
    state.owner = null;
    expect(await addSourceAction(form(add()))).toEqual({ ok: false, code: "unauthorized" });
    expect(await state.services.sources.activeHosts()).toEqual([]);
  });

  it("refuses a URL, a missing reason and an unknown category", async () => {
    expect(await addSourceAction(form(add({ host: "https://visa.example.gov.dz" })))).toEqual({ ok: false, code: "invalid_input" });
    expect(await addSourceAction(form(add({ reason: "" })))).toEqual({ ok: false, code: "invalid_input" });
    expect(await addSourceAction(form(add({ category: "blog" })))).toEqual({ ok: false, code: "invalid_input" });
    expect(await state.services.sources.activeHosts()).toEqual([]);
  });

  it("adds a host, and the database-style audit records the reason", async () => {
    expect(await addSourceAction(form(add()))).toMatchObject({ ok: true, code: "saved" });
    expect(await state.services.sources.activeHosts()).toEqual(["visa.example.gov.dz"]);
    expect(state.services.audit.events.find((e) => e.type === "source.added")!.meta.reason).toBe("Confirmed the address");
  });

  it("a change needs its own reason and the version the owner saw", async () => {
    await addSourceAction(form(add()));
    const row = (await state.services.sources.list({ kind: "owner", id: TEST_OWNER.id }))[0]!;
    const noReason = await changeSourceAction(form({ host: row.host, intent: "disable", expectedVersion: String(row.version), reason: "" }));
    expect(noReason).toEqual({ ok: false, code: "invalid_input" });
    const stale = await changeSourceAction(form({ host: row.host, intent: "disable", expectedVersion: String(row.version + 5), reason: "Source moved" }));
    expect(stale).toEqual({ ok: false, code: "stale" });
    expect((await state.services.sources.activeHosts())).toEqual(["visa.example.gov.dz"]);
  });

  it("disable and enable change what agents can read at once", async () => {
    await addSourceAction(form(add()));
    const row = (await state.services.sources.list({ kind: "owner", id: TEST_OWNER.id }))[0]!;
    expect(await changeSourceAction(form({ host: row.host, intent: "disable", expectedVersion: String(row.version), reason: "Source moved" }))).toMatchObject({ ok: true });
    expect(await state.services.sources.activeHosts()).toEqual([]);
    const after = (await state.services.sources.list({ kind: "owner", id: TEST_OWNER.id }))[0]!;
    expect(await changeSourceAction(form({ host: after.host, intent: "enable", expectedVersion: String(after.version), reason: "Back online" }))).toMatchObject({ ok: true });
    expect(await state.services.sources.activeHosts()).toEqual(["visa.example.gov.dz"]);
  });

  it("retirement is terminal: the row stays, and a later owner change is refused", async () => {
    await addSourceAction(form(add()));
    const row = (await state.services.sources.list({ kind: "owner", id: TEST_OWNER.id }))[0]!;
    expect(await changeSourceAction(form({ host: row.host, intent: "retire", expectedVersion: String(row.version), reason: "Not used any more" }))).toMatchObject({ ok: true });
    expect(await state.services.sources.activeHosts()).toEqual([]);
    expect((await state.services.sourceStore.get(row.host))?.status).toBe("retired");
    const later = await changeSourceAction(form({ host: row.host, intent: "enable", expectedVersion: String(row.version + 1), reason: "Bring it back" }));
    expect(later).toEqual({ ok: false, code: "rule_refused" });
  });

  it("a retired host can only ask to come back; the request is a pending approval, not a change", async () => {
    await addSourceAction(form(add()));
    const row = (await state.services.sources.list({ kind: "owner", id: TEST_OWNER.id }))[0]!;
    await changeSourceAction(form({ host: row.host, intent: "retire", expectedVersion: String(row.version), reason: "Not used any more" }));
    const retired = (await state.services.sources.list({ kind: "owner", id: TEST_OWNER.id }))[0]!;
    const asked = await changeSourceAction(form({ host: retired.host, intent: "request_reactivation", expectedVersion: String(retired.version), reason: "Confirmed the new address" }));
    expect(asked).toMatchObject({ ok: true, code: "pending_owner" });
    expect((await state.services.sourceStore.get(row.host))?.status).toBe("retired");
    const approved = await decideReviewAction(form({ itemId: (asked as { id: string }).id, decision: "approve", reason: "Checked it again", expectedVersion: "1" }));
    expect(approved).toMatchObject({ ok: true, code: "saved" });
    expect(await state.services.sources.activeHosts()).toEqual([row.host]);
  });
  });

describe("CRM transitions through the action", () => {
  async function newLead() {
    return state.services.crm.createLead(TEST_OWNER, LEAD_INPUT);
  }

  it("unauthorized requests cannot move a lead", async () => {
    const lead = await newLead();
    state.owner = null;
    expect(await changeLeadStageAction(form({ id: lead.id, to: "contacted", expectedVersion: String(lead.version) }))).toEqual({ ok: false, code: "unauthorized" });
    expect((await state.services.crm.view(TEST_OWNER, lead.id)).lead.stage).toBe("new");
  });

  it("a standard move is applied and recorded once", async () => {
    const lead = await newLead();
    expect(await changeLeadStageAction(form({ id: lead.id, to: "contacted", expectedVersion: String(lead.version) }))).toEqual({ ok: true, code: "saved" });
    const view = await state.services.crm.view(TEST_OWNER, lead.id);
    expect(view.lead.stage).toBe("contacted");
    expect(view.history).toHaveLength(1);
  });

  it("a move the pipeline forbids is refused and writes nothing", async () => {
    const lead = await newLead();
    expect(await changeLeadStageAction(form({ id: lead.id, to: "converted", expectedVersion: String(lead.version) }))).toEqual({ ok: false, code: "rule_refused" });
    expect((await state.services.crm.view(TEST_OWNER, lead.id)).history).toHaveLength(0);
  });

  it("a move from a stale screen is refused", async () => {
    const lead = await newLead();
    await changeLeadStageAction(form({ id: lead.id, to: "contacted", expectedVersion: String(lead.version) }));
    expect(await changeLeadStageAction(form({ id: lead.id, to: "qualified", expectedVersion: String(lead.version) }))).toEqual({ ok: false, code: "stale" });
  });

  it("reopening a lost lead waits for the owner, and approving it moves the lead exactly once", async () => {
    const lead = await newLead();
    const lost = await state.services.crm.changeStage(TEST_OWNER, lead.id, { to: "lost", reason: "No reply", expectedVersion: lead.version });
    const waiting = await changeLeadStageAction(form({ id: lead.id, to: "new", expectedVersion: String(lost.version) }));
    expect(waiting).toMatchObject({ ok: true, code: "pending_owner" });
    expect((await state.services.crm.view(TEST_OWNER, lead.id)).lead.stage).toBe("lost");

    const reviewId = (waiting as { id: string }).id;
    const approved = await decideReviewAction(form({ itemId: reviewId, decision: "approve", reason: "Customer came back", expectedVersion: "1" }));
    expect(approved).toMatchObject({ ok: true, code: "saved" });
    const view = await state.services.crm.view(TEST_OWNER, lead.id);
    expect(view.lead.stage).toBe("new");
    expect(view.history.filter((h) => h.toStage === "new")).toHaveLength(1);

    expect(await decideReviewAction(form({ itemId: reviewId, decision: "approve", reason: "Again", expectedVersion: "2" }))).toEqual({ ok: false, code: "already_decided" });
    expect((await state.services.crm.view(TEST_OWNER, lead.id)).history.filter((h) => h.toStage === "new")).toHaveLength(1);
  });

  it("asking again for the same reopen gives the same waiting approval, not a second one", async () => {
    const lead = await newLead();
    const lost = await state.services.crm.changeStage(TEST_OWNER, lead.id, { to: "lost", reason: "No reply", expectedVersion: lead.version });
    const first = await changeLeadStageAction(form({ id: lead.id, to: "new", expectedVersion: String(lost.version) }));
    const second = await changeLeadStageAction(form({ id: lead.id, to: "new", expectedVersion: String(lost.version) }));
    expect((first as { id: string }).id).toBe((second as { id: string }).id);
  });
});
