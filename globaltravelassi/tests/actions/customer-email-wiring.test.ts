import { describe, it, expect, beforeEach, vi } from "vitest";

/**
 * Which email each action queues, and the launch-audit fixes in the same actions: disabled accounts, the system-only
 * "payment pending" status, the timeline write, and the locale in the deletion redirect. The database is a recorder.
 */

const ADMIN = "00000000-0000-0000-0000-0000000000a1";
const USER = "00000000-0000-0000-0000-0000000000b1";
const APP = "00000000-0000-4000-8000-0000000000d1";
const EVENT = "00000000-0000-4000-8000-0000000000e1";
const DOC = "00000000-0000-4000-8000-0000000000c1";
const SERVICE = "00000000-0000-4000-8000-0000000000f1";

const state = vi.hoisted(() => ({
  user: null as string | null,
  role: "customer" as "customer" | "admin",
  active: true,
  emails: [] as { kind: string; subject: string }[],
  inserts: [] as { table: string; row: Record<string, unknown> }[],
  eventError: false,
  redirects: [] as string[],
}));

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    state.redirects.push(url);
    throw Object.assign(new Error("NEXT_REDIRECT"), { digest: `NEXT_REDIRECT;${url}` });
  },
}));
vi.mock("next/headers", () => ({
  headers: async () => new Headers({ "x-forwarded-for": "198.51.100.7" }),
  cookies: async () => ({ get: () => undefined }),
}));
vi.mock("@/lib/attribution/cookie", () => ({
  currentAttribution: async () => ({ source: "tiktok", detail: "summer26" }),
}));
vi.mock("@/lib/email/notify", () => ({
  queueCustomerEmail: (_c: unknown, kind: string, subject: string) => { state.emails.push({ kind, subject }); },
  retryFailedCustomerEmails: async () => ({ sent: 0, failed: 0, skipped: 0 }),
}));

const fake = () => ({
  auth: { getUser: async () => ({ data: { user: state.user ? { id: state.user } : null } }) },
  from: (table: string) => ({
    select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: state.user ? { role: state.role, is_active: state.active } : null }) }) }),
    insert: (row: Record<string, unknown>) => {
      state.inserts.push({ table, row });
      const id = table === "applications" ? APP : table === "documents" ? DOC : EVENT;
      const failed = table === "application_events" && state.eventError;
      const result = { data: failed ? null : { id, reference: "GTA-1" }, error: failed ? { code: "42501" } : null };
      return { select: () => ({ single: async () => result }), then: (r: (v: unknown) => unknown) => r(result) };
    },
    update: () => ({ eq: () => ({ select: async () => ({ data: [{ id: APP, status: "x" }], error: null }) }) }),
  }),
  rpc: async (fn: string) => ({ data: fn === "consume_rate_limit" ? true : [], error: null }),
  storage: {
    from: () => ({
      remove: async () => ({ error: null }),
      // A real PDF signature: the document check reads the first bytes.
      download: async () => ({ data: new Blob([new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x37])]), error: null }),
    }),
  },
});
vi.mock("@/lib/supabase/server", () => ({ createServerSupabase: async () => fake() }));

const { updateStatusAction, setDocumentVerifiedAction, deleteApplicationAction } = await import("@/lib/actions/admin");
const { createApplicationAction } = await import("@/lib/actions/applications");
const { registerDocumentAction } = await import("@/lib/actions/documents");

const form = (fields: Record<string, string>) => {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.set(k, v);
  return fd;
};
const asAdmin = () => { state.user = ADMIN; state.role = "admin"; state.active = true; };
const asCustomer = (active = true) => { state.user = USER; state.role = "customer"; state.active = active; };

const applicationForm = () => form({
  submissionToken: "11111111-2222-4333-8444-555555555555", website: "", locale: "fr", fullName: "Amina Test", email: "amina@example.dz", whatsapp: "0555000111", nationality: "DZ",
  countryOfResidence: "DZ", destinationCountry: "FR", serviceId: SERVICE, travelDate: "", employmentStatus: "employed",
  previousTravelHistory: "", additionalInfo: "", source: "", consent: "on",
});

beforeEach(() => {
  state.emails = [];
  state.inserts = [];
  state.eventError = false;
  state.redirects = [];
});

describe("owner status changes", () => {
  for (const [status, kind] of [
    ["documents_required", "additional_documents_requested"],
    ["approved", "application_approved"],
    ["rejected", "application_rejected"],
    ["in_review", "application_status_updated"],
    ["completed", "application_status_updated"],
  ] as const) {
    it(`${status} queues ${kind} for the timeline event`, async () => {
      asAdmin();
      expect(await updateStatusAction(form({ applicationId: APP, status, message: "" }))).toMatchObject({ ok: true });
      expect(state.emails).toEqual([{ kind, subject: EVENT }]);
    });
  }

  it("refuses to set 'payment pending' by hand: only a proof submission sets it", async () => {
    asAdmin();
    expect(await updateStatusAction(form({ applicationId: APP, status: "payment_pending", message: "" }))).toMatchObject({ ok: false, code: "invalid_input" });
    expect(state.emails).toEqual([]);
  });

  it("reports a status saved without its timeline event, and sends no email", async () => {
    asAdmin();
    state.eventError = true;
    expect(await updateStatusAction(form({ applicationId: APP, status: "approved", message: "" }))).toEqual({ ok: false, code: "timeline_not_saved" });
    expect(state.emails).toEqual([]);
  });

  it("does nothing for a customer session", async () => {
    asCustomer();
    expect(await updateStatusAction(form({ applicationId: APP, status: "approved", message: "" }))).toEqual({ ok: false, code: "unauthorized" });
    expect(state.emails).toEqual([]);
  });

  it("queues the document review email", async () => {
    asAdmin();
    await setDocumentVerifiedAction(form({ documentId: DOC, verified: "true" }));
    expect(state.emails).toEqual([{ kind: "document_review_result", subject: DOC }]);
  });
});

describe("request deletion redirect", () => {
  it("ignores a crafted locale, so the redirect stays on this site", async () => {
    asAdmin();
    await expect(deleteApplicationAction(form({ applicationId: APP, locale: "/evil.example" }))).rejects.toThrow("NEXT_REDIRECT");
    expect(state.redirects).toEqual(["/ar/admin/applications?deleted=1"]);
  });
});

describe("customer actions", () => {
  it("a new request records its language and queues the received email", async () => {
    asCustomer();
    await expect(createApplicationAction(applicationForm())).rejects.toThrow("NEXT_REDIRECT");
    expect(state.inserts[0]).toMatchObject({
      table: "applications",
      row: { user_id: USER, locale: "fr", lead_source: "tiktok", lead_source_detail: "summer26", submission_token: "11111111-2222-4333-8444-555555555555" },
    });
    expect(state.emails).toEqual([{ kind: "application_received", subject: APP }]);
  });

  it("a disabled account cannot create a request or register a document", async () => {
    asCustomer(false);
    expect(await createApplicationAction(applicationForm())).toEqual({ ok: false, code: "disabled" });
    expect(await registerDocumentAction({ applicationId: APP, docType: "passport", fileName: "p.pdf", mimeType: "application/pdf", sizeBytes: 10, storagePath: `${USER}/${APP}/p.pdf`, locale: "en" })).toEqual({ ok: false, code: "disabled" });
    expect(state.inserts).toEqual([]);
    expect(state.emails).toEqual([]);
  });

  it("a registered document queues the upload confirmation", async () => {
    asCustomer();
    const result = await registerDocumentAction({ applicationId: APP, docType: "passport", fileName: "p.pdf", mimeType: "application/pdf", sizeBytes: 10, storagePath: `${USER}/${APP}/p.pdf`, locale: "en" });
    expect(result).toMatchObject({ ok: true, id: DOC });
    expect(state.emails).toEqual([{ kind: "document_upload_confirmed", subject: DOC }]);
  });
});
