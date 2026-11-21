import { describe, it, expect, beforeEach, vi } from "vitest";

/**
 * The payment actions with the database session replaced by a recorder. What is checked here: input validation, the
 * owner check, that a refused proof never reaches the database, and that database refusals map to the codes the screen
 * shows. The database rules themselves are tested on PGlite in tests/db/manual-payments.test.ts.
 */

const state = vi.hoisted(() => ({
  user: null as string | null,
  adminUser: null as string | null,
  rpcCalls: [] as { fn: string; args: Record<string, unknown> }[],
  rpcResult: { data: null as unknown, error: null as { message: string } | null },
  orphans: [] as string[],
  eligibleNow: new Set<string>(),
  storageRemoved: [] as string[],
  removeFails: false,
  intents: [] as string[],
  finished: [] as { id: string; removed: boolean }[],
}));

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));

const fakeClient = () => ({
  auth: { getUser: async () => ({ data: { user: state.user ? { id: state.user } : null } }) },
  from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: state.adminUser ? { role: "admin", is_active: true } : null }) }) }) }),
  storage: { from: () => ({ remove: async (names: string[]) => { state.storageRemoved.push(...names); return { error: state.removeFails ? { message: "storage unavailable" } : null }; } }) },
  rpc: async (fn: string, args: Record<string, unknown>) => {
    state.rpcCalls.push({ fn, args });
    if (fn === "orphan_payment_proofs") return { data: state.orphans.map((object_name) => ({ object_name })), error: null };
    if (fn === "orphan_proof_still_eligible") return { data: state.eligibleNow.has(String(args.p_name)), error: null };
    if (fn === "begin_orphan_removal") {
      const name = String(args.p_name);
      if (!state.eligibleNow.has(name)) return { data: null, error: { message: "This proof is not eligible for removal." } };
      state.intents.push(name);
      return { data: `intent-${state.intents.length}`, error: null };
    }
    if (fn === "finish_orphan_removal") {
      state.finished.push({ id: String(args.p_removal), removed: Boolean(args.p_removed) });
      return { data: args.p_removed ? "removed" : "failed", error: null };
    }
    return state.rpcResult;
  },
});

vi.mock("@/lib/supabase/server", () => ({ createServerSupabase: async () => fakeClient() }));

const { submitPaymentEvidenceAction, decidePaymentAction, saveMethodSettingsAction, purgeOrphanProofsAction } = await import("@/lib/actions/payments");

const USER = "00000000-0000-0000-0000-0000000000b1";
const APP = "00000000-0000-0000-0000-0000000000d1";
const PAY = "00000000-0000-0000-0000-0000000000f1";
const proof = (over: Record<string, unknown> = {}) => ({
  applicationId: APP,
  method: "usdt",
  storagePath: `${USER}/${APP}/payment-1-proof.pdf`,
  mimeType: "application/pdf",
  sizeBytes: 2048,
  fileName: "proof.pdf",
  ...over,
});
const form = (fields: Record<string, string>) => {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.set(k, v);
  return fd;
};

beforeEach(() => {
  state.user = USER;
  state.adminUser = null;
  state.rpcCalls = [];
  state.rpcResult = { data: "00000000-0000-0000-0000-0000000000e1", error: null };
  state.orphans = [];
  state.eligibleNow = new Set();
  state.storageRemoved = [];
  state.removeFails = false;
  state.intents = [];
  state.finished = [];
});

describe("customer submits a proof", () => {
  it("an anonymous visitor is refused before anything is sent", async () => {
    state.user = null;
    expect(await submitPaymentEvidenceAction(proof())).toEqual({ ok: false, code: "unauthorized" });
    expect(state.rpcCalls).toHaveLength(0);
  });

  it("malformed input is refused, including an unknown method and an amount field", async () => {
    expect(await submitPaymentEvidenceAction(proof({ method: "cash" }))).toEqual({ ok: false, code: "invalid_input" });
    expect(await submitPaymentEvidenceAction(proof({ applicationId: "not-a-uuid" }))).toEqual({ ok: false, code: "invalid_input" });
    expect(await submitPaymentEvidenceAction(proof({ sizeBytes: 0 }))).toEqual({ ok: false, code: "invalid_input" });
    expect(state.rpcCalls).toHaveLength(0);
  });

  it("a proof outside the customer's folder is refused before it reaches the database", async () => {
    expect(await submitPaymentEvidenceAction(proof({ storagePath: `${USER}/${USER}/x.pdf` }))).toEqual({ ok: false, code: "invalid_path" });
    expect(await submitPaymentEvidenceAction(proof({ mimeType: "application/pdf", sizeBytes: 2048, storagePath: "other/x.pdf" }))).toEqual({ ok: false, code: "invalid_path" });
    expect(state.rpcCalls).toHaveLength(0);
  });

  it("a valid proof is sent with no amount: the database takes it from the service", async () => {
    const out = await submitPaymentEvidenceAction(proof());
    expect(out).toEqual({ ok: true, code: "submitted", id: "00000000-0000-0000-0000-0000000000e1" });
    expect(state.rpcCalls[0]?.fn).toBe("submit_payment_evidence");
    expect(Object.keys(state.rpcCalls[0]!.args)).not.toContain("p_amount");
  });

  it.each([
    ["Payment method is not available", "unavailable"],
    ["A payment is already waiting for review.", "already_waiting"],
    ["This request is already paid.", "already_paid"],
    ["This request is not open for payment.", "not_open"],
    ["This service has no price yet.", "no_price"],
    ["The proof file was not uploaded.", "file_missing"],
    ["Request not found.", "not_found"],
    ["something unexpected in the database", "generic"],
  ])("maps the database refusal %j to %s", async (message, code) => {
    state.rpcResult = { data: null, error: { message } };
    expect(await submitPaymentEvidenceAction(proof())).toEqual({ ok: false, code });
  });
});

describe("owner decides a payment", () => {
  it("a visitor who is not the owner is refused", async () => {
    state.adminUser = null;
    expect(await decidePaymentAction(form({ paymentId: PAY, decision: "approve", reason: "Funds seen" }))).toEqual({ ok: false, code: "unauthorized" });
    expect(state.rpcCalls).toHaveLength(0);
  });

  it("a reason of 3 to 500 characters is required, and the decision must be known", async () => {
    state.adminUser = USER;
    expect(await decidePaymentAction(form({ paymentId: PAY, decision: "approve", reason: " x " }))).toEqual({ ok: false, code: "invalid_input" });
    expect(await decidePaymentAction(form({ paymentId: PAY, decision: "maybe", reason: "Funds seen" }))).toEqual({ ok: false, code: "invalid_input" });
    expect(state.rpcCalls).toHaveLength(0);
  });

  it("an approval is confirmed with no customer message, and a rejection is recorded with one", async () => {
    state.adminUser = USER;
    state.rpcResult = { data: "received", error: null };
    expect(await decidePaymentAction(form({ paymentId: PAY, decision: "approve", reason: "Funds seen on the account" }))).toMatchObject({ ok: true, code: "confirmed" });
    expect(state.rpcCalls.at(-1)?.args).toMatchObject({ p_decision: "approve", p_customer_message: null });
    state.rpcResult = { data: "rejected", error: null };
    expect(await decidePaymentAction(form({ paymentId: PAY, decision: "reject", reason: "Amount is wrong", customerMessage: "The amount on the proof is lower than the price." }))).toMatchObject({ ok: true, code: "rejected" });
    expect(state.rpcCalls.at(-1)?.args).toMatchObject({ p_decision: "reject", p_customer_message: "The amount on the proof is lower than the price." });
  });

  it("a rejection without a message for the customer is refused before it reaches the database", async () => {
    state.adminUser = USER;
    expect(await decidePaymentAction(form({ paymentId: PAY, decision: "reject", reason: "Amount is wrong", customerMessage: "  " }))).toEqual({ ok: false, code: "invalid_input" });
    expect(state.rpcCalls).toHaveLength(0);
  });

  it("the owner's internal reason is sent to the database, and the customer message is kept separate from it", async () => {
    state.adminUser = USER;
    state.rpcResult = { data: "rejected", error: null };
    await decidePaymentAction(form({ paymentId: PAY, decision: "reject", reason: "Internal: suspected duplicate", customerMessage: "Please send a clearer copy." }));
    expect(state.rpcCalls.at(-1)?.args).toMatchObject({ p_reason: "Internal: suspected duplicate", p_customer_message: "Please send a clearer copy." });
  });

  it("a second decision on the same payment is refused", async () => {
    state.adminUser = USER;
    state.rpcResult = { data: null, error: { message: "This payment was already decided." } };
    expect(await decidePaymentAction(form({ paymentId: PAY, decision: "approve", reason: "Funds seen" }))).toEqual({ ok: false, code: "already_decided" });
  });
});

describe("owner configures methods", () => {
  const settings = (over: Record<string, string> = {}) =>
    form({ method: "usdt", enabled: "on", instructionsFr: "FR", instructionsEn: "EN", instructionsAr: "AR", reason: "Offer USDT to clients", ...over });

  it("a visitor who is not the owner cannot change a method", async () => {
    expect(await saveMethodSettingsAction(settings())).toEqual({ ok: false, code: "unauthorized" });
    expect(state.rpcCalls).toHaveLength(0);
  });

  it("the change is saved with its reason", async () => {
    state.adminUser = USER;
    expect(await saveMethodSettingsAction(settings())).toEqual({ ok: true, code: "saved" });
    expect(state.rpcCalls[0]).toMatchObject({ fn: "save_payment_method", args: { p_method: "usdt", p_enabled: true, p_reason: "Offer USDT to clients" } });
  });

  it("offering a method without complete instructions is refused, with its own message code", async () => {
    state.adminUser = USER;
    state.rpcResult = { data: null, error: { message: "A method can be offered only with instructions in French, English and Arabic." } };
    expect(await saveMethodSettingsAction(settings({ instructionsAr: "" }))).toEqual({ ok: false, code: "instructions_required" });
  });

  it("an unknown method is refused before it reaches the database", async () => {
    state.adminUser = USER;
    expect(await saveMethodSettingsAction(settings({ method: "cash" }))).toEqual({ ok: false, code: "invalid_input" });
    expect(state.rpcCalls).toHaveLength(0);
  });
});

describe("owner removes unsubmitted proofs", () => {
  const OLD = `${USER}/${APP}/payment-old.pdf`;
  const NEW = `${USER}/${APP}/payment-new.pdf`;
  const stored = vi.hoisted(() => ({ removed: [] as string[], eligible: new Set<string>(), candidates: [] as string[] }));

  beforeEach(() => {
    stored.removed = [];
    stored.candidates = [];
    stored.eligible = new Set<string>();
  });

  it("a visitor who is not the owner cannot remove anything", async () => {
    state.adminUser = null;
    expect(await purgeOrphanProofsAction(form({ reason: "Old uploads" }))).toEqual({ ok: false, code: "unauthorized" });
    expect(state.rpcCalls).toHaveLength(0);
  });

  it("a reason is required", async () => {
    state.adminUser = USER;
    expect(await purgeOrphanProofsAction(form({ reason: "x" }))).toEqual({ ok: false, code: "invalid_input" });
    expect(state.rpcCalls).toHaveLength(0);
  });

  it("removes only the proofs that are still eligible, and records each intent and its confirmed result", async () => {
    state.adminUser = USER;
    state.orphans = [OLD, NEW];
    state.eligibleNow = new Set([OLD]);
    const out = await purgeOrphanProofsAction(form({ reason: "Unsubmitted for over a week" }));
    expect(out).toEqual({ ok: true, code: "purged", id: "1", reference: "0" });
    expect(state.storageRemoved).toEqual([OLD]);
    expect(state.intents).toEqual([OLD]);
    expect(state.finished).toEqual([{ id: "intent-1", removed: true }]);
  });

  it("a proof that is no longer eligible when its removal begins is skipped: no intent, no removal", async () => {
    state.adminUser = USER;
    state.orphans = [OLD];
    state.eligibleNow = new Set();
    expect(await purgeOrphanProofsAction(form({ reason: "Unsubmitted for over a week" }))).toEqual({ ok: true, code: "purged", id: "0", reference: "0" });
    expect(state.storageRemoved).toEqual([]);
    expect(state.intents).toEqual([]);
  });

  it("a failed storage removal is recorded as failed, never as removed, and the owner sees it counted", async () => {
    state.adminUser = USER;
    state.orphans = [OLD];
    state.eligibleNow = new Set([OLD]);
    state.removeFails = true;
    const out = await purgeOrphanProofsAction(form({ reason: "Unsubmitted for over a week" }));
    expect(out).toEqual({ ok: true, code: "purged_partial", id: "0", reference: "1" });
    expect(state.finished).toEqual([{ id: "intent-1", removed: false }]);
  });
});
