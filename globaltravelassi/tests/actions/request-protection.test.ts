import { describe, it, expect, vi, beforeEach } from "vitest";

/** The request form's protections, with the database replaced by a recorder. */

const USER = "00000000-0000-0000-0000-0000000000b1";
const SERVICE = "00000000-0000-4000-8000-0000000000f1";
const TOKEN = "11111111-2222-4333-8444-555555555555";
const EXISTING = "00000000-0000-4000-8000-0000000000e9";

const state = vi.hoisted(() => ({
  active: true,
  allowed: true,
  inserts: [] as Record<string, unknown>[],
  insertError: null as { code: string } | null,
  rpcKeys: [] as string[],
  redirects: [] as string[],
  attribution: null as { source: string; detail: string | null } | null,
  emails: [] as string[],
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
  headers: async () => new Headers({ "x-forwarded-for": "198.51.100.7, 10.0.0.1" }),
  cookies: async () => ({ get: () => undefined }),
}));
vi.mock("@/lib/attribution/cookie", () => ({ currentAttribution: async () => state.attribution }));
vi.mock("@/lib/email/notify", () => ({
  queueCustomerEmail: (_c: unknown, kind: string) => { state.emails.push(kind); },
}));

const fake = () => ({
  auth: { getUser: async () => ({ data: { user: { id: USER } } }) },
  from: (table: string) => ({
    select: () => ({
      eq: () => ({
        eq: () => ({ maybeSingle: async () => ({ data: { id: EXISTING } }) }),
        maybeSingle: async () => ({ data: { is_active: state.active } }),
      }),
    }),
    insert: (row: Record<string, unknown>) => {
      state.inserts.push({ table, ...row });
      return {
        select: () => ({
          single: async () => (state.insertError
            ? { data: null, error: state.insertError }
            : { data: { id: "00000000-0000-4000-8000-0000000000a7", reference: "GTA-1" }, error: null }),
        }),
      };
    },
  }),
  rpc: async (fn: string, args: { p_key?: string }) => {
    if (fn === "consume_rate_limit") {
      state.rpcKeys.push(String(args.p_key));
      return { data: state.allowed, error: null };
    }
    return { data: null, error: null };
  },
});
vi.mock("@/lib/supabase/server", () => ({ createServerSupabase: async () => fake() }));

const { createApplicationAction } = await import("@/lib/actions/applications");

const form = (over: Record<string, string> = {}) => {
  const fd = new FormData();
  const base: Record<string, string> = {
    locale: "fr", submissionToken: TOKEN, website: "", fullName: "Amina Test", email: "amina@example.dz", whatsapp: "0555000111",
    nationality: "DZ", countryOfResidence: "DZ", destinationCountry: "FR", serviceId: SERVICE, travelDate: "",
    employmentStatus: "employed", previousTravelHistory: "", additionalInfo: "", source: "", consent: "on",
  };
  for (const [k, v] of Object.entries({ ...base, ...over })) fd.set(k, v);
  return fd;
};

beforeEach(() => {
  state.active = true;
  state.allowed = true;
  state.inserts = [];
  state.insertError = null;
  state.rpcKeys = [];
  state.redirects = [];
  state.attribution = { source: "tiktok", detail: "summer26" };
  state.emails = [];
});

describe("request form protections", () => {
  it("a filled honeypot is sent to the dashboard as if saved, and nothing is stored", async () => {
    await expect(createApplicationAction(form({ website: "http://spam.example" }))).rejects.toThrow("NEXT_REDIRECT");
    expect(state.redirects).toEqual(["/fr/dashboard"]);
    expect(state.inserts).toEqual([]);
  });

  it("refuses a submission without a valid one-time token", async () => {
    expect(await createApplicationAction(form({ submissionToken: "not-a-token" }))).toMatchObject({ ok: false, code: "invalid_input" });
    expect(state.inserts).toEqual([]);
  });

  it("refuses a request from a disabled account before anything is stored", async () => {
    state.active = false;
    expect(await createApplicationAction(form())).toEqual({ ok: false, code: "disabled" });
    expect(state.inserts).toEqual([]);
  });

  it("refuses when the rate limit is reached, and keys the limit by a hash, never the raw id or address", async () => {
    state.allowed = false;
    expect(await createApplicationAction(form())).toEqual({ ok: false, code: "rate_limited" });
    expect(state.inserts).toEqual([]);
    expect(state.rpcKeys.length).toBeGreaterThanOrEqual(1);
    for (const key of state.rpcKeys) {
      expect(key).toMatch(/^apply-(account|address):[0-9a-f]{40}$/);
      expect(key).not.toContain(USER);
      expect(key).not.toContain("198.51.100.7");
    }
  });

  it("records the source from the first-visit cookie, never from the form", async () => {
    await expect(createApplicationAction(form({ source: "fake-source" }))).rejects.toThrow("NEXT_REDIRECT");
    expect(state.inserts[0]).toMatchObject({ lead_source: "tiktok", lead_source_detail: "summer26", submission_token: TOKEN });
  });

  it("records 'other' when the cookie is missing or blocked, never a guessed channel", async () => {
    state.attribution = null;
    await expect(createApplicationAction(form())).rejects.toThrow("NEXT_REDIRECT");
    expect(state.inserts[0]).toMatchObject({ lead_source: "other", lead_source_detail: null });
  });

  it("a repeated submission with the same token returns the first request, and stores nothing new", async () => {
    state.insertError = { code: "23505" };
    await expect(createApplicationAction(form())).rejects.toThrow("NEXT_REDIRECT");
    expect(state.redirects).toEqual([`/fr/dashboard/requests/${EXISTING}?created=1`]);
    expect(state.emails).toEqual([]);
  });

  it("a successful request redirects to its confirmation and queues the received email", async () => {
    await expect(createApplicationAction(form())).rejects.toThrow("NEXT_REDIRECT");
    expect(state.redirects).toEqual(["/fr/dashboard/requests/00000000-0000-4000-8000-0000000000a7?created=1"]);
    expect(state.emails).toEqual(["application_received"]);
  });
});
