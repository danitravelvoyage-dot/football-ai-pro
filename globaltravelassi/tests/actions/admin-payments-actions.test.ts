import { describe, it, expect, beforeEach, vi } from "vitest";

/**
 * Owner actions that touch payments and request deletion, run against a recorder in place of the database and storage.
 * Regression: a refused deletion must never remove a stored file; a payment action must go through a function, never a
 * direct table write.
 */

const state = vi.hoisted(() => ({
  admin: true,
  rpcCalls: [] as { fn: string; args: Record<string, unknown> }[],
  rpcResult: { data: null as unknown, error: null as { message: string } | null },
  removed: [] as string[][],
  removeError: null as { message: string } | null,
  tableWrites: [] as string[],
}));

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw Object.assign(new Error("NEXT_REDIRECT"), { digest: `NEXT_REDIRECT;${url}` });
  },
}));

const fake = () => ({
  auth: { getUser: async () => ({ data: { user: state.admin ? { id: "00000000-0000-0000-0000-0000000000a1" } : null } }) },
  from: (table: string) => ({
    select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: state.admin ? { role: "admin", is_active: true } : null }) }) }),
    insert: () => {
      state.tableWrites.push(`${table}.insert`);
      return Promise.resolve({ data: null, error: null });
    },
    update: () => {
      state.tableWrites.push(`${table}.update`);
      return { eq: () => ({ select: async () => ({ data: [], error: null }) }) };
    },
    delete: () => {
      state.tableWrites.push(`${table}.delete`);
      return { eq: () => ({ select: async () => ({ data: [], error: null }) }) };
    },
  }),
  rpc: async (fn: string, args: Record<string, unknown>) => {
    state.rpcCalls.push({ fn, args });
    return state.rpcResult;
  },
  storage: { from: () => ({ remove: async (paths: string[]) => { state.removed.push(paths); return { error: state.removeError }; } }) },
});

vi.mock("@/lib/supabase/server", () => ({ createServerSupabase: async () => fake() }));

const { deleteApplicationAction, recordPaymentAction, setPaymentStatusAction } = await import("@/lib/actions/admin");

const APP = "00000000-0000-0000-0000-0000000000d1";
const PAY = "00000000-0000-0000-0000-0000000000f1";
const form = (fields: Record<string, string>) => {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.set(k, v);
  return fd;
};

beforeEach(() => {
  state.admin = true;
  state.rpcCalls = [];
  state.rpcResult = { data: [], error: null };
  state.removed = [];
  state.removeError = null;
  state.tableWrites = [];
});

describe("request deletion never removes files before the database allows it", () => {
  it("a refused deletion removes no stored file and deletes nothing", async () => {
    state.rpcResult = { data: null, error: { message: "This request has protected payments or records, which are kept. Nothing was deleted." } };
    const out = await deleteApplicationAction(form({ applicationId: APP, locale: "en" }));
    expect(out).toEqual({ ok: false, code: "protected_records" });
    expect(state.removed).toEqual([]);
    expect(state.tableWrites).toEqual([]);
  });

  it("a deletion the database allows removes exactly the document files it returned, then redirects", async () => {
    state.rpcResult = { data: ["u/a/passport.pdf", "u/a/photo.jpg"], error: null };
    await expect(deleteApplicationAction(form({ applicationId: APP, locale: "en" }))).rejects.toThrow("NEXT_REDIRECT");
    expect(state.rpcCalls[0]).toEqual({ fn: "delete_application_request", args: { p_application: APP } });
    expect(state.removed).toEqual([["u/a/passport.pdf", "u/a/photo.jpg"]]);
  });

  it("a storage failure after the request is deleted is reported with the count of files that may remain", async () => {
    state.rpcResult = { data: ["u/a/passport.pdf"], error: null };
    state.removeError = { message: "storage unavailable" };
    expect(await deleteApplicationAction(form({ applicationId: APP, locale: "en" }))).toEqual({ ok: false, code: "files_remaining", reference: "1" });
  });

  it("only the owner can delete, and nothing is called without the owner's session", async () => {
    state.admin = false;
    expect(await deleteApplicationAction(form({ applicationId: APP, locale: "en" }))).toEqual({ ok: false, code: "unauthorized" });
    expect(state.rpcCalls).toEqual([]);
    expect(state.removed).toEqual([]);
  });

  it("a request that does not exist is reported as such, and no file is touched", async () => {
    state.rpcResult = { data: null, error: { message: "Request not found." } };
    expect(await deleteApplicationAction(form({ applicationId: APP, locale: "en" }))).toEqual({ ok: false, code: "not_found" });
    expect(state.removed).toEqual([]);
  });
});

describe("owner payment actions go through the database functions, never a direct table write", () => {
  it("recording a payment calls record_manual_payment and writes no table directly", async () => {
    state.rpcResult = { data: PAY, error: null };
    const out = await recordPaymentAction(form({ applicationId: APP, amount: "5000", currency: "DZD", method: "cash", status: "pending", reference: "", note: "", receivedOn: "" }));
    expect(out).toMatchObject({ ok: true, code: "payment_saved" });
    expect(state.rpcCalls[0]?.fn).toBe("record_manual_payment");
    expect(state.tableWrites).not.toContain("payments.insert");
  });

  it("changing a status on a payment with a proof is refused with the protected message, and nothing is written", async () => {
    state.rpcResult = { data: null, error: { message: "A payment with a proof changes only through the owner's decision." } };
    expect(await setPaymentStatusAction(form({ paymentId: PAY, status: "received" }))).toEqual({ ok: false, code: "protected_records" });
    expect(state.rpcCalls[0]?.fn).toBe("set_manual_payment_status");
    expect(state.tableWrites).toEqual([]);
  });

  it("a status change on an ordinary payment is one function call", async () => {
    state.rpcResult = { data: null, error: null };
    expect(await setPaymentStatusAction(form({ paymentId: PAY, status: "cancelled" }))).toEqual({ ok: true, code: "saved" });
    expect(state.tableWrites).toEqual([]);
  });
});
