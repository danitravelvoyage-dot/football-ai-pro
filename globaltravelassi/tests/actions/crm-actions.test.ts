import { describe, it, expect, vi, beforeEach } from "vitest";

/** CRM actions: lead source correction, contact log, customer category. Database replaced by a recorder. */

const ADMIN = "00000000-0000-0000-0000-0000000000a1";
const APP = "00000000-0000-4000-8000-0000000000d1";

const state = vi.hoisted(() => ({
  admin: true,
  current: "instagram" as string | null,
  updates: [] as { table: string; values: Record<string, unknown> }[],
  activity: [] as Record<string, unknown>[],
}));

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("@/lib/email/notify", () => ({ queueCustomerEmail: () => {}, retryFailedCustomerEmails: async () => ({ sent: 0, failed: 0, skipped: 0 }) }));

const fake = () => ({
  auth: { getUser: async () => ({ data: { user: state.admin ? { id: ADMIN } : null } }) },
  from: (table: string) => ({
    select: () => ({
      eq: () => ({
        maybeSingle: async () => ({
          data: table === "profiles" ? (state.admin ? { role: "admin", is_active: true } : null) : { lead_source: state.current },
        }),
      }),
    }),
    update: (values: Record<string, unknown>) => {
      state.updates.push({ table, values });
      return { eq: () => ({ select: async () => ({ data: [{ id: APP }], error: null }) }) };
    },
    insert: (row: Record<string, unknown>) => {
      if (table === "crm_activity") state.activity.push(row);
      return Promise.resolve({ data: null, error: null });
    },
  }),
});
vi.mock("@/lib/supabase/server", () => ({ createServerSupabase: async () => fake() }));

const { correctLeadSourceAction, logContactAction, setCustomerCategoryAction } = await import("@/lib/actions/admin");

const form = (fields: Record<string, string>) => {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.set(k, v);
  return fd;
};

beforeEach(() => {
  state.admin = true;
  state.current = "instagram";
  state.updates = [];
  state.activity = [];
});

describe("lead source correction", () => {
  it("changes the source with the correcting administrator and the reason, and records it in the activity log", async () => {
    expect(await correctLeadSourceAction(form({ applicationId: APP, leadSource: "google", reason: "Found in the ad report" }))).toEqual({ ok: true, code: "saved" });
    expect(state.updates[0]).toMatchObject({ table: "applications", values: { lead_source: "google", lead_source_corrected_by: ADMIN } });
    expect(state.activity[0]).toMatchObject({ kind: "source_corrected", actor_id: ADMIN, application_id: APP });
    expect(String(state.activity[0]!.detail)).toContain("instagram → google: Found in the ad report");
  });

  it("does nothing when the source is already that value", async () => {
    expect(await correctLeadSourceAction(form({ applicationId: APP, leadSource: "instagram", reason: "No change needed" }))).toEqual({ ok: true, code: "saved" });
    expect(state.updates).toEqual([]);
    expect(state.activity).toEqual([]);
  });

  it("refuses a correction without a reason", async () => {
    expect(await correctLeadSourceAction(form({ applicationId: APP, leadSource: "google", reason: "" }))).toMatchObject({ ok: false, code: "invalid_input" });
    expect(state.updates).toEqual([]);
  });

  it("refuses anyone who is not an active administrator", async () => {
    state.admin = false;
    expect(await correctLeadSourceAction(form({ applicationId: APP, leadSource: "google", reason: "Found it" }))).toEqual({ ok: false, code: "unauthorized" });
    expect(state.updates).toEqual([]);
  });
});

describe("contact log", () => {
  it("records the time and the channel of a manual contact, and logs it", async () => {
    expect(await logContactAction(form({ applicationId: APP, channel: "whatsapp", note: "Sent the document list" }))).toEqual({ ok: true, code: "contact_saved" });
    expect(state.updates[0]!.values).toMatchObject({ last_contact_channel: "whatsapp" });
    expect(typeof state.updates[0]!.values.last_contacted_at).toBe("string");
    expect(state.activity[0]).toMatchObject({ kind: "contact_logged" });
  });

  it("refuses an unknown channel", async () => {
    expect(await logContactAction(form({ applicationId: APP, channel: "sms", note: "" }))).toMatchObject({ ok: false, code: "invalid_input" });
  });
});

describe("customer category", () => {
  it("sets the category and logs it", async () => {
    expect(await setCustomerCategoryAction(form({ applicationId: APP, category: "corporate" }))).toEqual({ ok: true, code: "saved" });
    expect(state.updates[0]!.values).toEqual({ customer_category: "corporate" });
    expect(state.activity[0]).toMatchObject({ kind: "category_changed", detail: "corporate" });
  });

  it("refuses an unknown category", async () => {
    expect(await setCustomerCategoryAction(form({ applicationId: APP, category: "vip" }))).toMatchObject({ ok: false, code: "invalid_input" });
  });
});
